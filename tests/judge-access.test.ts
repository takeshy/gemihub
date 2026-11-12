import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { google } from "googleapis";
import type OpenAI from "openai";
import { createApp } from "../server/app.ts";
import { ShopLogs } from "../server/shop-logs.ts";
import { Store, type Shop, type User } from "../server/store.ts";
import { sample, shopSchema, shopDate, ownerStaffId } from "../server/domain.ts";
import { availableSlots, bookingCalendars, calendarScope, type CalendarGateway } from "../server/calendar.ts";
import { decrypt, encrypt } from "../server/google.ts";
import { digest } from "../server/auth.ts";
import { aiUsage, currentProvider, generateJson, generateWithTools, setOpenAiClient, toOpenAiInput } from "../server/llm.ts";
import type { Booking } from "../server/domain.ts";
import type { Checkout } from "../server/payments.ts";
import type { JudgeMail } from "../server/judge.ts";
import { defaultRefundTiers } from "../server/payment-domain.ts";

process.env.DEMO_MODE = "true";
const invite = "i".repeat(40);

test("reconciled judge payment mail keeps the booking language across requests", async t => {
  process.env.JUDGE_INVITE = invite;
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  const { store, call, cookies } = await start(t);
  const owner = cookies(await call("/api/judge/start?lang=en", { invite }))[0];
  const shop = (await store.list<Shop>("shop"))[0];
  shop.published = structuredClone(sample); shop.published.name = "Moon Atelier";
  shop.publication = "public"; shop.locale = "ja"; await store.saveShop(shop);
  const at = new Date().toISOString();
  for (const language of ["en", "ja"] as const) {
    for (const cancelled of [false, true]) {
      const id = randomUUID();
      const booking: Booking = { id, shopId: shop.id, customer: "customer@example.com", name: "Customer", menuId: "simple", staffId: "aoi", price: 5500, message: "", start: "2026-12-15T01:00:00Z", end: "2026-12-15T02:00:00Z", status: cancelled ? "cancelled" : "active", createdAt: at, locale: language,
        payment: { provider: "paypal", environment: "sandbox", orderId: id, captureId: id, amount: 5500, currency: "JPY", policy: defaultRefundTiers, ...(cancelled ? { cancellation: { at, by: "customer@example.com", reason: "customer" as const, percent: 100, amount: 5500, status: "completed" as const, requestId: id, refundId: id } } : {}) } };
      await store.put("checkout", id, { id, shopId: shop.id, customer: booking.customer, booking, policy: defaultRefundTiers, environment: "sandbox", phase: "confirmed", expires: Date.now(), createdAt: Date.now(), returnUrl: "", cancelUrl: "", orderId: id } satisfies Checkout);
      const previous = new Set((await store.list<JudgeMail>("judgeMail")).map(mail => mail.id));
      assert.equal((await call(`/api/shops/${shop.id}/retry?lang=${language === "en" ? "ja" : "en"}`, {}, owner)).status, 200);
      const mails = await store.list<JudgeMail>("judgeMail");
      const mail = mails.find(mail => !previous.has(mail.id) && mail.to === booking.customer);
      assert.ok(mail);
      if (language === "en") {
        assert.doesNotMatch(mail.subject + mail.body, /予約|返金|支払|様/);
        assert.match(mail.subject, /Moon Atelier/);
      } else assert.match(mail.subject, cancelled ? /予約キャンセル・返金/ : /ご予約を承りました/);
    }
  }
  const count = (await store.list<JudgeMail>("judgeMail")).length;
  await call(`/api/shops/${shop.id}/retry?lang=en`, {}, owner);
  assert.equal((await store.list<JudgeMail>("judgeMail")).length, count, "reconciliation deduplicates each payment event");
});

async function start(t: { after: (fn: () => unknown) => void }, store = new Store(":memory:")) {
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = base;
  t.after(async () => { server.close(); await store.close(); });
  const call = (path: string, data?: unknown, cookie = "") => fetch(base + path, {
    method: data === undefined ? "GET" : "POST", redirect: "manual",
    headers: { Origin: base, Cookie: cookie, ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).filter(value => !value.endsWith("="));
  const session = async (user: User) => {
    const id = randomBytes(32).toString("base64url");
    await store.put("session", digest(id), { user, expires: Date.now() + 3600000 });
    return `gemihub_session=${id}`;
  };
  return { store, base, call, cookies, session };
}

test("English judge setup starts without services and retains its US region across language changes", async t => {
  process.env.JUDGE_INVITE = invite;
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  const { store, base, call, cookies } = await start(t);
  const begin = (language: string, zone: string) => fetch(`${base}/api/judge/start?lang=${language}`, {
    method: "POST", headers: { Origin: base, "Content-Type": "application/json", "Accept-Language": "ja-JP", Cookie: `gemihub_tz=${encodeURIComponent(zone)}` }, body: JSON.stringify({ invite }),
  });
  const response = await begin("en", "Asia/Tokyo");
  assert.equal(response.status, 200);
  const owner = cookies(response)[0];
  const shop = (await store.list<Shop>("shop"))[0];
  assert.deepEqual(shop.regionDefault, { country: "US", timeZone: "America/New_York" });
  const proposal = await call(`/api/shops/${shop.id}/plan?lang=en`, { text: "A nail salon" }, owner);
  assert.equal(proposal.status, 200);
  const plan = await proposal.json() as { config: { region: { country: string }; menus: { price: number }[] } };
  assert.equal(plan.config.region.country, "US");
  assert.deepEqual(plan.config.menus, []);
  assert.equal((await call("/api/judge/start?lang=ja", { invite }, owner)).status, 200);
  assert.deepEqual((await store.shop(shop.id))!.regionDefault, shop.regionDefault, "a language switch does not convert an existing shop");
  const reset = await call("/api/judge/reset?lang=en", { requestId: randomUUID() }, owner);
  assert.equal(reset.status, 200);
  const fresh = (await store.list<Shop>("shop")).find(item => !item.judge?.archivedAt)!;
  assert.deepEqual(fresh.regionDefault, shop.regionDefault);
  assert.equal((await begin("en", "America/Los_Angeles")).status, 200);
  assert.ok((await store.list<Shop>("shop")).some(item => item.regionDefault?.timeZone === "America/Los_Angeles"));
  assert.equal((await begin("ja", "America/Los_Angeles")).status, 200);
  assert.ok((await store.list<Shop>("shop")).some(item => !item.regionDefault && !item.judge?.archivedAt));
});

test("judges start without Google, see recorded mail instead of sending it, switch to a trial customer and reset", async t => {
  process.env.JUDGE_INVITE = invite;
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  const { store, call, cookies } = await start(t);
  assert.equal((await call(`/judge/${"x".repeat(40)}`)).status, 404);
  const page = await call(`/judge/${invite}`);
  assert.equal(page.status, 302, "a fresh browser is sent to the English invitation");
  assert.match(page.headers.get("Location")!, /\?lang=en$/);
  assert.equal((await call("/api/judge/start", { invite: "wrong" })).status, 404);

  const started = await call("/api/judge/start", { invite });
  assert.equal(started.status, 200);
  const judge = cookies(started)[0];
  const session = await (await call("/api/session", undefined, judge)).json() as { user: { judge?: boolean; email: string }; judgePublished?: boolean };
  assert.equal(session.user.judge, true);
  assert.equal(session.judgePublished, false, "judge controls stay hidden before the shop is published");
  assert.match(session.user.email, /@judge\.gemihub\.invalid$/);
  const resumed = await (await call("/api/judge/start", { invite }, judge)).json() as { resumed?: boolean };
  assert.equal(resumed.resumed, true, "the same browser resumes instead of creating another judge");
  assert.equal((await store.list<Shop>("shop")).length, 1);

  const shop = (await store.list<Shop>("shop"))[0];
  assert.ok(shop.judge);
  shop.published = structuredClone(sample); shop.publication = "provisional"; await store.saveShop(shop);
  assert.equal((await (await call("/api/session", undefined, judge)).json() as { judgePublished?: boolean }).judgePublished, true, "a private publication enables customer trials too");
  const workspace = await (await call("/api/workspace", undefined, judge)).json() as { shops: { publicUrl: string }[] };
  assert.equal(workspace.shops[0].publicUrl, `/s/${shop.slug}`, "judges stay on the management origin");

  // Staff invitations normally send mail; judge shops record it for the judge menu.
  assert.equal((await call(`/api/shops/${shop.id}/invite`, { email: "staff@example.com" }, judge)).status, 200);
  const mails = await (await call("/api/judge/mails", undefined, judge)).json() as { to: string; subject: string }[];
  assert.deepEqual(mails.map(mail => mail.to), ["staff@example.com"]);
  assert.equal((await store.list("job")).length, 0, "no mail job is queued");

  const status = await (await call("/api/judge/status", undefined, judge)).json() as { aiLimit: number; published: boolean };
  assert.equal(status.aiLimit, 200);
  assert.equal(status.published, true);

  const switched = await call("/api/judge/customer", {}, judge);
  assert.equal(switched.status, 200);
  const switchedCookies = cookies(switched);
  const customer = switchedCookies.find(value => value.startsWith("gemihub_session="))!;
  const ownerMemo = switchedCookies.find(value => value.startsWith("gemihub_judge_owner="))!;
  const customerSession = await (await call("/api/session", undefined, `${customer}; ${ownerMemo}`)).json() as { user: { role: string; email: string }; judgeCustomer?: boolean };
  assert.equal(customerSession.user.role, "customer");
  assert.equal(customerSession.judgeCustomer, true);
  assert.ok((await new ShopLogs(store).customerActivity(shop.id, customerSession.user.email)).rows.some(row => row.operation === "login"));
  assert.equal((await call(`/api/public/${shop.slug}`, undefined, customer)).status, 200, "the judge's trial customer may use the provisional shop");
  const stranger = cookies(await call("/api/judge/start", { invite }))[0];
  const strangerCustomer = cookies(await call("/api/judge/customer", {}, stranger)).find(value => value.startsWith("gemihub_session="));
  assert.equal(strangerCustomer, undefined, "another judge cannot switch to a customer before publishing");
  assert.equal((await call(`/api/public/${shop.slug}`, undefined, stranger)).status, 403, "other judges cannot open a provisional judge shop");
  assert.equal((await call("/api/judge/status", undefined, customer)).status, 403);
  const back = await call("/api/judge/owner", {}, `${customer}; ${ownerMemo}`);
  assert.equal(back.status, 200);
  assert.equal(cookies(back).find(value => value.startsWith("gemihub_session=")), judge);

  // A reset archives the shop, clears recorded mail and trial customers, and keeps AI usage.
  await store.put("judgeUsage", session.user.email, { email: session.user.email, count: 7 });
  const requestId = crypto.randomUUID();
  const reset = await call("/api/judge/reset", { requestId }, judge);
  assert.equal(reset.status, 200);
  const renewed = cookies(reset)[0];
  assert.equal((await call("/api/workspace", undefined, judge)).status, 401, "the previous session ends");
  const fresh = await (await call("/api/workspace", undefined, renewed)).json() as { shops: Shop[] };
  assert.equal(fresh.shops.length, 1);
  assert.notEqual(fresh.shops[0].id, shop.id);
  assert.equal(fresh.shops[0].published, null);
  assert.ok((await store.get<Shop>("shop", shop.id))!.judge!.archivedAt);
  assert.deepEqual(await (await call("/api/judge/mails", undefined, renewed)).json(), []);
  assert.equal((await call("/api/session", undefined, customer).then(r => r.json()) as { user: unknown }).user, null);
  assert.equal((await (await call("/api/judge/status", undefined, renewed)).json() as { aiUsed: number }).aiUsed, 7);
  assert.equal((await call(`/s/${shop.slug}`)).status, 404, "the archived storefront disappears");
  assert.equal((await call("/api/judge/reset", { requestId }, renewed)).status, 200, "retrying the same reset is harmless");
  assert.equal((await store.list<Shop>("shop")).filter(item => !item.judge?.archivedAt).length, 2, "one live shop per judge");

  // Ending judge access signs judges out and hides their shops.
  process.env.JUDGE_UNTIL = new Date(Date.now() - 1000).toISOString();
  assert.equal((await (await call("/api/session", undefined, renewed)).json() as { user: unknown }).user, null);
  assert.equal((await call("/api/judge/start", { invite })).status, 404);
  assert.equal((await call(`/judge/${invite}?lang=en`)).status, 404);
});

test("reopening the invitation restores the original owner from trial mode without creating a shop", async t => {
  process.env.JUDGE_INVITE = invite;
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  const { store, call, cookies } = await start(t);
  const ownerCookie = cookies(await call("/api/judge/start", { invite }))[0];
  const owner = (await (await call("/api/session", undefined, ownerCookie)).json()).user;
  const shop = (await store.shop(owner.shopId))!;
  shop.published = structuredClone(sample);
  await store.saveShop(shop);
  const switched = cookies(await call("/api/judge/customer", {}, ownerCookie));
  const customerCookie = switched.find(value => value.startsWith("gemihub_session="))!;
  const ownerMemo = switched.find(value => value.startsWith("gemihub_judge_owner="))!;
  const customer = (await (await call("/api/session", undefined, customerCookie)).json()).user;

  for (const cookie of [`${customerCookie}; ${ownerMemo}`, ownerMemo]) {
    const response = await call("/api/judge/start", { invite }, cookie);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).resumed, true);
    assert.equal(cookies(response).find(value => value.startsWith("gemihub_session=")), ownerCookie);
    const restored = (await (await call("/api/workspace", undefined, ownerCookie)).json()).shops;
    assert.deepEqual(restored.map((shop: Shop) => shop.id), [owner.shopId]);
    assert.equal((await store.list("shop")).length, 1);
  }

  // Browsers already affected by the old behavior retain the original owner cookie.
  const accidental = cookies(await call("/api/judge/start", { invite }))[0];
  const recovery = await (await call("/api/session", undefined, `${accidental}; ${ownerMemo}`)).json();
  assert.equal(recovery.judgeOwnerAvailable, true);
  const recovered = await call("/api/judge/start", { invite }, `${accidental}; ${ownerMemo}`);
  assert.equal(cookies(recovered).find(value => value.startsWith("gemihub_session=")), ownerCookie);
  assert.equal((await store.list("shop")).length, 2, "recovery never creates or deletes shops");

  // A trial session with a lost owner cookie must not silently become a new judge.
  assert.equal(await store.get("session", digest(customerCookie.split("=")[1])), undefined, "restoring the owner ends the trial session");
  await store.put("session", digest(customerCookie.split("=")[1]), { user: customer, expires: Date.now() + 60000 });
  const orphan = await call("/api/judge/start", { invite }, customerCookie);
  assert.equal(orphan.status, 403);
  assert.equal((await store.list("shop")).length, 2);
  const invalid = await call("/api/judge/start", { invite }, `${customerCookie}; gemihub_judge_owner=invalid`);
  assert.equal(invalid.status, 403);
  assert.equal((await call("/api/judge/start", { invite }, "gemihub_judge_owner=invalid")).status, 403);
  assert.equal((await store.list("shop")).length, 2);
});

test("judge owner restoration rejects expired, archived or mismatched accounts and logout clears recovery", async t => {
  process.env.JUDGE_INVITE = invite;
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  const { store, call, cookies, session: makeSession } = await start(t);
  const first = cookies(await call("/api/judge/start", { invite }))[0];
  const owner = (await (await call("/api/session", undefined, first)).json()).user;
  const memo = `gemihub_judge_owner=${first.split("=")[1]}`;
  const otherTrial = await makeSession({email:"judge-customer-other@judge.gemihub.invalid",name:"Trial",role:"customer",shopId:"other-shop"});
  assert.equal((await call("/api/judge/owner", {}, `${otherTrial}; ${memo}`)).status, 403);
  assert.equal((await call("/api/judge/start", {invite}, `${otherTrial}; ${memo}`)).status, 403);
  const loggedOut = await call("/api/logout", {}, `${first}; ${memo}`);
  assert.ok(loggedOut.headers.getSetCookie().some(value => value.startsWith("gemihub_judge_owner=;") && value.includes("Max-Age=0")));
  assert.equal((await call("/api/judge/owner", {}, memo)).status, 403, "logged-out owner sessions cannot be restored");
  const expired = await makeSession(owner);
  const expiredId = expired.split("=")[1];
  await store.put("session", digest(expiredId), { user: owner, expires: Date.now() - 1000 });
  assert.equal((await call("/api/judge/owner", {}, `gemihub_judge_owner=${expiredId}`)).status, 403);
  const archived = await makeSession(owner);
  const shop = (await store.shop(owner.shopId))!;
  shop.archivedAt = new Date().toISOString(); await store.saveShop(shop);
  assert.equal((await call("/api/judge/owner", {}, `gemihub_judge_owner=${archived.split("=")[1]}`)).status, 403);
});

test("customer email login preserves the same shop's judge owner and invitation resumes it", async t => {
  process.env.JUDGE_INVITE = invite;
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  const { store, base, call, cookies } = await start(t);
  const ownerCookie = cookies(await call("/api/judge/start", { invite }))[0];
  const owner = (await (await call("/api/session", undefined, ownerCookie)).json()).user;
  const shop = (await store.shop(owner.shopId))!;
  shop.published = structuredClone(sample); shop.publication = "public"; await store.saveShop(shop);
  const verifyEmail = async (cookie: string) => {
    const token = randomBytes(32).toString("base64url");
    await store.put("emailLogin", digest(token), {shopId: shop.id, email: "returning@example.com", origin: base, expires: Date.now() + 60000});
    const response = await call(`/api/public/${shop.slug}/auth/email/verify`, { token }, cookie);
    assert.equal(response.status, 200);
    return cookies(response);
  };
  const switched = await verifyEmail(ownerCookie);
  const memo = switched.find(cookie => cookie.startsWith("gemihub_judge_owner="))!;
  assert.equal(memo, ownerCookie.replace("gemihub_session=", "gemihub_judge_owner="));
  const customer = switched.find(cookie => cookie.startsWith("gemihub_session="))!;
  const state = await (await call("/api/session", undefined, `${customer}; ${memo}`)).json();
  assert.equal(state.user.role, "customer");
  assert.equal(state.judgeOwnerAvailable, true);
  const resumed = await call("/api/judge/start", { invite }, `${customer}; ${memo}`);
  assert.equal(resumed.status, 200);
  assert.equal(cookies(resumed).find(cookie => cookie.startsWith("gemihub_session=")), ownerCookie);

  const trial = cookies(await call("/api/judge/customer", {}, ownerCookie));
  const verifiedTrial = await verifyEmail(trial.join("; "));
  assert.equal(verifiedTrial.some(cookie => cookie.startsWith("gemihub_judge_owner=")), false, "existing recovery cookie is retained");
  assert.equal((await call("/api/judge/owner", {}, `${verifiedTrial.join("; ")}; ${memo}`)).status, 200);

  const outsider = cookies(await call("/api/judge/start", { invite }))[0];
  assert.equal((await verifyEmail(outsider)).some(cookie => cookie.startsWith("gemihub_judge_owner=")), false, "customer login at another shop cannot establish owner recovery");
  assert.equal((await store.list("shop")).length, 2);
});

test("operator-issued judge recovery tickets resume only the current live owner, once", async t => {
  process.env.JUDGE_INVITE = invite;
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  const { store, base, call, cookies } = await start(t);
  const ownerCookie = cookies(await call("/api/judge/start", { invite }))[0];
  const owner = (await (await call("/api/session", undefined, ownerCookie)).json()).user;
  const shop = (await store.shop(owner.shopId))!;
  const issue = async (expires = Date.now() + 60000) => {
    const token = randomBytes(32).toString("base64url");
    await store.put("ticket", digest(token), {user: owner, host: new URL(base).hostname, slug: shop.slug, expires});
    return `/auth/complete?ticket=${token}`;
  };
  const link = await issue();
  const restored = await call(link, undefined, "gemihub_judge_owner=stale");
  assert.equal(restored.status, 302);
  assert.equal(restored.headers.get("Location"), "/");
  assert.ok(restored.headers.getSetCookie().some(cookie => cookie.startsWith("gemihub_judge_owner=;") && cookie.includes("Max-Age=0")));
  const newCookie = cookies(restored)[0];
  assert.equal((await (await call("/api/session", undefined, newCookie)).json()).user.shopId, shop.id);
  assert.equal((await call(link)).status, 400, "ticket cannot be replayed");
  assert.equal((await call(await issue(Date.now() - 1000))).status, 400);
  await store.put("user", owner.email, {...owner, shopId: "reset-shop"});
  assert.equal((await call(await issue())).status, 400, "reset account cannot recover the old shop");
  await store.put("user", owner.email, owner);
  shop.archivedAt = new Date().toISOString(); await store.saveShop(shop);
  assert.equal((await call(await issue())).status, 400, "archived shops stay inaccessible");
  delete shop.archivedAt; await store.saveShop(shop);
  process.env.JUDGE_UNTIL = new Date(Date.now() - 1000).toISOString();
  assert.equal((await call(await issue())).status, 400, "judge period must still be active");
  assert.equal((await store.list("shop")).length, 1, "recovery never creates another shop");
});

test("judge shops use the operator's demo Google connection and judge AI calls share one quota", async t => {
  process.env.JUDGE_INVITE = invite;
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  process.env.JUDGE_AI_LIMIT = "1";
  const store = new Store(":memory:");
  const judgeShop = { ...(await store.createShop("judge-a@judge.gemihub.invalid")), judge: { createdAt: new Date().toISOString() } };
  await store.saveShop(judgeShop);
  await store.put("user", "owner@example.com", { email: "owner@example.com", name: "Owner", role: "owner", refreshToken: "owner-token" });
  const ownShop = await store.createShop("owner@example.com");
  assert.equal(await store.ownerToken(judgeShop), undefined, "no demo connection yet");
  await store.put("demoGoogle", "current", { email: "demo@example.com", refreshToken: "demo-token", connectedAt: "", connectedBy: "admin@example.com" });
  assert.equal(await store.ownerToken(judgeShop), "demo-token");
  assert.equal(await store.ownerToken(ownShop), "owner-token", "ordinary shops keep the owner's token");
  process.env.JUDGE_UNTIL = new Date(Date.now() - 1000).toISOString();
  assert.equal(await store.ownerToken(judgeShop), undefined, "expired judge access stops storage");
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();

  let charges = 0;
  process.env.OPENAI_API_KEY = "test"; process.env.OPENAI_MODEL = "test-model";
  const requests: unknown[] = [];
  setOpenAiClient({ responses: { create: async (body: unknown) => { requests.push(body); return { output_text: '{"ok":true}', output: [] }; } } } as unknown as OpenAI);
  const { setProviderResolver } = await import("../server/llm.ts");
  setProviderResolver(async () => "openai");
  await aiUsage.run({ charge: async () => { charges++; } }, async () => {
    await generateJson({ system: "s", contents: [{ role: "user", parts: [{ text: "a" }] }], schema: {} });
    await generateJson({ system: "s", contents: [{ role: "user", parts: [{ text: "b" }] }], schema: {} });
  });
  assert.equal(charges, 1, "one request charges once even with several model calls");
  assert.equal(requests.length, 2);
  await assert.rejects(aiUsage.run({ charge: async () => { throw Object.assign(new Error("limit"), { status: 429 }); } }, () => generateJson({ system: "s", contents: [], schema: {} })), /limit/);
  assert.equal(requests.length, 2, "a refused charge makes no model call");
});

test("judge owner slots use the shared demo Calendar token and honor rotation, disconnection and expiry", async t => {
  process.env.JUDGE_INVITE = invite;
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  const store = new Store(":memory:");
  t.after(() => store.close());
  const shop = await store.createShop("judge-calendar@judge.gemihub.invalid");
  shop.judge = { createdAt: new Date().toISOString() };
  await store.saveShop(shop);
  const config = shopSchema.parse({ ...structuredClone(sample), staff: [], ownerBooking: true });
  config.hours.closedWeekdays = [];
  // Keep storage in memory while exercising the production missing-credential guard.
  const production = {
    memory: false, get: store.get.bind(store), list: store.list.bind(store),
    records: store.records.bind(store), bookings: store.bookings.bind(store), ownerToken: store.ownerToken.bind(store),
  } as unknown as Store;
  const unavailable = (error: unknown) => (error as { status: number }).status === 503;
  await assert.rejects(bookingCalendars(production, shop, config), unavailable);
  const demo = { email: "demo@example.com", refreshToken: encrypt("demo-calendar-1"), connectedAt: "", connectedBy: "admin@example.com" };
  await store.put("demoGoogle", "current", demo);
  let expectedToken = "demo-calendar-1", busy: { start: string; end: string }[] = [], broken = false, queries = 0;
  const gateway: CalendarGateway = {
    async exchange() { throw new Error("Judges do not authorize Google"); },
    async busy(connection) {
      queries++;
      assert.equal(connection.staffId, ownerStaffId);
      assert.equal(connection.shopId, shop.id);
      assert.equal(decrypt(connection.refreshToken), expectedToken);
      if (broken) throw new Error("private provider failure");
      return busy;
    },
  };
  const date = shopDate(config, Date.now() + 3 * 86400000);
  const slots = () => availableSlots(production, shop, config, date, "simple", undefined, gateway);
  const first = (await slots())[0];
  assert.ok(first);
  busy = [{ start: first.start, end: first.end }];
  assert.ok(!(await slots()).some(slot => slot.start === first.start));
  expectedToken = "demo-calendar-2";
  await store.put("demoGoogle", "current", { ...demo, refreshToken: encrypt(expectedToken) });
  await slots();
  assert.equal(queries, 3);
  assert.deepEqual(await store.list("calendar"), [], "shared credentials are not copied into judge connections");
  broken = true;
  await assert.rejects(slots(), error => unavailable(error) && !(error as Error).message.includes("private provider failure"));
  broken = false;
  const ownShop = await store.createShop("owner@example.com");
  await assert.rejects(bookingCalendars(production, ownShop, config), unavailable, "ordinary shops cannot borrow the demo token");
  await store.delete("demoGoogle", "current");
  await assert.rejects(slots(), unavailable);
  await store.put("demoGoogle", "current", demo);
  process.env.JUDGE_UNTIL = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(slots(), unavailable);
  assert.equal(queries, 4, "missing or expired shared credentials never reach Google");
});

test("OpenAI translation keeps prompts, images and tool calls; tool results come back in the shared shape", async () => {
  const input = toOpenAiInput([
    { role: "user", parts: [{ text: "hello" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }] },
    { role: "model", parts: [{ functionCall: { id: "c1", name: "read_shop_file", args: { path: "a.md" } } }] },
    { role: "user", parts: [{ functionResponse: { id: "c1", name: "read_shop_file", response: { text: "body" } } }, { text: "image follows" }] },
  ]);
  assert.deepEqual(input, [
    { role: "user", content: [{ type: "input_text", text: "hello" }, { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "auto" }] },
    { type: "function_call", call_id: "c1", name: "read_shop_file", arguments: '{"path":"a.md"}' },
    { type: "function_call_output", call_id: "c1", output: '{"text":"body"}' },
    { role: "user", content: [{ type: "input_text", text: "image follows" }] },
  ]);
  process.env.OPENAI_API_KEY = "test"; process.env.OPENAI_MODEL = "test-model";
  const { setProviderResolver } = await import("../server/llm.ts");
  setProviderResolver(async () => "openai");
  setOpenAiClient({ responses: { create: async () => ({ output_text: "", output: [{ type: "function_call", call_id: "c2", name: "read_shop_file", arguments: '{"path":"b.md"}' }] }) } } as unknown as OpenAI);
  const response = await generateWithTools({ system: "s", contents: [], tools: [{ name: "read_shop_file", description: "d", parametersJsonSchema: {} }] });
  assert.deepEqual(response.functionCalls, [{ id: "c2", name: "read_shop_file", args: { path: "b.md" } }]);
  assert.deepEqual(response.candidates?.[0]?.content?.parts, [{ functionCall: { id: "c2", name: "read_shop_file", args: { path: "b.md" } } }]);
});

test("invitation-only sign-up asks new Google owners for the password; existing owners and customers are unaffected", async t => {
  const shellRead = t.mock.method(fs, "readFile", async () => Buffer.from("<!doctype html><div id=root></div>"));
  syncBuiltinESMExports();
  t.after(() => { shellRead.mock.restore(); syncBuiltinESMExports(); });
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.ACCESS_PASSWORD = "open sesame";
  let email = "new@example.com";
  const prototype = google.auth.OAuth2.prototype as unknown as Record<"getToken" | "verifyIdToken", (...args: unknown[]) => Promise<unknown>>;
  t.mock.method(prototype, "getToken", async () => ({ tokens: { id_token: "id", access_token: "access", refresh_token: "refresh", scope: "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.freebusy" } }));
  t.mock.method(prototype, "verifyIdToken", async () => ({ getPayload: () => ({ email_verified: true, email, name: "Owner" }) }));
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    new URL(String(input)).hostname === "www.googleapis.com" ? Response.json({ files: [] }) : originalFetch(input, init));
  const { store, base, call, cookies } = await start(t);
  async function signIn(origin: string, suffix = "") {
    const begin = await originalFetch(origin + "/auth/google" + suffix, { redirect: "manual" });
    const state = new URL(begin.headers.get("Location")!).searchParams.get("state")!;
    return originalFetch(origin + `/auth/google/callback?code=code&state=${state}`, { redirect: "manual", headers: { Cookie: begin.headers.get("Set-Cookie")!.split(";")[0] } });
  }
  assert.equal((await (await call("/api/session")).json() as { invite: boolean }).invite, true);
  const pendingOwner = cookies(await signIn(base))[0];
  assert.equal((await store.list("shop")).length, 0, "no shop before the password");
  assert.equal((await (await call("/api/session", undefined, pendingOwner)).json() as { user: { accessPending?: boolean } }).user.accessPending, true);
  assert.equal((await call("/api/workspace", undefined, pendingOwner)).status, 409);
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await call("/api/access/verify", { password: "wrong" }, pendingOwner)).status, 401);
  assert.equal((await call("/api/access/verify", { password: "open sesame" }, pendingOwner)).status, 429, "repeated failures are throttled");
  // The throttle lives in the server process; a second server over the same store starts a fresh window.
  const second = await start(t, store);
  const owner = second.cookies(await signIn(second.base))[0];
  const verified = await second.call("/api/access/verify", { password: "open sesame" }, owner);
  assert.equal(verified.status, 200);
  const signedIn = second.cookies(verified)[0];
  assert.equal((await second.call("/api/workspace", undefined, signedIn)).status, 200);
  assert.equal((await store.list("shop")).length, 1);
  assert.equal((await store.get<User>("user", email))?.accessPending, false);
  assert.equal((await second.call("/api/access/verify", { password: "open sesame" }, signedIn)).status, 403);
  // Returning owners and customers never see the password.
  assert.equal((await second.call("/api/workspace", undefined, second.cookies(await signIn(second.base))[0])).status, 200);
  const shop = (await store.list<Shop>("shop"))[0];
  shop.published = structuredClone(sample); shop.publication = "public"; await store.saveShop(shop);
  email = "customer@example.com";
  const customer = second.cookies(await signIn(second.base, `?shop=${shop.slug}`))[0];
  const customerSession = await (await second.call("/api/session", undefined, customer)).json() as { user: { role: string; accessPending?: boolean } };
  assert.equal(customerSession.user.role, "customer");
  assert.equal(customerSession.user.accessPending, undefined);
  delete process.env.ACCESS_PASSWORD;
});

test("administrators connect the demo Google account, see judges and switch the AI provider", async t => {
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.ADMIN_EMAILS = "admin@example.com";
  process.env.JUDGE_INVITE = invite;
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_MODEL; delete process.env.OPENAI_IMAGE_MODEL;
  const prototype = google.auth.OAuth2.prototype as unknown as Record<"getToken" | "verifyIdToken", (...args: unknown[]) => Promise<unknown>>;
  let granted = `openid email profile https://www.googleapis.com/auth/drive.file ${calendarScope}`;
  t.mock.method(prototype, "getToken", async () => ({ tokens: { id_token: "id", access_token: "access", refresh_token: "demo-refresh", scope: granted } }));
  t.mock.method(prototype, "verifyIdToken", async () => ({ getPayload: () => ({ email_verified: true, email: "Demo@Example.com" }) }));
  const { store, call, session } = await start(t);
  const admin = await session({ email: "admin@example.com", name: "Admin", role: "owner" });
  const other = await session({ email: "owner@example.com", name: "Owner", role: "owner" });
  assert.equal((await call("/api/admin/status", undefined, other)).status, 404);
  assert.equal((await call("/admin/google/connect", undefined, other)).status, 404);
  assert.equal((await (await call("/api/session", undefined, admin)).json() as { user: { admin?: boolean } }).user.admin, true);

  const begin = await call("/admin/google/connect", undefined, admin);
  assert.equal(begin.status, 302);
  const authorize = new URL(begin.headers.get("Location")!);
  assert.match(authorize.searchParams.get("scope")!, /drive\.file/);
  assert.ok(authorize.searchParams.get("scope")!.split(" ").includes(calendarScope));
  assert.doesNotMatch(authorize.searchParams.get("scope")!, /gmail/);
  const state = authorize.searchParams.get("state")!;
  const oauthCookie = begin.headers.get("Set-Cookie")!.split(";")[0];
  const done = await call(`/auth/google/callback?code=code&state=${state}`, undefined, `${admin}; ${oauthCookie}`);
  assert.equal(done.status, 302);
  assert.match(done.headers.get("Location")!, /^\/admin\?google=connected/);
  const connection = await store.get<{ email: string; refreshToken: string }>("demoGoogle", "current");
  assert.equal(connection?.email, "demo@example.com");
  assert.notEqual(connection?.refreshToken, "demo-refresh", "the token is encrypted");
  assert.equal(await store.get("user", "admin@example.com"), undefined, "the administrator's own user is untouched");

  granted = "openid email profile https://www.googleapis.com/auth/drive.file";
  const deniedBegin = await call("/admin/google/connect", undefined, admin);
  const deniedState = new URL(deniedBegin.headers.get("Location")!).searchParams.get("state")!;
  const deniedCookie = deniedBegin.headers.get("Set-Cookie")!.split(";")[0];
  const denied = await call(`/auth/google/callback?code=code&state=${deniedState}`, undefined, `${admin}; ${deniedCookie}`);
  assert.equal(denied.status, 400, "Calendar consent is required for the shared demo token");
  assert.deepEqual(await store.get("demoGoogle", "current"), connection, "denied consent preserves the existing connection");

  const status = await (await call("/api/admin/status", undefined, admin)).json() as { judge: { active: boolean; inviteUrlEn: string }; demoGoogle: { email: string }; ai: { provider: string; openai: { ready: boolean } } };
  assert.equal(status.judge.active, true);
  assert.match(status.judge.inviteUrlEn, new RegExp(`/judge/${invite}\\?lang=en$`));
  assert.equal(status.demoGoogle.email, "demo@example.com");
  assert.equal(status.ai.provider, "vertex");
  assert.equal((await (await call("/api/session", undefined, other)).json() as { user: { admin?: boolean } }).user.admin, undefined);

  await call("/api/judge/start", { invite });
  const judges = await (await call("/api/admin/judges", undefined, admin)).json() as { shopName: string | null; aiUsed: number }[];
  assert.equal(judges.length, 1);
  assert.equal(judges[0].shopName, null);

  assert.equal((await call("/api/admin/ai-provider", { provider: "openai" }, admin)).status, 400, "an unconfigured provider cannot be selected");
  process.env.OPENAI_API_KEY = "key"; process.env.OPENAI_MODEL = "model"; process.env.OPENAI_IMAGE_MODEL = "image-model";
  assert.equal((await call("/api/admin/ai-provider", { provider: "openai" }, admin)).status, 200);
  assert.equal(await currentProvider(), "openai");
  assert.equal((await call("/api/admin/ai-provider", { provider: "openai" }, other)).status, 404);
  assert.equal((await call("/api/admin/google/disconnect", {}, admin)).status, 200);
  assert.equal(await store.get("demoGoogle", "current"), undefined);
});
