import assert from "node:assert/strict";
import test from "node:test";
import { downloadDriveFileDirect, fetchDriveFileDirect } from "./drive-download";

test("direct Drive download sends file bytes only to the browser", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return url === "/api/google/picker"
      ? Response.json({ accessToken: "test-token" })
      : new Response("epub-bytes");
  };

  try {
    const response = await fetchDriveFileDirect("file id");
    assert.equal(await response.text(), "epub-bytes");
    assert.equal(calls[0].url, "/api/google/picker");
    assert.equal(calls[0].init?.cache, "no-store");
    assert.equal(calls[1].url, "https://www.googleapis.com/drive/v3/files/file%20id?alt=media");
    assert.equal(new Headers(calls[1].init?.headers).get("Authorization"), "Bearer test-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("large Drive download streams to the selected file", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const chunks: Uint8Array[] = [];
  const events: string[] = [];
  globalThis.window = {
    showSaveFilePicker: async ({ suggestedName }: { suggestedName: string }) => {
      events.push(`picker:${suggestedName}`);
      return {
        createWritable: async () => new WritableStream<Uint8Array>({
          write(chunk) { chunks.push(chunk); },
        }),
      };
    },
  } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (input) => {
    const url = String(input);
    events.push(url);
    return url === "/api/google/picker"
      ? Response.json({ accessToken: "test-token" })
      : new Response("epub-bytes");
  };

  try {
    await downloadDriveFileDirect("file-id", "book.epub");
    assert.equal(events[0], "picker:book.epub");
    assert.equal(events[1], "/api/google/picker");
    assert.equal(Buffer.concat(chunks).toString(), "epub-bytes");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
