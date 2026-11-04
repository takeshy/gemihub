import assert from "node:assert/strict";
import { mock } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "playwright/test";
import { google } from "googleapis";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { sample } from "../server/domain.ts";
import { digest } from "../server/auth.ts";
import { encrypt } from "../server/google.ts";
import { designOf } from "../server/design-versions.ts";
import { designDrive } from "../tests/helpers/design-drive.ts";

process.env.DEMO_MODE = "true";
const drive = designDrive();
mock.method(google, "drive", () => drive.client);
const store = new Store(":memory:");
const noAI = async () => { throw new Error("Unexpected AI call"); };
const server = createApp(store, { propose: noAI, proposeArticle: noAI, identifyVisual: noAI, explainSystem: noAI });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox"] });
await mkdir("tmp/design-versions", { recursive: true });
try {
  for (const language of ["ja", "en"]) for (const width of [1280, 390]) {
    const shop = await store.createShop(`versions-${language}-${width}@example.com`);
    const user = { email: shop.owner, name: "Owner", role: "owner", shopId: shop.id, refreshToken: encrypt("token") };
    await store.put("user", user.email, user);
    const session = randomUUID();
    await store.put("session", digest(session), { user, expires: Date.now() + 3600000 });
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: language === "ja" ? "ja-JP" : "en-US" });
    await context.addCookies([{ name: "gemihub_session", value: session, url: origin }]);
    const errors = [];
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    const call = async (path, data) => {
      const response = await context.request.post(`${origin}/api/shops/${shop.id}${path}`, { headers: { Origin: origin, "X-Gemihub-Language": language }, data });
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    };
    const preparePlan = async config => {
      const fresh = await store.shop(shop.id);
      const id = randomUUID();
      await store.put("plan", id, { id, shopId: shop.id, base: fresh.revision, config, source: fresh.published, approved: true, summary: [`Design ${config.header.title}`], request: "Change the design", createdAt: Date.now(), checklist: [] });
      return id;
    };
    const publish = async config => {
      const id = await preparePlan(config);
      await call(`/plans/${id}/publish`, {});
      return id;
    };
    const config = label => ({ ...structuredClone(sample), header: { ...sample.header, title: label }, appearance: { accent: label === "A" ? "sage" : "rose", layout: "standard", imageUrl: "", articles: { blogs: false, announcements: false } }, screens: { about: { html: `<section class="version-signature"><h2>Design ${label}</h2><slot name="menus"></slot></section>`, css: `.version-signature { border-top: 8px solid ${label === "A" ? "#527b51" : "#b84c69"}; padding-top: 20px; }` } } });
    const first = config("A"), second = config("B");
    await publish(first);
    const open = () => page.goto(`${origin}/publication-preview/${shop.id}?lang=${language}`);
    await open();
    const history = page.locator(".design-version-history");
    await history.locator("summary").click();
    await expect(history.locator(".design-version-empty")).toBeVisible();
    await expect(page.locator(".preview-surface .version-signature h2")).toHaveText("Design A");
    await page.screenshot({ path: `tmp/design-versions/empty-${language}-${width}.png`, fullPage: true });
    await publish(second);
    await call("/live-settings/menus", { requestId: randomUUID(), value: second.menus.map(menu => ({ ...menu, price: menu.price + 1000 })) });
    await open();
    await history.locator("summary").click();
    // The price change is operational, so only design A (version 1) is archived.
    await expect(history.locator("[data-design-version]")).toHaveCount(1);
    await expect(page.locator(".preview-surface .version-signature h2")).toHaveText("Design B");
    await page.screenshot({ path: `tmp/design-versions/before-${language}-${width}.png`, fullPage: true });
    let dialogs = 0; page.on("dialog", async dialog => { dialogs++; await dialog.dismiss(); });
    await history.locator('[data-design-version="1"] button').click();
    await expect(page.locator(".preview-surface .version-signature h2")).toHaveText("Design A");
    await expect(history.locator("[data-design-version]")).toHaveCount(2);
    await expect(history.locator('[data-design-version="1"] .pill')).toHaveText(language === "ja" ? "現在の版" : "Current version");
    await expect(history.locator('[data-design-version="1"] button')).toHaveCount(0);
    let fresh = await store.shop(shop.id);
    assert.deepEqual(designOf(fresh.published), designOf(first));
    assert.equal(fresh.published.menus[0].price, first.menus[0].price + 1000);
    assert.match(drive.files.get(fresh.google.historyId).content, language === "ja" ? /版 1.*復元/ : /Restored version 1/);
    assert.equal(dialogs, 0, "one-click restore uses no confirmation modal");
    await page.screenshot({ path: `tmp/design-versions/restored-${language}-${width}.png`, fullPage: true });
    // Version 2 is design B, archived by the restore above.
    await history.locator('[data-design-version="2"] button').click();
    await expect(page.locator(".preview-surface .version-signature h2")).toHaveText("Design B");
    // A browser-local draft is preserved while the owner restores the live design.
    await page.goto(`${origin}/?shop=${shop.id}&tab=try&screen=about&lang=${language}`);
    await expect(page.locator(".local-preview-screen .version-signature h2")).toHaveText("Design B");
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find(key => key.startsWith("gemihub:local-preview:"));
      const draft = JSON.parse(localStorage.getItem(key));
      draft.config.footer.text = "Keep unsaved local footer";
      draft.fixtures.customerName = "Keep sample customer";
      localStorage.setItem(key, JSON.stringify(draft));
    });
    await page.reload();
    await expect(page.locator(".local-preview-screen .version-signature h2")).toHaveText("Design B");
    const savedDraft = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.includes("local") && key.includes("preview")));
    assert.ok(savedDraft, "local editor draft exists");
    // The editor's history is per screen: only states of "About" that differ from now (B) are listed,
    // one per distinct state, so design A appears once (version 3, its newest copy).
    const ownerHistory = page.locator(".design-version-history");
    await ownerHistory.locator("summary").click();
    await expect(ownerHistory.locator("[data-design-version]")).toHaveCount(1);
    await ownerHistory.locator('[data-design-version="3"] button').click();
    await expect(ownerHistory.getByRole("status")).toBeVisible();
    await expect(page.locator(".local-preview-screen .version-signature h2")).toHaveText("Design A");
    const afterDraft = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), savedDraft[0]);
    assert.deepEqual(afterDraft.fixtures, JSON.parse(savedDraft[1]).fixtures, "sample data stays intact");
    assert.equal(afterDraft.config.footer.text, "Keep unsaved local footer", "unsaved local designs stay intact");
    fresh = await store.shop(shop.id);
    assert.equal(fresh.published.menus[0].price, first.menus[0].price + 1000);
    assert.deepEqual(fresh.published.screens.about, first.screens.about, "only the About screen was restored");
    assert.equal(fresh.published.header.title, second.header.title, "the header keeps its current design");
    assert.equal(fresh.designPublication.restoredFrom, undefined);
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal overflow");
    await page.screenshot({ path: `tmp/design-versions/editor-${language}-${width}.png`, fullPage: true });
    if (language === "en" && width === 390) {
      drive.failNextUpdate(input => input.fileId === fresh.google.artifactIds["web/shop.json"] && !!input.media);
      // Version 4 holds About = B (archived by the editor restore); it is the only state differing from now.
      await ownerHistory.locator('[data-design-version="4"] button').click();
      await expect(ownerHistory.getByRole("alert")).toBeVisible();
      await page.reload();
      await ownerHistory.locator("summary").click();
      const retry = ownerHistory.locator('[data-design-version="4"] button');
      await expect(retry).toHaveText("Retry restore");
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect(page.locator(".local-preview-screen .version-signature h2")).toHaveText("Design B");
      assert.deepEqual((await store.shop(shop.id)).published.screens.about, second.screens.about);
    }
    // A custom-page restore must be recoverable in a browser with no cached editor draft.
    fresh = await store.shop(shop.id);
    const recoveryPage = { id: "recover-faq", slug: "recover-faq", title: "Recovery FAQ", navigationLabel: "Recovery", body: "<h2>Page A</h2>", layout: "standard", imageUrl: "" };
    await publish({ ...fresh.published, pages: [...fresh.published.pages, recoveryPage] });
    const pageVersion = (await store.shop(shop.id)).designPublication.number;
    fresh = await store.shop(shop.id);
    await publish({ ...fresh.published, pages: fresh.published.pages.map(item => item.id === recoveryPage.id ? { ...item, body: "<h2>Page B</h2>" } : item) });
    fresh = await store.shop(shop.id);
    const restoreId = randomUUID();
    drive.failNextUpdate(input => input.fileId === fresh.google.artifactIds["web/shop.json"] && !!input.media);
    const failure = await context.request.post(`${origin}/api/shops/${shop.id}/design-versions/${pageVersion}/restore`, { headers: { Origin: origin }, data: { requestId: restoreId, revision: fresh.revision, target: `page:${recoveryPage.id}` } });
    assert.equal(failure.status(), 503);
    const paused = await store.shop(shop.id);
    const clean = await browser.newContext({ viewport: { width, height: 950 }, locale: language === "ja" ? "ja-JP" : "en-US" });
    await clean.addCookies([{ name: "gemihub_session", value: session, url: origin }]);
    const recovered = await clean.newPage();
    const recoveryErrors = []; recovered.on("pageerror", error => recoveryErrors.push(error.message));
    await recovered.goto(`${origin}/?shop=${shop.id}&tab=try&screen=page:${recoveryPage.id}&lang=${language}`);
    const cleanHistory = recovered.locator(".design-version-history");
    await cleanHistory.locator("summary").click();
    const resume = cleanHistory.getByRole("button", { name: language === "ja" ? "中断した復元を再試行" : "Retry interrupted restore", exact: true });
    await expect(resume).toBeEnabled();
    assert.equal(await recovered.getByRole("treeitem", { name: recoveryPage.title, exact: true }).count(), 0, "the page tree is unavailable while the restore is interrupted");
    const restoreRequest = recovered.waitForRequest(request => request.method() === "POST" && request.url().includes(`/design-versions/${pageVersion}/restore`));
    await resume.click();
    assert.deepEqual((await restoreRequest).postDataJSON(), { requestId: restoreId, revision: paused.revision, target: `page:${recoveryPage.id}` });
    await expect(recovered.locator(".local-preview-screen .custom-page h2")).toHaveText("Page A");
    fresh = await store.shop(shop.id);
    assert.equal(fresh.publishingPlanId, undefined);
    assert.equal(fresh.revision, paused.revision + 1);
    assert.equal(fresh.designVersions.filter(version => version.number === paused.designPublication.number).length, 1, "retry keeps the original backup");
    // Older persisted versions still appear in the real screen panel after an upgrade.
    for (const version of fresh.designVersions) delete version.fingerprints;
    await store.saveShop(fresh);
    const pageHistory = recovered.locator(".design-version-history");
    if (!await pageHistory.evaluate(element => element.open)) await pageHistory.locator("summary").click();
    await expect(pageHistory.locator("[data-design-version]")).not.toHaveCount(0);

    // An interrupted AI publication must offer retry even though build-context returns 503.
    const retryConfig = { ...fresh.published, footer: { ...fresh.published.footer, text: "Recovered publication" } };
    const planId = await preparePlan(retryConfig);
    drive.failNextUpdate(input => input.fileId === fresh.google.artifactIds["web/shop.json"] && !!input.media);
    const failedPublish = await clean.request.post(`${origin}/api/shops/${shop.id}/plans/${planId}/publish`, { headers: { Origin: origin }, data: {} });
    assert.equal(failedPublish.status(), 503);
    const publishPaused = await store.shop(shop.id);
    const savedPlan = await store.get("plan", planId);
    const unrelatedPlanId = randomUUID();
    await store.put("plan", unrelatedPlanId, { ...savedPlan, id: unrelatedPlanId, approved: false, createdAt: Date.now() + 1000 });
    await recovered.goto(`${origin}/?shop=${shop.id}&tab=build&lang=${language}`);
    const recoveryCard = recovered.locator("[data-publication-recovery]");
    const publishRetry = recoveryCard.getByRole("button", { name: language === "ja" ? "反映を再試行" : "Retry applying", exact: true });
    await expect(publishRetry).toBeEnabled();
    await expect(recovered.locator(".shop-history [role=alert]")).toBeVisible();
    const publishRequest = recovered.waitForRequest(request => request.method() === "POST" && request.url().includes(`/plans/${planId}/publish`));
    await publishRetry.click(); await publishRequest;
    await expect(recoveryCard).toHaveCount(0);
    await expect(recovered.locator(".shop-spec .spec-stats")).toBeVisible();
    fresh = await store.shop(shop.id);
    assert.equal(fresh.publishingPlanId, undefined);
    assert.equal(fresh.lastPublishedPlanId, planId);
    assert.equal(fresh.published.footer.text, retryConfig.footer.text);
    assert.equal(fresh.revision, publishPaused.revision + 1);
    assert.equal(fresh.designVersions.filter(version => version.number === publishPaused.designPublication.number).length, 1);
    assert.deepEqual(recoveryErrors, []);
    await clean.close();
    await context.close();
  }
  console.log("Version history: desktop/mobile, Japanese/English, empty state, restore/undo, operational data and local drafts verified.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await store.close();
  mock.restoreAll();
}
