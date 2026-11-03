import { tr } from "../shared/i18n.ts";
import type { IncomingMessage, Server } from "node:http";
import { GoogleGenAI, Modality, Type, type FunctionResponse, type LiveConnectParameters, type Session as LiveSession } from "@google/genai";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { origin } from "./auth.ts";
import { conversationInstruction, conversationTool, draftText, type ShopData, type Source } from "./assistant.ts";

// Voice for the same shop assistant through the Gemini Live API on Vertex AI. The browser streams
// 16 kHz PCM through this server; Gemini answers in short speech. Live has the same two tools as text
// chat: `investigate` (the read-only research layer) and `draft_request`. Drafts are shown on screen
// and only on-screen approval applies them: spoken agreement is never approval.

export type LiveConnector = (parameters: LiveConnectParameters) => Promise<LiveSession>;
export type LiveAccess = { data: ShopData; close?: () => void };
const defaultConnector: LiveConnector = parameters => new GoogleGenAI({
  vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.VERTEX_LIVE_LOCATION || "us-central1",
}).live.connect(parameters);
export const liveConfigured = () => !!process.env.GOOGLE_CLOUD_PROJECT && !!process.env.VERTEX_LIVE_MODEL;

const clientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("audio"), data: z.string().max(50000).regex(/^[A-Za-z0-9+/]+=*$/) }).strict(),
  z.object({ type: z.literal("context"), messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) })).max(6) }).strict(),
]);

/**
 * Accepts WebSocket upgrades on /api/shops/:id/assistant/live. `authorize` checks the session and
 * shop (and charges a judge's quota once per conversation) and returns the shop's documents.
 */
export function attachAssistantLive(server: Server, authorize: (req: IncomingMessage, shopId: string) => Promise<LiveAccess | undefined>, connector: LiveConnector = defaultConnector) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  server.on("upgrade", (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url || "/", origin());
      const match = url.pathname.match(/^\/api\/shops\/([^/]+)\/assistant\/live$/);
      if (!match) return;
      const access = req.headers.origin === origin() && req.headers.host === new URL(origin()).host && liveConfigured()
        ? await authorize(req, match[1]).catch(() => undefined) : undefined;
      if (!access) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(req, socket, head, ws => {
        void converse(ws, access).catch(() => ws.close(1011, tr("音声会話に接続できませんでした")));
      });
    })().catch(() => socket.destroy());
  });

  async function converse(ws: WebSocket, access: LiveAccess) {
    let live: LiveSession | undefined;
    let stopped = false;
    let heard = "", spoken = "";
    let frames = 0, windowStart = Date.now();
    const send = (value: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
    const limit = setTimeout(() => ws.close(1000, tr("15分たったため音声会話を終了しました")), 15 * 60000);
    limit.unref();
    ws.on("close", () => { stopped = true; clearTimeout(limit); live?.close(); access.close?.(); });
    ws.on("message", raw => {
      try {
        if (Date.now() - windowStart > 1000) { frames = 0; windowStart = Date.now(); }
        if (++frames > 80) throw new Error("rate");
        const input = clientMessage.parse(JSON.parse(raw.toString()));
        if (input.type === "context") {
          live?.sendClientContent({ turns: [{ role: "user", parts: [{ text: tr("これまでの文字のやりとりです。参考にして、これからの音声の質問に答えてください。\n{0}", JSON.stringify(input.messages)) }] }], turnComplete: false });
          return;
        }
        live?.sendRealtimeInput({ audio: { data: input.data, mimeType: "audio/pcm;rate=16000" } });
      } catch { ws.close(1008, tr("入力を確認してください")); }
    });
    live = await connector({
      model: process.env.VERTEX_LIVE_MODEL!,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { triggerTokens: "24000", slidingWindow: { targetTokens: "12000" } },
        systemInstruction: conversationInstruction(true),
        tools: [{ functionDeclarations: [
          { name: "investigate", description: tr("お店のシステム・設定・経緯・実データについての事実を調査担当に調べてもらう。事実の質問には必ずこれを使う。"), parameters: { type: Type.OBJECT, properties: { question: { type: Type.STRING, description: tr("調べたいこと。会話の文脈を補って一文で") } }, required: ["question"] } },
          { name: "draft_request", description: tr("設定の変更や新しいページの作成を頼まれたとき、依頼文の下書きを画面に出す。反映はしない。"), parameters: { type: Type.OBJECT, properties: {
            change: { type: Type.STRING, description: tr("頼まれた変更の内容。時期や対象を具体的に") },
            constraints: { type: Type.ARRAY, items: { type: Type.STRING }, description: tr("この依頼に特有の注意点（任意）") },
          }, required: ["change"] } },
        ] }],
      },
      callbacks: {
        onmessage: message => {
          if (stopped) return;
          const content = message.serverContent;
          if (content?.inputTranscription?.text) { heard += content.inputTranscription.text; send({ type: "heard", text: content.inputTranscription.text }); }
          if (content?.outputTranscription?.text) { spoken += content.outputTranscription.text; send({ type: "spoken", text: content.outputTranscription.text }); }
          if (content?.interrupted) send({ type: "interrupted" });
          for (const part of content?.modelTurn?.parts || []) if (part.inlineData?.data) send({ type: "audio", data: part.inlineData.data, mimeType: part.inlineData.mimeType });
          if (content?.turnComplete) {
            if (heard.trim() || spoken.trim()) send({ type: "turn", question: heard.trim(), answer: spoken.trim() });
            heard = ""; spoken = "";
          }
          const calls = message.toolCall?.functionCalls || [];
          if (!calls.length) return;
          // Research may take several seconds; the model has already said a short acknowledgement.
          void Promise.all(calls.map(async (call): Promise<FunctionResponse> => {
            try {
              const response = await conversationTool(call.name, call.args, access.data,
                draft => send({ type: "draft", draft, text: draftText(draft) }),
                (sources: Source[]) => send({ type: "sources", sources }));
              return { id: call.id, name: call.name, response };
            } catch (error) {
              return { id: call.id, name: call.name, response: { error: error instanceof Error ? error.message : tr("処理できませんでした") } };
            }
          })).then(functionResponses => { if (!stopped) live?.sendToolResponse({ functionResponses }); });
        },
        onerror: () => send({ type: "error", message: tr("音声接続が中断しました。文字入力をご利用ください。") }),
        onclose: () => { live = undefined; if (!stopped) ws.close(1000, tr("音声会話を終了しました")); },
      },
    });
    if (stopped) { live.close(); return; }
    send({ type: "ready" });
  }
}
