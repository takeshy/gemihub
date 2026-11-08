import assert from "node:assert/strict";
import { mock } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "playwright/test";
import { google } from "googleapis";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { sample } from "../server/domain.ts";
import { defaultAppearance } from "../shared/theme-editing.ts";
import { digest } from "../server/auth.ts";
import { encrypt } from "../server/google.ts";
import { designDrive } from "../tests/helpers/design-drive.ts";

process.env.DEMO_MODE = "true";
const drive = designDrive();
mock.method(google, "drive", () => drive.client);
const store = new Store(":memory:");
const server = createApp(store);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox"] });
  for (const language of ["ja", "en"]) for (const width of [1280, 390]) for (const layoutChanged of [false, true]) {
    const shop = await store.createShop(`screen-${language}-${width}-${layoutChanged}@example.com`);
    shop.publication = "public";
    await store.saveShop(shop);
    const user = { email: shop.owner, name: "Owner", role: "owner", shopId: shop.id, refreshToken: encrypt("fixture") };
    const session = randomUUID();
    await store.put("user", user.email, user);
    await store.put("session", digest(session), { user, expires: Date.now() + 3600000 });
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: language === "ja" ? "ja-JP" : "en-US" });
    await context.addCookies([{ name: "gemihub_session", value: session, url: origin }]);
    const publish = async config => {
      const fresh = await store.shop(shop.id), id = randomUUID();
      await store.put("plan", id, { id, shopId: shop.id, base: fresh.revision, config, source: fresh.published, approved: true, summary: ["Booking copy"], request: "Change booking heading", createdAt: Date.now(), checklist: [] });
      const response = await context.request.post(`${origin}/api/shops/${shop.id}/plans/${id}/publish`, { headers: { Origin: origin }, data: {} });
      assert.equal(response.status(), 200, await response.text());
    };
    const previous = { ...structuredClone(sample), appearance: { ...defaultAppearance, accent: "rose", copy: { bookingTitle: "Old booking title", contactTitle: "Old contact title" } } };
    await publish(previous);
    const oldVersion = (await store.shop(shop.id)).designPublication.number;
    await publish({ ...previous, appearance: { ...previous.appearance, accent: "rose", copy: { bookingTitle: "New booking title", contactTitle: "Current contact title" } }, ...(layoutChanged ? { screens: { reserve: { html: '<section class="new-booking-layout"><slot name="booking"></slot></section>', css: ".new-booking-layout{padding:20px}" } } } : {}) });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?shop=${shop.id}&tab=try&screen=reserve&lang=${language}`);
    const preview = page.locator(".local-preview-screen");
    await expect(preview.getByRole("heading", { name: "New booking title", exact: true })).toBeVisible();
    const history = page.locator(".design-version-history");
    await history.locator("summary").click();
    await history.locator(`[data-design-version="${oldVersion}"] button`).click();
    await expect(preview.getByRole("heading", { name: "Old booking title", exact: true })).toBeVisible();
    await expect(preview.getByRole("heading", { name: "New booking title", exact: true })).toHaveCount(0);
    await expect(preview.locator(".new-booking-layout")).toHaveCount(0);
    const fresh = await store.shop(shop.id);
    assert.equal(fresh.published.appearance.accent, "rose");
    assert.equal(fresh.published.appearance.copy.contactTitle, "Current contact title");
    const exported = JSON.parse(drive.files.get(fresh.google.artifactIds["web/shop.json"]).content);
    assert.equal(exported.appearance.copy.bookingTitle, "Old booking title");
    // Verify a fresh customer's live booking page also receives and renders the restored copy.
    const customer = { email: "customer@example.com", name: "Customer", role: "customer", shopId: shop.id };
    const customerSession = randomUUID();
    await store.put("session", digest(customerSession), { user: customer, expires: Date.now() + 3600000 });
    await store.put("customer", `${shop.id}:${customer.email}`, { shopId: shop.id, email: customer.email, name: customer.name, birthDate: "2000-01-01", gender: "not_specified" });
    await context.addCookies([{ name: "gemihub_session", value: customerSession, url: origin }]);
    await page.goto(`${origin}/s/${fresh.slug}?pane=reserve&lang=${language}`);
    await expect(page.getByRole("heading", { name: "Old booking title", exact: true })).toBeVisible();
    const directory = `tmp/design-screen-restore/${language}-${width}-${layoutChanged}`;
    await mkdir(directory, { recursive: true });
    for (const name of ["index.html", "data.js"]) await writeFile(`${directory}/${name}`, drive.files.get(fresh.google.artifactIds[`web/${name}`]).content);
    await page.goto(new URL(`../${directory}/index.html?lang=${language}`, import.meta.url).href);
    await page.locator(".public-nav button").nth(1).click();
    await expect(page.getByRole("heading", { name: "Old booking title", exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Screen restoration: text-only and layout+text, Japanese/English, desktop/mobile, editor, customer page and file:// Drive output verified (8 cases).");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await store.close();
  mock.restoreAll();
}
