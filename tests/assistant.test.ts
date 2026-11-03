import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import type OpenAI from "openai";
import type { LiveConnectParameters, Session as LiveSession } from "@google/genai";
import { createApp } from "../server/app.ts";
import { Store, type Shop, type User } from "../server/store.ts";
import { sample, documents } from "../server/domain.ts";
import { digest } from "../server/auth.ts";
import { converse, draftText, fixedConstraints, research, systemBundle, type ShopData } from "../server/assistant.ts";
import { setOpenAiClient, setProviderResolver } from "../server/llm.ts";

process.env.DEMO_MODE = "true";
process.env.OPENAI_API_KEY = "test";
process.env.OPENAI_MODEL = "test-model";

type Body = { instructions?: string; input: unknown[]; tools?: unknown[]; text?: unknown };
/** A scripted OpenAI client: each layer (conversation / research) answers from its own queue. */
function scripted(conversation: object[], researchSteps: object[]) {
  const seen: Body[] = [];
  setProviderResolver(async () => "openai");
  setOpenAiClient({ responses: { create: async (body: Body) => {
    seen.push(body);
    const queue = /research layer|調査担当/.test(body.instructions || "") ? researchSteps : conversation;
    const next = queue.shift();
    assert.ok(next, `unexpected model call: ${body.instructions?.slice(0, 40)}`);
    return next;
  } } } as unknown as OpenAI);
  return seen;
}
const call = (name: string, args: object, id = "c1") => ({ output_text: "", output: [{ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output_text: text, output: [] });
function shopData(records: Record<string, unknown[]> = {}): ShopData & { reads: string[] } {
  const reads: string[] = [];
  return { reads, today: "2026-11-03", documents: documents(sample, [{ at: "2026-10-01T00:00:00Z", summary: "営業時間・休業日を更新", request: "水曜は仕込みに充てたいので定休日にして" }]),
    records: async kind => { reads.push(kind); return records[kind] || []; } };
}

test("the shared system OKF bundle is v0.2 with complete chapter frontmatter and indexed chapters", () => {
  const bundle = systemBundle();
  assert.match(bundle["system/index.md"], /^---\nokf_version: "0\.2"\n---/);
  const chapters = Object.keys(bundle).filter(path => path !== "system/index.md");
  assert.ok(chapters.length >= 5);
  for (const path of chapters) {
    for (const field of ["type", "title", "description", "tags", "updated"]) assert.match(bundle[path], new RegExp(`^${field}: `, "m"), `${path} ${field}`);
    assert.match(bundle["system/index.md"], new RegExp(`\\(\\./${path.slice("system/".length).replace(".", "\\.")}\\)`), `${path} is indexed`);
  }
});

test("research reads records and chapters read-only and keeps only sources it actually read", async () => {
  const data = shopData({ bookings: [{ id: "b1", start: "2026-11-04T10:00:00+09:00", status: "active" }, { id: "b2", start: "2026-11-05T10:00:00+09:00", status: "active" }] });
  scripted([], [
    call("read_records", { kind: "bookings" }),
    call("read_system_file", { path: "payments.md" }, "c2"),
    say(""),
    say(JSON.stringify({ answer: "今週の予約は2件です（予約台帳）。", sources: ["sheet:bookings", "system/payments.md", "system/booking.md"] })),
  ]);
  const result = await research("今週の予約は何件？", data);
  assert.equal(result.answer, "今週の予約は2件です（予約台帳）。");
  assert.deepEqual(data.reads, ["bookings"]);
  assert.deepEqual(result.sources.map(source => source.path), ["sheet:bookings", "system/payments.md"], "unread chapters are not cited");
});

test("the conversation layer researches facts and turns change requests into a draft without applying anything", async () => {
  const data = shopData();
  let seen = scripted([call("investigate", { question: "キャンセル時の返金ルール" }), say("開始72時間前までなら全額返金です。")], [
    say(""), say(JSON.stringify({ answer: "rules.payment.refundTiers により72時間前まで100%返金。", sources: ["spec.md"] })),
  ]);
  const answer = await converse({ question: "キャンセルしたら返金はどうなる？", messages: [], data });
  assert.equal(answer.answer, "開始72時間前までなら全額返金です。");
  assert.deepEqual(answer.sources.map(source => source.path), ["spec.md"]);
  assert.equal(answer.draft, undefined);
  const conversationCall = seen.find(body => !/調査担当|research layer/.test(body.instructions || ""))!;
  assert.deepEqual((conversationCall.tools as { name: string }[]).map(tool => tool.name), ["investigate", "draft_request"], "conversation has no direct data access");

  seen = scripted([call("draft_request", { change: "来月から水曜を定休日にする" }), say("下書きを作りました。画面で承認してください。")], [
    say(""), say(JSON.stringify({ answer: "hours.closedWeekdays は [2]（火曜）。", sources: ["spec.md"] })),
  ]);
  const request = await converse({ question: "来月から水曜を定休日にして", messages: [], data });
  assert.equal(request.draft?.current, "hours.closedWeekdays は [2]（火曜）。");
  assert.equal(request.draft?.change, "来月から水曜を定休日にする");
  for (const constraint of fixedConstraints()) assert.ok(request.draft!.constraints.includes(constraint));
  const text = draftText(request.draft!);
  assert.match(text, /## 現在の状態[\s\S]*## 頼まれた変更[\s\S]*## 守るべき制約/);
  void seen;
});

test("the assistant route answers operators of published shops, returns drafts as editable text and records requests in history", async t => {
  const replies: { question: string; messages: unknown[] }[] = [];
  const store = new Store(":memory:");
  const server = createApp(store, {
    propose: async (text, current) => ({ config: { ...current!, hours: { ...current!.hours, closedWeekdays: [2, 3] } }, summary: ["営業時間・休業日を更新"] }),
    proposeArticle: async () => { throw new Error("unused"); }, identifyVisual: async () => { throw new Error("unused"); }, explainSystem: async () => { throw new Error("unused"); },
    assistant: async input => {
      replies.push({ question: input.question, messages: input.messages });
      const bookings = await input.data.records("bookings");
      return /にして/.test(input.question)
        ? { answer: "下書きを作りました。", sources: [{ path: "spec.md", title: "spec" }], draft: { current: "定休日は火曜", change: input.question, constraints: fixedConstraints(), sources: [] } }
        : { answer: `予約は${bookings.length}件です。`, sources: [{ path: "sheet:bookings", title: "予約台帳" }] };
    },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = base;
  t.after(async () => { server.close(); await store.close(); });
  const request = (path: string, data: unknown, cookie: string) => fetch(base + path, { method: "POST", headers: { Origin: base, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const owner = (await request("/api/demo-login", { role: "owner", email: "owner@example.com" }, "")).headers.get("set-cookie")!.split(";")[0];
  const shop = (await store.list<Shop>("shop"))[0];
  assert.equal((await request(`/api/shops/${shop.id}/assistant`, { question: "今週の予約は？" }, owner)).status, 409, "unpublished shops have no spec yet");
  shop.published = structuredClone(sample); shop.publication = "public"; await store.saveShop(shop);
  const customer = (await request("/api/demo-login", { role: "customer", email: "guest@example.com", shopId: shop.id }, "")).headers.get("set-cookie")!.split(";")[0];
  assert.equal((await request(`/api/shops/${shop.id}/assistant`, { question: "今週の予約は？" }, customer)).status, 403);

  const answer = await (await request(`/api/shops/${shop.id}/assistant`, { question: "今週の予約は？", messages: [{ role: "user", text: "こんにちは" }] }, owner)).json() as { answer: string; request?: string };
  assert.equal(answer.answer, "予約は0件です。");
  assert.equal(answer.request, undefined);
  const drafted = await (await request(`/api/shops/${shop.id}/assistant`, { question: "来月から水曜を定休日にして" }, owner)).json() as { request: string };
  assert.match(drafted.request, /## 現在の状態\n定休日は火曜/);
  assert.deepEqual((await store.shop(shop.id))!.published!.hours.closedWeekdays, sample.hours.closedWeekdays, "a draft changes nothing");

  // Approving the draft hands its text to the ordinary plan flow; publishing records the request.
  const plan = await (await request(`/api/shops/${shop.id}/plan`, { text: drafted.request, intent: "modify" }, owner)).json() as { id: string };
  assert.deepEqual((await store.shop(shop.id))!.published!.hours.closedWeekdays, sample.hours.closedWeekdays, "a plan alone changes nothing");
  await request(`/api/shops/${shop.id}/plans/${plan.id}/approve`, {}, owner);
  assert.equal((await request(`/api/shops/${shop.id}/plans/${plan.id}/publish`, {}, owner)).status, 200);
  const published = (await store.shop(shop.id))!;
  assert.deepEqual(published.published!.hours.closedWeekdays, [2, 3]);
  assert.equal(published.history.at(-1)!.request, drafted.request);
  assert.match(documents(published.published!, published.history).history, /依頼：## 現在の状態/);
});

test("Live voice uses the same two tools, relays research results and shows drafts on screen only", async t => {
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
  process.env.VERTEX_LIVE_MODEL = "live-model";
  let parameters: LiveConnectParameters | undefined;
  const toolResponses: unknown[] = [];
  const store = new Store(":memory:");
  const server = createApp(store, undefined, undefined, undefined, undefined, async input => {
    parameters = input;
    return { sendRealtimeInput() {}, sendClientContent() {}, sendToolResponse(value: unknown) { toolResponses.push(value); }, close() {} } as unknown as LiveSession;
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  process.env.APP_ORIGIN = base;
  t.after(async () => { server.close(); await store.close(); delete process.env.GOOGLE_CLOUD_PROJECT; });
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample); shop.publication = "public"; await store.saveShop(shop);
  const id = randomBytes(32).toString("base64url");
  await store.put("session", digest(id), { user: { email: "owner@example.com", name: "Owner", role: "owner", shopId: shop.id } satisfies User, expires: Date.now() + 3600000 });
  const open = (cookie: string) => new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/shops/${shop.id}/assistant/live`, { headers: { Origin: base, Cookie: cookie } });
    socket.once("open", () => resolve(socket)); socket.once("error", reject);
  });
  await assert.rejects(open(""), /403/, "a session is required");
  const socket = await open(`gemihub_session=${id}`);
  const events: { type: string; [key: string]: unknown }[] = [];
  socket.on("message", raw => events.push(JSON.parse(raw.toString())));
  const until = async (type: string) => { for (let i = 0; i < 100 && !events.some(event => event.type === type); i++) await new Promise(resolve => setTimeout(resolve, 20)); return events.find(event => event.type === type)!; };
  await until("ready");
  assert.equal(parameters!.model, "live-model");
  const declarations = (parameters!.config!.tools as { functionDeclarations: { name: string }[] }[])[0].functionDeclarations.map(tool => tool.name);
  assert.deepEqual(declarations, ["investigate", "draft_request"]);
  assert.match(String(parameters!.config!.systemInstruction), /調べますね|Let me check/);

  scripted([], [say(""), say(JSON.stringify({ answer: "hours.closedWeekdays は [2]。", sources: ["spec.md"] }))]);
  parameters!.callbacks!.onmessage!({ toolCall: { functionCalls: [{ id: "v1", name: "draft_request", args: { change: "来月から水曜を定休日にする" } }] } } as never);
  const draft = await until("draft");
  assert.match(String(draft.text), /## 頼まれた変更\n来月から水曜を定休日にする/);
  for (let i = 0; i < 50 && !toolResponses.length; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(JSON.stringify(toolResponses[0]), /shown/);
  parameters!.callbacks!.onmessage!({ serverContent: { inputTranscription: { text: "なぜ水曜？" }, outputTranscription: { text: "仕込みのためです。" }, turnComplete: true } } as never);
  const turn = await until("turn");
  assert.equal(turn.question, "なぜ水曜？");
  assert.equal(turn.answer, "仕込みのためです。");
  socket.close();
});
