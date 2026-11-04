import { test } from "node:test";
import assert from "node:assert/strict";
import { Firestore } from "@google-cloud/firestore";
import { Store } from "../server/store.ts";
import { acquireLock, lockLeaseMs, lockRenewMs, releaseLock, renewLock } from "../server/store-locks.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test("expiring Firestore locks preserve ownership across long operations, crashes and takeovers", async t => {
  const previous = { project: process.env.GOOGLE_CLOUD_PROJECT, demo: process.env.DEMO_MODE };
  process.env.GOOGLE_CLOUD_PROJECT = "fixture";
  process.env.DEMO_MODE = "false";
  t.after(() => {
    for (const [key, value] of [["GOOGLE_CLOUD_PROJECT", previous.project], ["DEMO_MODE", previous.demo]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  let now = Date.parse("2026-11-05T00:00:00Z");
  t.mock.method(Date, "now", () => now);
  const cloud = new Map<string, Record<string, any>>();
  const timers = new Map<object, () => void>();
  t.mock.method(globalThis, "setInterval", ((fn: () => void, delay: number) => {
    assert.equal(delay, lockRenewMs);
    const timer = { unref() {} }; timers.set(timer, fn); return timer;
  }) as typeof setInterval);
  t.mock.method(globalThis, "clearInterval", ((timer: object) => { timers.delete(timer); }) as typeof clearInterval);
  const ref = (path: string): any => ({
    path,
    async get() {
      const value = structuredClone(cloud.get(path));
      return { exists: !!value, get: (field: string) => value?.[field] };
    },
    async delete() { cloud.delete(path); },
  });
  t.mock.method(Firestore.prototype, "collection", ((name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) })) as any);
  let transactions = Promise.resolve();
  let failRenewal = false;
  t.mock.method(Firestore.prototype, "runTransaction", ((fn: any) => {
    const result = transactions.then(async () => {
      const changes: (() => void)[] = [];
      const value = await fn({
        get: (doc: any) => { assert.equal(changes.length, 0, "all lock reads precede writes"); return doc.get(); },
        set: (doc: any, data: any) => { changes.push(() => { cloud.set(doc.path, structuredClone(data)); }); },
        update: (doc: any, data: any) => { if (failRenewal) throw new Error("renewal unavailable"); changes.push(() => { cloud.set(doc.path, { ...cloud.get(doc.path), ...data }); }); },
        delete: (doc: any) => { changes.push(() => { cloud.delete(doc.path); }); },
      });
      for (const change of changes) change();
      return value;
    });
    transactions = result.then(() => {}, () => {});
    return result;
  }) as any);
  t.mock.method(Firestore.prototype, "terminate", async () => {});
  const db = new Firestore({ projectId: "fixture" });
  const lock = (id: string) => [...cloud].find(([path, row]) => path.startsWith("gemihub_locks/") && row.shopId === id)!;
  const state = (kind: string) => [...cloud.values()].find(row => row.kind === kind);

  await t.test("only an expired lock can be replaced, and delayed release preserves the new owner", async () => {
    const doc = db.collection("gemihub_locks").doc("expiry");
    const first = (await acquireLock(db, doc, "expiry"))!;
    assert.equal(await acquireLock(db, doc, "expiry"), undefined);
    now += lockLeaseMs;
    const second = (await acquireLock(db, doc, "expiry"))!;
    assert.notEqual(first.owner, second.owner);
    await releaseLock(db, first);
    assert.equal(cloud.get((doc as any).path)?.owner, second.owner);
    await assert.rejects(renewLock(db, first), { status: 503 });
    await releaseLock(db, second);
    assert.equal(cloud.has((doc as any).path), false);
  });

  await t.test("original at-only locks expire without a migration or startup-wide deletion", async () => {
    const doc = db.collection("gemihub_locks").doc("legacy");
    const path = (doc as any).path;
    cloud.set(path, { shopId: "legacy", at: new Date(now).toISOString() });
    assert.equal(await acquireLock(db, doc, "legacy"), undefined);
    now += lockLeaseMs;
    const recovered = (await acquireLock(db, doc, "legacy"))!;
    assert.ok(recovered.owner);
    await releaseLock(db, recovered);
    cloud.set(path, { at: "invalid" });
    assert.equal(await acquireLock(db, doc, "legacy"), undefined);
    cloud.delete(path);
  });

  await t.test("a ten-minute operation stays locked while its one-minute renewal succeeds", async () => {
    const store = new Store(), started = deferred(), finish = deferred();
    const running = store.locked("long", async () => { started.resolve(); await finish.promise; });
    await started.promise;
    for (let minute = 0; minute < 10; minute++) {
      now += lockRenewMs;
      for (const tick of timers.values()) tick();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(lock("long")[1].expiresAt, now + lockLeaseMs);
    }
    const [path] = lock("long");
    assert.equal(await acquireLock(db, ref(path), "long"), undefined);
    finish.resolve(); await running; await store.close();
    assert.equal(timers.size, 0);
  });

  await t.test("a crashed owner's resumed operation cannot overwrite data or remove the replacement lock", async () => {
    const first = new Store(), second = new Store();
    const oldStarted = deferred(), resumeOld = deferred(), newStarted = deferred(), finishNew = deferred();
    const old = first.locked("takeover", async () => {
      oldStarted.resolve(); await resumeOld.promise;
      await first.put("result", "protected", { writer: "old" });
    });
    const rejected = assert.rejects(old, { status: 503 });
    await oldStarted.promise;
    now += lockLeaseMs + 1; // The crashed process never runs its renewal timer.
    const current = second.locked("takeover", async () => {
      await second.put("result", "protected", { writer: "new" });
      newStarted.resolve(); await finishNew.promise;
    });
    await newStarted.promise;
    const owner = lock("takeover")[1].owner;
    resumeOld.resolve(); await rejected;
    assert.deepEqual(JSON.parse(state("result")!.json), { writer: "new" });
    assert.equal(lock("takeover")[1].owner, owner);
    finishNew.resolve(); await current;
    await Promise.all([first.close(), second.close()]);
  });

  await t.test("a failed heartbeat stops the old operation from persisting further changes", async t => {
    const log = t.mock.method(console, "error", () => {});
    const store = new Store(), started = deferred(), resume = deferred();
    const running = store.locked("renewal-failure", async () => {
      started.resolve(); await resume.promise;
      await store.put("should-not-exist", "failed-renewal", { changed: true });
    });
    const rejected = assert.rejects(running, { status: 503 });
    await started.promise;
    failRenewal = true;
    now += lockRenewMs;
    for (const tick of timers.values()) tick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(log.mock.callCount(), 1);
    failRenewal = false;
    resume.resolve(); await rejected;
    assert.equal(state("should-not-exist"), undefined);
    await store.close();
  });

  await t.test("writes verify server ownership even before the old local expiry", async () => {
    for (const operation of ["put", "batch", "delete", "take", "nested"] as const) {
      const store = new Store();
      await assert.rejects(store.locked(`fence-${operation}`, async () => {
        await store.put("journal", operation, { original: true });
        const [path, held] = lock(`fence-${operation}`);
        cloud.set(path, { ...held, owner: "replacement" });
        if (operation === "put") await store.put("journal", operation, { original: false });
        else if (operation === "batch") await store.transaction(async () => { await store.put("journal", operation, { original: false }); });
        else if (operation === "delete") await store.delete("journal", operation);
        else if (operation === "take") await store.take("journal", operation);
        else await store.locked("nested", () => store.put("journal", operation, { original: false }));
      }), { status: 503 });
      const journal = [...cloud.values()].find(row => row.kind === "journal" && row.id === operation)!;
      assert.deepEqual(JSON.parse(journal.json), { original: true });
      const [path, held] = lock(`fence-${operation}`);
      assert.equal(held.owner, "replacement"); cloud.delete(path);
      await store.close();
    }
  });
  assert.equal(timers.size, 0);
  assert.ok([...cloud.keys()].every(path => !path.startsWith("gemihub_locks/")));
  await db.terminate();
});
