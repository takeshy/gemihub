import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileLocal } from "./drive-local";
import { getCachedFile, setCachedFile, setCachedRemoteMeta } from "./indexeddb-cache";
import { loadPreviewMockData } from "../components/ide/editors/html-preview-mock";

const authPath = "web/__gemihub/auth/me.json";

test("preview retains cached auth and downloads other fixtures when an unrelated mock is missing", async (t) => {
  const authId = "preview-cached-auth";
  const missingId = "preview-missing-mock";
  const apiId = "preview-api-mock";
  const authContent = '{"accountType":"customer","email":"customer@example.com"}';
  const apiPath = "web/__gemihub/api/tickets/list.json";
  const apiContent = '{"tickets":[]}';
  await setCachedFile({ fileId: authId, fileName: authPath, content: authContent, md5Checksum: "", modifiedTime: "", cachedAt: 1 });
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input), "https://example.com");
    const fileId = url.searchParams.get("fileId")!;
    requests.push(fileId);
    if (fileId === missingId) return new Response("Not found", { status: 404 });
    assert.equal(fileId, apiId);
    return Response.json({ content: apiContent });
  });

  const data = await loadPreviewMockData({
    [authId]: { name: authPath },
    [missingId]: { name: "web/__gemihub/api/unrelated.json" },
    [apiId]: { name: apiPath },
  }, readFileLocal, () => false);

  assert.deepEqual(data, { [authPath]: authContent, [apiPath]: apiContent });
  assert.deepEqual(requests, [missingId, apiId]);
  assert.equal(await getCachedFile(missingId), undefined);
  assert.equal((await getCachedFile(apiId))?.content, apiContent);
});

test("an uncached preview auth mock is downloaded once and cached with its metadata", async (t) => {
  const fileId = "uncached-auth-mock";
  const content = '{"accountType":"customer","email":"customer@example.com"}';
  await setCachedRemoteMeta({
    id: "current", rootFolderId: "root", lastUpdatedAt: "", cachedAt: 1,
    files: { [fileId]: { name: authPath, mimeType: "application/json", md5Checksum: "md5", modifiedTime: "remote-time" } },
  });
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requests.push(String(input));
    return Response.json({ content, md5Checksum: "md5", modifiedTime: "remote-time" });
  });

  assert.equal(await readFileLocal(fileId), content);
  const cached = await getCachedFile(fileId);
  assert.equal(cached?.content, content);
  assert.equal(cached?.fileName, authPath);
  assert.equal(cached?.md5Checksum, "md5");
  assert.equal(cached?.modifiedTime, "remote-time");
  assert.equal(await readFileLocal(fileId), content);
  assert.deepEqual(requests, [`/api/drive/files?action=read&fileId=${fileId}`]);
});

test("cached local mock edits are used without a network request", async (t) => {
  const fileId = "edited-auth-mock";
  const content = '{"email":"local-edit@example.com"}';
  await setCachedFile({ fileId, fileName: authPath, content, md5Checksum: "old", modifiedTime: "old", cachedAt: 1 });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("A cached mock must not be fetched");
  });
  assert.equal(await readFileLocal(fileId), content);
});

test("a failed mock download is not cached as a successful response", async (t) => {
  const fileId = "failed-auth-mock";
  t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  await assert.rejects(readFileLocal(fileId), /File not found/);
  assert.equal(await getCachedFile(fileId), undefined);
});
