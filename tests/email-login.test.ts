import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { google } from "googleapis";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { emailLogin } from "../server/email-login.ts";
import { sample, type Booking } from "../server/domain.ts";
import { Store } from "../server/store.ts";

process.env.DEMO_MODE = "true";
const tokenFrom = (text: string) => new URL(text.match(/https?:\/\/\S+/)![0]).hash.slice("#email-login=".length);

test("email links authenticate only the intended shop and origin, preserve existing records and are consumed once", async t => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = "customer-google-test";
  t.after(() => { if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = previousClientId; });
  const prototype = google.auth.OAuth2.prototype as unknown as Record<"getToken" | "verifyIdToken", (...args: unknown[]) => Promise<unknown>>;
  t.mock.method(prototype, "getToken", async () => ({ tokens: { id_token: "customer-identity", access_token: "customer-access", scope: "openid email profile" } }));
  t.mock.method(prototype, "verifyIdToken", async () => ({ getPayload: () => ({ email_verified: true, email: "customer@example.com", name: "Google customer" }) }));
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com"), other = await store.createShop("other@example.com");
  for (const value of [shop, other]) { value.published = structuredClone(sample); value.publication = "public"; await store.saveShop(value); }
  shop.domain = "customer.example.com"; shop.domainVerified = true; await store.saveShop(shop);
  const profile = { name: "Returning customer", birthDate: "1990-01-01", gender: "not_specified" };
  await store.put("customer", `${shop.id}:customer@example.com`, { ...profile, shopId: shop.id, email: "customer@example.com" });
  await store.saveBooking({ id: "existing-booking", shopId: shop.id, customer: "customer@example.com", name: profile.name, menuId: "simple", staffId: "aoi", price: 5500, message: "", start: "2026-12-01T01:00:00Z", end: "2026-12-01T02:00:00Z", status: "active", createdAt: "2026-11-01T00:00:00Z" } satisfies Booking);
  const mails: { to: string; text: string }[] = [];
  const server = createApp(store, undefined, undefined, undefined, undefined, undefined, async (_shop, to, _subject, text) => { mails.push({ to, text }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const base = `/api/public/${shop.slug}`;
  const call = (path: string, data?: unknown, cookie = "", host?: string) => new Promise<{ status: number; body: any; cookie: string; headers: Headers }>((resolve, reject) => {
    const req = request(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Origin: host ? `https://${host}` : origin, Cookie: cookie, "Content-Type": "application/json", ...(host ? { Host: host } : {}) } }, response => {
      let text = ""; response.setEncoding("utf8"); response.on("data", chunk => { text += chunk; });
      response.on("end", () => { try { resolve({ status: response.statusCode!, body: JSON.parse(text), cookie: response.headers["set-cookie"]?.[0]?.split(";")[0] || "", headers: new Headers(Object.entries(response.headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined).map(([key, value]): [string, string] => [key, String(value)])) }); } catch (error) { reject(error); } });
    });
    req.on("error", reject); req.end(data === undefined ? undefined : JSON.stringify(data));
  });
  const publicView = await call(base);
  assert.match(publicView.body.authUrl, /#email-login$/); assert.doesNotMatch(publicView.body.authUrl, /auth\/google/);
  const googleUrl = new URL(publicView.body.googleAuthUrl);
  assert.equal(googleUrl.pathname, "/auth/google"); assert.equal(googleUrl.searchParams.get("shop"), shop.slug);
  const requested = await call(`${base}/auth/email`, { email: " Customer@Example.com " });
  assert.equal(requested.status, 200); assert.deepEqual(requested.body, { ok: true }); assert.equal(requested.cookie, "");
  assert.equal(mails[0].to, "customer@example.com");
  const token = tokenFrom(mails[0].text);
  assert.ok(await store.get("emailLogin", digest(token)));
  assert.ok(!JSON.stringify(await store.entries("emailLogin")).includes(token), "the raw token is not stored");
  for (let i = 0; i < 2; i++) assert.equal((await call(`${base}/auth/email/info`, { token })).status, 200, "mail scanners cannot consume the link");
  assert.equal((await call("/api/session")).body.user, null);
  assert.equal((await call(`/api/public/${other.slug}/auth/email/verify`, { token })).status, 400);
  assert.equal((await call(`${base}/auth/email/verify`, { token }, "", shop.domain)).status, 400, "a different origin cannot consume the link");
  const verified = await call(`${base}/auth/email/verify`, { token });
  assert.equal(verified.status, 200); assert.equal(verified.body.redirectTo, `/s/${shop.slug}?pane=mine&lang=ja`);
  assert.match(verified.headers.get("set-cookie")!, /HttpOnly/);
  assert.equal((await call("/api/session", undefined, verified.cookie)).body.user.name, profile.name);
  assert.deepEqual((await call(base, undefined, verified.cookie)).body.customerProfile, profile);
  assert.equal((await call(`${base}/bookings`, undefined, verified.cookie)).body[0].id, "existing-booking");
  assert.equal((await call(`${base}/auth/email/verify`, { token })).status, 400);
  assert.equal(await store.get("user", "customer@example.com"), undefined, "customer sign-in does not create or replace Google owner credentials");
  const googleStart = await fetch(googleUrl, { redirect: "manual" });
  const authorization = new URL(googleStart.headers.get("location")!);
  assert.deepEqual(authorization.searchParams.get("scope")!.split(" "), ["openid", "email", "profile"]);
  const oauthCookie = googleStart.headers.getSetCookie().find(value => value.startsWith("gemihub_oauth="))!.split(";")[0];
  const googleDone = await fetch(`${origin}/auth/google/callback?code=customer&state=${authorization.searchParams.get("state")}`, { redirect: "manual", headers: { Cookie: oauthCookie } });
  assert.equal(googleDone.status, 302);
  const googleCookie = googleDone.headers.getSetCookie().find(value => value.startsWith("gemihub_session="))!.split(";")[0];
  assert.deepEqual((await call(base, undefined, googleCookie)).body.customerProfile, profile, "both methods share the same member profile");
  assert.equal((await call(`${base}/bookings`, undefined, googleCookie)).body[0].id, "existing-booking");
  assert.equal(await store.get("user", "customer@example.com"), undefined, "Google customer login does not create an owner account");
  assert.equal((await call(`${base}/auth/email`, { email: "customer@example.com" })).status, 429);
  assert.equal((await call(`${base}/auth/email`, { email: "invalid" })).status, 400);

  await call(`${base}/auth/email`, { email: "new@example.com" }, "", shop.domain);
  const hostedView = await call(base, undefined, "", shop.domain);
  assert.equal(new URL(hostedView.body.googleAuthUrl).searchParams.get("host"), shop.domain);
  const hostedToken = tokenFrom(mails.at(-1)!.text);
  assert.match(mails.at(-1)!.text, /https:\/\/customer\.example\.com\/\?pane=mine&lang=ja#email-login=/);
  const concurrent = await Promise.all([call(`${base}/auth/email/verify`, { token: hostedToken }, "", shop.domain), call(`${base}/auth/email/verify`, { token: hostedToken }, "", shop.domain)]);
  assert.deepEqual(concurrent.map(value => value.status).sort(), [200, 400]);
  const fresh = concurrent.find(value => value.status === 200)!;
  assert.equal(fresh.body.redirectTo, "/?pane=mine&lang=ja");
  assert.equal((await call(base, undefined, fresh.cookie, shop.domain)).body.registrationRequired, true);
});

test("customer email verification never grants owner or staff management permissions", async t => {
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample); await store.saveShop(shop);
  await store.put("member", `${shop.id}:staff@example.com`, { shopId: shop.id, email: "staff@example.com", accepted: true });
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const service = emailLogin(store, async () => {});
  for (const email of [shop.owner, "staff@example.com"]) {
    const token = Buffer.alloc(32, email === shop.owner ? 1 : 2).toString("base64url");
    await store.put("emailLogin", digest(token), { shopId: shop.id, email, origin, expires: Date.now() + 60000 });
    const user = await service.verify(shop, origin, { token });
    assert.equal(user.role, "customer"); assert.equal(user.authMethod, "email");
    const id = digest(email);
    await store.put("session", digest(id), { user, expires: Date.now() + 60000 });
    const headers = { Cookie: `gemihub_session=${id}` };
    const workspace = await (await fetch(origin + "/api/workspace", { headers })).json() as { shops: unknown[] };
    assert.deepEqual(workspace.shops, []);
    assert.equal((await fetch(`${origin}/api/shops/${shop.id}/calendar`, { headers })).status, 403);
    assert.equal((await fetch(`${origin}/api/shops/${shop.id}/staff-accounts`, { headers })).status, 403);
  }
});

test("expired, malformed and undelivered email links cannot authenticate", async t => {
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample); await store.saveShop(shop); t.after(() => store.close());
  const token = Buffer.alloc(32, 3).toString("base64url"), origin = "https://gemihub.net";
  await store.put("emailLogin", digest(token), { shopId: shop.id, email: "customer@example.com", origin, expires: Date.now() - 1 });
  const service = emailLogin(store, async () => { throw new Error("private mail failure"); });
  await assert.rejects(service.verify(shop, origin, { token }), error => (error as { status: number }).status === 400);
  await assert.rejects(service.info(shop, origin, { token: "bad" }), error => (error as { status: number }).status === 400);
  await assert.rejects(service.request(shop, origin, `/s/${shop.slug}`, "ip", { email: "new@example.com" }), error => (error as { status: number }).status === 503 && !(error as Error).message.includes("private mail failure"));
  assert.equal((await store.entries("emailLogin")).length, 1, "a failed delivery removes its unused challenge");
  await store.cleanup(); assert.deepEqual(await store.entries("emailLogin"), []);
});
