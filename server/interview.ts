import {
  GoogleGenAI,
  Modality,
  Type,
  type Session as LiveSession,
  type LiveConnectParameters,
} from "@google/genai";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { z } from "zod";
import { Store, type Shop, type User } from "./store.ts";
import { session, origin } from "./auth.ts";
import { readConfig } from "./google.ts";

export const fieldLabels = {
  name: "店名",
  industry: "業種",
  menus: "メニュー・所要時間・料金",
  staff: "スタッフ・対応メニュー・勤務",
  hours: "営業時間",
  closed: "定休日・臨時休業",
  rules: "予約方法・受付期限・当日予約・キャンセル",
  notificationEmail: "通知メール",
  changes: "変更したいこと",
};
export const fieldsSchema = z
  .object(
    Object.fromEntries(
      Object.keys(fieldLabels).map((k) => [k, z.string().max(6000).optional()]),
    ),
  )
  .strict();
export type Interview = {
  shopId: string;
  base: number;
  fields: Record<string, string>;
  version: number;
  handle?: string;
  updatedAt: number;
};
export async function interview(store: Store, shop: Shop): Promise<Interview> {
  const old = await store.get<Interview>("interview", shop.id);
  return old?.base === shop.revision
    ? old
    : {
        shopId: shop.id,
        base: shop.revision,
        fields: {},
        version: 0,
        updatedAt: Date.now(),
      };
}
export function interviewText(state: Interview, published: boolean) {
  const keys = published
    ? ["changes"]
    : Object.keys(fieldLabels).filter((k) => k !== "changes");
  if (keys.some((k) => !state.fields[k]?.trim()))
    throw Object.assign(
      new Error("不足している項目を会話か画面で確認してください"),
      { status: 400 },
    );
  return Object.entries(state.fields)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${fieldLabels[k as keyof typeof fieldLabels]}: ${v}`)
    .join("\n");
}
export async function saveInterview(
  store: Store,
  shop: Shop,
  fields: unknown,
  version?: number,
) {
  const state = await interview(store, shop);
  if (version !== undefined && state.version !== version)
    throw Object.assign(
      new Error("会話内容が更新されました。もう一度確認してください"),
      { status: 409 },
    );
  state.fields = { ...state.fields, ...fieldsSchema.parse(fields) } as Record<
    string,
    string
  >;
  state.version++;
  state.updatedAt = Date.now();
  await store.put("interview", shop.id, state);
  return state;
}
function client(live = false) {
  if (!process.env.GOOGLE_CLOUD_PROJECT)
    throw Object.assign(
      new Error(
        "音声会話の接続がまだ設定されていません。文字入力も利用できます。",
      ),
      { status: 503 },
    );
  return new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: live
      ? process.env.VERTEX_LIVE_LOCATION || "us-central1"
      : process.env.GOOGLE_CLOUD_LOCATION || "global",
  });
}
const instruction =
  "個人商店の予約システムの聞き取り担当。日本語で短く一つずつ質問する。既存店では依頼された変更だけを聞く。未提供の店名・料金・日時・ルールを捏造しない。曖昧な条件は確認。確定情報を update_interview で都度反映し、不足項目を続けて聞く。初回は店名、業種、メニュー（名前・分・円）、スタッフ（対応メニュー・勤務）、営業時間、休日、予約ルール（何日前から、何分前まで、当日可否、キャンセル期限）、通知メールを揃える。変更依頼はchangesに内容をまとめる。不要な項目は「なし」と確認する。揃ったら present_plan を呼ぶ。予約時の指名・指名なしは常にお客様が選べるため、店主に方式を選ばせない。承認・公開・データ変更は一切できない。プランは必ず画面で確認・承認してもらう。";
export async function normalizeTurn(
  text: string,
  current: Interview,
  published: boolean,
) {
  if (!process.env.VERTEX_FLASH_LITE_MODEL)
    throw Object.assign(
      new Error(
        "リアルタイム整形のモデルが未設定です。文字入力はそのまま使えます。",
      ),
      { status: 503 },
    );
  const schema = z.object({
    fields: fieldsSchema,
    question: z.string().max(2000),
    ready: z.boolean(),
  });
  const response = await client().models.generateContent({
    model: process.env.VERTEX_FLASH_LITE_MODEL,
    contents: JSON.stringify({ text, confirmed: current.fields, published }),
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: schema.toJSONSchema(),
      systemInstruction:
        instruction +
        " 回答から確定した項目だけfieldsに返す。questionには次の質問、揃ったらready=true。",
    },
  });
  return schema.parse(JSON.parse(response.text || "{}"));
}
export type LiveConnector = (
  parameters: LiveConnectParameters,
) => Promise<LiveSession>;
export function attachLive(
  server: Server,
  store: Store,
  connector: LiveConnector = (parameters) =>
    client(true).live.connect(parameters),
) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  server.on("upgrade", (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url || "/", origin());
      const match = url.pathname.match(/^\/api\/shops\/([^/]+)\/live$/);
      const identity = await session(store, req);
      const shop = match ? await store.shop(match[1]) : undefined;
      if (
        req.headers.origin !== origin() ||
        req.headers.host !== new URL(origin()).host ||
        !shop ||
        identity?.user.email !== shop.owner ||
        !process.env.VERTEX_LIVE_MODEL
      ) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(req, socket, head, (ws) => {
        void connect(ws, shop, identity.user).catch(() => {
          ws.close(1011, "音声会話に接続できませんでした");
        });
      });
    })().catch(() => socket.destroy());
  });
  async function connect(ws: WebSocket, shop: Shop, user: User) {
    let live: LiveSession | undefined;
    let stopped = false;
    let retry = 0;
    let outputQueue = Promise.resolve();
    const send = (value: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
    };
    let frames = 0;
    let windowStart = Date.now();
    const timer = setTimeout(
      () => ws.close(1000, "再接続してください"),
      60 * 60000,
    );
    timer.unref();
    ws.on("close", () => {
      stopped = true;
      clearTimeout(timer);
      live?.close();
    });
    async function open(resume = true) {
      const currentShop = await store.shop(shop.id);
      if (
        !currentShop ||
        currentShop.owner !== user.email ||
        currentShop.revision !== shop.revision
      ) {
        ws.close(1000, "公開内容が変わりました");
        return;
      }
      const state = await interview(store, shop);
      const token = (await store.get<User>("user", shop.owner))?.refreshToken;
      const config =
        shop.google && token ? await readConfig(shop, token) : shop.published;
      send({ type: "state", state });
      live = await connector({
        model: process.env.VERTEX_LIVE_MODEL!,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: {
            triggerTokens: "24000",
            slidingWindow: { targetTokens: "12000" },
          },
          sessionResumption:
            resume && state.handle ? { handle: state.handle } : {},
          systemInstruction:
            instruction +
            "\n既存設定と確定内容：" +
            JSON.stringify({ config, fields: state.fields }),
          tools: [
            {
              functionDeclarations: [
                {
                  name: "update_interview",
                  description: "確定した項目を画面に反映する",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      field: {
                        type: Type.STRING,
                        enum: Object.keys(fieldLabels),
                      },
                      value: { type: Type.STRING },
                    },
                    required: ["field", "value"],
                  },
                },
                {
                  name: "present_plan",
                  description: "項目が揃ったら未承認プランを画面に提示する",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
              ],
            },
          ],
        },
        callbacks: {
          onmessage: (message) => {
            if (stopped) return;
            if (message.serverContent?.interrupted)
              send({ type: "interrupted" });
            for (const part of message.serverContent?.modelTurn?.parts || [])
              if (part.inlineData?.data)
                send({ type: "audio", ...part.inlineData });
            if (message.serverContent?.inputTranscription?.text)
              send({
                type: "transcript",
                text: message.serverContent.inputTranscription.text,
              });
            if (message.serverContent?.outputTranscription?.text)
              send({
                type: "question",
                text: message.serverContent.outputTranscription.text,
              });
            outputQueue = outputQueue
              .then(async () => {
                if (
                  message.sessionResumptionUpdate?.resumable &&
                  message.sessionResumptionUpdate.newHandle
                )
                  await store.locked(shop.id, async () => {
                    const state = await interview(store, shop);
                    state.handle = message.sessionResumptionUpdate!.newHandle;
                    await store.put("interview", shop.id, state);
                  });
                for (const call of message.toolCall?.functionCalls || []) {
                  let response: Record<string, unknown>;
                  try {
                    response = await store.locked(shop.id, async () => {
                      const fresh = await store.shop(shop.id);
                      if (
                        fresh?.owner !== user.email ||
                        fresh.revision !== shop.revision
                      )
                        throw new Error(
                          "公開内容が変わりました。会話を再開してください",
                        );
                      if (call.name === "update_interview") {
                        const args = z
                          .object({
                            field: z.enum(
                              Object.keys(fieldLabels) as [string, ...string[]],
                            ),
                            value: z.string().max(6000),
                          })
                          .parse(call.args);
                        const state = await saveInterview(store, shop, {
                          [args.field]: args.value,
                        });
                        send({ type: "state", state });
                        return { ok: true };
                      }
                      if (call.name !== "present_plan")
                        throw new Error("許可されていない操作です");
                      const state = await interview(store, shop);
                      send({
                        type: "plan",
                        text: interviewText(state, !!shop.published),
                      });
                      return { ok: true, approval: "画面で承認してください" };
                    });
                  } catch (e) {
                    response = { error: (e as Error).message };
                    send({ type: "error", message: (e as Error).message });
                  }
                  live?.sendToolResponse({
                    functionResponses: [
                      { id: call.id, name: call.name, response },
                    ],
                  });
                }
                if (message.goAway) {
                  live?.close();
                }
              })
              .catch(() => ws.close(1011, "会話内容を保存できませんでした"));
          },
          onerror: () =>
            send({
              type: "error",
              message:
                "音声接続が中断しました。再接続するか文字入力をご利用ください。",
            }),
          onclose: () => {
            live = undefined;
            if (stopped) return;
            if (++retry > 3) {
              ws.close(1011, "接続を再開してください");
              return;
            }
            send({ type: "reconnecting" });
            void outputQueue
              .then(() => open(retry < 3))
              .catch(() => ws.close(1011, "再接続できませんでした"));
          },
        },
      });
      if (stopped) {
        live.close();
        return;
      }
      send({ type: "ready" });
      if (!resume || !state.handle)
        live.sendClientContent({
          turns: [
            {
              role: "user",
              parts: [
                { text: "確定内容を確認して、続きの質問を一つお願いします。" },
              ],
            },
          ],
          turnComplete: true,
        });
    }
    ws.on("message", (raw) => {
      try {
        if (Date.now() - windowStart > 1000) {
          frames = 0;
          windowStart = Date.now();
        }
        if (++frames > 80) throw new Error();
        const input = z
          .object({
            type: z.literal("audio"),
            data: z
              .string()
              .max(50000)
              .regex(/^[A-Za-z0-9+/]+=*$/),
          })
          .strict()
          .parse(JSON.parse(raw.toString()));
        live?.sendRealtimeInput({
          audio: { data: input.data, mimeType: "audio/pcm;rate=16000" },
        });
      } catch {
        ws.close(1008, "入力を確認してください");
      }
    });
    try {
      await open();
    } catch {
      clearTimeout(timer);
      live?.close();
      ws.close(1011, "音声会話の設定・接続を確認してください");
    }
  }
  server.on("close", () => {
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
  });
}
