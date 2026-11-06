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
import { PayPalError } from "../server/paypal.ts";
import { ShopLogs } from "../server/shop-logs.ts";

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

test("research is one call over the material the caller chose, without tools, and cites only what it was given", async () => {
  const data = shopData({ bookings: [{ id: "b1", start: "2026-11-04T10:00:00+09:00", status: "active" }, { id: "b2", start: "2026-11-05T10:00:00+09:00", status: "active" }] });
  let seen = scripted([], [say(JSON.stringify({ answer: "今週の予約は2件です（予約台帳）。", sources: ["sheet:bookings", "system/payments.md", "spec.md"] }))]);
  const result = await research("今週の予約は何件？", data, { records: ["bookings"] });
  assert.equal(result.answer, "今週の予約は2件です（予約台帳）。");
  assert.deepEqual(data.reads, ["bookings"], "only the requested record kinds are read");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tools, undefined, "the research layer gets no tools");
  const input = JSON.stringify(seen[0].input);
  const sent = (seen[0].input as { role: string; content: { text?: string }[] }[]).find(message => message.role === "user")!;
  const material = JSON.parse(sent.content.find(part => part.text)?.text || "{}");
  assert.ok(Number.isFinite(Date.parse(material.now)) && Date.parse(material.now) <= Date.now(), "research receives the current server time");
  assert.ok(input.includes("spec.md") && input.includes("history.md") && input.includes("sheet:bookings"));
  assert.ok(!input.includes("system/payments.md"), "OKF chapters are given only for usage questions");
  assert.deepEqual(result.sources.map(source => source.path), ["sheet:bookings", "spec.md"], "material that was not given is not cited");
  // Usage questions get every OKF chapter up front and no records unless asked for.
  seen = scripted([], [say(JSON.stringify({ answer: "マイページから取り消せます。", sources: ["system/booking.md"] }))]);
  const usage = await research("お客様はどこからキャンセルする？", data, { usage: true });
  assert.ok(Object.keys(systemBundle()).every(path => JSON.stringify(seen[0].input).includes(path)));
  assert.deepEqual(data.reads, ["bookings"]);
  assert.deepEqual(usage.sources.map(source => source.path), ["system/booking.md"]);
});

test("research reads PayPal through read-only tools and cites the record", async () => {
  const data = shopData();
  const invoked: string[] = [];
  data.paypal = {
    tools: [
      { name: "paypal_get_refund", description: "read refund", parametersJsonSchema: { type: "object", properties: { refundId: { type: "string" } }, required: ["refundId"] } },
      { name: "ledger_find_booking_payments", description: "read ledger", parametersJsonSchema: { type: "object", properties: { bookingId: { type: "string" } } } },
    ],
    async invoke(name) {
      invoked.push(name);
      if (name === "ledger_find_booking_payments") return { result: { total: 1, rows: [{ bookingId: "b1", start: "2026-11-09T19:00:00Z", paidAt: "2026-11-05T01:00:00Z", refund: { id: "REF1", at: "2026-11-05T02:00:00Z", amount: 49.5, status: "completed" } }] }, source: { path: "sheet:paypal", title: "PayPal ledger" } };
      return { result: { id: "REF1", status: "COMPLETED", amount: { amount: 49.5, currency: "USD" } }, source: { path: "paypal:refund:REF1", title: "PayPal refund REF1" } };
    },
  };
  const seen = scripted([], [
    call("paypal_get_refund", { refundId: "REF1" }),
    say(JSON.stringify({ answer: "The $49.50 refund completed (PayPal REF1).", sources: ["paypal:refund:REF1"] })),
  ]);
  const result = await research("Did the $49.50 refund go through?", data, { paypal: true });
  assert.match(result.answer, /completed/);
  assert.deepEqual(result.sources.map(source => source.path), ["paypal:refund:REF1", "sheet:paypal"]);
  assert.deepEqual(invoked, ["ledger_find_booking_payments", "paypal_get_refund"]);
  const researchCall = seen.find(body => /調査担当|research layer/.test(body.instructions || ""))!;
  const names = (researchCall.tools as { name: string }[]).map(tool => tool.name);
  assert.deepEqual(names.sort(), ["ledger_find_booking_payments", "paypal_get_refund"]);
  assert.match(JSON.stringify(researchCall.input), /REF1/);
  assert.match(JSON.stringify(researchCall.input), /2026-11-05T02:00:00Z/);
  assert.ok(names.every(name => /^(paypal_get_|ledger_find_)/.test(name)), "no write tool is exposed");
});

test("a denied Transaction Search points research to owned refund IDs without hiding the error", async () => {
  const data = shopData(), invoked: string[] = [];
  data.paypal = {
    tools: ["ledger_find_booking_payments", "paypal_list_transactions", "paypal_get_refund"].map(name => ({ name, description: "read only", parametersJsonSchema: { type: "object", properties: {} } })),
    async invoke(name) {
      invoked.push(name);
      if (name === "paypal_list_transactions") throw new PayPalError(false, undefined, 403);
      if (name === "ledger_find_booking_payments") return { result: { rows: [{ refund: { id: "REF1", at: "2026-11-05T02:00:00Z" } }] }, source: { path: "sheet:paypal", title: "Ledger" } };
      return { result: { id: "REF1", status: "COMPLETED", amount: { amount: 55, currency: "USD" } }, source: { path: "paypal:refund:REF1", title: "Refund" } };
    },
  };
  const seen = scripted([], [
    call("paypal_list_transactions", { type: "refund" }, "search"),
    call("paypal_get_refund", { refundId: "REF1" }, "refund"),
    say(JSON.stringify({ answer: "Refund REF1: COMPLETED, USD 55.00.", sources: ["paypal:refund:REF1"] })),
  ]);
  const result = await research("Did the latest refund go through on PayPal?", data, { paypal: true });
  assert.match(result.answer, /REF1.*COMPLETED.*USD 55/);
  assert.deepEqual(invoked, ["ledger_find_booking_payments", "paypal_list_transactions", "paypal_get_refund"]);
  assert.match(JSON.stringify(seen[1].input), /retryable/);
  assert.match(JSON.stringify(seen[1].input), /not authorized|利用する権限がありません/);
});

test("a shop with PayPal records still answers non-payment questions in one tool-free research call", async () => {
  const data = shopData();
  data.paypal = { tools: [{ name: "paypal_get_refund", description: "read refund", parametersJsonSchema: { type: "object", properties: {} } }], async invoke() { throw new Error("not used"); } };
  const seen = scripted([], [say(JSON.stringify({ answer: "水曜は定休日です。", sources: ["spec.md"] }))]);
  const result = await research("定休日は？", data);
  assert.equal(result.answer, "水曜は定休日です。");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tools, undefined, "PayPal tools are offered only when investigate asks for paypal");
});

test("investigate searches the same customer activity as CRM and cites only the shop's logs", async () => {
  const store = new Store(":memory:"), logs = new ShopLogs(store), data = shopData();
  logs.activity("own", "guest@example.com", "mypage_view");
  logs.activity("foreign", "guest@example.com", "reserve_view");
  await logs.drain();
  data.logs = logs.toolsFor("own");
  const seen = scripted([
    call("investigate", { question: "お客様はマイページを開いた？", logs: true }),
    say("マイページを開いた記録があります。"),
  ], [
    call("search_shop_logs", { kind: "activity", customer: "guest@example.com" }),
    say(JSON.stringify({ answer: "マイページを開いた記録があります。", sources: ["logs:shop", "logs:foreign"] })),
  ]);
  const result = await converse({ question: "お客様の行動履歴を調べて", messages: [], data });
  assert.deepEqual(result.sources.map(source => source.path), ["logs:shop"]);
  const payloads = JSON.stringify(seen);
  assert.ok(payloads.includes("mypage_view"));
  assert.ok(!payloads.includes("reserve_view"));
  assert.ok(!payloads.includes("paypal_get_order"), "log-only questions do not get PayPal tools");
});

test("access questions use daily and article aggregates with source keys rather than sampled log counts", async t => {
  const diagnosticEvents: { event: string; tool?: string }[] = [];
  t.mock.method(console, "info", (message: string) => { diagnosticEvents.push(JSON.parse(message)); });
  const data = shopData(), store = new Store(":memory:"), logs = new ShopLogs(store);
  data.logs = logs.toolsFor("own", async days => ({ days, from: "2026-11-01T00:00:00Z", to: "2026-11-06T00:00:00Z", total: 6001, byCategory: { blogs: 6001, announcements: 0 }, rows: [{ postId: "p1", title: "Article", category: "blogs", path: "/s/shop/blogs/article", views: 6001, uniqueBrowsers: 100 }] }), async days => ({ days, timeZone: "Asia/Tokyo", totalViews: 7000, rows: [{ date: "2026-11-06", views: 7000, uniqueBrowsers: 120 }] }));
  const seen = scripted([], [
    call("get_daily_traffic", { days: 7 }),
    call("get_article_access_counts", { days: 7 }),
    say(JSON.stringify({ answer: "Today: 120 browsers, 7,000 PV. Article: 6,001 PV and 100 browsers.", sources: ["logs:traffic", "logs:articles", "logs:foreign"] })),
  ]);
  const result = await research("今日の訪問数と記事のアクセス数は？", data, { logs: true });
  assert.deepEqual(result.sources.map(source => source.path), ["logs:traffic", "logs:articles"]);
  assert.ok(JSON.stringify(seen).includes("6001"));
  assert.deepEqual(diagnosticEvents.filter(event => event.event === "assistant_log_tool").map(event => event.tool), ["get_daily_traffic", "get_article_access_counts"]);
  assert.ok(!diagnosticEvents.some(event => event.event === "assistant_paypal_tool"));
  await assert.rejects(data.logs.invoke("get_daily_traffic", { shopId: "foreign" }));
});

test("the conversation layer researches facts and turns change requests into a draft without applying anything", async () => {
  const data = shopData();
  let seen = scripted([call("investigate", { question: "キャンセル時の返金ルール" }), say("開始72時間前までなら全額返金です。")], [
    say(JSON.stringify({ answer: "rules.payment.refundTiers により72時間前まで100%返金。", sources: ["spec.md"] })),
  ]);
  const answer = await converse({ question: "キャンセルしたら返金はどうなる？", messages: [], data });
  assert.equal(answer.answer, "開始72時間前までなら全額返金です。");
  assert.deepEqual(answer.sources.map(source => source.path), ["spec.md"]);
  assert.equal(answer.draft, undefined);
  const conversationCall = seen.find(body => !/調査担当|research layer/.test(body.instructions || ""))!;
  assert.deepEqual((conversationCall.tools as { name: string }[]).map(tool => tool.name), ["investigate", "draft_request"], "conversation has no direct data access");

  seen = scripted([call("draft_request", { change: "来月から水曜を定休日にする" }), say("下書きを作りました。画面で承認してください。")], [
    say(JSON.stringify({ answer: "hours.closedWeekdays は [2]（火曜）。", sources: ["spec.md"] })),
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

  scripted([], [say(JSON.stringify({ answer: "hours.closedWeekdays は [2]。", sources: ["spec.md"] }))]);
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
