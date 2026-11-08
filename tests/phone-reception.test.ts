import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import { WebSocket } from "ws";
import { google } from "googleapis";
import { encrypt } from "../server/google.ts";
import { digest } from "../server/auth.ts";
import { judgePhonePin } from "../server/judge.ts";
import { Store } from "../server/store.ts";
import { sample, type Booking, type ShopConfig } from "../server/domain.ts";
import { applyPhoneSettings } from "./phone-test-helpers.ts";
import { createApp } from "../server/app.ts";
import * as intelligence from "../server/ai.ts";
import type { proposePhoneRules } from "../server/phone-rules-ai.ts";
import { dateIn } from "../shared/region.ts";
import { aggregateCustomers, phoneKey, type Inquiry } from "../server/customers.ts";
import { newestInteractionFirst, oldestInteractionFirst, type InquiryInteraction } from "../server/inquiries.ts";
import {
  callerNumber, downsample24kTo8k, mulawToPcm16, pcm16ToMulaw, phoneStreamToken, samePhoneNumber,
  streamUrl, phoneStreamContext, twilioSignature, upsample8kTo16k, validTwilioSignature, withinPhoneHours,
} from "../server/phone-reception.ts";

const token = "test-auth-token";
function fixtureConfig(): ShopConfig {
  const config = structuredClone(sample);
  config.staff = []; config.ownerBooking = true; config.hours.closedWeekdays = [];
  config.hours.start = "00:00"; config.hours.end = "23:59";
  config.rules = { ...config.rules, interval: 15, advanceDays: 60, leadMinutes: 0, sameDay: true };
  delete config.rules.payment;
  return config;
}
async function fixture(t: TestContext, phoneRules?: typeof proposePhoneRules) {
  process.env.DEMO_MODE = "true";
  process.env.TWILIO_AUTH_TOKEN = token;
  process.env.TWILIO_SKIP_SIGNATURE = "false";
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
  process.env.PHONE_LIVE_MODEL = "test-live";
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  const config = fixtureConfig();
  shop.published = config; shop.publication = "public";
  applyPhoneSettings(shop, { enabled: true, twilioNumber: "+18312167968", cashBookings: true });
  await store.saveShop(shop);
  for (const [cookie, email, role] of [["owner", shop.owner, "owner"]]) await store.put("session", (await import("../server/auth.ts")).digest(cookie), { user: { email, name: cookie, role, shopId: shop.id }, expires: Date.now() + 3600000 });
  let callbacks: any, liveParameters: any, connectFailure: Error | undefined;
  const toolResponses: any[] = [];
  const live = {
    sendClientContent() {}, sendRealtimeInput() {}, sendToolResponse(value: unknown) { toolResponses.push(value); }, close() {},
  };
  const connector = async (parameters: any) => { if (connectFailure) throw connectFailure; liveParameters = parameters; callbacks = parameters.callbacks; return live as any; };
  const server = createApp(store, phoneRules ? { ...intelligence, phoneRules } : undefined, undefined, undefined, undefined, undefined, undefined, undefined, connector);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const ws of sockets) ws.terminate(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const call = async (path: string, data?: unknown, who = "owner") => {
    const response = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Cookie: `gemihub_session=${who}`, Origin: origin, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie") };
  };
  const webhook = async (from: string, callSid = "CA123", to = "+18312167968", extra: Record<string, string> = {}, path = "/phone/incoming") => {
    const params = { To: to, From: from, CallSid: callSid, ...extra };
    const response = await fetch(origin + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioSignature(token, origin + path, params) },
      body: new URLSearchParams(params).toString(),
    });
    return { status: response.status, text: await response.text() };
  };
  const stream = async (callSid = "CA-TOOL", caller = "0312345678", url = streamUrl(origin, shop.id, callSid, caller)) => {
    const ws = new WebSocket(url);
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
    ws.send(JSON.stringify({ event: "connected" }));
    ws.send(JSON.stringify({ event: "start", start: { streamSid: "SS1", callSid } }));
    return ws;
  };
  const waitFor = async (predicate: () => boolean | Promise<boolean>, timeout = 3000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw new Error("timed out");
  };
  const invoke = async (id: string, name: string, args: object) => {
    const count = toolResponses.length;
    callbacks.onmessage({ toolCall: { functionCalls: [{ id, name, args }] } });
    await waitFor(() => toolResponses.length > count);
    return toolResponses.at(-1).functionResponses[0].response;
  };
  const failConnect = (error: Error) => { connectFailure = error; };
  return { store, shop, config, call, webhook, stream, callbacks: () => callbacks, liveParameters: () => liveParameters, failConnect, invoke, toolResponses, waitFor, origin };
}

test("withheld and blocked caller IDs never reach the AI", async t => {
  const f = await fixture(t);
  for (const from of ["anonymous", "restricted", "", "+ (12) 345"]) {
    const result = await f.webhook(from, `CA-${from || "empty"}`);
    assert.equal(result.status, 200);
    assert.match(result.text, /<Say/);
    assert.match(result.text, /番号を通知しておかけ直しください/);
    assert.doesNotMatch(result.text, /<Connect>/);
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  const logs = await f.store.queryShopLogs(f.shop.id, new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 60000).toISOString(), 100, undefined, { kind: "phone" });
  assert.ok(logs.some(log => log.outcome === "blocked"));
});

test("judge phone menus support registered callers and scoped keypad PIN access", async t => {
  const env = {
    SESSION_SECRET: "judge-phone-test-private-session-secret-12345",
    JUDGE_INVITE: "judge-phone-test-invitation-1234567890",
    JUDGE_UNTIL: new Date(Date.now() + 86400000).toISOString(),
    JUDGE_PHONE_NUMBER: "+12025550120",
    JUDGE_PHONE_NUMBER_JA: "+815012345678",
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const f = await fixture(t);
  const makeJudge = async (id: string, locale: "en" | "ja", published: boolean) => {
    const email = `judge-${id}@judge.gemihub.invalid`, shop = await f.store.createShop(email);
    shop.judge = { createdAt: new Date().toISOString() };
    shop.locale = locale;
    if (published) { shop.published = { ...fixtureConfig(), name: `${id} test shop` }; shop.publication = "provisional"; }
    await f.store.saveShop(shop);
    const user = { email, name: id, role: "owner", shopId: shop.id, judge: true };
    await f.store.put("user", email, user);
    await f.store.put("session", (await import("../server/auth.ts")).digest(id), { user, expires: Date.now() + 3600000 });
    return shop;
  };
  const us = await makeJudge("English", "en", true);
  const jp = await makeJudge("Japanese", "ja", false);
  const status = "/api/judge/status", register = "/api/judge/phone";
  assert.deepEqual((await f.call(`${status}?lang=en`, undefined, "English")).body.phone, { number: env.JUDGE_PHONE_NUMBER, caller: "", pin: judgePhonePin(us.id) });
  assert.deepEqual((await f.call(`${status}?lang=ja`, undefined, "Japanese")).body.phone, { number: env.JUDGE_PHONE_NUMBER_JA, caller: "", pin: judgePhonePin(jp.id) });
  assert.equal((await f.call(register, { caller: "2025550101" })).status, 403);
  assert.equal((await f.call(register, { caller: "client:2025550101" }, "English")).status, 400);
  assert.deepEqual((await f.call(register, { caller: "(202) 555-0101" }, "English")).body, { caller: "+12025550101" });
  assert.equal((await f.call(register, { caller: "+1 202-555-0101" }, "Japanese")).status, 409);
  assert.deepEqual((await f.call(register, { caller: "090-1111-2222" }, "Japanese")).body, { caller: "+819011112222" });
  assert.equal((await f.call(`${status}?lang=ja`, undefined, "English")).body.phone.caller, "+12025550101");

  const webhookUrl = (result: { text: string }) => result.text.match(/<Stream url="([^"]+)"/)?.[1];
  const blocked = await f.webhook("anonymous", "CA-NO-ID", env.JUDGE_PHONE_NUMBER);
  assert.match(blocked.text, /Save the number/);
  assert.equal(webhookUrl(blocked), undefined);
  assert.match((await f.webhook("+819033334444", "CA-UNKNOWN", env.JUDGE_PHONE_NUMBER_JA)).text, /<Gather[^>]+numDigits="8"/);
  assert.equal(webhookUrl(await f.webhook("+819011112222", "CA-UNPUBLISHED", env.JUDGE_PHONE_NUMBER_JA)), undefined);
  jp.published = { ...fixtureConfig(), name: "Japanese test shop" }; jp.publication = "provisional";
  await f.store.saveShop(jp);
  assert.equal(phoneStreamContext(new URL(webhookUrl(await f.webhook("+819011112222", "CA-JP", env.JUDGE_PHONE_NUMBER_JA))!))?.shopId, jp.id);
  assert.equal(phoneStreamContext(new URL(webhookUrl(await f.webhook("+819011112222", "CA-JP-FORWARD", env.JUDGE_PHONE_NUMBER))!))?.shopId, jp.id);
  assert.equal(phoneStreamContext(new URL(webhookUrl(await f.webhook("+12025550101"))!))?.shopId, f.shop.id, "an ordinary number still routes by destination");

  const pin = judgePhonePin(us.id), jpPin = judgePhonePin(jp.id);
  assert.match(pin, /^\d{8}$/);
  assert.notEqual(pin, "00000000", "zero is reserved for the original shop");
  assert.equal(judgePhonePin(us.id), pin, "refreshing the menu keeps the same PIN");
  assert.notEqual(pin, jpPin);
  const pinCaller = "+12025550999";
  const pinWebhook = (digits: string, attempt = 1, from = pinCaller, sid = "CA-PIN", to = env.JUDGE_PHONE_NUMBER) =>
    f.webhook(from, sid, to, { Digits: digits }, `/phone/incoming?pinAttempt=${attempt}`);
  const prompt = await f.webhook(pinCaller, "CA-PIN", env.JUDGE_PHONE_NUMBER);
  assert.match(prompt.text, /input="dtmf"/);
  assert.match(prompt.text, /actionOnEmptyResult="true"/);
  assert.match(prompt.text, /pinAttempt=1/);
  assert.match(prompt.text, /language="en-US"/);
  assert.ok(!prompt.text.includes(pin), "the audio prompt never reveals a PIN");
  const unsigned = await fetch(`${f.origin}/phone/incoming?pinAttempt=1`, { method: "POST", body: new URLSearchParams({ To: env.JUDGE_PHONE_NUMBER, From: pinCaller, CallSid: "CA-PIN", Digits: pin }) });
  assert.equal(unsigned.status, 403, "the Gather callback must be signed too");
  const badPin = pin === "11111111" ? "22222222" : "11111111";
  assert.match((await pinWebhook(badPin)).text, /pinAttempt=2/);
  assert.match((await pinWebhook("", 2)).text, /pinAttempt=3/);
  assert.doesNotMatch((await pinWebhook(badPin, 3)).text, /<Gather|<Connect>/);
  assert.doesNotMatch((await pinWebhook(pin, 4)).text, /<Gather|<Connect>/);
  const pinUrl = webhookUrl(await pinWebhook(pin, 1, pinCaller, "CA-PIN-OK"))!;
  assert.ok(pinUrl, "a correct PIN admits an unregistered caller");
  assert.match(pinUrl, /\/judge-pin-[a-f0-9]{32}$/);
  assert.equal(phoneStreamContext(new URL(pinUrl))?.shopId, us.id);
  assert.equal((await f.store.get<{caller: string}>("judgePhone", us.id))?.caller, "+12025550101", "PIN access never changes the saved registration");
  const pinWs = await f.stream("CA-PIN-OK", pinCaller, pinUrl);
  await f.waitFor(() => !!f.liveParameters());
  assert.match(f.liveParameters().config.systemInstruction, /English test shop/);
  pinWs.close();
  await assert.rejects(f.stream("CA-PIN-OK", pinCaller, pinUrl.replace("judge-pin-", "judge-")), /403/);
  await assert.rejects(f.stream("CA-PIN-OK", pinCaller, pinUrl.replace("CA-PIN-OK", "CA-OTHER")), /403/);
  await assert.rejects(f.stream("CA-PIN-OK", pinCaller, pinUrl.replace(encodeURIComponent(pinCaller), encodeURIComponent("+12025550998"))), /403/);
  const normalPinUrl = streamUrl(f.origin, f.shop.id, "CA-NORMAL-PIN", pinCaller, "pin");
  await assert.rejects(f.stream("CA-NORMAL-PIN", pinCaller, normalPinUrl), /403/, "PIN streams must belong to a judge shop");
  // Every new call shares the caller's guessing budget; it expires after 15 minutes.
  const limitedCaller = "+12025550997";
  for (let index = 0; index < 10; index++) await pinWebhook(badPin, 1, limitedCaller, `CA-LIMIT-${index}`);
  assert.doesNotMatch((await pinWebhook(pin, 1, limitedCaller, "CA-LIMIT-BLOCKED")).text, /<Gather|<Connect>/);
  await f.store.put("judgePhonePinAttempts", digest(limitedCaller), { count: 10, until: Date.now() - 1 });
  assert.ok(webhookUrl(await pinWebhook(pin, 1, limitedCaller, "CA-LIMIT-EXPIRED")));
  assert.doesNotMatch((await pinWebhook(pin, 1, "anonymous")).text, /<Gather|<Connect>/);
  assert.ok(webhookUrl(await pinWebhook(jpPin, 1, "+819033334445", "CA-JA-PIN", env.JUDGE_PHONE_NUMBER_JA)));

  const url = webhookUrl(await f.webhook("+12025550101", "CA-US", env.JUDGE_PHONE_NUMBER))!;
  assert.equal(phoneStreamContext(new URL(url))?.shopId, us.id);
  assert.match(url, /\/judge-[a-f0-9]{32}$/);
  const ws = await f.stream("CA-US", "+12025550101", url);
  await f.waitFor(() => !!f.liveParameters());
  assert.match(f.liveParameters().config.systemInstruction, /English test shop/);
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  assert.equal((await f.invoke("book", "create_booking", { name: "Pat", menuId: "simple", start: `${day}T10:00:00+09:00` })).ok, true);
  assert.equal((await f.store.bookings(us.id)).length, 1);
  assert.equal((await f.invoke("ask", "create_inquiry", { name: "Pat", reason: "Demo inquiry" })).ok, true);
  assert.equal((await f.store.records<Inquiry>("inquiry", us)).length, 1);
  assert.equal((await f.store.records<Inquiry>("inquiry", jp)).length, 0);
  ws.close();

  assert.deepEqual((await f.call(register, { caller: "" }, "English")).body, { caller: "" });
  await assert.rejects(f.stream("CA-US", "+12025550101", url), /403/);
  assert.equal(webhookUrl(await f.webhook("+12025550101", "CA-REMOVED", env.JUDGE_PHONE_NUMBER)), undefined);
  assert.deepEqual((await f.call(register, { caller: "2025550101" }, "Japanese")).body, { caller: "+12025550101" });
  const reset = await f.call("/api/judge/reset", { requestId: "00000000-0000-4000-8000-000000000000" }, "Japanese");
  assert.equal(reset.status, 200);
  assert.equal(await f.store.get("judgePhone", jp.id), undefined);
  const resetCookie = reset.cookie!.match(/gemihub_session=([^;]+)/)![1];
  const resetStatus = (await f.call(`${status}?lang=ja`, undefined, resetCookie)).body;
  assert.match(resetStatus.phone.pin, /^\d{8}$/);
  assert.notEqual(resetStatus.phone.pin, jpPin);
  assert.equal(webhookUrl(await pinWebhook(jpPin, 1, "+819033334445", "CA-OLD-PIN", env.JUDGE_PHONE_NUMBER_JA)), undefined);
  assert.equal(webhookUrl(await f.webhook("+12025550101", "CA-RESET", env.JUDGE_PHONE_NUMBER)), undefined);
});

test("00000000 routes a shared judge number to its original shop with ordinary reception settings", async t => {
  const env = {
    SESSION_SECRET: "original-phone-test-private-session-secret-12345",
    JUDGE_INVITE: "original-phone-test-invitation-1234567890",
    JUDGE_UNTIL: new Date(Date.now() + 86400000).toISOString(),
    JUDGE_PHONE_NUMBER: "+12025550120",
    JUDGE_PHONE_NUMBER_JA: "+18312167968",
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const f = await fixture(t);
  f.config.name = "Original real shop";
  f.shop.published = f.config;
  f.shop.locale = "ja";
  applyPhoneSettings(f.shop, { enabled: true, twilioNumber: env.JUDGE_PHONE_NUMBER_JA, cashBookings: false });
  await f.store.saveShop(f.shop);
  const judge = await f.store.createShop("judge-shared@judge.gemihub.invalid");
  judge.judge = { createdAt: new Date().toISOString() };
  judge.published = { ...fixtureConfig(), name: "Shared demo shop" };
  judge.publication = "provisional";
  await f.store.saveShop(judge);
  const caller = "+819033334444", registeredCaller = "+819011112222";
  await f.store.put("judgePhone", judge.id, { shopId: judge.id, caller: registeredCaller });
  const webhookUrl = (result: { text: string }) => result.text.match(/<Stream url="([^"]+)"/)?.[1];
  const keypad = (digits = "00000000", from = caller, sid = "CA-ORIGINAL", attempt = 1, to = env.JUDGE_PHONE_NUMBER_JA) =>
    f.webhook(from, sid, to, { Digits: digits }, `/phone/incoming?pinAttempt=${attempt}`);
  for (const from of [caller, registeredCaller]) {
    const prompt = await f.webhook(from, "CA-SHARED-MENU", env.JUDGE_PHONE_NUMBER_JA);
    assert.match(prompt.text, /<Gather/);
    assert.match(prompt.text, /0を8回/);
    assert.equal(webhookUrl(prompt), undefined, "registered judges can also choose the original shop");
    const selected = phoneStreamContext(new URL(webhookUrl(await keypad("00000000", from))!))!;
    assert.equal(selected.shopId, f.shop.id);
    assert.equal(selected.token, phoneStreamToken(f.shop.id, "CA-ORIGINAL", from));
    assert.equal((await f.store.get<{ caller: string }>("judgePhone", judge.id))?.caller, registeredCaller);
  }
  const pin = judgePhonePin(judge.id);
  const judgeContext = phoneStreamContext(new URL(webhookUrl(await keypad(pin, registeredCaller, "CA-DEMO"))!))!;
  assert.equal(judgeContext.shopId, judge.id);
  assert.match(judgeContext.token, /^judge-pin-/);

  const url = webhookUrl(await keypad())!;
  const ws = await f.stream("CA-ORIGINAL", caller, url);
  await f.waitFor(() => !!f.liveParameters());
  assert.match(f.liveParameters().config.systemInstruction, /Original real shop/);
  const day = dateIn(Date.now(), "Asia/Tokyo");
  assert.match((await f.invoke("book", "create_booking", { name: "Pat", menuId: "simple", start: `${day}T10:00:00+09:00` })).error, /電話での現金予約は現在受け付けていません/, "the original shop disables cash bookings even though the judge line enables them");
  assert.equal((await f.invoke("inquiry", "create_inquiry", { name: "Pat", reason: "Original shop inquiry" })).ok, true);
  assert.equal((await f.store.records<Inquiry>("inquiry", f.shop)).length, 1);
  assert.equal((await f.store.records<Inquiry>("inquiry", judge)).length, 0);
  ws.close();
  await assert.rejects(f.stream("CA-ORIGINAL", caller, url.replace("CA-ORIGINAL", "CA-CHANGED")), /403/);
  await assert.rejects(f.stream("CA-ORIGINAL", caller, streamUrl(f.origin, f.shop.id, "CA-ORIGINAL", caller, "pin")), /403/);

  await f.store.put("judgePhonePinAttempts", digest(caller), { count: 10, until: Date.now() + 60000 });
  assert.ok(webhookUrl(await keypad()), "public original-shop routing is independent of the judge PIN guessing budget");
  assert.equal((await f.store.get<{ count: number }>("judgePhonePinAttempts", digest(caller)))?.count, 10);
  assert.equal(webhookUrl(await keypad(pin)), undefined, "judge PIN attempts remain limited");
  assert.equal(webhookUrl(await keypad("00000000", caller, "CA-EXPIRED", 4)), undefined);
  assert.equal(webhookUrl(await keypad("00000000", "anonymous")), undefined);
  assert.equal(webhookUrl(await keypad("00000000", caller, "CA-NO-TARGET", 1, env.JUDGE_PHONE_NUMBER)), undefined, "zero never falls back to a demo shop when the dialled number has no original shop");
  const unsigned = await fetch(`${f.origin}/phone/incoming?pinAttempt=1`, { method: "POST", body: new URLSearchParams({ To: env.JUDGE_PHONE_NUMBER_JA, From: caller, CallSid: "CA-UNSIGNED", Digits: "00000000" }) });
  assert.equal(unsigned.status, 403);

  f.shop.phone!.enabled = false;
  await f.store.saveShop(f.shop);
  assert.equal(webhookUrl(await keypad()), undefined);
  await assert.rejects(f.stream("CA-ORIGINAL", caller, url), /403/, "disabling the original shop also rejects an already-issued stream");
  f.shop.phone!.enabled = true;
  f.shop.phone!.hours = { start: "00:00", end: "23:59", weekdays: [] };
  await f.store.saveShop(f.shop);
  assert.match((await keypad()).text, /電話受付の時間外/);
  await assert.rejects(f.stream("CA-ORIGINAL", caller, url), /403/);
  delete f.shop.phone!.hours;
  await f.store.saveShop({ ...f.shop, published: null });
  assert.equal(webhookUrl(await keypad()), undefined);
  f.shop.published = f.config;
  await f.store.saveShop(f.shop);

  const duplicate = await f.store.createShop("duplicate@example.com");
  duplicate.published = fixtureConfig();
  applyPhoneSettings(duplicate, { enabled: true, twilioNumber: env.JUDGE_PHONE_NUMBER_JA, cashBookings: true });
  await f.store.saveShop(duplicate);
  assert.equal(webhookUrl(await keypad()), undefined, "ambiguous original shops never choose an arbitrary destination");
  duplicate.archivedAt = new Date().toISOString();
  await f.store.saveShop(duplicate);
  assert.ok(webhookUrl(await keypad()), "archived shops do not interfere with routing");
  f.shop.archivedAt = new Date().toISOString();
  await f.store.saveShop(f.shop);
  assert.equal(webhookUrl(await keypad()), undefined, "archived original shops cannot receive calls");
});

test("a known caller reaches a signed Twilio media stream, and settings can disable it", async t => {
  const f = await fixture(t);
  const connected = await f.webhook("+819011112222", "CA-OK");
  const url = new URL(connected.text.match(/<Stream url="([^"]+)"/)![1]);
  assert.equal(url.search, "");
  assert.deepEqual(phoneStreamContext(url), { shopId: f.shop.id, callSid: "CA-OK", caller: "+819011112222", token: phoneStreamToken(f.shop.id, "CA-OK", "+819011112222") });
  const saved = await f.call(`/api/shops/${f.shop.id}/phone/settings`, { enabled: false, twilioNumber: "+18312167968", cashBookings: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.settings.enabled, false);
  const disabled = await f.webhook("+819011112222", "CA-OFF");
  assert.match(disabled.text, /ご利用いただけません/);
  assert.doesNotMatch(disabled.text, /<Connect>/);
});

test("the AI creates a cash booking through the same inventory as online bookings", async t => {
  const f = await fixture(t);
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  const start = new Date(`${day}T10:00:00+09:00`).toISOString();
  const ws = await f.stream("CA-BOOK");
  f.callbacks().onmessage({
    serverContent: { inputTranscription: { text: "明日の10時に予約したいです" }, outputTranscription: { text: "ありがとうございます" }, turnComplete: true },
  });
  f.callbacks().onmessage({ toolCall: { functionCalls: [{ id: "call-1", name: "create_booking", args: { name: "Hanako", menuId: "simple", start } }] } });
  await f.waitFor(() => f.toolResponses.length > 0);
  const response = f.toolResponses[0].functionResponses[0].response;
  assert.equal(response.ok, true, JSON.stringify(response));
  const bookings = await f.store.bookings(f.shop.id);
  assert.equal(bookings.length, 1);
  const booking = bookings[0] as Booking;
  assert.equal(booking.customer, "tel:+81312345678");
  assert.equal(booking.phone, "0312345678");
  assert.equal(booking.start, start);
  assert.equal(booking.payment, undefined);
  assert.equal(booking.updatedBy, "phone-ai:CA-BOOK");
  const online = await (await fetch(`${f.origin}/api/public/${f.shop.slug}/slots?date=${day}&menu=simple`)).json() as { start: string }[];
  assert.ok(!online.some(slot => slot.start === start), "the phone booking removes the slot from online inventory");
  ws.close();
  await new Promise(resolve => setTimeout(resolve, 80));
  const logs = await f.store.queryShopLogs(f.shop.id, new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 60000).toISOString(), 100, undefined, { kind: "phone" });
  const call = logs.find(log => log.callId === "CA-BOOK");
  assert.equal(call?.outcome, "booking");
  assert.match(call?.transcript || "", /明日の10時/);
});

test("phone calls reject standalone services as addons before offering times and can recover with a supported selection", async t => {
  const f = await fixture(t);
  f.config.menus = [
    { id: "foot", name: "Foot nails", duration: 60, price: 6000, active: true },
    { id: "removal", name: "Other salon removal", duration: 40, price: 3300, active: true },
    { id: "replacement", name: "Removal with replacement", duration: 35, price: 500, active: true, optionFor: ["foot"], optionGroup: "removal" },
    { id: "own", name: "Our salon removal", duration: 35, price: 0, active: true, optionFor: ["foot"], optionGroup: "removal" },
  ];
  f.shop.phone!.rules = "Confirm where the existing gel was applied.";
  await f.store.saveShop(f.shop);
  const ws = await f.stream("CA-OPTIONS");
  const prompt = f.liveParameters().config.systemInstruction;
  assert.match(prompt, /Confirm where the existing gel was applied/);
  assert.match(prompt, /"optionFor":\["foot"\]/);
  assert.match(prompt, /"id":"removal"[^\n]*?"optionFor":\[\]/);
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  const input = { menuId: "foot", optionIds: ["removal"], date: day };
  const unavailable = await f.invoke("bad-check", "check_availability", input);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, "INVALID_MENU_SELECTION");
  assert.equal(unavailable.slots, undefined, "a bad combination is not an empty availability result");
  assert.deepEqual(unavailable.menus.find((menu: any) => menu.id === "removal").optionFor, []);
  assert.equal((await f.invoke("finish", "finish_call", {})).ok, false);
  const badBooking = await f.invoke("bad-book", "create_booking", { ...input, name: "Caller", start: `${day}T10:00:00+09:00` });
  assert.equal(badBooking.code, "INVALID_MENU_SELECTION");
  assert.equal((await f.store.bookings(f.shop.id)).length, 0);
  assert.equal((await f.invoke("conflict", "check_availability", { ...input, optionIds: ["replacement", "own"] })).code, "INVALID_MENU_SELECTION");
  const valid = await f.invoke("good-check", "check_availability", { ...input, optionIds: ["replacement"] });
  assert.ok(valid.slots.length);
  assert.deepEqual(valid.selection, { menuId: "foot", optionIds: ["replacement"], names: ["Foot nails", "Removal with replacement"], price: 6500, duration: 95 });
  const booked = await f.invoke("good-book", "create_booking", { menuId: "foot", optionIds: ["replacement"], name: "Caller", start: valid.slots[0].start });
  assert.equal(booked.ok, true);
  const booking = (await f.store.bookings(f.shop.id))[0];
  assert.equal(booking.price, 6500);
  assert.deepEqual(booking.optionIds, ["replacement"]);
  assert.equal(Date.parse(booking.end) - Date.parse(booking.start), 95 * 60000);
  ws.close();
});

test("phone calls expand universal addon targets and keep their selection groups", async t => {
  const f = await fixture(t);
  f.config.menus.push(
    { id: "any-addon", name: "Any addon", duration: 30, price: 500, active: true, optionFor: [], optionForAll: true, optionGroup: "extras" },
    { id: "other-addon", name: "Other addon", duration: 30, price: 1000, active: true, optionFor: [], optionForAll: true, optionGroup: "extras" },
  );
  await f.store.saveShop(f.shop);
  const ws = await f.stream("CA-ANY-ADDON");
  assert.match(f.liveParameters().config.systemInstruction, /"id":"any-addon"[^\n]*?"optionFor":\["simple","design"\]/);
  const input = { menuId: "design", optionIds: ["any-addon"], date: dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo") };
  const checked = await f.invoke("check-any", "check_availability", input);
  assert.ok(checked.slots.length);
  assert.equal((await f.invoke("check-group", "check_availability", { ...input, optionIds: ["any-addon", "other-addon"] })).code, "INVALID_MENU_SELECTION");
  assert.equal((await f.invoke("book-any", "create_booking", { ...input, name: "Caller", start: checked.slots[0].start })).ok, true);
  const booking = (await f.store.bookings(f.shop.id))[0];
  assert.deepEqual(booking.optionIds, ["any-addon"]);
  assert.equal(booking.price, checked.selection.price);
  assert.equal(Date.parse(booking.end) - Date.parse(booking.start), checked.selection.duration * 60000);
  ws.close();
});

test("phone booking rechecks menu compatibility if an addon changes after availability", async t => {
  const f = await fixture(t);
  f.config.menus.push({ id: "addon", name: "Addon", duration: 30, price: 500, active: true, optionFor: ["simple"] });
  await f.store.saveShop(f.shop);
  const ws = await f.stream("CA-CHANGED-OPTIONS");
  const input = { menuId: "simple", optionIds: ["addon"], date: dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo") };
  const checked = await f.invoke("check", "check_availability", input);
  assert.ok(checked.slots.length);
  f.config.menus.find(menu => menu.id === "addon")!.optionFor = ["design"];
  await f.store.saveShop(f.shop);
  const result = await f.invoke("book", "create_booking", { ...input, name: "Caller", start: checked.slots[0].start });
  assert.equal(result.code, "INVALID_MENU_SELECTION");
  assert.deepEqual(result.menus.find((menu: any) => menu.id === "addon").optionFor, ["design"]);
  assert.equal((await f.store.bookings(f.shop.id)).length, 0);
  ws.close();
});

test("phone rules proposals are private, idempotent drafts and settings saves reject stale updates", async t => {
  let generated = 0;
  const f = await fixture(t, async (config, rules, note, call) => {
    generated++;
    assert.equal(config.name, f.config.name);
    assert.equal(rules, "Keep the greeting brief.");
    assert.equal(note, "Improve addon checks");
    assert.equal(call?.transcript, "Caller requested foot nails with removal.");
    return { rules: `${rules}\nCheck compatible addons.`, explanation: "Added addon checks.", warnings: [] };
  });
  const base = `/api/shops/${f.shop.id}/phone`;
  const original = await f.call(`${base}/settings`);
  const settings = { ...original.body, rules: "Keep the greeting brief." };
  assert.equal((await f.call(`${base}/settings`, { ...settings, previous: original.body })).status, 200);
  await f.store.appendShopLog({ id: "own-call", shopId: f.shop.id, at: new Date().toISOString(), requestId: "r", kind: "phone", operation: "phone_call", ok: false, callId: "CA-RULES", outcome: "error", transcript: "Caller requested foot nails with removal." });
  const other = await f.store.createShop("other@example.com");
  await f.store.appendShopLog({ id: "other-call", shopId: other.id, at: new Date().toISOString(), requestId: "r2", kind: "phone", operation: "phone_call", ok: false, callId: "CA-PRIVATE", transcript: "Other shop private call." });
  await f.store.put("session", digest("staff"), { user: { email: "staff@example.com", name: "Staff", role: "owner", shopId: f.shop.id }, expires: Date.now() + 3600000 });
  await f.store.put("member", `${f.shop.id}:staff@example.com`, { shopId: f.shop.id, email: "staff@example.com", accepted: true });
  const input = { rules: settings.rules, note: "Improve addon checks", callId: "CA-RULES", requestId: "00000000-0000-4000-8000-000000000100" };
  for (const who of ["staff", "unknown"]) {
    assert.equal((await f.call(`${base}/rules/ai`, input, who)).status, 403);
    assert.equal((await f.call(`${base}/settings`, settings, who)).status, 403);
    assert.equal((await f.call(`${base}/calls`, undefined, who)).status, 403);
  }
  assert.equal((await f.call(`${base}/rules/ai`, { ...input, callId: "CA-PRIVATE" })).status, 404);
  assert.equal(generated, 0);
  const [first, repeat] = await Promise.all([f.call(`${base}/rules/ai`, input), f.call(`${base}/rules/ai`, input)]);
  assert.equal(first.status, 200);
  assert.deepEqual(repeat.body, first.body);
  assert.equal(generated, 1);
  assert.equal((await f.call(`${base}/settings`)).body.rules, settings.rules, "draft generation does not save rules");
  assert.equal((await f.call(`${base}/rules/ai`, { ...input, note: "different" })).status, 409);
  const updated = { ...settings, rules: first.body.rules };
  assert.equal((await f.call(`${base}/settings`, { ...updated, previous: settings })).status, 200);
  assert.equal((await f.call(`${base}/settings`, { ...updated, previous: settings })).status, 200, "lost-response retries succeed");
  assert.equal((await f.call(`${base}/settings`, { ...settings, previous: settings })).status, 409, "stale tabs cannot overwrite saved rules");
  assert.equal((await f.call(`${base}/settings`, { ...original.body, enabled: false })).status, 200);
  assert.equal((await f.call(`${base}/settings`)).body.rules, updated.rules, "legacy callers preserve rules when omitted");
  assert.equal((await f.call(`${base}/settings`, { ...settings, rules: "x".repeat(6001) })).status, 400);
  assert.equal((await f.call(`${base}/settings`, { ...settings, rules: "" })).status, 200);
  assert.equal((await f.call(`${base}/settings`)).body.rules, "");
});

test("a matching CRM phone number links the booking to the existing customer", async t => {
  const f = await fixture(t);
  await f.store.put("customer", `${f.shop.id}:alice@example.com`, {
    shopId: f.shop.id, email: "alice@example.com", name: "Alice", phone: "03-1234-5678",
    updatedBy: "owner", updatedAt: new Date().toISOString(),
  });
  const day = dateIn(Date.now() + 6 * 86400000, "Asia/Tokyo");
  const start = new Date(`${day}T10:00:00+09:00`).toISOString();
  const ws = await f.stream("CA-CRM");
  f.callbacks().onmessage({ toolCall: { functionCalls: [{ id: "call-1", name: "create_booking", args: { name: "Alice", menuId: "simple", start } }] } });
  await f.waitFor(() => f.toolResponses.length > 0);
  const bookings = await f.store.bookings(f.shop.id);
  assert.equal(bookings[0].customer, "alice@example.com");
  assert.equal(bookings[0].phone, "0312345678");
  assert.ok(!(await f.store.get("customer", `${f.shop.id}:tel:+81312345678`)), "no duplicate phone-only customer is created");
  ws.close();
});

test("the AI records an inquiry with the caller number and transcript", async t => {
  const f = await fixture(t);
  const ws = await f.stream("CA-INQ");
  f.callbacks().onmessage({ serverContent: { inputTranscription: { text: "駐車場はありますか" }, outputTranscription: { text: "確認して折り返します" }, turnComplete: true } });
  f.callbacks().onmessage({ toolCall: { functionCalls: [{ id: "call-1", name: "create_inquiry", args: { name: "Taro", reason: "駐車場について知りたい" } }] } });
  await f.waitFor(() => f.toolResponses.length > 0);
  const response = f.toolResponses[0].functionResponses[0].response;
  assert.equal(response.ok, true, JSON.stringify(response));
  const inquiries = await f.store.records<any>("inquiry", f.shop);
  assert.equal(inquiries.length, 1);
  assert.deepEqual([inquiries[0].name, inquiries[0].phone, inquiries[0].source, inquiries[0].message], ["Taro", "0312345678", "phone", "駐車場について知りたい"]);
  ws.close();
  await new Promise(resolve => setTimeout(resolve, 100));
  const entries = await f.store.records<any>("inquiryInteraction", f.shop);
  assert.ok(entries.some(entry => entry.inquiryId === inquiries[0].id && entry.kind === "phone" && /駐車場/.test(entry.text)));
});

test("a discounted transfer listing is never sold by phone, so a refund cannot be triggered by a call", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T01:00:00Z") });
  const f = await fixture(t);
  const start = new Date("2026-11-06T04:00:00Z").toISOString();
  const held = {
    id: "held", shopId: f.shop.id, customer: "seller@example.com", name: "Seller", message: "", menuId: "simple", price: 5500,
    staffId: "owner", start, end: new Date(Date.parse(start) + 60 * 60000).toISOString(), status: "active", createdAt: new Date().toISOString(),
  };
  await f.store.put("checkout", "C1", { id: "C1", shopId: f.shop.id, customer: "seller@example.com", phase: "confirmed", booking: held });
  await f.store.put("transfer", "T1", {
    id: "T1", shopId: f.shop.id, bookingId: "C1", seller: "seller@example.com", sellerName: "Seller", sellerCaptureId: "cap",
    environment: "sandbox", currency: "JPY", basis: 5500, discountPercent: 30, price: 3850,
    deadline: "2026-11-06T03:50:00Z", unsold: { percent: 0, amount: 0 }, policy: [{ hoursBefore: 0, percent: 0 }],
    phase: "listed", createdAt: new Date().toISOString(), attempts: 0,
  });
  const ws = await f.stream("CA-TRANSFER");
  f.callbacks().onmessage({ toolCall: { functionCalls: [{ id: "call-1", name: "check_availability", args: { menuId: "simple" } }] } });
  await f.waitFor(() => f.toolResponses.length > 0);
  const result = f.toolResponses[0].functionResponses[0].response;
  assert.equal(result.transferSlots, undefined);
  assert.ok(!result.slots.some((slot: { start: string }) => slot.start === start), "the listed slot is not offered as a regular slot");
  f.callbacks().onmessage({ toolCall: { functionCalls: [{ id: "call-2", name: "create_booking", args: { name: "Taro", menuId: "simple", start, transferId: "T1" } }] } });
  await f.waitFor(() => f.toolResponses.length > 1);
  assert.ok(f.toolResponses[1].functionResponses[0].response.error);
  assert.equal((await f.store.get<any>("transfer", "T1")).phase, "listed");
  assert.equal((await f.store.get<any>("checkout", "C1")).booking.status, "active");
  ws.close();
});

test("caller IDs, signatures, hours and audio conversion are deterministic", () => {
  assert.equal(callerNumber("anonymous"), undefined);
  assert.equal(callerNumber("+81 90-1111-2222"), "+819011112222");
  assert.ok(samePhoneNumber("+819012345678", "090-1234-5678"));
  assert.ok(samePhoneNumber("+81312345678", "03-1234-5678"));
  assert.ok(samePhoneNumber("+81751234567", "075-123-4567"));
  assert.ok(samePhoneNumber("+18312167968", "(831) 216-7968"));
  assert.ok(!samePhoneNumber("+442012345678", "+812012345678"), "different countries must not match by suffix");
  assert.ok(!samePhoneNumber("+819012345678", "090-9999-0000"));
  assert.ok(samePhoneNumber("+819012345678", "+81-090-1234-5678"), "the domestic trunk zero after +81 is still the same line");
  assert.ok(samePhoneNumber("+819012345678", "0081-90-1234-5678"));
  assert.ok(!samePhoneNumber(callerNumber("+3312345678"), "+13312345678"), "an international caller is not a US national number");
  assert.equal(phoneKey("090-1234-5678"), phoneKey("+819012345678"));
  for (const withheld of ["+266696687", "+7378742833", "+2562533", "+8656696", "+86282452253"]) assert.equal(callerNumber(withheld), undefined);
  const params = { To: "+819012345678", From: "+819011112222", CallSid: "CA1" };
  const signature = twilioSignature(token, "https://example.com/phone/incoming", params);
  assert.ok(validTwilioSignature(token, "https://example.com/phone/incoming", params, signature));
  assert.ok(!validTwilioSignature(token, "https://example.com/other", params, signature));
  const hours = { start: "09:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] };
  assert.equal(withinPhoneHours({ enabled: true, twilioNumber: "", cashBookings: true, hours }, new Date("2026-11-06T01:00:00Z"), "Asia/Tokyo"), true);
  assert.equal(withinPhoneHours({ enabled: true, twilioNumber: "", cashBookings: true, hours }, new Date("2026-11-07T01:00:00Z"), "Asia/Tokyo"), false);
  const overnight = { enabled: true, twilioNumber: "", cashBookings: true, hours: { start: "22:00", end: "02:00", weekdays: [5] } };
  assert.equal(withinPhoneHours(overnight, new Date("2026-11-06T14:00:00Z"), "Asia/Tokyo"), true, "Friday 23:00");
  assert.equal(withinPhoneHours(overnight, new Date("2026-11-06T16:00:00Z"), "Asia/Tokyo"), true, "Saturday 01:00 belongs to Friday's hours");
  assert.equal(withinPhoneHours(overnight, new Date("2026-11-07T16:00:00Z"), "Asia/Tokyo"), false, "Sunday 01:00 belongs to Saturday");
  assert.equal(withinPhoneHours(overnight, new Date("2026-11-06T03:00:00Z"), "Asia/Tokyo"), false, "Friday noon");
  const pcm = Int16Array.from([0, 1000, -1000, 32767, -32768]);
  assert.deepEqual(Array.from(pcm16ToMulaw(pcm)).length, 5);
  assert.equal(mulawToPcm16(pcm16ToMulaw(pcm)).length, 5);
  assert.equal(upsample8kTo16k(pcm).length, 10);
  assert.equal(downsample24kTo8k(new Int16Array(24)).samples.length, 8);
});

test("signed streams reject tampering, legacy query URLs and missing secrets", async t => {
  const f = await fixture(t);
  assert.throws(() => phoneStreamToken("shop", "call", "caller", ""), /secret/);
  assert.throws(() => phoneStreamToken("shop", "call", "caller", "  "), /secret/);
  const url = streamUrl(f.origin, f.shop.id, "CA-AUTH", "0312345678");
  const rejected = async (target: string) => {
    const ws = new WebSocket(target);
    const status = await new Promise<number>((resolve, reject) => {
      ws.once("unexpected-response", (_request, response) => { response.resume(); ws.terminate(); resolve(response.statusCode!); });
      ws.once("open", () => { ws.terminate(); reject(new Error("unauthorized stream opened")); });
      ws.on("error", () => undefined);
    });
    assert.equal(status, 403);
  };
  await rejected(url.replace("0312345678", "0399990000"));
  await rejected(`${f.origin.replace("http", "ws")}/phone/stream?shop=${f.shop.id}&call=CA-AUTH&from=0312345678&token=forged`);
  const forged = createHmac("sha256", "phone").update(JSON.stringify([f.shop.id, "CA-AUTH", "0312345678"])).digest("hex").slice(0, 32);
  process.env.TWILIO_AUTH_TOKEN = " "; // Overrides any optional local credential file with an empty secret.
  try { await rejected(url.replace(/[^/]+$/, forged)); }
  finally { process.env.TWILIO_AUTH_TOKEN = token; }
});

test("a call can retry a booking and create another reservation after staff cancels it", async t => {
  const f = await fixture(t), ws = await f.stream("CA-RESCHEDULE");
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  const start = new Date(`${day}T10:00:00+09:00`).toISOString();
  const invoke = async (id: string, name: string, args: object) => {
    const count = f.toolResponses.length;
    f.callbacks().onmessage({ toolCall: { functionCalls: [{ id, name, args }] } });
    await f.waitFor(() => f.toolResponses.length > count);
    return f.toolResponses.at(-1).functionResponses[0].response;
  };
  const args = { name: "Hanako", menuId: "simple", start };
  const first = await invoke("book-1", "create_booking", args);
  assert.equal(first.ok, true);
  assert.equal((await invoke("book-1", "create_booking", args)).bookingId, first.bookingId);
  assert.equal((await f.call(`/api/shops/${f.shop.id}/bookings/${first.bookingId}/status`, { status: "cancelled" })).status, 200);
  assert.ok((await invoke("book-1", "create_booking", args)).error, "a retry cannot report a cancelled booking as successful");
  const next = await invoke("book-2", "create_booking", { ...args, start: new Date(`${day}T12:00:00+09:00`).toISOString() });
  assert.equal(next.ok, true);
  assert.notEqual(next.bookingId, first.bookingId);
  assert.deepEqual((await f.store.bookings(f.shop.id)).map(booking => booking.status).sort(), ["active", "cancelled"]);
  ws.close();
});

test("an international landline caller reuses an email CRM identity", async t => {
  const f = await fixture(t);
  await f.store.put("customer", `${f.shop.id}:alice@example.com`, { shopId: f.shop.id, email: "alice@example.com", name: "Alice", phone: "03-1234-5678" });
  const ws = await f.stream("CA-LANDLINE", "81312345678");
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  f.callbacks().onmessage({ toolCall: { functionCalls: [{ id: "book", name: "create_booking", args: { name: "Alice", menuId: "simple", start: new Date(`${day}T10:00:00+09:00`).toISOString() } }] } });
  await f.waitFor(() => f.toolResponses.length > 0);
  assert.equal((await f.store.bookings(f.shop.id))[0].customer, "alice@example.com");
  assert.equal((await f.store.records<any>("customer", f.shop)).length, 1);
  ws.close();
});

test("an international caller reuses a domestic phone-only customer's key", async t => {
  const f = await fixture(t), key = "tel:+819011112222";
  await f.store.put("customer", `${f.shop.id}:${key}`, { shopId: f.shop.id, email: key, name: "Taro", phone: "090-1111-2222" });
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo"), start = new Date(`${day}T10:00:00+09:00`).toISOString();
  const ws = await f.stream("CA-DOMESTIC", "819011112222");
  const booked = await f.invoke("book", "create_booking", { name: "Taro", menuId: "simple", start });
  assert.equal(booked.ok, true);
  assert.equal((await f.store.get<Booking>("booking", booked.bookingId))!.customer, key);
  assert.deepEqual((await f.store.records<any>("customer", f.shop)).map(record => record.email), [key]);
  ws.close();
});

for (const kind of ["booking", "inquiry"] as const) test(`disconnect waits for an in-flight ${kind} and records its ID`, async t => {
  const f = await fixture(t), callSid = `CA-SLOW-${kind}`, ws = await f.stream(callSid);
  let entered = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(release);
  const put = f.store.put.bind(f.store);
  t.mock.method(f.store, "put", async (type: string, id: string, value: unknown) => {
    if (type === kind) { entered = true; await gate; }
    return put(type, id, value);
  });
  f.callbacks().onmessage({ serverContent: { inputTranscription: { text: "お願いします" }, outputTranscription: { text: "承ります" }, turnComplete: true } });
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  const args = kind === "booking" ? { name: "Taro", menuId: "simple", start: new Date(`${day}T10:00:00+09:00`).toISOString() } : { name: "Taro", reason: "確認してほしい" };
  f.callbacks().onmessage({ toolCall: { functionCalls: [{ id: "slow", name: `create_${kind}`, args }] } });
  await f.waitFor(() => entered);
  ws.close(); await once(ws, "close");
  release();
  const logs = () => f.store.queryShopLogs(f.shop.id, new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 60000).toISOString(), 100, undefined, { kind: "phone" });
  await f.waitFor(async () => (await logs()).some(log => log.callId === callSid));
  const log = (await logs()).find(log => log.callId === callSid)!;
  const record = (await f.store.records<any>(kind, f.shop))[0];
  assert.equal(log.outcome, kind);
  assert.equal(kind === "booking" ? log.bookingId : log.inquiryId, record.id);
  if (kind === "inquiry") await f.waitFor(async () => (await f.store.records<any>("inquiryInteraction", f.shop)).some(entry => entry.inquiryId === record.id && /お願いします/.test(entry.text)));
});

test("farewell audio stays connected until Twilio acknowledges its playback mark", async t => {
  const f = await fixture(t), ws = await f.stream("CA-PLAYBACK");
  const frames: any[] = [];
  ws.on("message", raw => frames.push(JSON.parse(raw.toString())));
  f.callbacks().onmessage({ toolCall: { functionCalls: [{ id: "finish", name: "finish_call", args: {} }] } });
  await f.waitFor(() => f.toolResponses.length > 0);
  // More than 1.2 seconds of audio can be queued. Generating it does not mean it has played.
  const data = Buffer.from(new Int16Array(24000 * 3).buffer).toString("base64");
  f.callbacks().onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data } }] }, outputTranscription: { text: "ありがとうございました" }, turnComplete: true } });
  await f.waitFor(() => frames.some(frame => frame.event === "mark"));
  const mark = frames.find(frame => frame.event === "mark");
  assert.ok(frames.findIndex(frame => frame.event === "media") < frames.indexOf(mark));
  await new Promise(resolve => setTimeout(resolve, 1400));
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.send(JSON.stringify({ event: "mark", streamSid: "SS1", mark: { name: "unrelated" } }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(ws.readyState, WebSocket.OPEN);
  f.callbacks().onmessage({ serverContent: { interrupted: true, turnComplete: true } });
  // Twilio also acknowledges cleared audio; this old mark must not end the resumed call.
  ws.send(JSON.stringify({ event: "mark", streamSid: "SS1", mark: mark.mark }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(ws.readyState, WebSocket.OPEN);
  assert.equal(frames.filter(frame => frame.event === "mark").length, 1);
  f.callbacks().onmessage({ toolCall: { functionCalls: [{ id: "finish-again", name: "finish_call", args: {} }] } });
  await f.waitFor(() => f.toolResponses.length > 1);
  f.callbacks().onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data } }] }, turnComplete: true } });
  await f.waitFor(() => frames.filter(frame => frame.event === "mark").length === 2);
  ws.send(JSON.stringify({ event: "mark", streamSid: "SS1", mark: frames.filter(frame => frame.event === "mark")[1].mark }));
  await once(ws, "close");
});

test("US cash booking notifications show dollars rather than cents", async t => {
  const f = await fixture(t);
  f.config.region = { country: "US", timeZone: "America/Los_Angeles" };
  f.config.menus.find(menu => menu.id === "simple")!.price = 55;
  f.shop.published = f.config;
  f.shop.google = { folderId: "folder" } as typeof f.shop.google;
  await f.store.saveShop(f.shop);
  const ws = await f.stream("CA-USD");
  const day = dateIn(Date.now() + 5 * 86400000, "America/Los_Angeles");
  f.callbacks().onmessage({ toolCall: { functionCalls: [{ id: "book", name: "create_booking", args: { name: "Taro", menuId: "simple", start: new Date(`${day}T18:00:00Z`).toISOString() } }] } });
  await f.waitFor(() => f.toolResponses.length > 0);
  assert.equal(f.toolResponses[0].functionResponses[0].response.ok, true);
  const jobs = await f.store.records<any>("job", f.shop);
  assert.ok(jobs.some(job => /\$55\.00/.test(job.body)), JSON.stringify(jobs));
  assert.ok(!jobs.some(job => /\$0\.55/.test(job.body)));
  ws.close();
});

test("long inquiry transcripts are retained in ordered interactions within the length limit", async t => {
  const f = await fixture(t), ws = await f.stream("CA-LONG");
  const text = "長いお問い合わせです。".repeat(1000);
  f.callbacks().onmessage({ serverContent: { inputTranscription: { text }, outputTranscription: { text: "確認します" }, turnComplete: true } });
  f.callbacks().onmessage({ toolCall: { functionCalls: [{ id: "inquire", name: "create_inquiry", args: { name: "Taro", reason: "確認してほしい" } }] } });
  await f.waitFor(() => f.toolResponses.length > 0);
  ws.close(); await once(ws, "close");
  await f.waitFor(async () => (await f.store.records<any>("inquiryInteraction", f.shop)).length >= 3);
  const entries = await f.store.records<any>("inquiryInteraction", f.shop);
  assert.ok(entries.every(entry => entry.text.length <= 5000));
  const history = await f.call(`/api/shops/${f.shop.id}/inquiries`);
  assert.equal(history.body[0].interactions.map((entry: any) => entry.text).join(""), `お客様: ${text}\nAI: 確認します`);
  // The owner's history is newest first; a transcript must still read from its beginning.
  assert.equal([...history.body[0].interactions].sort(newestInteractionFirst).map((entry: any) => entry.text).join(""), `お客様: ${text}\nAI: 確認します`);
});

test("the caller's message reaches the booking and the owner without reading the number aloud", async t => {
  const f = await fixture(t);
  f.shop.google = { folderId: "folder" } as typeof f.shop.google;
  await f.store.saveShop(f.shop);
  const ws = await f.stream("CA-NOTE");
  await f.waitFor(() => !!f.liveParameters());
  const instruction = f.liveParameters().config.systemInstruction;
  assert.ok(!instruction.includes("0312345678"), "the model does not need the number");
  assert.match(instruction, /伝えておきたいこと/);
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  const booked = await f.invoke("book", "create_booking", { name: "Hanako", menuId: "simple", start: `${day}T10:00:00+09:00`, message: "爪が弱いです" });
  assert.equal((await f.store.get<Booking>("booking", booked.bookingId))!.message, "爪が弱いです");
  assert.ok((await f.store.records<any>("job", f.shop)).some(job => /爪が弱いです/.test(job.body)));
  ws.close();
});

test("the owner's mail leaves right after a booking instead of waiting for the scheduled run", async t => {
  const f = await fixture(t), sent: unknown[] = [];
  f.shop.google = { folderId: "folder" } as typeof f.shop.google;
  await f.store.saveShop(f.shop);
  t.mock.method(f.store, "ownerToken", async () => encrypt("token"));
  t.mock.method(google, "gmail", (() => ({ users: { messages: { async send(input: unknown) { sent.push(input); } } } })) as any);
  const ws = await f.stream("CA-MAIL");
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  assert.equal((await f.invoke("book", "create_booking", { name: "Hanako", menuId: "simple", start: `${day}T10:00:00+09:00` })).ok, true);
  await f.waitFor(() => sent.length > 0);
  await f.waitFor(async () => (await f.store.records<any>("job", f.shop)).length === 0);
  ws.close();
});

test("a booking succeeds when the model rewrites the offered start", async t => {
  const f = await fixture(t), ws = await f.stream("CA-REWRITE");
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo"), iso = new Date(`${day}T10:00:00+09:00`).toISOString();
  const offset = await f.invoke("offset", "create_booking", { name: "Hanako", menuId: "simple", start: `${day}T10:00:00+09:00` });
  assert.equal(offset.ok, true, JSON.stringify(offset));
  assert.equal(offset.start, iso);
  const local = await f.invoke("local", "create_booking", { name: "Taro", menuId: "simple", start: `${day}T12:00:00` });
  assert.equal(local.ok, true, JSON.stringify(local));
  assert.equal(local.start, new Date(`${day}T12:00:00+09:00`).toISOString());
  ws.close();
});

test("a failed booking stops the hang-up beside it, reaches the owner and is logged as an error", async t => {
  const f = await fixture(t);
  f.shop.google = { folderId: "folder" } as typeof f.shop.google;
  await f.store.saveShop(f.shop);
  const ws = await f.stream("CA-LOST");
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  f.callbacks().onmessage({ toolCall: { functionCalls: [
    { id: "finish", name: "finish_call", args: {} },
    { id: "book", name: "create_booking", args: { name: "Hanako", menuId: "simple", start: `${day}T03:17:00+09:00` } },
  ] } });
  await f.waitFor(() => f.toolResponses.length > 0);
  const responses = f.toolResponses[0].functionResponses;
  assert.deepEqual(responses.map((item: any) => item.name), ["create_booking", "finish_call"]);
  assert.ok(responses[0].response.error);
  assert.equal(responses[1].response.ok, false);
  assert.equal(ws.readyState, WebSocket.OPEN);
  await f.invoke("finish-again", "finish_call", {});
  ws.close(); await once(ws, "close");
  const logs = () => f.store.queryShopLogs(f.shop.id, new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 60000).toISOString(), 100, undefined, { kind: "phone" });
  await f.waitFor(async () => (await logs()).some(log => log.callId === "CA-LOST"));
  assert.equal((await logs()).find(log => log.callId === "CA-LOST")?.outcome, "error");
  await f.waitFor(async () => (await f.store.records<any>("job", f.shop)).length > 0);
});

test("hanging up after offering slots is questioned once, and a declined booking can still end", async t => {
  const f = await fixture(t), ws = await f.stream("CA-OFFERED");
  await f.invoke("slots", "check_availability", { menuId: "simple", date: dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo") });
  assert.equal((await f.invoke("finish", "finish_call", {})).ok, false);
  assert.equal((await f.invoke("finish-again", "finish_call", {})).ok, true);
  ws.close();
});

test("transcript parts stay readable while other entries follow time order", () => {
  const entry = (id: string, at: string, part?: number) => ({ id, shopId: "s", inquiryId: "q", kind: "phone", text: id, at, ...(part === undefined ? {} : { part }) }) as InquiryInteraction;
  const entries = [entry("z", "2026-11-07T01:00:00.000Z", 0), entry("a", "2026-11-07T01:00:00.000Z", 1), entry("note", "2026-11-07T02:00:00.000Z"), entry("old", "2026-11-07T00:00:00.000Z")];
  assert.deepEqual([...entries].sort(newestInteractionFirst).map(item => item.id), ["note", "z", "a", "old"]);
  assert.deepEqual([...entries].sort(oldestInteractionFirst).map(item => item.id), ["old", "z", "a", "note"]);
});

test("an English shop answers calls in English from the webhook through the live session", async t => {
  const f = await fixture(t);
  f.shop.locale = "en"; await f.store.saveShop(f.shop);
  const blocked = await f.webhook("anonymous", "CA-EN-BLOCKED");
  assert.match(blocked.text, /language="en-US"/);
  assert.doesNotMatch(blocked.text, /[ぁ-ん]/);
  const ws = await f.stream("CA-EN");
  await f.waitFor(() => !!f.liveParameters());
  const config = f.liveParameters().config;
  assert.doesNotMatch(config.systemInstruction.split("\n")[0], /[ぁ-ん]/);
  assert.match(config.systemInstruction, /Guide callers with online bookings to change or cancel them online/);
  assert.doesNotMatch(config.tools[0].functionDeclarations[0].description, /[ぁ-ん]/);
  const response = await f.invoke("cancel", "cancel_booking", {});
  assert.equal(response.message, "No cash booking was found for this number. Change or cancel online bookings online.", "tool results keep the shop's language outside the upgrade request");
  ws.close();
});

test("a farewell that never completes still ends the call", async t => {
  const f = await fixture(t), ws = await f.stream("CA-NO-TURN");
  await f.invoke("finish", "finish_call", {});
  await once(ws, "close");
});

test("a stale turn cannot hang up before audio generated after it", async t => {
  const f = await fixture(t), ws = await f.stream("CA-LATE-AUDIO");
  const frames: any[] = [];
  ws.on("message", raw => frames.push(JSON.parse(raw.toString())));
  await f.invoke("finish", "finish_call", {});
  f.callbacks().onmessage({ serverContent: { turnComplete: true } });
  await f.waitFor(() => frames.some(frame => frame.event === "mark"));
  const data = Buffer.from(new Int16Array(240).buffer).toString("base64");
  f.callbacks().onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data } }] } } });
  await f.waitFor(() => frames.filter(frame => frame.event === "mark").length === 2);
  ws.send(JSON.stringify({ event: "mark", streamSid: "SS1", mark: frames.find(frame => frame.event === "mark").mark }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(ws.readyState, WebSocket.OPEN, "the first mark no longer covers all the audio");
  ws.send(JSON.stringify({ event: "mark", streamSid: "SS1", mark: frames.filter(frame => frame.event === "mark")[1].mark }));
  await once(ws, "close");
});

test("a failed Gemini connection records the call and notifies the owner once", async t => {
  const f = await fixture(t);
  f.shop.google = { folderId: "folder" } as typeof f.shop.google;
  await f.store.saveShop(f.shop);
  f.failConnect(new Error("live unavailable"));
  const ws = await f.stream("CA-FAIL");
  if (ws.readyState !== WebSocket.CLOSED) await once(ws, "close");
  const logs = () => f.store.queryShopLogs(f.shop.id, new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 60000).toISOString(), 100, undefined, { kind: "phone" });
  await f.waitFor(async () => (await logs()).some(log => log.callId === "CA-FAIL"));
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal((await logs()).find(log => log.callId === "CA-FAIL")?.outcome, "error");
  assert.equal((await f.store.records<any>("job", f.shop)).filter(job => /live unavailable|error/.test(job.body)).length, 1);
});

test("a repeated booking or inquiry under a new tool-call ID stays one record", async t => {
  const f = await fixture(t), ws = await f.stream("CA-REPEAT");
  const shift = { menuIds: ["simple"], weekdays: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" };
  f.config.staff = [{ ...shift, id: "a", name: "A" }, { ...shift, id: "b", name: "B" }] as typeof f.config.staff;
  f.shop.published = f.config; await f.store.saveShop(f.shop);
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  const args = { name: "Hanako", menuId: "simple", start: new Date(`${day}T10:00:00+09:00`).toISOString() };
  const first = await f.invoke("one", "create_booking", args);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal((await f.invoke("two", "create_booking", args)).bookingId, first.bookingId);
  assert.equal((await f.store.bookings(f.shop.id)).length, 1);
  const other = await f.invoke("three", "create_booking", { ...args, name: "Taro" });
  assert.notEqual(other.bookingId, first.bookingId, "a second guest in one call is a separate booking");
  const inquiry = { name: "Hanako", reason: "駐車場について" };
  const asked = await f.invoke("four", "create_inquiry", inquiry);
  assert.equal((await f.invoke("five", "create_inquiry", inquiry)).inquiryId, asked.inquiryId);
  assert.equal((await f.store.records<any>("inquiry", f.shop)).length, 1);
  ws.close();
});

test("a matching caller can confirm and cancel one of their cash bookings", async t => {
  const f = await fixture(t), bookingCall = await f.stream("CA-BOOK-TO-CANCEL", "0312345678");
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  const book = (hour: string) => f.invoke(`book-${hour}`, "create_booking", { name: "Taro", menuId: "simple", start: `${day}T${hour}:00:00+09:00` });
  const first = await book("10"), second = await book("12");
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  bookingCall.close();

  const ws = await f.stream("CA-CANCEL", "+81312345678");
  const matches = await f.invoke("lookup", "cancel_booking", { start: day });
  assert.equal(matches.ok, false);
  assert.deepEqual(matches.choices.map((choice: { bookingId: string }) => choice.bookingId).sort(), [first.bookingId, second.bookingId].sort());
  assert.ok((await f.store.bookings(f.shop.id)).every(booking => booking.status === "active"));

  const confirmation = { bookingId: first.bookingId, start: `${day}T10:00:00+09:00` };
  const cancelled = await f.invoke("confirm", "cancel_booking", confirmation);
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.bookingId, first.bookingId);
  assert.deepEqual(await f.invoke("retry", "cancel_booking", confirmation), cancelled);
  assert.equal((await f.store.get<Booking>("booking", first.bookingId))!.status, "cancelled");
  assert.equal((await f.store.get<Booking>("booking", second.bookingId))!.status, "active");
  const availability = await f.invoke("check", "check_availability", { date: day, menuId: "simple" });
  assert.ok(availability.slots.some((slot: { start: string }) => slot.start === first.start), "cancellation releases the slot");
  ws.close();
  const logs = () => f.store.queryShopLogs(f.shop.id, new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 60000).toISOString(), 100, undefined, { kind: "phone" });
  await f.waitFor(async () => (await logs()).some(log => log.callId === "CA-CANCEL" && log.outcome === "cancelled" && log.bookingId === first.bookingId));
});

test("phone cancellation notifies the booking customer and owner once, and never mails telephone IDs", async t => {
  const f = await fixture(t), caller = "0312345678";
  f.shop.google = { folderId: "folder" } as typeof f.shop.google;
  await f.store.saveShop(f.shop);
  // The booking's recipient remains authoritative even if this number now matches another CRM account.
  await f.store.put("customer", `${f.shop.id}:different@example.com`, { shopId: f.shop.id, email: "different@example.com", name: "Different", phone: caller });
  const place = async (id: string, customer: string) => {
    const start = new Date(Date.now() + 5 * 86400000).toISOString();
    await f.store.saveBooking({ id, shopId: f.shop.id, customer, name: "Taro", phone: caller, message: "", menuId: "simple", price: 5500, staffId: "owner", start, end: new Date(Date.parse(start) + 3600000).toISOString(), status: "active", createdAt: new Date().toISOString() });
  };
  await place("email-cancel", "booked@example.com");
  const ws = await f.stream("CA-CUSTOMER-CANCEL", caller);
  const confirmed = await f.invoke("cancel", "cancel_booking", { bookingId: "email-cancel" });
  assert.equal(confirmed.ok, true);
  const jobs = () => f.store.records<any>("job", f.shop);
  let mail = await jobs();
  assert.deepEqual(mail.map(job => job.to).sort(), ["booked@example.com", f.config.notificationEmail].sort());
  const customerMail = mail.find(job => job.to === "booked@example.com");
  assert.match(customerMail.subject, /予約をキャンセルしました/);
  assert.match(customerMail.body, /Taro/);
  assert.match(customerMail.body, /メニュー:/);
  assert.match(customerMail.body, /返金はありません/);
  assert.deepEqual(await f.invoke("retry", "cancel_booking", { bookingId: "email-cancel" }), confirmed);
  assert.equal((await jobs()).length, 2, "retries do not queue another owner or customer notification");
  await place("telephone-cancel", phoneKey(caller));
  assert.equal((await f.invoke("phone-only", "cancel_booking", { bookingId: "telephone-cancel" })).ok, true);
  mail = await jobs();
  assert.equal(mail.length, 3, "a phone-only booking only notifies the owner");
  assert.ok(mail.every(job => !job.to.startsWith("tel:") && job.to !== "different@example.com"));
  await place("same-recipient", f.config.notificationEmail);
  assert.equal((await f.invoke("dedup", "cancel_booking", { bookingId: "same-recipient" })).ok, true);
  assert.equal((await jobs()).length, 4, "a customer using the shop notification email only receives one mail");
  ws.close();
});

test("phone cancellation respects the caller number, booking type and shop deadline", async t => {
  const f = await fixture(t), caller = "0312345678";
  const place = (id: string, startsIn: number, phone?: string, payment?: Booking["payment"]) => {
    const start = new Date(Date.now() + startsIn).toISOString();
    return f.store.saveBooking({ id, shopId: f.shop.id, customer: "taro@example.com", name: "Taro", phone, payment, message: "", menuId: "simple", price: 5500, staffId: "owner", start, end: new Date(Date.parse(start) + 3600000).toISOString(), status: "active", createdAt: new Date().toISOString() });
  };
  await place("other-caller", 3 * 86400000, "03-1111-2222");
  await place("online", 3 * 86400000);
  await place("prepaid", 3 * 86400000, caller, { provider: "paypal", environment: "sandbox", orderId: "order", captureId: "capture", amount: 5500, currency: "JPY", policy: [{ hoursBefore: 0, percent: 0 }] });
  await place("past", -86400000, caller);
  await place("past-deadline", 3600000, caller);
  const ws = await f.stream("CA-REJECT-CANCEL", caller);
  const lookup = await f.invoke("lookup", "cancel_booking", {});
  assert.deepEqual(lookup.choices.map((choice: { bookingId: string }) => choice.bookingId), ["past-deadline"]);
  for (const bookingId of ["other-caller", "online", "prepaid", "past", "past-deadline"]) {
    assert.equal((await f.invoke(bookingId, "cancel_booking", { bookingId })).ok, false);
    assert.equal((await f.store.get<Booking>("booking", bookingId))!.status, "active");
  }
  ws.close();
});

test("a phone-only inquiry appears in the CRM and a known customer's name survives a call", async t => {
  const f = await fixture(t), ws = await f.stream("CA-LINK", "+819012345678");
  const key = phoneKey("090-1234-5678");
  await f.invoke("ask", "create_inquiry", { name: "Taro", reason: "確認してほしい" });
  const inquiries = await f.store.records<Inquiry>("inquiry", f.shop), records = await f.store.records<any>("customer", f.shop);
  assert.deepEqual(records.map(record => record.email), [key]);
  const customers = aggregateCustomers([], inquiries, [], new Date(), undefined, records);
  assert.deepEqual(customers.map(customer => [customer.email, customer.history.length]), [[key, 1]]);
  ws.close();
  await f.store.put("customer", `${f.shop.id}:${key}`, { ...records[0], name: "Staff entered" });
  const again = await f.stream("CA-LINK-2", "+819012345678");
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  await f.invoke("book", "create_booking", { name: "Misheard", menuId: "simple", start: new Date(`${day}T10:00:00+09:00`).toISOString() });
  assert.equal((await f.store.get<any>("customer", `${f.shop.id}:${key}`)).name, "Staff entered");
  again.close();
});

test("a number shared by several accounts books under the phone key", async t => {
  const f = await fixture(t), phone = "03-1234-5678", key = phoneKey(phone);
  for (const email of ["one@example.com", "two@example.com"]) await f.store.put("customer", `${f.shop.id}:${email}`, { shopId: f.shop.id, email, name: email, phone });
  const day = dateIn(Date.now() + 5 * 86400000, "Asia/Tokyo");
  const ws = await f.stream("CA-FAMILY");
  const booked = await f.invoke("book", "create_booking", { name: "Two", menuId: "simple", start: new Date(`${day}T12:00:00+09:00`).toISOString() });
  assert.equal((await f.store.get<Booking>("booking", booked.bookingId))!.customer, key);
  ws.close();
});
