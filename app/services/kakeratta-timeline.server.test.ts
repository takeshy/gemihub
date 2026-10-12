import assert from "node:assert/strict";
import test from "node:test";
import { requireTimelinePremium, TimelinePremiumRequired } from "./kakeratta-timeline.server.ts";
import { getOwnedPersonalAccount } from "./personal-hubwork-account.server.ts";
import type { HubworkAccount } from "~/types/hubwork";

const identity = { email: "member@example.com", rootFolderId: "member-root" };
const paid = { id: "member", email: identity.email, rootFolderId: identity.rootFolderId, plan: "lite", accountStatus: "enabled", billingStatus: "active" } as HubworkAccount;

test("Timeline synchronization accepts an owned active Premium plan", async () => {
  assert.equal(await requireTimelinePremium(identity, async () => paid), paid);
});

test("Timeline synchronization rejects free, disabled and canceled accounts", async () => {
  for (const account of [null, { ...paid, plan: undefined }, { ...paid, accountStatus: "disabled" }, { ...paid, billingStatus: "canceled" }]) {
    await assert.rejects(requireTimelinePremium(identity, async () => account as HubworkAccount | null), TimelinePremiumRequired);
  }
});

test("another organization's owner's plan never enables personal Timeline sync", async () => {
  const resolve = (current: typeof identity) => getOwnedPersonalAccount(current, {
    getAccountByRootFolderId: async () => null,
    getAccountByEmail: async () => ({ ...paid, email: "owner@example.com", rootFolderId: "owner-root" }),
  });
  await assert.rejects(requireTimelinePremium(identity, resolve), TimelinePremiumRequired);
});

test("Drive reads retry when the content changes between metadata reads", async () => {
  const { readTimelineDriveSnapshot } = await import("./kakeratta-timeline.server.ts");
  const originalFetch = globalThis.fetch;
  let metadataRead = 0;
  let bodyRead = 0;
  globalThis.fetch = async () => Response.json({ etag: ++metadataRead === 1 ? '"v1"' : '"v2"', md5Checksum: "new-md5" });
  try {
    const snapshot = await readTimelineDriveSnapshot("token", { id: "file", name: "day.md", mimeType: "text/markdown" }, new AbortController().signal, async () => ++bodyRead === 1 ? "old" : "new");
    assert.equal(bodyRead, 2);
    assert.equal(snapshot.content, "new");
    assert.equal(snapshot.etag, '"v2"');
  } finally { globalThis.fetch = originalFetch; }
});

test("a Drive precondition conflict requests a merge instead of unconditional overwrite", async () => {
  const { writeTimelineDriveSnapshot } = await import("./kakeratta-timeline.server.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "PUT");
    assert.equal(new Headers(init?.headers).get("If-Match"), '"expected"');
    return new Response(null, { status: 412 });
  };
  try {
    const result = await writeTimelineDriveSnapshot("token", { name: "day.md", content: "old", etag: '"expected"', file: { id: "file", name: "day.md", mimeType: "text/markdown" } }, "merged", new AbortController().signal, async () => { throw new Error("Must not treat conflict as saved"); });
    assert.equal(result, null);
  } finally { globalThis.fetch = originalFetch; }
});
