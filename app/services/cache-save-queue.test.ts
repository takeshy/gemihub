import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitPendingCacheSaves, queueCacheSave } from "./cache-save-queue";

test("saves for one file finish in request order before sync reads the cache", async () => {
  const writes: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const first = queueCacheSave("file", async () => {
    await firstGate;
    writes.push("older");
  });
  const second = queueCacheSave("file", async () => { writes.push("newer"); });
  let drained = false;
  const drain = awaitPendingCacheSaves().then(() => { drained = true; });
  await Promise.resolve();
  assert.deepEqual(writes, []);
  assert.equal(drained, false);
  releaseFirst();
  await Promise.all([first, second, drain]);
  assert.deepEqual(writes, ["older", "newer"]);
});
