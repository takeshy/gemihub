import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bindLocalDirectConnection, directConnectionFingerprint, createLocalDirectStore } from "./kakeratta-direct-store.server";

test("claim IDs, transcript and effect intent survive a new store instance", async t => {
  const directory = await mkdtemp(join(tmpdir(), "gemihub-direct-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = createLocalDirectStore("workspace", directory);
  const second = createLocalDirectStore("workspace", directory);
  const state = (await first.acquire("request-1"))!;
  state.context = { trigger: { text: "test" } };
  state.pendingEffect = "comment intent";
  await first.save(state);
  assert.equal(await second.acquire(state.id), null, "Concurrent poll must not acquire an active request");
  await first.release(state.id);
  const resumed = (await second.acquire(state.id))!;
  assert.equal(resumed.claimId, state.claimId);
  assert.equal(resumed.pendingEffect, state.pendingEffect);
  assert.deepEqual(resumed.context, state.context);
  await second.finish(state.id);
  await second.release(state.id);
  assert.deepEqual(await first.list(), []);
});

test("connection keys separate journals, invalidate old handles and never revive old state on rollback", async t => {
  const directory = await mkdtemp(join(tmpdir(), "gemihub-direct-connection-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const firstKey = directConnectionFingerprint("root", "https://example.com/mcp", { Authorization: "Bearer first", "X-User": "u" });
  assert.equal(firstKey, directConnectionFingerprint("root", "https://example.com/mcp", { "x-user": "u", authorization: "Bearer first" }));
  const secondKey = directConnectionFingerprint("root", "https://example.com/mcp", { Authorization: "Bearer second", "X-User": "u" });
  assert.notEqual(firstKey, secondKey);
  const first = await bindLocalDirectConnection("root", firstKey, true, directory);
  const firstStore = createLocalDirectStore(first.scope, directory);
  await firstStore.acquire("old-request");
  await firstStore.release("old-request");
  const second = await bindLocalDirectConnection("root", secondKey, true, directory);
  assert.equal(await first.isCurrent(), false);
  assert.notEqual(first.scope, second.scope);
  assert.deepEqual(await createLocalDirectStore(second.scope, directory).list(), []);
  await assert.rejects(bindLocalDirectConnection("root", firstKey, false, directory), /Connection changed/);
  const rollback = await bindLocalDirectConnection("root", firstKey, true, directory);
  assert.notEqual(rollback.scope, first.scope);
  assert.equal(await second.isCurrent(), false);
  assert.deepEqual(await createLocalDirectStore(rollback.scope, directory).list(), []);
});
