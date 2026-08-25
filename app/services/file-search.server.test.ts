import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateChecksum,
  getOrCreateStore,
  FILE_SEARCH_EMBEDDING_MODEL,
  isUnsupportedFileSearchApiKey,
  normalizeFileSearchStoreName,
} from "./file-search.server.ts";
import { isRagEligible } from "~/constants/rag";
import { formatFileSearchSource } from "./gemini-chat-core.ts";

test("calculateChecksum matches for string and bytes", async () => {
  const text = "Hello, RAG!";
  const bytes = new TextEncoder().encode(text);
  const checksumFromString = await calculateChecksum(text);
  const checksumFromBytes = await calculateChecksum(bytes);
  assert.equal(checksumFromString, checksumFromBytes);
});

test("RAG eligibility includes File Search multimodal image formats", () => {
  assert.equal(isRagEligible("assets/photo.png"), true);
  assert.equal(isRagEligible("assets/photo.jpg"), true);
  assert.equal(isRagEligible("assets/photo.jpeg"), true);
  assert.equal(isRagEligible("assets/clip.gif"), false);
});

test("normalizeFileSearchStoreName accepts raw store ids and full resource names", () => {
  assert.equal(normalizeFileSearchStoreName("abc123"), "fileSearchStores/abc123");
  assert.equal(normalizeFileSearchStoreName("fileSearchStores/abc123"), "fileSearchStores/abc123");
  assert.equal(normalizeFileSearchStoreName("  "), null);
});

test("AQ-format authorization keys are identified as unsupported by File Search", () => {
  assert.equal(isUnsupportedFileSearchApiKey("AQ.example"), true);
  assert.equal(isUnsupportedFileSearchApiKey("  aq.example  "), true);
  assert.equal(isUnsupportedFileSearchApiKey("AIza-example"), false);
  assert.equal(isUnsupportedFileSearchApiKey(undefined), false);
});

test("formatFileSearchSource includes page and media citation details", () => {
  assert.equal(formatFileSearchSource({ title: "docs/report.pdf", pageNumber: 3 }), "docs/report.pdf (p.3)");
  assert.equal(formatFileSearchSource({ title: "assets/logo.png", mediaId: "fileSearchStores/store/blobs/blob" }), "assets/logo.png (image)");
  assert.equal(
    formatFileSearchSource({
      customMetadata: [{ key: "path", stringValue: "notes/source.md" }],
    }),
    "notes/source.md"
  );
});

test("formatFileSearchSource accepts Interactions API file_name fields", () => {
  assert.equal(formatFileSearchSource({ file_name: "docs/reference.pdf", page_number: 2 }), "docs/reference.pdf (p.2)");
  assert.equal(formatFileSearchSource({ fileName: "notes/design.md" }), "notes/design.md");
});

test("getOrCreateStore lists File Search stores with API page size limit", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    return new Response(JSON.stringify({
      fileSearchStores: [{
        name: "existing",
        displayName: "test-store",
        embeddingModel: FILE_SEARCH_EMBEDDING_MODEL,
      }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const storeName = await getOrCreateStore("test-api-key", "test-store");

  assert.equal(storeName, "fileSearchStores/existing");
  assert.equal(new URL(requestedUrls[0]).searchParams.get("pageSize"), "20");
});

test("getOrCreateStore rejects OAuth access tokens with actionable guidance", async () => {
  await assert.rejects(
    () => getOrCreateStore("ya29.oauth-token", "test-store"),
    /requires a Gemini API key.*OAuth access token.*Settings > General/i,
  );
});

test("getOrCreateStore explains an API OAuth credential mismatch", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      code: 401,
      status: "UNAUTHENTICATED",
      details: [{ reason: "ACCESS_TOKEN_TYPE_UNSUPPORTED" }],
    },
  }), { status: 401 });

  await assert.rejects(
    () => getOrCreateStore("opaque-credential", "test-store"),
    /registered Gemini API key.*enabled for the Gemini API/i,
  );
});

test("getOrCreateStore identifies Google's AQ-key compatibility failure", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(
    '{"error":{"details":[{"reason":"ACCESS_TOKEN_TYPE_UNSUPPORTED"}]}}',
    { status: 401 },
  );

  await assert.rejects(
    () => getOrCreateStore("AQ.registered-gemini-key", "test-store"),
    /AQ-format Gemini API key.*Google Gemini API authentication compatibility issue/i,
  );
});
