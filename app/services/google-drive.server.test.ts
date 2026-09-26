import assert from "node:assert/strict";
import test from "node:test";
import { readFileBytes, createResumableUploadSession, updateResumableUploadSession } from "./google-drive.server.ts";

for (const replace of [false, true]) {
  for (const origin of [undefined, "https://gemihub.example"]) {
    test(`resumable ${replace ? "update" : "create"} preserves browser Origin (${origin ?? "server upload"})`, async () => {
      const originalFetch = globalThis.fetch;
      const uploadUrl = "https://www.googleapis.com/upload/drive/v3/files?upload_id=session";
      globalThis.fetch = async (_url, init) => {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("Origin"), origin ?? null);
        assert.equal(headers.get("Authorization"), "Bearer token");
        assert.equal(headers.get("X-Upload-Content-Length"), String(40 * 1024 * 1024));
        assert.equal(init?.method, replace ? "PATCH" : "POST");
        return new Response(null, { headers: { Location: uploadUrl } });
      };
      try {
        const result = replace
          ? await updateResumableUploadSession("token", "file-id", "application/pdf", 40 * 1024 * 1024, { origin })
          : await createResumableUploadSession("token", "book.pdf", "root", "application/pdf", 40 * 1024 * 1024, { origin });
        assert.equal(result, uploadUrl);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
}

test("readFileBytes returns raw bytes", async () => {
  const originalFetch = globalThis.fetch;
  const payload = new Uint8Array([0, 255, 16, 32, 128]);

  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://www.googleapis.com/drive/v3/files/file123?alt=media");
    const headers = options?.headers as Record<string, string> | undefined;
    assert.equal(headers?.Authorization, "Bearer token");
    return new Response(payload, { status: 200 });
  };

  try {
    const result = await readFileBytes("token", "file123");
    assert.deepEqual(Array.from(result), Array.from(payload));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
