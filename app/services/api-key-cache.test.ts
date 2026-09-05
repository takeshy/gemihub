import assert from "node:assert/strict";
import test from "node:test";
import {
  clearCachedApiKey,
  ensureCachedApiKey,
  getCachedApiKey,
  setCachedApiKey,
} from "./api-key-cache.ts";

/**
 * `ensureCachedApiKey` only runs in the browser, so the tests stand up the two
 * globals it touches: `window` (for the presence check and the cache event)
 * and `fetch`.
 */
function withBrowser(
  fetchImpl: (input: unknown, init?: unknown) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const globals = globalThis as Record<string, unknown>;
  const originalWindow = globals.window;
  const originalFetch = globals.fetch;
  globals.window = { dispatchEvent: () => true };
  globals.fetch = fetchImpl;
  return run().finally(() => {
    globals.window = originalWindow;
    globals.fetch = originalFetch;
    clearCachedApiKey();
  });
}

test("ensureCachedApiKey returns the in-memory key without a request", async () => {
  await withBrowser(
    async () => {
      throw new Error("should not fetch when the key is already cached");
    },
    async () => {
      setCachedApiKey("cached-key");
      assert.equal(await ensureCachedApiKey(), "cached-key");
    },
  );
});

test("ensureCachedApiKey refills the cache from the session after a reload", async () => {
  let calls = 0;
  await withBrowser(
    async () => {
      calls += 1;
      return Response.json({ apiKey: "session-key" });
    },
    async () => {
      clearCachedApiKey();
      assert.equal(getCachedApiKey(), null);
      assert.equal(await ensureCachedApiKey(), "session-key");
      assert.equal(getCachedApiKey(), "session-key");
      // The second call is served from memory.
      assert.equal(await ensureCachedApiKey(), "session-key");
      assert.equal(calls, 1);
    },
  );
});

test("ensureCachedApiKey shares one request between concurrent callers", async () => {
  let calls = 0;
  await withBrowser(
    async () => {
      calls += 1;
      return Response.json({ apiKey: "session-key" });
    },
    async () => {
      clearCachedApiKey();
      const results = await Promise.all([ensureCachedApiKey(), ensureCachedApiKey(), ensureCachedApiKey()]);
      assert.deepEqual(results, ["session-key", "session-key", "session-key"]);
      assert.equal(calls, 1);
    },
  );
});

test("ensureCachedApiKey returns null when the session holds no key, and retries later", async () => {
  let calls = 0;
  await withBrowser(
    async () => {
      calls += 1;
      // First: session has no key (locked). Then: unlocked in another tab.
      return calls === 1
        ? Response.json({ error: "not found" }, { status: 404 })
        : Response.json({ apiKey: "unlocked-later" });
    },
    async () => {
      clearCachedApiKey();
      assert.equal(await ensureCachedApiKey(), null);
      // A null result must not be memoised, so an unlock elsewhere is picked up.
      assert.equal(await ensureCachedApiKey(), "unlocked-later");
      assert.equal(calls, 2);
    },
  );
});

test("ensureCachedApiKey returns null when the request fails (offline)", async () => {
  await withBrowser(
    async () => {
      throw new Error("network down");
    },
    async () => {
      clearCachedApiKey();
      assert.equal(await ensureCachedApiKey(), null);
      assert.equal(getCachedApiKey(), null);
    },
  );
});
