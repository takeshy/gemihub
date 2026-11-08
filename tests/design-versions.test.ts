import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import { createApp } from "../server/app.ts";
import { Store, type Shop, type User } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { encrypt } from "../server/google.ts";
import { sample, shopSchema, type ShopConfig } from "../server/domain.ts";
import { designOf, designFingerprints, versionsFor, restoreDesign, isDesignArtifact, driveDesignVersions, preserveDesignVersion } from "../server/design-versions.ts";
import { scopedConfig, type ReleaseScope } from "../server/pages.ts";
import { archiveImage } from "../server/image-library.ts";
import { designDrive } from "./helpers/design-drive.ts";
import { readFile } from "node:fs/promises";
import { artifacts } from "../server/artifacts.ts";
import { screenIds } from "../shared/screens.ts";
import { storefrontCopyKeys, type StorefrontCopyKey } from "../shared/storefront-copy.ts";
import { defaultAppearance } from "../shared/theme-editing.ts";

process.env.DEMO_MODE = "true";
const page = (slug: string) => ({ id: "faq", slug, title: "FAQ", navigationLabel: "FAQ", body: `<p>${slug}</p>`, layout: "standard" as const, imageUrl: "" });

test("design allowlist preserves every non-design setting and removes absent optional custom screens", () => {
  const current = shopSchema.parse({ ...sample, screens: { about: { html: '<div><slot name="menus"></slot></div>', css: "" } } });
  const design = designOf(sample);
  const restored = restoreDesign(current, { ...design, menus: [{ price: 0 }], rules: {} } as typeof design);
  assert.deepEqual(restored, shopSchema.parse(sample));
  const keys = new Set(["appearance", "screens", "pages", "header", "footer"]);
  for (const key of Object.keys(current) as (keyof ShopConfig)[]) if (!keys.has(key)) assert.deepEqual(restored[key], current[key], key);
  assert.equal(isDesignArtifact("web/blogs/index.html"), false);
  assert.equal(isDesignArtifact("admin/index.html"), false);
});

test("screen restoration owns its copy, removes newer overrides and preserves other appearance settings", () => {
  const keys: Record<typeof screenIds[number], StorefrontCopyKey[]> = {
    about: ["aboutMenus", "aboutStaff", "aboutAccess", "aboutHours", "recentPosts"],
    reserve: ["bookingTitle", "bookingMenu", "bookingTime", "bookingStaffTime", "bookingConfirm", "bookingSummary"],
    mine: ["mineBookings", "recentPosts"],
    contact: ["contactTitle"],
  };
  const current = shopSchema.parse({ ...sample, appearance: { ...defaultAppearance, accent: "rose", copy: Object.fromEntries(storefrontCopyKeys.map(key => [key, `Current ${key}`])) } });
  for (const screen of screenIds) {
    for (const savedCopy of [undefined, Object.fromEntries(storefrontCopyKeys.map(key => [key, `Saved ${key}`]))]) {
      const saved = shopSchema.parse({ ...sample, appearance: { ...defaultAppearance, copy: savedCopy } });
      const restored = restoreDesign(current, designOf(saved), { kind: "screen", screen });
      const expected = structuredClone(current);
      expected.screens = {};
      for (const key of keys[screen]) {
        if (saved.appearance?.copy?.[key]) expected.appearance!.copy![key] = saved.appearance.copy[key];
        else delete expected.appearance!.copy![key];
      }
      assert.deepEqual(restored, expected, screen);
      assert.notEqual(designFingerprints(current)[`screen:${screen}`], designFingerprints(saved)[`screen:${screen}`]);
    }
  }
  const noOverrides = restoreDesign(shopSchema.parse({ ...sample, appearance: { ...defaultAppearance, copy: { bookingTitle: "New" } } }), designOf(sample), { kind: "screen", screen: "reserve" });
  assert.equal(noOverrides.appearance?.copy, undefined, "the last removed override leaves no empty copy object");
});

test("an older index is not compared with current screen hashes before its archive can be read", () => {
  const version = { number: 1, at: "now", summary: "Old index", folderId: "folder", manifestId: "unindexed", fingerprints: { ...designFingerprints(sample), "screen:reserve": "legacy-layout-only" } };
  assert.deepEqual(versionsFor([version], sample, { kind: "screen", screen: "reserve" }), []);
  assert.deepEqual(versionsFor([version], sample), [version], "the full history remains available without a connection");
});

test("copy-only and layout-plus-copy publications appear in screen history and restore exported copy, including older indexes", async t => {
  const drive = designDrive();
  t.mock.method(google, "drive", (() => drive.client) as never);
  const store = new Store(":memory:"), server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  for (const mode of ["copy", "layout-and-copy", "default-copy"]) {
    const shop = await store.createShop(`${mode}@example.com`);
    const user: User = { email: shop.owner, role: "owner", name: "Owner", shopId: shop.id, refreshToken: encrypt("fixture") };
    await store.put("user", user.email, user);
    await store.put("session", digest(shop.id), { user, expires: Date.now() + 60000 });
    const request = async (path: string, data?: unknown) => {
      const response = await fetch(`${origin}/api/shops/${shop.id}${path}`, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${shop.id}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    const publish = async (config: ShopConfig) => {
      const fresh = (await store.shop(shop.id))!, id = randomUUID();
      await store.put("plan", id, { id, shopId: shop.id, base: fresh.revision, config, source: fresh.published, approved: true, summary: [mode], request: "Change screen copy", createdAt: Date.now(), checklist: [] });
      await request(`/plans/${id}/publish`, {});
    };
    const previous = shopSchema.parse({ ...sample, appearance: { ...defaultAppearance, accent: "rose", copy: mode === "default-copy" ? undefined : { bookingTitle: "Old booking title" } } });
    await publish(previous);
    const current = shopSchema.parse({ ...previous, appearance: { ...previous.appearance, accent: "rose", copy: { bookingTitle: "New booking title", navReserve: "Current navigation", contactTitle: "Current contact" } }, ...(mode === "layout-and-copy" ? { screens: { reserve: { html: '<section><slot name="booking"></slot></section>', css: "section{padding:24px}" } } } : {}) });
    await publish(current);
    let fresh = (await store.shop(shop.id))!;
    // Simulate an already persisted index from before copy was included in screen hashes.
    const version = fresh.designVersions![0];
    delete version.fingerprintVersion;
    version.fingerprints!["screen:reserve"] = createHash("sha256").update(JSON.stringify(previous.screens?.reserve ?? null)).digest("base64url").slice(0, 22);
    await store.saveShop(fresh);
    const history = await request("/design-versions?target=screen%3Areserve");
    assert.deepEqual(history.versions.map((item: { number: number }) => item.number), [1], mode);
    assert.deepEqual(await store.shop(shop.id), fresh, "listing an old index is read-only");
    await request("/design-versions/1/restore", { requestId: randomUUID(), revision: fresh.revision, target: "screen:reserve" });
    fresh = (await store.shop(shop.id))!;
    const expectedCopy = { ...current.appearance!.copy };
    if (mode === "default-copy") delete expectedCopy.bookingTitle;
    else expectedCopy.bookingTitle = "Old booking title";
    assert.deepEqual(fresh.published!.appearance!.copy, expectedCopy);
    assert.equal(fresh.published!.appearance!.accent, "rose");
    assert.equal(fresh.published!.screens?.reserve, undefined);
    const exported = JSON.parse(drive.files.get(fresh.google!.artifactIds!["web/shop.json"])!.content);
    assert.deepEqual(exported.appearance.copy, expectedCopy, "Drive contains restored text and current unrelated text");
    const publicResponse = await fetch(`${origin}/api/public/${fresh.slug}`, { headers: { Cookie: `gemihub_session=${shop.id}` } });
    assert.equal(publicResponse.status, 200);
    assert.deepEqual((await publicResponse.json()).config.appearance.copy, expectedCopy, "the live booking page receives restored copy");
    const undo = (await request("/design-versions?target=screen%3Areserve")).versions[0].number;
    await request(`/design-versions/${undo}/restore`, { requestId: randomUUID(), revision: fresh.revision, target: "screen:reserve" });
    assert.equal((await store.shop(shop.id))!.published!.appearance!.copy!.bookingTitle, "New booking title");
  }
});

test("publication snapshots, one-click rollback/redo, retries, retention, owner isolation and judge Drive", async t => {
  const drive = designDrive();
  mock.method(google, "drive", (() => drive.client) as never);
  mock.method(google, "sheets", (() => { throw new Error("Business sheets must not be accessed"); }) as never);
  t.after(() => mock.restoreAll());
  const store = new Store(":memory:");
  let assistantHistory = "";
  const unused = async (): Promise<never> => { throw new Error("No AI should run during publication or restore"); };
  const server = createApp(store, { propose: unused, proposeArticle: unused, identifyVisual: unused, explainSystem: unused,
    assistant: async input => {
      assistantHistory = input.data.documents.history;
      return { answer: assistantHistory, sources: [{ path: "history.md", title: "history.md" }] };
    },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  async function owner(email: string, judge = false) {
    const shop = await store.createShop(email);
    if (judge) { shop.judge = { createdAt: new Date().toISOString() }; await store.saveShop(shop); }
    const user: User = { email, role: "owner", name: "Owner", shopId: shop.id, ...(judge ? { judge: true } : { refreshToken: encrypt("token") }) };
    await store.put("user", email, user);
    await store.put("session", digest(email), { user, expires: Date.now() + 3600000 });
    return shop;
  }
  async function request(shop: Shop, path: string, data?: unknown, email = shop.owner) {
    const response = await fetch(`${origin}/api/shops/${shop.id}${path}`, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${email}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  const latest = async (shop: Shop) => (await store.shop(shop.id))!;
  async function publish(shop: Shop, config: ShopConfig, scope?: ReleaseScope) {
    const fresh = await latest(shop);
    const id = randomUUID();
    await store.put("plan", id, { id, shopId: shop.id, base: fresh.revision, config: scope ? scopedConfig(fresh.published, config, scope) : config, source: fresh.published, approved: true, summary: [`Design ${fresh.revision + 1}`], request: "Owner design request", createdAt: Date.now(), checklist: [], scope });
    return { id, ...await request(shop, `/plans/${id}/publish`, {}) };
  }
  function publicFiles(shop: Shop) {
    return Object.fromEntries(Object.entries(shop.google!.artifactIds!).filter(([path]) => isDesignArtifact(path)).map(([path, id]) => [path, drive.files.get(id)!.content]));
  }
  // What a fresh publication of the shop's current configuration writes to Drive.
  async function generated(shop: Shop) {
    return Object.fromEntries(Object.entries(artifacts(shop.published!, await readFile("dist/index.html", "utf8"), undefined, {})).filter(([path]) => isDesignArtifact(path)));
  }
  const withFooter = (config: ShopConfig, text: string) => ({ ...config, footer: { ...config.footer, text } });
  async function restore(shop: Shop, number: number, requestId = randomUUID()) {
    return request(shop, `/design-versions/${number}/restore`, { requestId, revision: (await latest(shop)).revision });
  }
  const shop = await owner("versions@example.com");
  assert.deepEqual((await request(shop, "/design-versions")).body.versions, []);
  const first = { ...structuredClone(sample), pages: [page("original")] };
  assert.equal((await publish(shop, first)).status, 200);
  assert.deepEqual((await request(shop, "/design-versions")).body.versions, []);
  const firstFiles = publicFiles(await latest(shop));
  const second = { ...structuredClone(first), appearance: { accent: "rose" as const, layout: "compact" as const, imageUrl: "" }, pages: [page("renamed")], footer: { text: "New footer", alignment: "left" as const } };
  assert.equal((await publish(shop, second)).status, 200);
  let fresh = await latest(shop);
  assert.equal(fresh.designVersions!.length, 1);
  assert.equal(fresh.designVersions![0].number, 1);
  assert.equal(fresh.designVersions![0].summary, "Design 1");
  assert.deepEqual((await driveDesignVersions(encrypt("token")).read(fresh.designVersions![0])).files, firstFiles, "archive contains exact bytes of every published file");
  assert.ok(!("menus" in JSON.parse(drive.files.get(fresh.designVersions![0].manifestId)!.content).design));

  // Operational edits, business records and an existing draft must survive restoration.
  fresh.published!.menus[0].price += 500;
  fresh.published!.hours.start = "08:00";
  fresh.published!.staff[0].name = "Current staff";
  fresh.published!.staff[0].weekdays = [1, 3, 5];
  fresh.published!.rules.cancelHours += 1;
  fresh.published!.rules.payment = { enabled: false, refundTiers: [{ hoursBefore: 48, percent: 60 }, { hoursBefore: 0, percent: 0 }] };
  fresh.published = shopSchema.parse(fresh.published);
  fresh.draft = { ...structuredClone(first), description: "Keep this draft" };
  await store.saveShop(fresh);
  const operational = structuredClone(fresh.published);
  const draft = structuredClone(fresh.draft);
  for (const kind of ["booking", "customer", "inquiry", "checkout", "member"]) await store.put(kind, `${shop.id}:${kind}`, { shopId: shop.id, sentinel: kind });
  const businessBefore = await Promise.all(["booking", "customer", "inquiry", "checkout", "member", "post"].map(kind => store.list(kind)));
  const beforeRestoreFiles = publicFiles(fresh);
  const requestId = randomUUID();
  assert.equal((await restore(shop, 1, requestId)).status, 200);
  fresh = await latest(shop);
  assert.deepEqual(designOf(fresh.published!), designOf(first));
  for (const key of Object.keys(operational) as (keyof ShopConfig)[]) if (!["appearance", "screens", "pages", "header", "footer"].includes(key)) assert.deepEqual(fresh.published![key], operational[key], key);
  assert.deepEqual(fresh.draft, draft);
  assert.deepEqual(publicFiles(fresh), await generated(fresh), "Drive exports are regenerated from the restored design");
  assert.equal(JSON.parse(publicFiles(fresh)["web/shop.json"]).menus[0].price, operational.menus[0].price, "restored Drive exports keep current operational settings");
  assert.equal(fresh.designVersions![0].number, 2);
  assert.deepEqual((await driveDesignVersions(encrypt("token")).read(fresh.designVersions![0])).files, beforeRestoreFiles);
  assert.deepEqual(await Promise.all(["booking", "customer", "inquiry", "checkout", "member", "post"].map(kind => store.list(kind))), businessBefore);
  assert.match(drive.files.get(fresh.google!.historyId)!.content, /版 1.*復元.*版 2/);
  const answer = await request(shop, "/assistant", { question: "いつ版を戻したか" });
  assert.equal(answer.status, 200);
  assert.match(assistantHistory, /版 1.*復元/);
  assert.equal(answer.body.sources[0].path, "history.md");
  const revision = fresh.revision;
  assert.equal((await restore(shop, 1, requestId)).status, 200);
  assert.equal((await latest(shop)).revision, revision, "lost response retries do not create another restore/backup");

  assert.equal((await restore(shop, 2)).status, 200, "restoration is undoable");
  assert.deepEqual(designOf((await latest(shop)).published!), designOf(second));
  assert.deepEqual(publicFiles(await latest(shop)), await generated(await latest(shop)));
  assert.equal((await restore(shop, 1)).status, 200);
  const versionCount = (await latest(shop)).designVersions!.length;
  const regenerated = await publish(shop, (await latest(shop)).published!);
  assert.equal(regenerated.status, 200);
  assert.equal((await latest(shop)).designVersions!.length, versionCount, "operational-only publications do not create design versions");
  assert.deepEqual(designOf((await latest(shop)).published!), designOf(first), "a later publication retains restored design");
  assert.equal(JSON.parse(publicFiles(await latest(shop))["web/shop.json"]).menus[0].price, operational.menus[0].price, "new exports use current operational settings");

  // Partial releases archive ALL screens and parts, not just the modified path.
  for (const scope of [{ kind: "page", pageId: "faq" }, { kind: "part", part: "footer" }] as ReleaseScope[]) {
    const before = await latest(shop), files = publicFiles(before);
    const config = structuredClone(before.published!);
    if (scope.kind === "page") config.pages[0] = page("partial"); else config.footer.text = "Partial footer";
    assert.equal((await publish(shop, config, scope)).status, 200);
    assert.deepEqual((await driveDesignVersions(encrypt("token")).read((await latest(shop)).designVersions![0])).files, files);
  }

  // A failed write after backup must resume without backing up partially changed files.
  fresh = await latest(shop);
  const filesBeforeFailure = publicFiles(fresh);
  const backupNumber = fresh.designPublication!.number;
  drive.failNextUpdate(input => input.fileId === fresh.google!.artifactIds!["web/data.js"] && !!input.media);
  const failed = await publish(shop, { ...fresh.published!, footer: { ...fresh.published!.footer, text: "Retry publication" } }, { kind: "part", part: "footer" });
  assert.equal(failed.status, 503);
  assert.equal((await request(shop, `/plans/${failed.id}/publish`, {})).status, 200);
  fresh = await latest(shop);
  assert.equal(fresh.designVersions!.filter(version => version.number === backupNumber).length, 1);
  assert.deepEqual((await driveDesignVersions(encrypt("token")).read(fresh.designVersions!.find(version => version.number === backupNumber)!)).files, filesBeforeFailure);
  const restoreId = randomUUID();
  drive.failNextUpdate(input => input.fileId === fresh.google!.artifactIds!["web/shop.json"] && !!input.media);
  assert.equal((await restore(shop, backupNumber, restoreId)).status, 503);
  const count = (await latest(shop)).designVersions!.length;
  assert.equal((await restore(shop, backupNumber, restoreId)).status, 200);
  assert.equal((await latest(shop)).designVersions!.length, count);
  assert.deepEqual((await latest(shop)).published!.footer, JSON.parse(filesBeforeFailure["web/parts/footer.json"]));
  assert.deepEqual(publicFiles(await latest(shop)), await generated(await latest(shop)));

  // Failed capture never writes the public snapshot; incomplete archive folders are trashed.
  fresh = await latest(shop);
  const intact = publicFiles(fresh);
  drive.failNextCopy();
  const failedCopy = await publish(shop, withFooter(fresh.published!, "After failed copy"), { kind: "part", part: "footer" });
  assert.equal(failedCopy.status, 503);
  assert.deepEqual(publicFiles(await latest(shop)), intact);
  assert.equal((await request(shop, `/plans/${failedCopy.id}/publish`, {})).status, 200);
  const oldestFolder = (await latest(shop)).designVersions!.at(-1)!.folderId;
  for (let i = 0; i < 12; i++) assert.equal((await publish(shop, withFooter((await latest(shop)).published!, `Footer ${i}`), { kind: "part", part: "footer" })).status, 200);
  fresh = await latest(shop);
  assert.equal(fresh.designVersions!.length, 10);
  assert.ok(drive.files.get(oldestFolder)!.trashed);
  assert.deepEqual(fresh.designVersions!.map(version => version.number), [...fresh.designVersions!.map(version => version.number)].sort((a, b) => b - a));
  // Trash failures keep a durable cleanup queue and are retried without losing history.
  const expired = fresh.designVersions!.at(-1)!;
  drive.failNextUpdate(input => input.requestBody?.trashed === true);
  assert.equal((await publish(shop, withFooter(fresh.published!, "Trash failure"), { kind: "part", part: "footer" })).status, 200);
  assert.equal((await latest(shop)).designVersions!.length, 10);
  assert.equal((await latest(shop)).designVersionTrash!.length, 1);
  await request(shop, "/design-versions");
  assert.ok(!drive.files.get(expired.folderId)!.trashed, "reading the history never writes to Drive");
  assert.equal((await publish(shop, withFooter((await latest(shop)).published!, "Trash retry"), { kind: "part", part: "footer" })).status, 200);
  assert.ok(drive.files.get(expired.folderId)!.trashed);
  assert.equal((await latest(shop)).designVersionTrash!.length, 0);
  // The oldest retained snapshot remains retryable after a failure and page reload.
  fresh = await latest(shop);
  const oldestNumber = fresh.designVersions!.at(-1)!.number;
  const oldestRequest = randomUUID();
  drive.failNextUpdate(input => input.fileId === fresh.google!.artifactIds!["web/shop.json"] && !!input.media);
  assert.equal((await restore(shop, oldestNumber, oldestRequest)).status, 503);
  const pendingList = (await request(shop, "/design-versions")).body;
  assert.ok(pendingList.versions.some((version: { number: number }) => version.number === oldestNumber));
  assert.equal(pendingList.pendingRestore.requestId, oldestRequest);
  assert.equal((await restore(shop, oldestNumber, pendingList.pendingRestore.requestId)).status, 200);
  assert.equal((await latest(shop)).designVersions!.length, 10);

  // Per-screen restore: the history lists only versions whose state of that screen differs from now,
  // and restoring replaces just that screen while every other part keeps its current design.
  const aboutA = { html: '<section><h2>A</h2><slot name="menus"></slot></section>', css: "" };
  const aboutB = { html: '<section><h2>B</h2><slot name="menus"></slot></section>', css: "" };
  fresh = await latest(shop);
  assert.equal((await publish(shop, { ...fresh.published!, screens: { ...fresh.published!.screens, about: aboutA } })).status, 200);
  const withA = (await latest(shop)).designPublication!.number;
  fresh = await latest(shop);
  assert.equal((await publish(shop, { ...fresh.published!, screens: { ...fresh.published!.screens, about: aboutB }, footer: { ...fresh.published!.footer, text: "Footer with B" } })).status, 200);
  const aboutKey = encodeURIComponent("screen:about");
  const aboutHistory = (await request(shop, `/design-versions?target=${aboutKey}`)).body;
  assert.equal(aboutHistory.versions[0].number, withA, "the newest differing state of the screen comes first");
  assert.ok(aboutHistory.versions.length < (await request(shop, "/design-versions")).body.versions.length, "identical states of the screen are collapsed");
  const reservePage = (await request(shop, `/design-versions?target=${encodeURIComponent("screen:reserve")}`)).body;
  assert.deepEqual(reservePage.versions, [], "an untouched screen has nothing to restore");
  // Pre-index archives retain the same screen/page/part history, without a GET rewriting state.
  const legacyTargets = ["screen:about", "screen:reserve", "part:footer", `page:${(await latest(shop)).published!.pages[0].id}`];
  const indexedLists = await Promise.all(legacyTargets.map(target => request(shop, `/design-versions?target=${encodeURIComponent(target)}`)));
  const legacy = await latest(shop);
  for (const version of legacy.designVersions!) delete version.fingerprints;
  await store.saveShop(legacy);
  for (const [i, target] of legacyTargets.entries()) {
    const result = await request(shop, `/design-versions?target=${encodeURIComponent(target)}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.versions, indexedLists[i].body.versions, target);
  }
  assert.deepEqual(await latest(shop), legacy, "legacy index fallback leaves shop state untouched");
  // Each archive is read once per process; later history reads use the cached index, not Drive.
  const driveGet = drive.client.files.get;
  let driveReads = 0;
  drive.client.files.get = async input => { driveReads++; return driveGet(input); };
  for (const target of legacyTargets) assert.equal((await request(shop, `/design-versions?target=${encodeURIComponent(target)}`)).status, 200);
  assert.equal(driveReads, 0, "cached legacy index avoids repeated Drive reads");
  drive.client.files.get = driveGet;
  // An unreadable archive is left out of that screen's history instead of failing the whole list.
  const unreadable = legacy.designVersions!.find(version => version.number === indexedLists[0].body.versions[0].number)!;
  const manifestId = unreadable.manifestId;
  unreadable.manifestId = "missing-manifest";
  await store.saveShop(legacy);
  const partial = await request(shop, `/design-versions?target=${encodeURIComponent(legacyTargets[0])}`);
  assert.equal(partial.status, 200);
  assert.ok(!partial.body.versions.some((version: { number: number }) => version.number === unreadable.number));
  unreadable.manifestId = manifestId;
  await store.saveShop(legacy);
  fresh = await latest(shop);
  assert.equal((await request(shop, `/design-versions/${withA}/restore`, { requestId: randomUUID(), revision: fresh.revision, target: "screen:about" })).status, 200);
  fresh = await latest(shop);
  assert.deepEqual(fresh.published!.screens!.about, aboutA);
  assert.equal(fresh.published!.footer.text, "Footer with B", "other parts keep their current design");
  assert.equal(fresh.designPublication!.restoredFrom, undefined, "a screen restore does not mark the whole version as current");
  assert.match(fresh.history.at(-1)!.summary, /「お店のこと」を版/);
  assert.equal((await request(shop, `/design-versions?target=${aboutKey}`)).body.versions[0].number, fresh.designVersions![0].number, "the screen restore is undoable");
  // A custom page restores on its own as well, and the Drive export of that page follows.
  const pageBefore = structuredClone(fresh.published!.pages[0]);
  assert.equal((await publish(shop, { ...fresh.published!, pages: [{ ...pageBefore, body: "<p>Rewritten page</p>" }], header: { ...fresh.published!.header, title: "Header kept" } })).status, 200);
  fresh = await latest(shop);
  const pageHistory = (await request(shop, `/design-versions?target=${encodeURIComponent(`page:${pageBefore.id}`)}`)).body;
  assert.equal((await request(shop, `/design-versions/${pageHistory.versions[0].number}/restore`, { requestId: randomUUID(), revision: fresh.revision, target: `page:${pageBefore.id}` })).status, 200);
  fresh = await latest(shop);
  assert.deepEqual(fresh.published!.pages[0], pageBefore);
  assert.equal(fresh.published!.header.title, "Header kept");
  assert.equal(JSON.parse(publicFiles(fresh)[`web/pages/${pageBefore.slug}.json`]).body, pageBefore.body);
  assert.equal((await request(shop, `/design-versions/${withA}/restore`, { requestId: randomUUID(), revision: fresh.revision, target: "page:missing" })).status, 409);
  assert.equal((await request(shop, "/design-versions?target=bogus")).status, 400);
  assert.equal((await latest(shop)).revision, fresh.revision, "refused screen restores change nothing");

  // A restore is refused, before anything is written, when the current state cannot be archived.
  fresh = await latest(shop);
  const missingIndex = fresh.google!.artifactIds!["web/index.html"];
  delete fresh.google!.artifactIds!["web/index.html"];
  await store.saveShop(fresh);
  const unarchivable = { revision: fresh.revision, versions: fresh.designVersions!.length, history: fresh.history.length };
  assert.equal((await restore(shop, fresh.designVersions![1].number)).status, 409);
  fresh = await latest(shop);
  assert.deepEqual({ revision: fresh.revision, versions: fresh.designVersions!.length, history: fresh.history.length }, unarchivable);
  assert.equal(fresh.publishingPlanId, undefined, "bookings are not paused by a refused restore");
  assert.equal(fresh.designRestore, undefined);
  fresh.google!.artifactIds!["web/index.html"] = missingIndex;
  await store.saveShop(fresh);
  // Defence in depth: the backup step itself refuses to continue a restore without an archive.
  await assert.rejects(preserveDesignVersion(fresh, "restore:x", { ready: () => false, capture: async () => null, readDesign: async () => { throw new Error(); }, read: async () => { throw new Error(); }, trash: async () => {} }, async () => {}, true));
  assert.notEqual(fresh.designBackupOperationId, "restore:x");

  const other = await owner("other@example.com");
  assert.equal((await request(shop, "/design-versions", undefined, other.owner)).status, 403);
  assert.equal((await request(shop, `/design-versions/${fresh.designVersions![0].number}/restore`, { revision: fresh.revision, requestId: randomUUID() }, other.owner)).status, 403);
  assert.equal((await restore(other, fresh.designVersions![0].number)).status, 409);

  process.env.JUDGE_INVITE = "j".repeat(40);
  process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
  await store.put("demoGoogle", "current", { email: "operator@example.com", refreshToken: encrypt("operator-token"), connectedAt: "now", connectedBy: "operator", rootFolderId: "judge-root" });
  const judge = await owner("judge@judge.gemihub.invalid", true);
  await store.put("judgeUsage", judge.owner, { email: judge.owner, count: 200 });
  assert.equal((await publish(judge, first)).status, 200);
  assert.equal((await publish(judge, second)).status, 200);
  assert.equal((await restore(judge, 1)).status, 200);
  const judgeFresh = await latest(judge);
  const root = drive.files.get(judgeFresh.google!.artifactFolders!.designVersions)!;
  assert.deepEqual(root.parents, [judgeFresh.google!.folderId]);
  assert.equal((await store.get<{ count: number }>("judgeUsage", judge.owner))!.count, 200, "restore consumes no AI quota");
});

test("images referenced by retained designs cannot be archived", async () => {
  const store = new Store(":memory:");
  const shop = await store.createShop("images@example.com");
  const id = "a".repeat(64);
  await store.put("menuImageUpload", id, { shopId: shop.id, complete: true });
  shop.designVersions = [{ number: 1, at: "now", summary: "Design", folderId: "folder", manifestId: "manifest", imageIds: [id] }];
  await assert.rejects(archiveImage(store, shop, id, sample), /版履歴/);
  assert.equal((await store.get<{ archived?: boolean }>("menuImageUpload", id))!.archived, undefined);
  await store.close();
});
