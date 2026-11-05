import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import { Store, mailLockKey } from "../server/store.ts";
import { sample, type Booking } from "../server/domain.ts";
import { queueBookingReminders, reminderCurrent } from "../server/booking-reminders.ts";
import { bookingReminderDue, bookingReminderHours } from "../shared/booking-reminders.ts";
import { defaultRefundTiers } from "../server/payment-domain.ts";
import { createApp } from "../server/app.ts";
import { encrypt } from "../server/google.ts";
import { digest } from "../server/auth.ts";
import type { JudgeMail } from "../server/judge.ts";

const hour = 3600000;
function booking(shopId: string, id: string, start: number): Booking {
  return { id, shopId, customer: `${id}@example.com`, name: `Customer ${id}`, menuId: "simple", staffId: "aoi", price: 5500, message: "Private message", start: new Date(start).toISOString(), end: new Date(start + hour).toISOString(), status: "active", createdAt: new Date(start - 72 * hour).toISOString(), locale: "en" };
}
const paid = { provider: "paypal", environment: "sandbox", orderId: "order", captureId: "capture", amount: 5500, currency: "JPY", policy: defaultRefundTiers } as const;

test("reminder timing leaves an hour before unpaid cancellation cutoffs and uses elapsed hours across DST", () => {
  const config = structuredClone(sample);
  const b = booking("shop", "customer", Date.parse("2026-11-02T00:30:00-05:00"));
  config.region = { country: "US", timeZone: "America/New_York" };
  assert.equal(bookingReminderHours(config, b), 25);
  assert.equal(bookingReminderDue(config, b), Date.parse(b.start) - 25 * hour);
  config.rules.cancelHours = 48;
  assert.equal(bookingReminderHours(config, b), 49);
  config.rules.cancelHours = 0;
  assert.equal(bookingReminderHours(config, b), 24);
  b.payment = structuredClone({ ...paid, policy: defaultRefundTiers });
  config.rules.cancelHours = 72;
  assert.equal(bookingReminderHours(config, b), 24, "paid bookings retain their saved refund policy");
});

test("queue selects confirmed due bookings, catches up, deduplicates concurrent workers, and commits atomically", async () => {
  const store = new Store(":memory:");
  try {
    const shop = await store.createShop("owner@example.com");
    shop.published = structuredClone(sample);
    shop.google = { folderId: "folder", specId: "spec", historyId: "history" };
    await store.saveShop(shop);
    const now = Date.parse("2026-11-06T01:00:00Z");
    const due = booking(shop.id, "due", now + 25 * hour);
    due.items = [{ menuId: "simple", name: "Saved service + add-on", price: 5500, duration: 60 }];
    const overdue = booking(shop.id, "overdue", now + 2 * hour);
    const early = booking(shop.id, "early", now + 25 * hour + 1);
    const started = booking(shop.id, "started", now);
    const cancelled = { ...booking(shop.id, "cancelled", now + 24 * hour), status: "cancelled" as const };
    const noShow = { ...booking(shop.id, "no-show", now + 24 * hour), status: "no_show" as const };
    const late = { ...booking(shop.id, "late", now + hour), createdAt: new Date(now).toISOString() };
    for (const b of [due, overdue, early, started, cancelled, noShow, late]) await store.saveBooking(b);
    // Unconfirmed checkout holds are not booking records and must never receive a reminder.
    await store.put("checkout", "unconfirmed", { shopId: shop.id, phase: "awaiting_approval", booking: booking(shop.id, "unconfirmed", now + hour) });
    let fail = true;
    const enqueue = async (id: string, mail: unknown) => {
      await store.put("testMail", id, mail);
      if (fail) throw new Error("interrupted enqueue");
    };
    await assert.rejects(store.locked(mailLockKey(shop.id), () => queueBookingReminders(store, shop, enqueue, now)));
    assert.deepEqual(await store.list("bookingReminder"), []);
    assert.deepEqual(await store.list("testMail"), []);
    fail = false;
    await Promise.all([1, 2, 3].map(() => store.locked(mailLockKey(shop.id), () => queueBookingReminders(store, shop, enqueue, now))));
    const mails = await store.list<{ to: string; body: string; subject: string }>("testMail");
    assert.deepEqual(mails.map(m => m.to).sort(), [due.customer, overdue.customer].sort());
    assert.equal((await store.list("bookingReminder")).length, 2);
    const mail = mails.find(m => m.to === due.customer)!;
    assert.match(mail.subject, /Upcoming appointment reminder/);
    assert.match(mail.body, /Saved service \+ add-on/);
    assert.match(mail.body, /GMT\+9|JST/);
    assert.ok(mail.body.includes(shop.published.address));
    assert.doesNotMatch(mail.body, /Private message/);
    const link = new URL(mail.body.match(/https?:\/\/\S+/)![0]);
    assert.equal(link.pathname, `/s/${shop.slug}`);
    assert.deepEqual([...link.searchParams.keys()].sort(), ["lang", "pane"]);
    assert.equal(link.searchParams.get("lang"), "en");
    assert.equal(link.searchParams.get("pane"), "mine");
    assert.equal(reminderCurrent(due, { bookingId: due.id, customer: due.customer, start: due.start }, new Set(), now), true);
    for (const change of [{ customer: "other@example.com" }, { start: early.start }, { status: "cancelled" as const }, { status: "no_show" as const }])
      assert.equal(reminderCurrent({ ...due, ...change }, { bookingId: due.id, customer: due.customer, start: due.start }, new Set(), now), false);
    assert.equal(reminderCurrent(started, { bookingId: started.id, customer: started.customer, start: started.start }, new Set(), now), false);
    await queueBookingReminders(store, { ...shop, archivedAt: new Date(now).toISOString() }, enqueue, now + hour);
    await queueBookingReminders(store, { ...shop, published: null }, enqueue, now + hour);
    assert.equal((await store.list("testMail")).length, 2);
  } finally { await store.close(); }
});

test("the minute worker retries Gmail, discards stale recipients, survives app restart, and links to authenticated My page", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  shop.published.rules.cancelHours = 0;
  shop.google = { folderId: "folder", specId: "spec", historyId: "history" };
  await store.saveShop(shop);
  await store.put("user", shop.owner, { email: shop.owner, role: "owner", refreshToken: encrypt("refresh") });
  const active = booking(shop.id, "active", Date.now() + 23 * hour);
  const cancelled = booking(shop.id, "cancelled", Date.now() + 23 * hour);
  const transferred = booking(shop.id, "transferred", Date.now() + 23 * hour);
  const listed = booking(shop.id, "listed", Date.now() + 23 * hour);
  for (const b of [active, cancelled, transferred, listed]) await store.saveBooking(b);
  const sent: string[] = [];
  let failing = true;
  t.mock.method(google, "gmail", (() => ({ users: { messages: { async send(input: { requestBody: { raw: string } }) {
    if (failing) throw new Error("temporary Gmail failure");
    sent.push(Buffer.from(input.requestBody.raw, "base64url").toString());
  } } } })) as never);
  t.mock.timers.enable({ apis: ["setInterval"] });
  let server = createApp(store);
  const listen = async () => {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.APP_ORIGIN = origin;
    return origin;
  };
  const close = async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); };
  t.after(async () => { await close(); await store.close(); });
  await listen();
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 300; i++) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("minute worker did not reach the expected state");
  };
  t.mock.timers.tick(60000);
  await until(async () => (await store.list<{ attempts: number }>("job")).filter(j => j.attempts > 0).length === 4);
  await store.saveBooking({ ...cancelled, status: "cancelled" });
  await store.saveBooking({ ...transferred, customer: "new-holder@example.com", name: "New holder", locale: "ja" });
  await store.put("transfer", "listed-transfer", { id: "listed-transfer", shopId: shop.id, bookingId: listed.id, phase: "listed", deadline: new Date(Date.now() + hour).toISOString() });
  failing = false;
  t.mock.timers.tick(60000);
  await until(async () => sent.length === 2 && (await store.list("job")).length === 0);
  assert.ok(sent.some(raw => raw.startsWith(`To: ${active.customer}\r\n`)));
  assert.ok(sent.some(raw => raw.startsWith("To: new-holder@example.com\r\n")));
  assert.ok(sent.every(raw => !raw.includes(`To: ${cancelled.customer}`) && !raw.includes(`To: ${transferred.customer}`) && !raw.includes(`To: ${listed.customer}`)));
  assert.ok(sent.every(raw => !raw.includes("\r\nCc:")), "reminders go only to the current customer");
  const activeBody = Buffer.from(sent.find(raw => raw.startsWith(`To: ${active.customer}`))!.split("\r\n\r\n")[1], "base64").toString();
  assert.match(activeBody, /Upcoming|appointment/);
  const link = new URL(activeBody.match(/https?:\/\/\S+/)![0]);
  const response = await fetch(link);
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /Customer active|Private message/);
  const api = `${link.origin}/api/public/${shop.slug}/bookings`;
  assert.equal((await fetch(api)).status, 401, "the reminder link does not grant access to bookings");
  await store.put("session", digest("reminder-customer"), { user: { email: active.customer, role: "customer", shopId: shop.id }, expires: Date.now() + 600000 });
  const own = await fetch(api, { headers: { Cookie: "gemihub_session=reminder-customer" } });
  assert.equal(own.status, 200);
  assert.deepEqual((await own.json() as Booking[]).map(b => b.id), [active.id]);
  await close();
  server = createApp(store);
  await listen();
  t.mock.timers.tick(60000);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(sent.length, 2, "deleting delivered jobs and restarting must not recreate reminders");
  assert.equal((await store.list("bookingReminder")).length, 5);
});

test("judge reminders record mail without delivery, use stored shop language for legacy bookings and stop after archive", async t => {
  const savedInvite = process.env.JUDGE_INVITE, savedUntil = process.env.JUDGE_UNTIL;
  process.env.DEMO_MODE = "true";
  process.env.JUDGE_INVITE = "booking-reminder-judge-test-invitation";
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  t.after(() => {
    if (savedInvite === undefined) delete process.env.JUDGE_INVITE; else process.env.JUDGE_INVITE = savedInvite;
    if (savedUntil === undefined) delete process.env.JUDGE_UNTIL; else process.env.JUDGE_UNTIL = savedUntil;
  });
  const store = new Store(":memory:");
  const shop = await store.createShop("judge-owner@example.com");
  shop.published = structuredClone(sample);
  shop.judge = { createdAt: new Date().toISOString() };
  await store.saveShop(shop);
  await store.put("shopLocale", shop.id, { locale: "en" });
  await store.saveBooking({ ...booking(shop.id, "legacy", Date.now() + 23 * hour), locale: undefined });
  let sends = 0;
  t.mock.method(google, "gmail", (() => { sends++; throw new Error("judge mail must not reach Gmail"); }) as never);
  t.mock.timers.enable({ apis: ["setInterval"] });
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  t.mock.timers.tick(60000);
  for (let i = 0; i < 100 && !(await store.list("judgeMail")).length; i++) await new Promise(resolve => setTimeout(resolve, 10));
  const recorded = await store.list<JudgeMail>("judgeMail");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].to, "legacy@example.com");
  assert.equal(recorded[0].cc, undefined);
  assert.match(recorded[0].subject, /Upcoming appointment reminder/);
  assert.match(recorded[0].body, /lang=en/);
  assert.deepEqual(await store.list("job"), []);
  await store.saveBooking(booking(shop.id, "archived", Date.now() + 23 * hour));
  await store.saveShop({ ...shop, archivedAt: new Date().toISOString() });
  t.mock.timers.tick(60000);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await store.list("judgeMail")).length, 1);
  assert.equal(sends, 0);
});

test("a booking awaiting a replacement gets no reminder until its cancellation is withdrawn", async () => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  shop.google = { folderId: "folder", specId: "spec", historyId: "history" };
  await store.saveShop(shop);
  const now = Date.parse("2026-11-06T01:00:00Z");
  const b = { ...booking(shop.id, "listed", now + 23 * hour), payment: structuredClone(paid) };
  await store.saveBooking(b);
  const mails: string[] = [];
  const queue = () => queueBookingReminders(store, shop, async (id) => { mails.push(id); }, now);
  await store.put("transfer", "t1", { id: "t1", shopId: shop.id, bookingId: b.id, phase: "listed" });
  await queue();
  assert.equal(mails.length, 0);
  const reminder = { bookingId: b.id, customer: b.customer, start: b.start };
  assert.equal(reminderCurrent(b, reminder, new Set([b.id]), now), false, "a queued reminder is dropped when the booking is listed before delivery");
  await store.put("transfer", "t1", { id: "t1", shopId: shop.id, bookingId: b.id, phase: "withdrawn" });
  await queue();
  assert.equal(mails.length, 1);
});

test("a transfer bought after the reminder time counts as short notice; one bought earlier is reminded", async () => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  shop.domain = "shop.example.com";
  shop.domainVerified = true;
  shop.google = { folderId: "folder", specId: "spec", historyId: "history" };
  await store.saveShop(shop);
  const now = Date.parse("2026-11-06T01:00:00Z");
  const held = (id: string, at: number) => ({ ...booking(shop.id, id, now + 5 * hour), payment: structuredClone(paid), customer: `${id}-buyer@example.com`, transfers: [{ id: `t-${id}`, at: new Date(at).toISOString() }] as Booking["transfers"] });
  await store.saveBooking(held("late", now - hour));
  await store.saveBooking(held("early", now - 30 * hour));
  const mails: { id: string; to: string; body: string }[] = [];
  await queueBookingReminders(store, shop, async (id, mail) => { mails.push({ id, ...mail }); }, now);
  assert.deepEqual(mails.map(mail => mail.to), ["early-buyer@example.com"]);
  assert.match(mails[0].body, /https:\/\/shop\.example\.com\/\?pane=mine&lang=en/, "the link uses the host of the customer's session");
});

test("failing to queue alerts and reminders does not hold back mail already waiting", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  shop.google = { folderId: "folder", specId: "spec", historyId: "history" };
  await store.saveShop(shop);
  await store.put("user", shop.owner, { email: shop.owner, role: "owner", refreshToken: encrypt("refresh") });
  await store.put("job", "waiting", { id: "waiting", shopId: shop.id, type: "mail", attempts: 0, to: "waiting@example.com", subject: "s", body: "b" });
  const sent: string[] = [];
  t.mock.method(google, "gmail", (() => ({ users: { messages: { async send(input: { requestBody: { raw: string } }) {
    sent.push(Buffer.from(input.requestBody.raw, "base64url").toString());
  } } } })) as never);
  const records = store.records.bind(store);
  t.mock.method(store, "records", (async (kind: string, target: typeof shop) => {
    if (kind === "slotWish" || kind === "transfer") throw new Error("read failed");
    return records(kind, target);
  }) as never);
  const logged = t.mock.method(console, "error", () => {});
  t.mock.timers.enable({ apis: ["setInterval"] });
  const server = createApp(store);
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  t.mock.timers.tick(60000);
  for (let i = 0; i < 300 && !sent.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sent.length, 1);
  assert.ok(logged.mock.callCount() >= 2);
});
