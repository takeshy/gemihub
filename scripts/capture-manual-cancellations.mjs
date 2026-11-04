import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, expect } from "playwright/test";

const root = resolve("storybook-static");
const catalog = JSON.parse(await readFile("shared/en.json", "utf8"));
const entries = Object.values(JSON.parse(await readFile(resolve(root, "index.json"), "utf8")).entries).filter(entry => entry.type === "story");
const checkOnly = process.argv.includes("--check");
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, `.${new URL(req.url, "http://localhost").pathname}`);
    assert.ok(path.startsWith(`${root}/`));
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" })[extname(path)] || "application/octet-stream");
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox"] });
  for (const language of ["ja", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: language === "ja" ? "ja-JP" : "en-US", timezoneId: "Asia/Tokyo", reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") || /paypal\.com$/.test(url.hostname)) errors.push(`Unexpected live request: ${url}`);
    });
    const label = key => language === "en" ? catalog[key] || key : key;
    async function open(title, suffix) {
      const entry = entries.find(entry => entry.title === title && entry.id.endsWith(`--${suffix}`));
      assert.ok(entry, `${title}/${suffix}`);
      await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${language}`);
      await page.locator("#storybook-root h1, #storybook-root h2").first().waitFor({ state: "attached" });
    }
    const shots = [];
    async function capture(name, focus) {
      await expect(focus).toBeVisible();
      await focus.evaluate(element => element.scrollIntoView({ block: "start" }));
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      shots.push({ name, bytes: await page.screenshot({ type: "jpeg", quality: 86, animations: "disabled" }) });
    }
    if (!checkOnly) {
      await open("運営/設定/メニュー・料金", "menus");
      const setting = page.getByLabel(label("キャンセル後に代わりの予約を受け付ける（指名・事前カウンセリング前提なら外す）"), { exact: true }).first();
      await expect(setting).toBeChecked();
      await capture("37-cancellation-settings.jpg", page.locator(".menu-edit-block").first());
      await open("お客様の画面/キャンセルとお得な空き枠", "listed");
      await expect(page.locator(".transfer-status")).toContainText("3,850");
      await expect(page.locator(".transfer-status")).toContainText("4,950");
      await capture("38-cancellation-pending.jpg", page.locator(".booking-card").first());
      await open("お客様の画面/キャンセルとお得な空き枠", "offers");
      await expect(page.locator(".transfer-offers .booking-card")).toHaveCount(3);
      await capture("39-discounted-appointments.jpg", page.locator(".transfer-offers"));
      await open("お客様の画面/キャンセルとお得な空き枠", "sold");
      await expect(page.locator(".transfer-history")).toContainText("4,950");
      await capture("40-cancellation-refund.jpg", page.locator(".transfer-history"));
      await open("運営/予約・お客様/お支払いと返金", "policy");
      await expect(page.locator(".refund-tier")).toHaveCount(4);
      await capture("41-refund-rules.jpg", page.getByRole("heading", { name: label("予約時のお支払い・キャンセル時の返金"), exact: true }));
      const localePath = language === "en" ? "en/" : "";
      for (const base of ["public/manual", "storybook-static/manual"]) {
        const folder = resolve(base, localePath); await mkdir(folder, { recursive: true });
        for (const shot of shots) await writeFile(resolve(folder, shot.name), shot.bytes);
      }
    }
    await open("運営/使い方", "manual");
    await expect(page.locator("#guide-cancellations")).toContainText(label("キャンセルと返金を確認する"));
    const manual = await page.locator(".manual").innerText();
    if (language === "en") assert.ok(!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(manual), "manual text is fully translated");
    const images = await page.locator(".manual img").evaluateAll(images => images.map(image => image.getAttribute("src")));
    assert.ok(images.length > 30);
    const prefix = language === "en" ? "/manual/en/" : "/manual/";
    for (const path of images) { assert.ok(path.startsWith(prefix)); assert.equal((await context.request.get(origin + path)).status(), 200, path); }
    for (const id of ["cancellation-settings", "cancellation", "discounted-appointments"]) await expect(page.locator(`#guide-${id}`)).toHaveCount(1);
    const image = page.locator("#guide-cancellation figure button").first();
    await image.scrollIntoViewIfNeeded(); await image.click();
    await expect(page.locator(".manual-dialog")).toBeVisible();
    await expect(page.locator(".manual-dialog img")).toHaveAttribute("src", `${prefix}38-cancellation-pending.jpg`);
    await page.getByRole("button", { name: label("拡大画像を閉じる"), exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#guide-cancellation").scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile manual does not overflow");
    assert.deepEqual(errors, []);
    console.log(`${language}: ${shots.length} new captures; ${images.length} manual image references, new instructions, zoom and mobile layout checked`);
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
