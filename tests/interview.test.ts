import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type {
  LiveServerMessage,
  Session,
  LiveConnectParameters,
} from "@google/genai";
import { createApp } from "../server/app.ts";
import { Store, type Shop } from "../server/store.ts";
import {
  interview,
  interviewText,
  saveInterview,
} from "../server/interview.ts";
import {
  propose,
  proposeArticle,
  identifyVisual,
  explainSystem,
} from "../server/ai.ts";

test("interview survives interruption, validates fields and versions, and never approves a plan", async (t) => {
  process.env.DEMO_MODE = "true";
  process.env.VERTEX_LIVE_MODEL = "fixture-live";
  const store = new Store(":memory:");
  let connection: LiveConnectParameters | undefined;
  const toolResponses: unknown[] = [];
  const contexts: unknown[] = [];
  const connector = async (parameters: LiveConnectParameters) => {
    connection = parameters;
    return {
      sendClientContent(value: unknown) { contexts.push(value); },
      sendRealtimeInput() {},
      sendToolResponse(value: unknown) {
        toolResponses.push(value);
      },
      close() {
        parameters.callbacks.onclose?.({} as CloseEvent);
      },
    } as unknown as Session;
  };
  const server = createApp(
    store,
    {
      propose,
      proposeArticle,
      identifyVisual,
      explainSystem,
      normalizeTurn: async (text) => ({
        fields: { name: text },
        question: "メニューを教えてください",
        ready: false,
      }),
    },
    connector,
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => {
    server.close();
    delete process.env.VERTEX_LIVE_MODEL;
  });
  async function api(path: string, data?: unknown, cookie = "") {
    const response = await fetch(origin + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
    };
  }
  const owner = (await api("/api/demo-login", { role: "owner" })).cookie;
  const shop: Shop = (await api("/api/workspace", undefined, owner)).body
    .shops[0];
  const base = `/api/shops/${shop.id}`;
  assert.equal((await api(base + "/interview")).status, 403);
  assert.equal(
    (
      await api(
        base + "/interview",
        { fields: { evil: "value" }, version: 0 },
        owner,
      )
    ).status,
    400,
  );
  const turn = await api(base + "/interview/turn", { text: "凪" }, owner);
  assert.equal(turn.status, 200);
  assert.equal(turn.body.state.fields.name, "凪");
  assert.equal(
    (
      await api(
        base + "/interview",
        { fields: { name: "別名" }, version: 0 },
        owner,
      )
    ).status,
    409,
  );
  assert.equal(
    (await api(base + "/interview", undefined, owner)).body.fields.name,
    "凪",
  );
  const messages: any[] = [];
  const ws = new WebSocket(origin.replace("http:", "ws:") + base + "/live", {
    headers: { Origin: origin, Cookie: owner },
  });
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  async function until(predicate: () => boolean) {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail("timed out");
  }
  await until(() => messages.some((m) => m.type === "ready"));
  assert.ok(connection?.config?.contextWindowCompression);
  assert.deepEqual(connection?.config?.sessionResumption, {});
  const emit = async (message: LiveServerMessage) => {
    connection!.callbacks.onmessage(message);
    await new Promise((r) => setTimeout(r, 20));
  };
  ws.send(JSON.stringify({ type: "context", messages: [{ role: "user", text: "営業時間を確認したい" }] }));
  await until(() => contexts.some(value => JSON.stringify(value).includes("営業時間を確認したい")));
  await emit({ serverContent: { inputTranscription: { text: "何時まで？" }, outputTranscription: { text: "18時までです。" }, turnComplete: true } } as LiveServerMessage);
  await until(() => messages.some(message => message.type === "answer" && message.text === "何時まで？" && message.answer === "18時までです。"));
  assert.equal((await store.list("plan")).length, 0);
  await emit({
    sessionResumptionUpdate: { resumable: true, newHandle: "resume-handle" },
  } as unknown as LiveServerMessage);
  await emit({
    toolCall: {
      functionCalls: [
        {
          id: "one",
          name: "update_interview",
          args: { field: "menus", value: "シンプル 60分 5500円" },
        },
      ],
    },
  } as unknown as LiveServerMessage);
  assert.equal(
    (await interview(store, shop)).fields.menus,
    "シンプル 60分 5500円",
  );
  await emit({
    toolCall: {
      functionCalls: [{ id: "two", name: "present_plan", args: {} }],
    },
  } as unknown as LiveServerMessage);
  assert.ok(messages.some((m) => m.type === "error"));
  assert.ok(!messages.some((m) => m.type === "plan"));
  await store.locked(shop.id, () =>
    saveInterview(store, shop, {
      industry: "nail",
      staff: "店主1名・全メニュー・営業中勤務",
      hours: "10:00〜18:00",
      closed: "火曜日",
      rules: "指名、30日前から60分前まで、当日可、キャンセル24時間前",
      notificationEmail: shop.owner,
    }),
  );
  await emit({
    toolCall: {
      functionCalls: [{ id: "three", name: "present_plan", args: {} }],
    },
  } as unknown as LiveServerMessage);
  assert.ok(
    messages.some((m) => m.type === "plan" && m.text.includes("5500円")),
  );
  assert.equal((await store.list("plan")).length, 0);
  assert.equal((await store.shop(shop.id))?.published, null);
  assert.match(interviewText(await interview(store, shop), false), /凪/);
  ws.close();
  await new Promise((r) => ws.on("close", r));
  const resumed = new WebSocket(
    origin.replace("http:", "ws:") + base + "/live",
    { headers: { Origin: origin, Cookie: owner } },
  );
  resumed.on("error", () => {});
  await new Promise((r) => resumed.on("open", r));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(connection?.config?.sessionResumption?.handle, "resume-handle");
  resumed.close();
  await new Promise((r) => resumed.on("close", r));
  await assert.rejects(
    () =>
      new Promise((resolve, reject) => {
        const denied = new WebSocket(
          origin.replace("http:", "ws:") + base + "/live",
          { headers: { Origin: "https://other.example", Cookie: owner } },
        );
        denied.on("open", resolve);
        denied.on("error", reject);
      }),
    /403/,
  );
  shop.revision++;
  await store.saveShop(shop);
  assert.deepEqual((await interview(store, shop)).fields, {});
  assert.equal(
    (
      await api(
        base + "/interview/plan",
        { fields: { changes: "修正" }, version: 0 },
        owner,
      )
    ).status,
    400,
  );
  assert.equal((await store.list("plan")).length, 0);
  assert.ok(toolResponses.length >= 3);
});
