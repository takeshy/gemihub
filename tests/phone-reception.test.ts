import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { Store } from "../server/store.ts";
import { sample, type Booking, type ShopConfig } from "../server/domain.ts";
import { applyPhoneSettings } from "./phone-test-helpers.ts";
import { createApp } from "../server/app.ts";
import { dateIn } from "../shared/region.ts";
import {
  callerNumber, downsample24kTo8k, mulawToPcm16, pcm16ToMulaw, phoneStreamToken, samePhoneNumber,
  twilioSignature, upsample8kTo16k, validTwilioSignature, withinPhoneHours,
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
async function fixture(t: TestContext) {
  process.env.DEMO_MODE = "true";
  process.env.TWILIO_AUTH_TOKEN = token;
  process.env.TWILIO_SKIP_SIGNATURE = "false";
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
  process.env.PHONE_LIVE_MODEL = "test-live";
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  const config = fixtureConfig();
  shop.published = config; shop.publication = "public";
  applyPhoneSettings(shop, { enabled: true, twilioNumber: "+819012345678", cashBookings: true });
  await store.saveShop(shop);
  for (const [cookie, email, role] of [["owner", shop.owner, "owner"]]) await store.put("session", (await import("../server/auth.ts")).digest(cookie), { user: { email, name: cookie, role, shopId: shop.id }, expires: Date.now() + 3600000 });
  let callbacks: any;
  const toolResponses: any[] = [];
  const live = {
    sendClientContent() {}, sendRealtimeInput() {}, sendToolResponse(value: unknown) { toolResponses.push(value); }, close() {},
  };
  const connector = async (parameters: any) => { callbacks = parameters.callbacks; return live as any; };
  const server = createApp(store, undefined, undefined, undefined, undefined, undefined, undefined, undefined, connector);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const call = async (path: string, data?: unknown, who = "owner") => {
    const response = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Cookie: `gemihub_session=${who}`, Origin: origin, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const webhook = async (from: string, callSid = "CA123") => {
    const params = { To: "+819012345678", From: from, CallSid: callSid };
    const response = await fetch(`${origin}/phone/incoming`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioSignature(token, `${origin}/phone/incoming`, params) },
      body: new URLSearchParams(params).toString(),
    });
    return { status: response.status, text: await response.text() };
  };
  const stream = async (callSid = "CA-TOOL") => {
    const url = `${origin.replace("http", "ws")}/phone/stream?shop=${shop.id}&call=${callSid}&from=0312345678&token=${phoneStreamToken(shop.id, callSid, "0312345678")}`;
    const ws = new WebSocket(url);
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
  return { store, shop, config, call, webhook, stream, callbacks: () => callbacks, toolResponses, waitFor, origin };
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

test("a known caller reaches a signed Twilio media stream, and settings can disable it", async t => {
  const f = await fixture(t);
  const connected = await f.webhook("+819011112222", "CA-OK");
  assert.match(connected.text, /<Connect><Stream url="ws:\/\/[^"]+\/phone\/stream\?/);
  assert.match(connected.text, new RegExp(`token=${phoneStreamToken(f.shop.id, "CA-OK", "819011112222")}`));
  const saved = await f.call(`/api/shops/${f.shop.id}/phone/settings`, { enabled: false, twilioNumber: "+819012345678", cashBookings: true });
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
  assert.equal(booking.customer, "tel:0312345678");
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
  assert.ok(!(await f.store.get("customer", `${f.shop.id}:tel:0312345678`)), "no duplicate phone-only customer is created");
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

test("today's discounted transfer slot is offered with the amount the shop would bear", async t => {
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
  assert.equal(result.transferSlots.length, 1);
  assert.deepEqual(
    [result.transferSlots[0].id, result.transferSlots[0].price, result.transferSlots[0].refundAmount, result.transferSlots[0].start],
    ["T1", 3850, 3850, start],
  );
  assert.ok(!result.slots.some((slot: { start: string }) => slot.start === start), "the listed slot is not offered twice");
  ws.close();
});

test("caller IDs, signatures, hours and audio conversion are deterministic", () => {
  assert.equal(callerNumber("anonymous"), undefined);
  assert.equal(callerNumber("+81 90-1111-2222"), "819011112222");
  assert.ok(samePhoneNumber("+819012345678", "090-1234-5678"));
  assert.ok(!samePhoneNumber("+819012345678", "090-9999-0000"));
  const params = { To: "+819012345678", From: "+819011112222", CallSid: "CA1" };
  const signature = twilioSignature(token, "https://example.com/phone/incoming", params);
  assert.ok(validTwilioSignature(token, "https://example.com/phone/incoming", params, signature));
  assert.ok(!validTwilioSignature(token, "https://example.com/other", params, signature));
  const hours = { start: "09:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] };
  assert.equal(withinPhoneHours({ enabled: true, twilioNumber: "", cashBookings: true, hours }, new Date("2026-11-06T01:00:00Z"), "Asia/Tokyo"), true);
  assert.equal(withinPhoneHours({ enabled: true, twilioNumber: "", cashBookings: true, hours }, new Date("2026-11-07T01:00:00Z"), "Asia/Tokyo"), false);
  const pcm = Int16Array.from([0, 1000, -1000, 32767, -32768]);
  assert.deepEqual(Array.from(pcm16ToMulaw(pcm)).length, 5);
  assert.equal(mulawToPcm16(pcm16ToMulaw(pcm)).length, 5);
  assert.equal(upsample8kTo16k(pcm).length, 10);
  assert.equal(downsample24kTo8k(new Int16Array(24)).samples.length, 8);
});
