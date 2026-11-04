import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { sample } from "../server/domain.ts";

test("a reconciliation tick interrupted by server shutdown cannot start new shop locks", async t => {
  for (const stage of ["cleanup", "list"] as const) await t.test(stage, async t => {
    const store = new Store(":memory:");
    const shop = await store.createShop("owner@example.com");
    shop.published = sample;
    await store.saveShop(shop);
    let tick!: () => void;
    t.mock.method(globalThis, "setInterval", ((callback: () => void) => {
      tick = callback;
      return { unref() {} };
    }) as typeof setInterval);
    t.mock.method(globalThis, "clearInterval", () => {});
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    if (stage === "cleanup") t.mock.method(store, "cleanup", async () => { entered(); await gate; });
    else {
      t.mock.method(store, "cleanup", async () => {});
      t.mock.method(store, "list", async () => { entered(); await gate; return [shop]; });
    }
    const lock = t.mock.method(store, "locked");
    const server = createApp(store);
    tick();
    await started;
    server.emit("close");
    await store.close();
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(lock.mock.callCount(), 0);
    t.mock.restoreAll();
  });
});
