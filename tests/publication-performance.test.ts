import { test } from "node:test";
import assert from "node:assert/strict";
import { google } from "googleapis";
import { Store, type Shop } from "../server/store.ts";
import { sample } from "../server/domain.ts";
import { encrypt, syncConfig } from "../server/google.ts";
import { writeStorefront, type StorefrontBuild } from "../server/storefront-build.tsx";
import type { StorefrontFiles } from "../server/storefront-files.ts";
import { designDrive } from "./helpers/design-drive.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import type { AddressInfo } from "node:net";

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test("Drive export bounds parallel uploads and checkpoints only new IDs without overlapping saves", async t => {
  const drive = designDrive();
  let active = 0, peak = 0, progressActive = 0, progressPeak = 0, checkpoints = 0;
  const originalCreate = drive.client.files.create, originalUpdate = drive.client.files.update;
  drive.client.files.create = async input => {
    active++; peak = Math.max(peak, active);
    try { await turn(); return await originalCreate(input); } finally { active--; }
  };
  drive.client.files.update = async input => {
    active++; peak = Math.max(peak, active);
    try { await turn(); return await originalUpdate(input); } finally { active--; }
  };
  t.mock.method(google, "drive", (() => drive.client) as never);
  const spec = (await originalCreate({ requestBody: { name: "spec.md" } })).data.id;
  const history = (await originalCreate({ requestBody: { name: "history.md" } })).data.id;
  const shop: Shop = { id: "shop", slug: "shop", owner: "owner@example.com", published: structuredClone(sample), draft: null, revision: 1, history: [], google: { folderId: "root", specId: spec, historyId: history } };
  let savedIds: Record<string, string> = {};
  const progress = async () => {
    checkpoints++; progressActive++; progressPeak = Math.max(progressPeak, progressActive);
    await turn(); savedIds = { ...shop.google!.artifactIds }; progressActive--;
  };
  await syncConfig(shop, sample, encrypt("fixture"), progress);
  assert.ok(peak > 1 && peak <= 4, "independent Drive uploads overlap within the request budget");
  assert.equal(progressPeak, 1, "checkpoints must not overwrite one another out of order");
  assert.deepEqual(savedIds, shop.google!.artifactIds);
  assert.equal(checkpoints, Object.keys(shop.google!.artifactIds!).length + Object.keys(shop.google!.artifactFolders!).length);
  checkpoints = 0;
  await syncConfig(shop, { ...sample, description: "Updated" }, encrypt("fixture"), progress);
  assert.equal(checkpoints, 0, "rewriting known files needs no ID checkpoint per file");
  assert.equal(active, 0);
});

test("storefront uploads assets before pages, reuses committed assets and skips identical releases", async () => {
  let active = 0, peak = 0;
  const written: string[] = [], finishedAssets = new Set<string>();
  const build: StorefrontBuild = { assets: Object.fromEntries(["a", "b", "c"].map(name => [name + ".css", { body: Buffer.from(name), contentType: "text/css" }])), pages: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${i}.html`, `page ${i}`])) };
  const files: StorefrontFiles = {
    async write(path) {
      if (path.includes("/releases/")) assert.equal(finishedAssets.size, 3, "every asset is durable before a page references it");
      active++; peak = Math.max(peak, active); written.push(path);
      try { await turn(); if (path.includes("/assets/")) finishedAssets.add(path); } finally { active--; }
    },
    async read() { return undefined; }, async remove() {},
  };
  const first = await writeStorefront(files, "shop", build);
  assert.ok(peak > 1 && peak <= 4);
  assert.equal(written.length, 15);
  written.length = 0;
  const second = await writeStorefront(files, "shop", { ...build, pages: { ...build.pages, "0.html": "changed" } }, first);
  assert.equal(written.length, 12);
  assert.ok(written.every(path => path.includes("/releases/")), "immutable assets already in the public release are reused");
  written.length = 0;
  assert.deepEqual(await writeStorefront(files, "shop", { ...build, pages: { ...build.pages, "0.html": "changed" } }, second), second);
  assert.equal(written.length, 0);
});

test("publishing commits the live page without waiting for queued article exports", async t => {
  process.env.DEMO_MODE = "true";
  const drive = designDrive();
  let articleAttempts = 0;
  const originalCreate = drive.client.files.create;
  drive.client.files.create = async input => {
    if (input.requestBody?.name === "posts") { articleAttempts++; throw new Error("Article export is temporarily unavailable"); }
    return originalCreate(input);
  };
  t.mock.method(google, "drive", (() => drive.client) as never);
  const store = new Store(":memory:"), shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  shop.google = { folderId: "root", specId: (await originalCreate({ requestBody: { name: "spec.md" } })).data.id, historyId: (await originalCreate({ requestBody: { name: "history.md" } })).data.id };
  await store.saveShop(shop);
  const user = { email: shop.owner, name: "Owner", role: "owner" as const, shopId: shop.id, refreshToken: encrypt("fixture") };
  await store.put("user", shop.owner, user);
  await store.put("session", digest("owner"), { user, expires: Date.now() + 60000 });
  await store.put("plan", "plan", { id: "plan", shopId: shop.id, base: shop.revision, source: shop.published, config: { ...sample, description: "Live update" }, approved: true, summary: ["Update"], createdAt: Date.now() });
  await store.put("job", "pending-articles", { id: "pending-articles", shopId: shop.id, type: "posts", attempts: 0 });
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const response = await fetch(origin + `/api/shops/${shop.id}/plans/plan/publish`, { method: "POST", headers: { Origin: origin, Cookie: "gemihub_session=owner", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 200);
  assert.equal((await store.shop(shop.id))!.published!.description, "Live update");
  assert.ok((await store.shop(shop.id))!.storefrontRelease);
  assert.equal(articleAttempts, 0);
  assert.ok(await store.get("job", "pending-articles"), "the durable worker retains responsibility for the unfinished article export");
  assert.ok((await store.records<{type: string}>("job", shop)).some(job => job.type === "posts"));
});
