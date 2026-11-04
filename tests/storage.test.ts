import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { Firestore } from "@google-cloud/firestore";
import { google } from "googleapis";
import { Store } from "../server/store.ts";
import { sample, type Booking } from "../server/domain.ts";
import { randomUUID } from "node:crypto";
import { createConversation, appendChatMessage, readConversation } from "../server/shop-chat.ts";

test("Firestore stores scoped business records and operational state durably without Google credentials or Sheets", async t => {
  const previous = { demo: process.env.DEMO_MODE, project: process.env.GOOGLE_CLOUD_PROJECT };
  process.env.DEMO_MODE = "false"; process.env.GOOGLE_CLOUD_PROJECT = "fixture";
  t.after(() => {
    for (const [key, value] of [["DEMO_MODE", previous.demo], ["GOOGLE_CLOUD_PROJECT", previous.project]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    mock.restoreAll();
  });
  const cloud = new Map<string, Record<string, unknown>>();
  const queries: string[] = [];
  let failCommit = false;
  const ref = (path: string): any => ({
    path,
    get: async () => { const value=cloud.get(path); return { exists: !!value, get: (key: string) => value?.[key] }; },
    create: async (value: Record<string, unknown>) => {
      if (cloud.has(path)) throw Object.assign(new Error("exists"), { code: 6 });
      cloud.set(path, value);
    },
    delete: async () => { cloud.delete(path); },
  });
  mock.method(Firestore.prototype, "collection", ((name: string) => ({
    doc: (id: string) => ref(`${name}/${id}`),
    where: (key: string, _op: string, value: string) => ({ get: async () => {
      queries.push(`${key}:${value}`);
      return { docs: [...cloud.entries()].filter(([path, row]) => path.startsWith(name + "/") && row[key] === value).map(([, row]) => ({ get: (field: string) => row[field] })) };
    } }),
  })) as any);
  mock.method(Firestore.prototype, "batch", (() => {
    const changes: [{ path: string }, Record<string, unknown>][] = [];
    return { set: (doc: { path: string }, value: Record<string, unknown>) => { changes.push([doc, value]); }, commit: async () => {
      if (failCommit) throw new Error("interrupted commit");
      for (const [doc, value] of changes) cloud.set(doc.path, value);
    } };
  }) as any);
  let transactions = Promise.resolve();
  mock.method(Firestore.prototype, "runTransaction", ((fn: any) => {
    const result = transactions.then(() => fn({ get: (doc: any) => doc.get(), delete: (doc: any) => cloud.delete(doc.path) }));
    transactions = result.then(() => {}, () => {}); return result;
  }) as any);
  let terminations = 0;
  mock.method(Firestore.prototype, "terminate", async () => { terminations++; });
  mock.method(google, "sheets", (() => { throw new Error("Sheets must never be called"); }) as any);
  const first = new Store(), second = new Store();
  const shop = await first.createShop("owner@example.com");
  shop.published = structuredClone(sample); await first.saveShop(shop);
  const other = await second.createShop("other@example.com");
  await first.put("ticket", "single-use", { expires: Date.now() + 10000 });
  assert.equal((await Promise.all([first.take("ticket", "single-use"), second.take("ticket", "single-use")])).filter(Boolean).length, 1);
  const sameOwner = await Promise.all([first.createShop("unique@example.com"), second.createShop("unique@example.com")]);
  assert.equal(sameOwner[0].id, sameOwner[1].id);
  const booking: Booking = { id: "booking1", shopId: shop.id, customer: "guest@example.com", name: "Guest", menuId: "simple", staffId: "aoi", start: "2026-11-01T01:00:00Z", end: "2026-11-01T02:00:00Z", status: "active", createdAt: new Date().toISOString(), requestKey: "stable", price: 5500, message: "hello" };
  let active = 0, max = 0;
  await Promise.all([first, second].map(store => store.locked(shop.id, async () => {
    max = Math.max(max, ++active);
    if (!(await store.bookings(shop.id)).length) { await new Promise(resolve => setTimeout(resolve, 20)); await store.saveBooking(booking); }
    active--;
  })));
  assert.equal(max, 1); assert.equal((await second.bookings(shop.id)).length, 1);
  const restarted = new Store();
  assert.equal((await restarted.get<Booking>("booking", booking.id))?.requestKey, "stable");
  await restarted.saveBooking({ ...booking, status: "cancelled" });
  assert.equal((await first.bookings(shop.id))[0].status, "cancelled");
  assert.equal((await first.bookings(shop.id)).length, 1, "updates keep the same record identity");
  await first.saveBooking({ ...booking, id: "other-booking", shopId: other.id });
  queries.length = 0;
  assert.deepEqual((await first.records<Booking>("booking", shop)).map(row => row.id), [booking.id]);
  assert.deepEqual(queries, [`scope:booking:${shop.id}`], "shop reads query only that shop and record kind");
  const conversation = await createConversation(first, shop, shop.owner, "modify", randomUUID());
  await appendChatMessage(first, shop, conversation, { role: "user", text: "Persist before publishing", requestId: randomUUID() });
  assert.equal((await readConversation(restarted, shop, shop.owner, conversation.id)).messages[0].text, "Persist before publishing");
  await first.transaction(async () => {
    await first.put("inquiry", "pending", { id: "pending", shopId: shop.id, message: "hello" });
    await first.put("job", "pending", { shopId: shop.id, type: "mail" });
    assert.equal((await first.records("inquiry", shop)).length, 1, "transactions read their staged business writes");
    assert.equal((await first.list("job")).length, 1);
    assert.equal((await second.records("inquiry", shop)).length, 0, "other instances see only committed records");
  });
  assert.equal((await restarted.records("inquiry", shop)).length, 1);
  failCommit = true;
  await assert.rejects(first.transaction(async () => {
    await first.put("inquiry", "failed", { id: "failed", shopId: shop.id });
    await first.put("job", "failed", { shopId: shop.id });
  }), /interrupted commit/);
  failCommit = false;
  assert.equal(await second.get("inquiry", "failed"), undefined);
  assert.equal(await second.get("job", "failed"), undefined);
  await first.put("inquiry", "failed", { id: "failed", shopId: shop.id });
  await first.put("inquiry", "failed", { id: "failed", shopId: shop.id });
  assert.equal((await second.records("inquiry", shop)).length, 2, "retrying an identity does not duplicate records");
  await assert.rejects(() => first.delete("booking", booking.id), /状態変更/);
  shop.archivedAt = new Date().toISOString(); await first.saveShop(shop);
  assert.deepEqual(await restarted.records("booking", shop), []);
  assert.deepEqual((await restarted.list<Booking>("booking")).map(row => row.id), ["other-booking"]);
  await assert.rejects(() => first.saveBooking(booking), /お店がありません/);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const running = first.locked("shutdown", async () => {
    await gate;
    await first.put("job", "shutdown", { completed: true });
  });
  const queued = assert.rejects(first.locked("shutdown", async () => {
    await first.locked("shutdown-nested", async () => {});
    throw new Error("queued operation failed");
  }), /queued operation failed/);
  let closed = false;
  const closing = first.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false, "shutdown waits for running and queued operations");
  assert.equal(terminations, 0, "Firestore stays connected until locks are released");
  release();
  await Promise.all([running, queued, closing]);
  assert.equal(terminations, 1);
  assert.deepEqual(await second.get("job", "shutdown"), { completed: true });
  assert.ok([...cloud.keys()].every(key => !key.startsWith("gemihub_locks/")));
  await Promise.all([first.close(), second.close(), restarted.close()]);
  assert.equal(terminations, 3, "repeated close calls terminate each connection once");
});
