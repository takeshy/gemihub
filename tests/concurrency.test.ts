import { test } from "node:test";
import assert from "node:assert/strict";
import { forEachConcurrent } from "../server/concurrency.ts";

test("a failed publication batch drains running uploads and does not start another", async () => {
  let release!: () => void, failed!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const failure = new Promise<void>(resolve => { failed = resolve; });
  const started: number[] = [], completed: number[] = [];
  let settled = false;
  const work = forEachConcurrent([0, 1, 2, 3, 4], 3, async item => {
    started.push(item);
    if (item === 0) { failed(); throw new Error("upload failed"); }
    await held;
    completed.push(item);
  });
  const result = work.then(() => { settled = true; }, error => { settled = true; return error; });
  await failure;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false, "an error must not release the shop lock while another upload can still write");
  release();
  assert.match((await result).message, /upload failed/);
  assert.deepEqual(started, [0, 1, 2]);
  assert.deepEqual(completed.sort(), [1, 2]);
});
