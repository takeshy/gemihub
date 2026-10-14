import test from "node:test";
import assert from "node:assert/strict";
import { publishBlueskyRecords, validateBlueskyPosts } from "./bluesky.server.ts";
import type { Agent } from "@atproto/api";
const at = "2026-10-14T00:00:00.000Z";
test("lost publication response is reconciled before retry, preserving reply roots", async () => {
  const rows = new Map<string, { uri: string; cid: string; value: Record<string, unknown> }>();
  let writes = 0, lost = false;
  const agent = { com: { atproto: { repo: {
    async getRecord({ rkey }: { rkey: string }) { const row = rows.get(rkey); if (!row) throw { error: "RecordNotFound" }; return { data: row }; },
    async createRecord({ rkey, record }: { rkey: string; record: Record<string, unknown> }) { writes++; const row = { uri: `at://did:plc:test/app.bsky.feed.post/${rkey}`, cid: rkey, value: record }; rows.set(rkey, row); if (!lost) { lost = true; throw new Error("Connection lost"); } return { data: row }; },
  } } } } as unknown as Agent;
  const posts = [{ id: "root", text: "hello", createdAt: at, parent: "" }, { id: "reply", text: "reply", createdAt: at, parent: "root" }];
  await assert.rejects(publishBlueskyRecords(agent, "did:plc:test", posts));
  const result = await publishBlueskyRecords(agent, "did:plc:test", posts);
  assert.equal(result.urls.length, 2); assert.equal(writes, 2);
  await publishBlueskyRecords(agent, "did:plc:test", posts); assert.equal(writes, 2);
  const values = [...rows.values()];
  assert.deepEqual(values[1].value.reply, { root: { uri: values[0].uri, cid: values[0].cid }, parent: { uri: values[0].uri, cid: values[0].cid } });
});
test("read failures never authorize a new publication", async () => {
  let writes = 0;
  const agent = { com: { atproto: { repo: { async getRecord() { throw new Error("Timeout"); }, async createRecord() { writes++; } } } } } as unknown as Agent;
  await assert.rejects(publishBlueskyRecords(agent, "did:plc:test", [{ id: "p", text: "hello", createdAt: at, parent: "" }]));
  assert.equal(writes, 0);
});
test("all posts are validated before sending, including parents, Unicode lengths and images", () => {
  assert.throws(() => validateBlueskyPosts([{ id: "p", text: "hello", createdAt: at, parent: "missing" }]));
  assert.throws(() => validateBlueskyPosts([{ id: "p", text: "あ".repeat(301), createdAt: at, parent: "" }]));
  assert.throws(() => validateBlueskyPosts([{ id: "p", text: "hi", createdAt: at, parent: "", images: [{ mime: "text/html", alt: "", data: "abcd" }] }]));
});

test("connection ownership separates users and selected workspaces", async () => {
  const { blueskyOwner } = await import("./bluesky.server.ts");
  assert.notEqual(blueskyOwner({ email: "a@example.com", rootFolderId: "shared" }), blueskyOwner({ email: "b@example.com", rootFolderId: "shared" }));
  assert.notEqual(blueskyOwner({ email: "a@example.com", rootFolderId: "one" }), blueskyOwner({ email: "a@example.com", rootFolderId: "two" }));
});
test("URL facets count UTF-8 bytes after Japanese text", async () => {
  const { blueskyLinkFacets } = await import("./bluesky.server.ts");
  const facets = blueskyLinkFacets("日本語 https://example.com。");
  assert.equal(facets.length, 1);
  assert.deepEqual(facets[0].index, { byteStart: Buffer.byteLength("日本語 "), byteEnd: Buffer.byteLength("日本語 https://example.com") });
});
test("OAuth metadata can initialize the official SDK for public HTTPS and loopback origins", async () => {
  const { blueskyClient } = await import("./bluesky.server.ts");
  const previous = process.env.BLUESKY_PUBLIC_URL;
  try {
    for (const origin of ["https://gemihub.example.com", "http://127.0.0.1:5173"]) {
      process.env.BLUESKY_PUBLIC_URL = origin;
      assert.ok(blueskyClient("test-owner"));
    }
  } finally { if (previous === undefined) delete process.env.BLUESKY_PUBLIC_URL; else process.env.BLUESKY_PUBLIC_URL = previous; }
});
test("localhost origins use a loopback client that redirects to 127.0.0.1", async () => {
  const { blueskyMetadata } = await import("./bluesky.server.ts");
  const previous = process.env.BLUESKY_PUBLIC_URL;
  try {
    process.env.BLUESKY_PUBLIC_URL = "http://localhost:8132";
    const metadata = blueskyMetadata();
    assert.deepEqual(metadata.redirect_uris, ["http://127.0.0.1:8132/auth/bluesky/callback"]);
    assert.ok(metadata.client_id.startsWith("http://localhost?"));
    process.env.BLUESKY_PUBLIC_URL = "http://example.com";
    assert.throws(() => blueskyMetadata());
  } finally { if (previous === undefined) delete process.env.BLUESKY_PUBLIC_URL; else process.env.BLUESKY_PUBLIC_URL = previous; }
});
test("record keys are valid, deterministic TIDs", async () => {
  const { blueskyRecordKey } = await import("./bluesky.server.ts");
  const post = { id: "Timeline/day.md#a:0", text: "hi", createdAt: "2026-10-14T13:17:33.191Z", parent: "" };
  const key = blueskyRecordKey("did:plc:test", post);
  assert.match(key, /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/);
  assert.equal(blueskyRecordKey("did:plc:test", post), key);
  assert.notEqual(blueskyRecordKey("did:plc:test", { ...post, text: "changed" }), key);
});
