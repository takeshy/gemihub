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
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { designOf, driveDesignVersions } from "../server/design-versions.ts";

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test("archive reads overlap within a bounded batch and drain on failure", async t => {
  const drive = designDrive();
  t.mock.method(google, "drive", (() => drive.client) as never);
  const files: Record<string, string> = {};
  const expected: Record<string, string> = {};
  const paths = ["web/index.html", "web/data.js", "web/shop.json", "web/mock.json", ...Array.from({ length: 12 }, (_, i) => `web/pages/page-${i}.html`)];
  for (const path of paths) {
    expected[path] = path;
    files[path] = (await drive.client.files.create({ requestBody: { name: path }, media: { body: Readable.from([path]) } })).data.id;
  }
  const manifestId = (await drive.client.files.create({ requestBody: { name: "manifest.json" }, media: { body: Readable.from([JSON.stringify({ design: designOf(sample), files })]) } })).data.id;
  const version = { number: 1, at: new Date().toISOString(), summary: "Archive", folderId: "folder", manifestId };
  const get = drive.client.files.get;
  let active = 0, peak = 0;
  drive.client.files.get = async input => {
    if (input.fileId === manifestId) return get(input);
    active++; peak = Math.max(peak, active);
    try { await turn(); return await get(input); } finally { active--; }
  };
  const storage = driveDesignVersions(encrypt("fixture"));
  assert.deepEqual((await storage.read(version)).files, expected);
  assert.ok(peak > 1 && peak <= 4);
  let release!: () => void, failed!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const failure = new Promise<void>(resolve => { failed = resolve; });
  t.after(() => release());
  drive.client.files.get = async input => {
    if (input.fileId === manifestId) return get(input);
    active++;
    try {
      if (input.fileId === files[paths[0]]) { failed(); throw new Error("Archive unreadable"); }
      await held; return await get(input);
    } finally { active--; }
  };
  let settled = false;
  const result = storage.read(version).then(() => { settled = true; return null; }, error => { settled = true; return error; });
  await failure; await turn();
  assert.equal(settled, false, "a failed read drains in-flight requests before releasing the shop lock");
  release();
  assert.match((await result).message, /Archive unreadable/);
  assert.equal(active, 0);
});

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

test("menu saves update operational exports without rewriting designs and remain retryable", async t => {
  process.env.DEMO_MODE = "true";
  const drive = designDrive();
  t.mock.method(google, "drive", (() => drive.client) as never);
  const store = new Store(":memory:"), shop = await store.createShop("menu-owner@example.com");
  shop.published = structuredClone(sample);
  shop.published.pages = [{ id: "faq", slug: "faq", title: "FAQ", navigationLabel: "FAQ", body: "<p>Original page</p>", layout: "standard", imageUrl: "" }];
  const token = encrypt("fixture");
  shop.google = { folderId: "root", specId: (await drive.client.files.create({ requestBody: { name: "spec.md" } })).data.id, historyId: (await drive.client.files.create({ requestBody: { name: "history.md" } })).data.id };
  await syncConfig(shop, shop.published, token);
  const staleId = (await drive.client.files.create({ requestBody: { name: "old.html" } })).data.id;
  shop.google.artifactIds!["web/pages/old.html"] = staleId;
  await store.saveShop(shop);
  const user = { email: shop.owner, role: "owner", name: "Owner", shopId: shop.id, refreshToken: token };
  await store.put("user", shop.owner, user);
  await store.put("session", digest("menu-owner"), { user, expires: Date.now() + 60000 });
  const ids = shop.google.artifactIds!, paths = ["web/index.html", "web/data.js", "web/shop.json", "web/mock.json", "admin/system.svg"];
  const expectedIds = new Set([shop.google.specId, shop.google.historyId, ...paths.map(path => ids[path])]);
  const protectedFiles = new Map(Object.entries(ids).filter(([path]) => !paths.includes(path)).map(([, id]) => [id, drive.files.get(id)!.content]));
  const writes = new Set<string>(), update = drive.client.files.update;
  drive.client.files.update = async input => {
    assert.ok(expectedIds.has(input.fileId!), "menu saves never rewrite or remove design artifacts");
    writes.add(input.fileId!);
    return update(input);
  };
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const menus = structuredClone(shop.published.menus); menus[0].price += 500;
  const requestId = randomUUID(), request = () => fetch(`${origin}/api/shops/${shop.id}/live-settings/menus`, { method: "POST", headers: { Origin: origin, Cookie: "gemihub_session=menu-owner", "Content-Type": "application/json" }, body: JSON.stringify({ requestId, value: menus }) });
  drive.failNextUpdate(input => input.fileId === ids["web/data.js"]);
  assert.equal((await request()).status, 503);
  assert.equal((await store.shop(shop.id))!.published!.menus[0].price, shop.published.menus[0].price, "failed exports keep the previous published settings");
  assert.ok((await store.shop(shop.id))!.publishingPlanId);
  writes.clear();
  assert.equal((await request()).status, 200);
  assert.deepEqual(writes, expectedIds, "only the two documents, operational snapshot and overview are uploaded");
  const saved = (await store.shop(shop.id))!;
  assert.equal(saved.published!.menus[0].price, menus[0].price);
  assert.ok(saved.storefrontRelease); assert.equal(saved.publishingPlanId, undefined);
  assert.equal(JSON.parse(drive.files.get(ids["web/shop.json"])!.content).menus[0].price, menus[0].price);
  for (const [id, content] of protectedFiles) { assert.equal(drive.files.get(id)!.content, content); assert.ok(!drive.files.get(id)!.trashed); }
  assert.equal((await store.records<{ type: string }>("job", shop)).filter(job => job.type === "posts").length, 0, "menu-only saves do not enqueue unchanged articles");
  writes.clear();
  assert.equal((await request()).status, 200);
  assert.equal(writes.size, 0, "a repeated successful save never uploads again");
  assert.equal((await store.shop(shop.id))!.revision, saved.revision);
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

test("restores commit without article export waits, with scoped Drive writes and a complete live release", async t => {
  process.env.DEMO_MODE = "true";
  const drive = designDrive();
  t.mock.method(google, "drive", (() => drive.client) as never);
  const create = drive.client.files.create, update = drive.client.files.update;
  let articleAttempts = 0;
  const writes = new Set<string>();
  drive.client.files.create = async input => {
    if (input.requestBody?.name === "posts") { articleAttempts++; throw new Error("Article export unavailable"); }
    const result = await create(input);
    if (input.media) writes.add(result.data.id);
    return result;
  };
  drive.client.files.update = async input => {
    if (input.media) writes.add(input.fileId!);
    return update(input);
  };
  const store = new Store(":memory:"), server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const at = new Date().toISOString(), token = encrypt("fixture");
  for (const target of [undefined, "part:header", "part:footer", "page:faq", "screen:about"]) {
    const shop = await store.createShop(`${target?.replaceAll(":", "-") || "all"}@example.com`);
    const page = (id: string) => ({ id, slug: id, title: id, navigationLabel: id, body: `<p>${id}</p>`, layout: "standard" as const, imageUrl: "" });
    const archived = { ...structuredClone(sample), pages: [page("faq"), page("access")], header: { ...sample.header, title: "Archived header" }, footer: { ...sample.footer, text: "Archived footer" }, screens: { about: { html: '<h2>Archived about</h2><slot name="menus"></slot>', css: "" } } };
    shop.published = archived;
    shop.google = { folderId: "root", specId: (await create({ requestBody: { name: "spec.md" } })).data.id, historyId: (await create({ requestBody: { name: "history.md" } })).data.id };
    await syncConfig(shop, archived, token);
    const storage = driveDesignVersions(token);
    const saved = await storage.capture(shop, { number: 1, at, summary: "Archived" });
    assert.ok(saved);
    shop.designVersions = [{ ...saved, number: 1, at, summary: "Archived" }];
    shop.designPublication = { number: 2, at, summary: "Current" };
    const current = structuredClone(archived);
    current.header.title = "Current header"; current.footer.text = "Current footer";
    current.pages[0] = { ...current.pages[0], slug: "updated-faq", body: "<p>Current FAQ</p>" };
    current.screens.about.html = '<h2>Current about</h2><slot name="menus"></slot>';
    current.menus[0].price += 500;
    await syncConfig(shop, current, token);
    shop.published = current;
    await store.saveShop(shop);
    const user = { email: shop.owner, name: "Owner", role: "owner" as const, shopId: shop.id, refreshToken: token };
    await store.put("user", shop.owner, user);
    await store.put("session", digest(shop.id), { user, expires: Date.now() + 60000 });
    await store.put("job", shop.id + ":pending", { id: shop.id + ":pending", shopId: shop.id, type: "posts", attempts: 0 });
    const beforeIds = { ...shop.google.artifactIds };
    const accessBefore = drive.files.get(beforeIds["web/pages/access.html"])!.content;
    writes.clear();
    const requestId = randomUUID();
    const request = () => fetch(origin + `/api/shops/${shop.id}/design-versions/1/restore`, { method: "POST", headers: { Origin: origin, Cookie: `gemihub_session=${shop.id}`, "Content-Type": "application/json" }, body: JSON.stringify({ requestId, revision: shop.revision, target }) });
    if (target === "page:faq") {
      drive.failNextUpdate(input => input.fileId === beforeIds["web/parts/header.html"] && !!input.media);
      assert.equal((await request()).status, 503, "a failed navigation write must leave restoration retryable");
      assert.equal((await store.shop(shop.id))!.published!.pages[0].slug, "updated-faq");
    }
    const response = await request();
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    const restored = (await store.shop(shop.id))!;
    assert.ok(restored.storefrontRelease);
    assert.equal(articleAttempts, 0, "restoration must not attempt queued article exports before responding");
    const jobs = await store.records<{type: string}>("job", shop);
    assert.equal(jobs.filter(job => job.type === "posts").length, target === "screen:about" ? 1 : 2);
    const ids = restored.google!.artifactIds!;
    const changed = Object.entries({ ...beforeIds, ...ids }).filter(([, id]) => writes.has(id)).map(([path]) => path).sort();
    const snapshots = ["web/index.html", "web/data.js", "web/shop.json", "web/mock.json"];
    const read = (path: string) => drive.files.get(ids[path])!.content;
    const publicResponse = await fetch(`${origin}/s/${shop.slug}/pages/access?lang=ja`, { headers: { Cookie: `gemihub_session=${shop.id}` } });
    assert.equal(publicResponse.status, 200);
    const publicHtml = await publicResponse.text();
    if (target?.startsWith("part:")) {
      const part = target.slice(5);
      assert.deepEqual(changed, [...snapshots, `web/parts/${part}.html`, `web/parts/${part}.json`].sort());
      assert.equal(read("web/pages/access.html"), accessBefore);
      assert.match(publicHtml, part === "header" ? /Archived header/ : /Archived footer/);
      assert.equal(restored.published!.pages[0].body, current.pages[0].body);
    } else if (target === "page:faq") {
      assert.deepEqual(changed, [...snapshots, "web/pages/index.json", "web/pages/faq.html", "web/pages/faq.json", "web/parts/header.html"].sort());
      assert.equal(drive.files.get(beforeIds["web/pages/updated-faq.html"])!.trashed, true);
      assert.equal(read("web/pages/access.html"), accessBefore);
      assert.match(publicHtml, /\/pages\/faq/);
      assert.doesNotMatch(publicHtml, /\/pages\/updated-faq/);
      assert.match(publicHtml, /Current header/);
      assert.match(read("web/parts/header.html"), /\/pages\/faq/);
      assert.doesNotMatch(read("web/parts/header.html"), /\/pages\/updated-faq/);
      assert.match(read("web/parts/header.html"), /Current header/);
    } else if (target === "screen:about") {
      assert.deepEqual(changed, [...snapshots].sort());
      assert.deepEqual(restored.published!.screens, archived.screens);
      assert.deepEqual(restored.published!.pages, current.pages);
    } else {
      assert.ok(changed.includes("admin/system.svg"));
      assert.equal(restored.published!.header.title, archived.header.title);
    }
    assert.equal(restored.published!.menus[0].price, current.menus[0].price);
    const backup = restored.designVersions![0];
    assert.deepEqual(JSON.parse(drive.files.get(backup.manifestId)!.content).design, designOf(current), "the complete pre-restore design is always backed up");
    const revision = restored.revision, count = writes.size;
    assert.equal((await request()).status, 200);
    assert.equal((await store.shop(shop.id))!.revision, revision);
    assert.equal(writes.size, count, "retrying a successful request creates no additional writes");
  }
});
