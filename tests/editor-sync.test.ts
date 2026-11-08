import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { google } from "googleapis";
import { sample, shopSchema, planSummary, type ShopConfig } from "../server/domain.ts";
import { syncConfig, encrypt } from "../server/google.ts";
import { contentHash, editorIndex } from "../server/editor-sync.ts";
import { fingerprint, syncStatus, replaceScope, refreshUneditedScopes } from "../src/editor-sync.ts";
import { sampleFixtures, type LocalDraft } from "../src/local-preview.ts";
import { pageValue, scopedSource, scopedConfig, same, type ShopPage } from "../server/pages.ts";
import { createApp } from "../server/app.ts";
import { Store, type Shop } from "../server/store.ts";
import { basicSchema } from "../server/live-settings.ts";
import { randomUUID } from "node:crypto";
import { digest } from "../server/auth.ts";
import type { AddressInfo } from "node:net";
const page = (id: string): ShopPage => ({ id, slug: id, title: id, navigationLabel: id, body: "もとの本文", layout: "standard", imageUrl: "" });

test("opening cached content refreshes untouched frames and baselines while retaining unpublished edits and page caches", async () => {
  const source = structuredClone(sample), config = { ...structuredClone(source), description: "Keep this unsaved description", pages: [page("cached")] };
  source.pages = [page("cached")];
  config.pages[0].body = "Keep this unsaved page";
  const draft: LocalDraft = { config, source, base: 0, downloaded: ["cached"], fixtures: sampleFixtures(config) };
  const remote = { ...structuredClone(source), header: { ...source.header, title: "New live header" }, pages: [page("cached"), page("unfetched")] };
  const updated = refreshUneditedScopes(draft, remote, 1);
  assert.equal(updated.config.header.title, remote.header.title);
  assert.equal(updated.source!.header.title, remote.header.title);
  assert.equal(updated.config.description, config.description);
  assert.equal(updated.source!.description, source.description);
  assert.deepEqual(updated.config.pages, config.pages);
  assert.deepEqual(updated.downloaded, draft.downloaded);
  assert.deepEqual(updated.fixtures, draft.fixtures);
  assert.equal(await syncStatus(updated, editorIndex(remote, 1), { kind: "theme" }), "synced");
  assert.equal(await syncStatus(updated, editorIndex(remote, 1), { kind: "content" }), "local");
  assert.equal(draft.config.header.title, source.header.title, "the existing draft is not mutated");
});

test("cached editor refresh retains real conflicts and pending releases, and acknowledges already published edits", async () => {
  const source = structuredClone(sample), local = { ...structuredClone(source), description: "Local description" };
  const draft: LocalDraft = { config: local, source, base: 0, fixtures: sampleFixtures(local) };
  const remote = { ...structuredClone(source), description: "Another live description" };
  const updated = refreshUneditedScopes(draft, remote, 1);
  assert.equal(updated.config.description, local.description);
  assert.equal(updated.source!.description, source.description);
  assert.equal(await syncStatus(updated, editorIndex(remote, 1), { kind: "content" }), "conflict");
  const published = refreshUneditedScopes(draft, local, 1);
  assert.equal(published.source!.description, local.description);
  assert.equal(await syncStatus(published, editorIndex(local, 1), { kind: "content" }), "synced");
  const pending = { ...draft, pending: { requestId: randomUUID(), config: local } };
  assert.equal(refreshUneditedScopes(pending, remote, 1), pending);
});

test("publication summaries and tree status agree when stored JSON keys have a different order", async () => {
  const config = shopSchema.parse({ ...sample, pages: [page("faq")] });
  const stored: ShopConfig = JSON.parse(JSON.stringify(config, (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value));
  const draft: LocalDraft = { config, source: stored, base: 0, fixtures: sampleFixtures(config) };
  assert.deepEqual(planSummary(stored, config), []);
  for (const scope of [{ kind: "shared" }, { kind: "part", part: "header" }, { kind: "part", part: "footer" }, { kind: "page", pageId: "faq" }] as const) {
    assert.equal(await syncStatus(draft, editorIndex(stored, 0), scope), "synced");
    assert.deepEqual(planSummary(stored, scopedConfig(stored, config, scope)), []);
  }
  const changed = structuredClone(config); changed.pages[0].body = "Changed page HTML";
  const scope = { kind: "page" as const, pageId: "faq" };
  assert.equal(await syncStatus({ ...draft, config: changed }, editorIndex(stored, 0), scope), "local");
  assert.equal(planSummary(stored, scopedConfig(stored, changed, scope)).length, 1, "real content changes still appear");
  const reordered = { ...config, menus: [...config.menus].reverse() };
  assert.ok(planSummary(config, reordered).length, "array order remains meaningful");
});

test("editor fingerprints match server SHA-256 and sync still detects conflicts without Web Crypto", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis.crypto, "subtle");
  Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: undefined });
  try {
    for (const value of [null, "", "お客様の髪型 ✂️", { text: "あ".repeat(2000), enabled: true, list: [0, false, null] }, sample])
      assert.equal(await fingerprint(value), contentHash(value));
    const config = structuredClone(sample);
    const draft: LocalDraft = { config, source: structuredClone(config), base: 0, fixtures: sampleFixtures(config) };
    assert.equal(await syncStatus(draft, editorIndex(config, 0), { kind: "shared" }), "synced");
    config.description = "ローカルの編集";
    assert.equal(await syncStatus(draft, editorIndex(draft.source, 0), { kind: "shared" }), "local");
    const remote = { ...draft.source!, description: "リモートの編集" };
    assert.equal(await syncStatus(draft, editorIndex(remote, 1), { kind: "shared" }), "conflict");
  } finally {
    if (previous) Object.defineProperty(globalThis.crypto, "subtle", previous);
    else Reflect.deleteProperty(globalThis.crypto, "subtle");
  }
});

test("a resolved conflict is no longer a conflict when the remote config has a different key order", async () => {
  const scope = { kind: "shared" as const };
  const base = structuredClone(sample);
  const local = { ...structuredClone(base), description: "ローカルの編集" };
  // Stored configs are not in schema key order; the browser's copy is re-parsed by the schema.
  const remote: ShopConfig = JSON.parse(JSON.stringify({ ...base, description: "リモートの編集" }));
  const draft: LocalDraft = { config: local, source: structuredClone(base), base: 0, fixtures: sampleFixtures(local) };
  const index = editorIndex(remote, 1);
  assert.equal(await syncStatus(draft, index, scope), "conflict");
  const remoteValue = JSON.parse(JSON.stringify(scopedSource(remote, scope)));
  const source = replaceScope(draft.source!, scope, remoteValue);
  assert.equal(await syncStatus({ ...draft, source, config: replaceScope(draft.config, scope, scopedSource(local, scope)) }, index, scope), "local", "keeping the local edit can be released");
  assert.equal(await syncStatus({ ...draft, source, config: replaceScope(draft.config, scope, remoteValue) }, index, scope), "synced", "taking the remote edit is in sync");
  assert.ok(same(scopedSource(source, scope), scopedSource(remote, scope)));
});

test("sync status distinguishes unfetched, remote, local and edit/delete conflicts", async () => {
  const remote = { ...structuredClone(sample), pages: [page("faq"), page("access")] };
  const config = { ...structuredClone(sample), pages: [] };
  const draft: LocalDraft = { config, source: { ...config }, base: 0, downloaded: [], fixtures: sampleFixtures(config) };
  const scope = { kind: "page" as const, pageId: "faq" };
  assert.equal(await syncStatus(draft, editorIndex(remote, 1), scope), "unfetched");
  draft.config = replaceScope(draft.config, scope, page("faq"));
  draft.source = replaceScope(draft.source!, scope, page("faq"));
  draft.downloaded = ["faq"];
  assert.equal(await fingerprint(page("faq")), editorIndex(remote, 1).pages[0].hash);
  assert.equal(await syncStatus(draft, editorIndex(remote, 1), scope), "synced");
  remote.pages[0].body = "リモート更新";
  assert.equal(await syncStatus(draft, editorIndex(remote, 2), scope), "remote");
  draft.config.pages[0] = { ...draft.config.pages[0], body: "ローカル更新" };
  assert.equal(await syncStatus(draft, editorIndex(remote, 2), scope), "conflict");
  remote.pages[0].body = "もとの本文";
  assert.equal(await syncStatus(draft, editorIndex(remote, 2), scope), "local");
  remote.pages = remote.pages.filter(p => p.id !== "faq");
  assert.equal(await syncStatus(draft, editorIndex(remote, 3), scope), "conflict");
  assert.equal(pageValue(replaceScope(draft.config, scope, null), "faq"), null);
  const headerScope = { kind: "part" as const, part: "header" as const };
  assert.equal(await syncStatus(draft, editorIndex(remote, 3), headerScope), "synced");
  draft.config = replaceScope(draft.config, headerScope, { ...draft.config.header, title: "ローカルのヘッダー" });
  assert.equal(await syncStatus(draft, editorIndex(remote, 3), headerScope), "local");
  remote.header.title = "リモートのヘッダー";
  assert.equal(await syncStatus(draft, editorIndex(remote, 4), headerScope), "conflict");
});

test("per-page Drive sync writes selected HTML/JSON and shared snapshots, never other pages or menus", async t => {
  t.after(() => { mock.restoreAll(); syncBuiltinESMExports(); });
  mock.method(fs, "readFile", async () => '<title></title><div id="root"></div>');
  syncBuiltinESMExports();
  const writes: { fileId: string; requestBody?: { trashed?: boolean }; media?: { mimeType: string } }[] = [];
  mock.method(google as unknown as { sheets: () => unknown }, "sheets", (() => { throw new Error("Sheets must not be called"); }));
  mock.method(google as unknown as { drive: () => unknown }, "drive", (() => ({ files: {
    update: async (data: { fileId: string; requestBody?: { trashed?: boolean } }) => { writes.push(data); return { data: {} }; },
    create: async () => { throw new Error("all required folders/files already exist"); },
  } })));
  const before = { ...structuredClone(sample), pages: [page("faq"), page("access")] };
  const config = structuredClone(before); config.pages[0].body = "変更本文";
  const shop: Shop = { id: "shop", owner: "owner@example.com", slug: "shop", revision: 1, history: [], draft: null, published: before, google: { folderId: "root", specId: "spec", historyId: "history", artifactFolders: { web: "web", admin: "admin", "web/pages": "pages" }, artifactIds: { "web/pages/faq.html": "faq-html", "web/pages/faq.json": "faq-json", "web/pages/access.html": "access-html", "web/pages/access.json": "access-json", "web/pages/index.json": "pages-index" } } };
  for (const [path, id] of Object.entries({ "web/index.html": "shop-html", "web/data.js": "shop-data", "web/shop.json": "shop-config", "web/mock.json": "shop-mock" })) shop.google!.artifactIds![path] = id;
  const snapshotIds = ["shop-html", "shop-data", "shop-config", "shop-mock"];
  shop.google!.artifactFolders!["web/parts"] = "parts";
  shop.google!.artifactIds!["web/parts/header.html"] = "header-html";
  await syncConfig(shop, config, encrypt("token"), () => {}, { kind: "page", pageId: "faq" });
  assert.deepEqual(writes.map(w => w.fileId).sort(), [...snapshotIds, "faq-html", "faq-json", "history", "pages-index", "spec"].sort());
  assert.equal(writes.find(w => w.fileId === "shop-data")?.media?.mimeType, "text/javascript");
  writes.length = 0;
  await syncConfig(shop, { ...config, pages: [{ ...config.pages[0], navigationLabel: "New label" }, config.pages[1]] }, encrypt("token"), () => {}, { kind: "page", pageId: "faq" });
  assert.ok(writes.some(w => w.fileId === "header-html"), "a changed page label refreshes the shared header");
  writes.length = 0;
  await syncConfig(shop, { ...config, pages: [page("access")] }, encrypt("token"), () => {}, { kind: "page", pageId: "faq" });
  assert.deepEqual(writes.filter(w => w.requestBody?.trashed).map(w => w.fileId).sort(), ["faq-html", "faq-json"]);
  assert.ok(!writes.some(w => w.fileId.startsWith("access")));
  assert.ok(writes.some(w => w.fileId === "header-html"), "removing a page also removes its navigation link");
  // Part releases also refresh the shared snapshot without changing other page/part files.
  shop.google!.artifactIds!["web/parts/header.json"] = "header-json";
  shop.google!.artifactIds!["web/parts/footer.html"] = "footer-html";
  writes.length = 0;
  await syncConfig(shop, { ...config, header: { ...config.header, title: "ヘッダーだけ更新" } }, encrypt("token"), () => {}, { kind: "part", part: "header" });
  assert.deepEqual(writes.map(w => w.fileId).sort(), [...snapshotIds, "header-html", "header-json", "history", "spec"].sort());
});

test("page AI and merge only propose, enforce owner and reject a changed remote", async t => {
  process.env.DEMO_MODE = "true";
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = { ...structuredClone(sample), pages: [page("faq")] };
  await store.saveShop(shop);
  let merges = 0;
  const ai = {
    async propose(_text: string, current: ShopConfig | null) { return { config: current || sample, summary: [] }; },
    async proposeArticle() { return { title: "", excerpt: "", body: "" }; },
    async identifyVisual() { return { ids: [], explanation: "" }; },
    async explainSystem() { return { answer: "", changeRequest: false }; },
    async createPage() { const { id: _, ...value } = page("new-page"); return { reply: "ページ案です", page: value }; },
    async mergePage(input: { local: unknown; remote: unknown }) { merges++; return { value: { ...(input.local as ShopPage), body: "両方の内容を結合" }, explanation: "両方の変更を残しました" }; },
  };
  const server = createApp(store, ai);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  for (const email of [shop.owner, "other@example.com"]) await store.put("session", digest(email), { user: { email, name: email, role: "owner" }, expires: Date.now() + 600000 });
  async function request(action: string, data?: unknown, email = shop.owner) {
    const res = await fetch(`${origin}/api/shops/${shop.id}/${action}`, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${email}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, body: await res.json() };
  }
  const index = await request("local-editor/index");
  assert.equal(index.status, 200);
  assert.ok(!JSON.stringify(index.body).includes("もとの本文"));
  assert.deepEqual((await request("local-editor/shared")).body.config.pages, []);
  assert.equal((await request("local-editor/pages/faq")).body.page.body, "もとの本文");
  const create = { messages: [{ role: "user", text: "FAQを作りたい" }], mode: "write" };
  assert.equal((await request("pages/create-with-ai", create, "other@example.com")).status, 403);
  assert.equal((await request("pages/create-with-ai", create)).body.page.title, "new-page");
  const local = { ...page("faq"), body: "ローカル変更" };
  const merging = { scope: { kind: "page", pageId: "faq" }, baseline: page("faq"), localValue: local, expectedRemote: page("faq") };
  assert.equal((await request("local-editor/merge", merging, "other@example.com")).status, 403);
  assert.equal((await request("local-editor/merge", { ...merging, expectedRemote: { ...page("faq"), body: "古い内容" } })).status, 409);
  assert.equal(merges, 0);
  const proposal = await request("local-editor/merge", merging);
  assert.equal(proposal.status, 200);
  assert.equal(proposal.body.value.body, "両方の内容を結合");
  assert.equal((await store.shop(shop.id))!.published!.pages[0].body, "もとの本文");
  assert.equal((await store.list("plan")).length, 0);
  const old = (await request("live-settings/basic")).body.config;
  const data = { value: { ...basicSchema.parse(old), name: "本番の店名" }, previous: basicSchema.parse(old), requestId: randomUUID() };
  assert.equal((await request("live-settings/basic", data, "other@example.com")).status, 403);
  assert.equal((await request("live-settings/basic", data)).status, 200);
  const latest = (await store.shop(shop.id))!;
  assert.equal(latest.published!.name, "本番の店名");
  assert.equal(latest.published!.pages[0].body, "もとの本文");
  const revision = latest.revision;
  assert.equal((await request("live-settings/basic", data)).status, 200);
  assert.equal((await store.shop(shop.id))!.revision, revision);

  const hours = { ...old.hours, end: "19:00" };
  assert.equal((await request("live-settings/hours", { value: hours, requestId: randomUUID() })).status, 200);
  const otherTab = { value: { ...basicSchema.parse(old), name: "別端末の店名", description: "別端末の紹介" }, requestId: randomUUID() };
  assert.equal((await request("live-settings/basic", otherTab)).status, 200);
  const overwrite = { ...data, value: { ...data.value, name: "後から保存した店名" }, requestId: randomUUID() };
  assert.equal((await request("live-settings/basic", overwrite)).status, 200, "a stale form overwrites its section without a conflict prompt");
  const overwritten = (await store.shop(shop.id))!;
  assert.equal(overwritten.published!.name, "後から保存した店名");
  assert.equal(overwritten.published!.description, old.description);
  assert.deepEqual(overwritten.published!.hours, hours, "other sections retain their latest values");
  assert.equal(overwritten.published!.pages[0].body, "もとの本文");
  assert.equal((await request("live-settings/basic", overwrite)).status, 200);
  assert.equal((await store.shop(shop.id))!.revision, overwritten.revision, "retrying a save does not publish twice");
});
