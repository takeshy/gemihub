import assert from "node:assert/strict";
import { test } from "node:test";
import { parallelProcessSettled } from "./parallel";

test("one failed upload does not cancel successful sibling uploads", async () => {
  const writes: number[] = [];
  const results = await parallelProcessSettled([1, 2, 3, 4], async (id) => {
    if (id === 2) throw new Error("Drive rejected file");
    writes.push(id);
    return `uploaded-${id}`;
  }, 4);

  assert.deepEqual(writes.sort(), [1, 3, 4]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled", "fulfilled"]);
  assert.equal(results[0].status === "fulfilled" && results[0].value, "uploaded-1");
  assert.equal(results[3].status === "fulfilled" && results[3].value, "uploaded-4");
});
