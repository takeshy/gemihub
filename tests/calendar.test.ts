import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store, type User } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { sample, dateJST } from "../server/domain.ts";
import { availableSlots, busySchema, calendarScope, type Busy, type CalendarConnection } from "../server/calendar.ts";

process.env.DEMO_MODE = "true";
process.env.GOOGLE_CLIENT_ID = "calendar-test";

test("Calendar OAuth is bound to member, shop, staff and account; busy slots are checked again at confirmation", async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  const config = structuredClone(sample);
  config.hours.closedWeekdays = [];
  shop.published = config;
  await store.saveShop(shop);
  const member = { shopId: shop.id, email: "family@example.com", accepted: true, status: "accepted" };
  await store.put("member", `${shop.id}:${member.email}`, member);
  const sessions: Record<string, User> = {
    owner: { email: shop.owner, name: "Owner", role: "owner" },
    family: { email: member.email, name: "Family", role: "customer" },
    outsider: { email: "outsider@example.com", name: "Outsider", role: "customer", shopId: shop.id },
  };
  for (const [id, user] of Object.entries(sessions)) await store.put("session", digest(id), { user, expires: Date.now() + 600000 });
  await store.put("customer", `${shop.id}:outsider@example.com`, { shopId: shop.id, email: "outsider@example.com", name: "Outsider", birthDate: "1990-01-01", gender: "not_specified", updatedAt: new Date().toISOString(), updatedBy: "outsider@example.com" });
  let busy: Busy = [];
  let broken = false;
  let identityEmail = member.email;
  let calls = 0;
  const gateway = {
    async exchange() { return { email: identityEmail, refreshToken: "encrypted-test-token" }; },
    async busy(_c: CalendarConnection, start: string, end: string) {
      calls++;
      assert.equal(Date.parse(end) - Date.parse(start), 86400000);
      assert.ok(start.endsWith("15:00:00.000Z"));
      if (broken) throw new Error("private provider error");
      return busy;
    },
  };
  const server = createApp(store, undefined, gateway);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  async function request(path: string, id = "family", data?: unknown, extra = "") {
    const res = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", redirect: "manual", headers: { Origin: origin, Cookie: `gemihub_session=${id}${extra}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null, cookie: res.headers.get("set-cookie")?.split(";")[0], location: res.headers.get("location") };
  }
  const path = `/api/shops/${shop.id}/calendar`;
  assert.equal((await request(path, "outsider")).status, 403);
  assert.equal((await request(`${path}/connect`, "family", { staffId: "missing" })).status, 400);
  async function connect(id = "family", staffId = "aoi", callbackId = id) {
    const result = await request(`${path}/connect`, id, { staffId });
    assert.equal(result.status, 200);
    const url = new URL(result.body.authUrl);
    assert.ok(url.searchParams.get("scope")!.includes(calendarScope));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(!url.searchParams.get("scope")!.includes("drive"));
    return request(`/auth/google/callback?state=${url.searchParams.get("state")}&code=fake`, callbackId, undefined, `; ${result.cookie}`);
  }
  assert.equal((await connect("family", "aoi", "outsider")).status, 403);
  identityEmail = "wrong@example.com";
  assert.equal((await connect()).status, 403);
  assert.equal((await request(path)).body.connected, false);
  const expired = await request(`${path}/connect`, "family", { staffId: "aoi" });
  const state = new URL(expired.body.authUrl).searchParams.get("state")!;
  const pending = (await store.get<Record<string, unknown>>("oauth", digest(state)))!;
  await store.put("oauth", digest(state), { ...pending, expires: Date.now() - 1 });
  assert.equal((await request(`/auth/google/callback?state=${state}&code=fake`, "family", undefined, `; ${expired.cookie}`)).status, 400);
  assert.equal((await request(`/auth/google/callback?state=${state}&code=fake`, "family")).status, 400);
  identityEmail = member.email;
  const connected = await connect();
  assert.equal(connected.status, 302);
  assert.equal(connected.location, "/?calendar=connected");
  const status = await request(path);
  assert.equal(status.body.staffId, "aoi");
  assert.ok(!JSON.stringify(status.body).includes("token"));
  assert.equal((await request(`${path}/connect`, "owner", { staffId: "aoi" })).status, 409);
  const workspace = await request("/api/workspace");
  assert.ok(!JSON.stringify(workspace.body).includes("encrypted-test-token"));
  const date = dateJST(new Date(Date.now() + 3 * 86400000));
  const slotPath = `/api/public/${shop.slug}/slots?date=${date}&menu=simple`;
  const slots = (await request(slotPath)).body;
  const first = slots[0];
  assert.equal(first.staffId, "aoi");
  busy = [{ start: first.start, end: first.end }];
  const blocked = (await request(slotPath)).body.find((s: { start: string }) => s.start === first.start);
  assert.equal(blocked.staffId, "haru"); // fallback must happen during allocation
  assert.equal((await request(`/api/public/${shop.slug}/bookings`, "outsider", { name: "Customer", menuId: "simple", staffId: "aoi", start: first.start })).status, 409);
  assert.equal((await request(slotPath + "&staff=haru")).body.find((s: { start: string }) => s.start === first.start).staffId, "haru");
  const booking = await request(`/api/public/${shop.slug}/bookings`, "outsider", { name: "Customer", menuId: "simple", start: first.start });
  assert.equal(booking.status, 200);
  assert.equal(booking.body.booking.staffId, "haru");
  assert.equal((await request(`/api/public/${shop.slug}/bookings`, "outsider", { name: "Customer", menuId: "simple", start: first.start })).status, 409);
  // Busy interval end is exclusive, so a slot beginning at its end is allowed.
  assert.ok((await request(slotPath)).body.some((s: { start: string; staffId: string }) => s.start === first.end && s.staffId === "aoi"));
  broken = true;
  const failed = await request(slotPath);
  assert.equal(failed.status, 503);
  assert.ok(!JSON.stringify(failed.body).includes("private provider error"));
  assert.equal((await request(`/api/public/${shop.slug}/bookings`, "outsider", { name: "Customer", menuId: "simple", start: first.end })).status, 503);
  shop.published = config;
  await store.saveShop(shop);
  assert.equal((await request(slotPath + "&staff=haru")).status, 200);
  broken = false;
  // An all-day busy period removes every slot for that staff member.
  busy = [{ start: `${date}T00:00:00+09:00`, end: `${date}T23:59:59+09:00` }];
  assert.deepEqual((await request(slotPath + "&staff=aoi")).body, []);
  await request(`/api/shops/${shop.id}/members/revoke`, "owner", { email: member.email });
  assert.equal(await store.get("calendar", `${shop.id}:${member.email}`), undefined);
  assert.equal((await request(path)).status, 403);
  assert.ok((await request(slotPath + "&staff=aoi")).body.length > 0);
  // Unaccepted and foreign-shop records never affect availability, even if left in storage.
  await store.put("calendar", `${shop.id}:${member.email}`, { shopId: shop.id, email: member.email, staffId: "aoi", refreshToken: "stale" });
  await store.put("calendar", "foreign:owner", { shopId: "foreign", email: shop.owner, staffId: "aoi", refreshToken: "foreign-token" });
  const before = calls;
  await availableSlots(store, shop, config, date, "simple", "aoi", gateway);
  assert.equal(calls, before);
  identityEmail = shop.owner;
  assert.equal((await connect("owner")).status, 302);
  assert.equal((await request(`${path}/disconnect`, "outsider", {})).status, 403);
  assert.equal((await request(`${path}/disconnect`, "owner", {})).status, 200);
  assert.equal((await request(path, "owner")).body.connected, false);
});

test("malformed busy intervals are rejected", () => {
  assert.equal(busySchema.safeParse([{ start: "invalid", end: "invalid" }]).success, false);
  assert.equal(busySchema.safeParse([{ start: "2026-11-01T11:00:00Z", end: "2026-11-01T10:00:00Z" }]).success, false);
});
