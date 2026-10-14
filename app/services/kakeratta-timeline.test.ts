import assert from "node:assert/strict";
import test from "node:test";
import { buildEntryBlock } from "../dashboard/memo/memoTimeline.ts";
import { parseTimeline } from "./timeline-format.ts";
import { syncKakerattaTimeline, type KakerattaTimelineRecord } from "./kakeratta-timeline.ts";
import type { KakerattaCall } from "./kakeratta-worker.ts";

const at = "2026-10-12T10:00:00.000Z";
const directory = "Dashboards/Timeline/Timeline";
const record = (id: string, text: string, revision = "r1", replyTo = ""): KakerattaTimelineRecord => ({
  entry: { id, text, at, speaker: "user", kind: replyTo ? "reply" : "post", ...(replyTo ? { root: replyTo, replyTo } : {}) },
  revision, deleteRevision: `delete-${revision}`, authorName: "担当者",
});
const local = (id: string, text: string, metadata: Record<string, string> = {}) => parseTimeline(buildEntryBlock({ id, createdAt: at, body: text, metadata }), `${directory}/2026-10-12.md`)[0];
function backend(initial: KakerattaTimelineRecord[] = []) {
  const rows = new Map(initial.map(row => [row.entry.id, row]));
  const calls: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];
  const call: KakerattaCall = async (name, args) => {
    assert.equal(name, "sync_timeline");
    calls.push(args);
    const results: { id: string; status: string }[] = [];
    for (const value of (args.entries ?? []) as Record<string, unknown>[]) {
      writes.push(value);
      const id = value.id as string;
      const current = rows.get(id);
      if (value.deleted) {
        if (current && current.deleteRevision === value.deleteRevision) { rows.delete(id); results.push({ id, status: "applied" }); }
        else results.push({ id, status: current ? "conflict" : "missing" });
      } else if (current && value.revision !== current.revision && current.entry.text !== value.text) results.push({ id, status: "conflict" });
      else {
        assert.ok(!value.replyTo || rows.has(value.replyTo as string), "parent must exist first");
        rows.set(id, record(id, value.text as string, "r2", value.replyTo as string));
        results.push({ id, status: "applied" });
      }
    }
    return { records: [...rows.values()], missing: ((args.ids ?? []) as string[]).filter(id => !rows.has(id)), results, next: "" };
  };
  return { call, calls, writes, rows };
}
const options = { connection: "connection-a", directory, enabledAt: "2026-10-12T09:00:00.000Z", language: "ja", signal: new AbortController().signal };

test("local posts and replies stay local while remote threads import with stable IDs", async () => {
  const remote = backend([record("remote-root", "remote post"), record("remote-reply", "remote reply", "r1", "remote-root")]);
  const root = local("root", "post");
  const reply = local("reply", "reply", { "root-id": "root", "reply-to": "root" });
  const result = await syncKakerattaTimeline({ ...options, call: remote.call, entries: [reply, root] });
  assert.equal(remote.writes.length, 0);
  assert.deepEqual(result.entries.slice(0, 2), [reply, root]);
  const importedRoot = result.entries.find(entry => entry.metadata["kakeratta-id"] === "remote-root")!;
  const importedReply = result.entries.find(entry => entry.metadata["kakeratta-id"] === "remote-reply")!;
  assert.equal(importedReply.replyTo, importedRoot.id);
  assert.equal(importedReply.authorName, "担当者");
  const retry = await syncKakerattaTimeline({ ...options, call: remote.call, entries: result.entries, cursor: result.cursor });
  assert.deepEqual(retry.entries.map(entry => entry.id), result.entries.map(entry => entry.id));
  assert.ok(remote.calls.every(call => !("entries" in call)));
});

test("simultaneous edits keep Kakeratta and archive the local edit without uploading it", async () => {
  const remote = backend([record("remote", "Kakeratta edit", "r2")]);
  const entry = local("ours", "GemiHub edit", { "kakeratta-id": "remote", "kakeratta-connection": options.connection, "kakeratta-revision": "r1", "kakeratta-base": JSON.stringify({ content: "original", deleted: false }) });
  const result = await syncKakerattaTimeline({ ...options, call: remote.call, entries: [entry] });
  assert.equal(remote.writes.length, 0);
  assert.equal(result.entries.find(entry => entry.id === "ours")?.content, "Kakeratta edit");
  const archive = result.entries.find(entry => entry.metadata["conflict-of"] === "ours")!;
  assert.equal(archive.content, "GemiHub edit");
  assert.equal(archive.metadata["local-only"], "true");
  const retry = await syncKakerattaTimeline({ ...options, call: remote.call, entries: result.entries, cursor: result.cursor });
  assert.equal(retry.entries.filter(entry => entry.metadata["conflict-of"] === "ours").length, 1);
  assert.equal(remote.writes.length, 0);
});

test("verified remote deletion preserves a concurrent local edit as a local root", async () => {
  const remote = backend();
  const entry = local("ours", "local edit", { "kakeratta-id": "missing", "kakeratta-connection": options.connection, "kakeratta-base": JSON.stringify({ content: "original", deleted: false }) });
  const result = await syncKakerattaTimeline({ ...options, call: remote.call, entries: [entry] });
  assert.equal(result.entries[0].deleted, true);
  assert.equal(result.entries[1].content, "local edit");
  assert.equal(result.entries[1].rootId, result.entries[1].id);
  assert.equal(remote.writes.length, 0);
});

test("connection changes archive previous bound content instead of sending it elsewhere", async () => {
  const remote = backend();
  const old = local("old", "private old post", { "kakeratta-id": "old-remote", "kakeratta-connection": "connection-old" });
  const result = await syncKakerattaTimeline({ ...options, call: remote.call, entries: [old] });
  assert.equal(result.entries[0].metadata["connection-archived"], "true");
  assert.equal(remote.writes.length, 0);
  assert.ok(remote.calls.every(call => !(call.ids as string[]).includes("old-remote")));
});

test("legacy local edits and deletions never mutate unchanged remote posts", async () => {
  for (const deleted of [false, true]) {
    const remote = backend([record("remote", "original")]);
    const entry = local("ours", deleted ? "original" : "local edit", {
      deleted: String(deleted), "kakeratta-id": "remote", "kakeratta-connection": options.connection,
      "kakeratta-base": JSON.stringify({ content: "original", deleted: false }),
    });
    const result = await syncKakerattaTimeline({ ...options, call: remote.call, entries: [entry] });
    assert.equal(remote.writes.length, 0);
    assert.equal(result.entries[0].content, "original");
    assert.equal(result.entries[0].deleted, false);
    assert.equal(result.entries[1].metadata["conflict-operation"], deleted ? "delete" : "edit");
  }
});

test("history scanning continues after backfill to discover older new imports", async () => {
  const requests: Record<string, unknown>[] = [];
  const call: KakerattaCall = async (_name, args) => {
    requests.push(args);
    return { records: args.before === "old-page" ? [record("old-import", "older imported post")] : [], missing: [], results: [], next: "" };
  };
  const result = await syncKakerattaTimeline({ ...options, call, entries: [], cursor: { connection: options.connection, complete: true, before: "old-page" } });
  assert.equal(requests[0].before, "old-page");
  assert.equal(requests[1].before, "");
  assert.equal(result.entries[0].content, "older imported post");
});

test("replies to local conflict copies remain local and never reach Kakeratta", async () => {
  const remote = backend();
  const archive = local("conflict", "preserved local content", { "local-only": "true" });
  const reply = local("reply", "reply to preserved content", { "reply-to": "conflict", "root-id": "conflict" });
  const result = await syncKakerattaTimeline({ ...options, call: remote.call, entries: [reply, archive] });
  assert.equal(remote.writes.length, 0);
  assert.equal(result.entries[0].metadata["local-only"], "true");
});

test("legacy unacknowledged local posts are retained without upload or remote deletion", async () => {
  const remote = backend();
  const entry = local("uncertain", "retained content", { "kakeratta-id": "legacy-id", "kakeratta-connection": options.connection });
  const result = await syncKakerattaTimeline({ ...options, call: remote.call, entries: [entry] });
  assert.deepEqual(result.entries, [entry]);
  assert.equal(remote.writes.length, 0);
});
