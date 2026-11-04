import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { sample } from "../server/domain.ts";
import { resetShop } from "../server/shop-reset.ts";
import { bookingLockKey, mailLockKey, Store, type Shop, type User } from "../server/store.ts";

test("reset waits for both booking/payment operations and in-flight mail delivery", async t => {
  for (const key of [bookingLockKey, mailLockKey]) await t.test(key.name, async t => {
    const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
    await store.put("user", shop.owner, { email: shop.owner, name: "Owner", role: "owner", shopId: shop.id });
    let entered!: () => void, release!: () => void, requested!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { requested = resolve; });
    const operation = store.locked(key(shop.id), async () => { entered(); await gate; });
    await started;
    const original = store.locked.bind(store);
    t.mock.method(store, "locked", ((id: string, fn: () => Promise<unknown>) => {
      if (id === key(shop.id)) requested();
      return original(id, fn);
    }) as typeof store.locked);
    const resetting = resetShop(store, shop.owner, shop.id);
    await waiting;
    try { assert.equal((await store.shop(shop.id))?.archivedAt, undefined); }
    finally { release(); }
    await operation;
    const result = await resetting;
    assert.notEqual(result.shopId, shop.id);
    assert.ok((await store.get<Shop>("shop", shop.id))!.archivedAt);
    await store.close();
  });
});

test("Google owners can reset in production, retain authorization and isolate other shops", async t => {
  const previousEnv = { NODE_ENV: process.env.NODE_ENV, DEMO_MODE: process.env.DEMO_MODE };
  process.env.NODE_ENV = "production"; process.env.DEMO_MODE = "false";
  const store = new Store(":memory:");
  const old = await store.createShop("owner@example.com");
  old.published = { ...structuredClone(sample), region: { country: "US", timeZone: "America/New_York" } };
  old.domain = "old.example.com"; old.domainVerified = true;
  await store.saveShop(old);
  const other = await store.createShop("other@example.com");
  other.published = structuredClone(sample); await store.saveShop(other);
  const owner: User = { email: old.owner, name: "Google owner", role: "owner", refreshToken: "encrypted-google-connection", shopId: old.id };
  await store.put("user", owner.email, owner);
  const sessionId = randomUUID(), secondSession = randomUUID(), customerSession = randomUUID();
  for (const id of [sessionId, secondSession]) await store.put("session", digest(id), { user: owner, expires: Date.now() + 3600000 });
  await store.put("session", digest(customerSession), { user: { email: "customer@example.com", name: "Customer", role: "customer", shopId: old.id }, expires: Date.now() + 3600000 });
  await store.put("checkout", "old-payment", { shopId: old.id, phase: "confirmed", audit: "preserve" });
  await store.put("plan", "old-plan", { shopId: old.id, config: old.published });
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = base;
  t.after(async () => {
    server.close(); await store.close();
    for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const call = (path: string, data?: unknown, id: string = sessionId, origin = base) => fetch(base + path, {
    method: data === undefined ? "GET" : "POST", headers: { Cookie: `gemihub_session=${id}`, Origin: origin, "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  assert.equal((await call("/api/session").then(r => r.json())).demo, false);
  assert.equal((await call("/api/shop-reset", { shopId: old.id }, "missing")).status, 403);
  assert.equal((await call("/api/shop-reset", { shopId: old.id }, customerSession)).status, 403);
  assert.equal((await call("/api/shop-reset", { shopId: other.id })).status, 403);
  assert.equal((await call("/api/shop-reset", { shopId: old.id }, sessionId, "https://elsewhere.example")).status, 403);
  assert.equal((await call("/api/shop-reset", { shopId: "invalid" })).status, 400);
  const reset = await Promise.all([call("/api/shop-reset", { shopId: old.id }), call("/api/shop-reset", { shopId: old.id })]);
  assert.deepEqual(reset.map(r => r.status), [200, 200]);
  const results = await Promise.all(reset.map(r => r.json()));
  assert.equal(results[0].shopId, results[1].shopId, "double clicks reset the old shop only once");
  const fresh = (await store.shop(results[0].shopId))!;
  assert.notEqual(fresh.id, old.id);
  assert.equal(fresh.published, null); assert.equal(fresh.draft, null); assert.equal(fresh.revision, 0); assert.deepEqual(fresh.history, []);
  assert.deepEqual(fresh.regionDefault, old.published.region);
  assert.equal(fresh.google, undefined, "new publication gets a new Drive folder");
  assert.equal((await store.get<User>("user", owner.email))!.refreshToken, owner.refreshToken);
  assert.equal(await store.ownerToken(fresh), owner.refreshToken);
  assert.equal(await store.shop(old.id), undefined);
  assert.ok((await store.get<Shop>("shop", old.id))!.archivedAt);
  assert.equal((await call(`/s/${old.slug}`)).status, 404);
  assert.equal((await call(`/api/shops/${old.id}`)).status, 404);
  assert.equal((await call(`/api/public/${old.slug}`)).status, 404);
  assert.equal((await call(`/api/public/${other.slug}`)).status, 200);
  assert.deepEqual(await store.shop(other.id), other);
  const workspace = await (await call("/api/workspace")).json();
  assert.deepEqual(workspace.shops.map((s: Shop) => s.id), [fresh.id]);
  assert.deepEqual(workspace.shops[0].plans, []);
  assert.equal((await call("/api/session", undefined, secondSession).then(r => r.json())).user.shopId, fresh.id);
  assert.equal((await call("/api/session", undefined, customerSession).then(r => r.json())).user, null);
  assert.deepEqual(await store.get("checkout", "old-payment"), { shopId: old.id, phase: "confirmed", audit: "preserve" });
  await assert.rejects(store.put("inquiry", "late-write", { shopId: old.id }), { status: 404 });
  // A stale tab cannot undo a later take or reset its new shop.
  const next = await (await call("/api/shop-reset", { shopId: fresh.id })).json();
  await call("/api/shop-reset", { shopId: old.id });
  assert.equal((await call("/api/session").then(r => r.json())).user.shopId, next.shopId);
  assert.equal((await store.list<Shop>("shop")).filter(s => s.owner === owner.email && !s.archivedAt).length, 1);
});

test("a failed Drive cleanup closes the old site and resumes the same reset", async () => {
  const store = new Store(":memory:");
  const old = await store.createShop("owner@example.com");
  old.published = structuredClone(sample);
  old.google = { folderId: "only-this-folder", specId: "spec", historyId: "history" };
  await store.saveShop(old);
  const owner: User = { email: old.owner, name: "Owner", role: "owner", shopId: old.id, refreshToken: "google-token" };
  await store.put("user", owner.email, owner);
  const calls: string[] = [];
  const trash = async (token: string, id: string) => { assert.equal(token, owner.refreshToken); calls.push(id); if (calls.length === 1) throw new Error("Drive unavailable"); };
  await assert.rejects(resetShop(store, owner.email, old.id, trash), /Drive unavailable/);
  assert.equal(await store.shop(old.id), undefined);
  assert.equal((await store.list<Shop>("shop")).length, 1, "no new shop until cleanup succeeds");
  const fresh = await resetShop(store, owner.email, old.id, trash);
  assert.deepEqual(await resetShop(store, owner.email, old.id, trash), fresh);
  assert.deepEqual(calls, ["only-this-folder", "only-this-folder"]);
  assert.equal((await store.list<Shop>("shop")).length, 2);
  assert.deepEqual(await store.records("post", (await store.get<Shop>("shop", old.id))!), []);
  await store.close();
});

test("a response failure while updating sessions is repaired by retry without another reset", async () => {
  const store = new Store(":memory:");
  const old = await store.createShop("owner@example.com");
  const owner: User = { email: old.owner, name: "Owner", role: "owner", shopId: old.id };
  await store.put("user", owner.email, owner);
  await store.put("session", "session", { user: owner, expires: Date.now() + 3600000 });
  const put = store.put.bind(store);
  let failed = false;
  store.put = async (kind, id, value) => { if (kind === "session" && !failed) { failed = true; throw new Error("Interrupted"); } await put(kind, id, value); };
  await assert.rejects(resetShop(store, owner.email, old.id), /Interrupted/);
  const done = await resetShop(store, owner.email, old.id);
  assert.equal((await store.get<{ user: User }>("session", "session"))!.user.shopId, done.shopId);
  assert.equal((await store.list<Shop>("shop")).length, 2);
  await store.close();
});
