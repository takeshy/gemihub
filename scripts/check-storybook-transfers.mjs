import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, expect } from "playwright/test";

const root = resolve("storybook-static");
const english = JSON.parse(await readFile("shared/en.json", "utf8"));
const index = JSON.parse(await readFile(resolve(root, "index.json"), "utf8"));
const stories = Object.values(index.entries).filter(entry => entry.type === "story" && ["お客様の画面/キャンセルとお得な空き枠", "運営/予約・お客様/キャンセル枠の予約"].includes(entry.title));
assert.equal(stories.length, 15);
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, `.${new URL(req.url, "http://localhost").pathname}`);
    assert.ok(path.startsWith(`${root}/`));
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" })[extname(path)] || "application/octet-stream");
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://storybook.test:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox", "--no-proxy-server", "--host-resolver-rules=MAP storybook.test 127.0.0.1"] });
  await mkdir("tmp/storybook-transfers", { recursive: true });
  for (const language of ["ja", "en"]) for (const width of [1200, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const dialogs = [];
    page.on("dialog", dialog => { dialogs.push(dialog.message()); return dialog.accept(); });
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/") || /paypal\.com$/.test(url.hostname)) {
        errors.push(`External payment or live API request: ${url}`);
        await route.abort();
      } else await route.continue();
    });
    const text = key => language === "en" ? english[key] || key : key;
    const button = key => page.getByRole("button", { name: text(key), exact: true });
    for (const story of stories) {
      await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=locale:${language}`);
      await page.locator("#storybook-root h1, #storybook-root h2").first().waitFor({ state: "attached" });
      assert.equal(await page.evaluate(() => isSecureContext), false);
      const kind = story.id.split("--").at(-1);
      const owner = story.title.startsWith("運営/");
      if (owner) {
        if (kind === "listed") await expect(page.locator(".transfer-status")).toBeVisible();
        else if (kind === "sold") await expect(page.locator(".payment-details")).toContainText(text("返金完了"));
        if (kind === "refund") {
          await expect(button("返金状況を再確認")).toBeVisible();
          await page.screenshot({ path: `tmp/storybook-transfers/${language}-${width}-${story.id}.png`, fullPage: true });
          await button("返金状況を再確認").click();
          await expect(button("返金状況を再確認")).toHaveCount(0);
          await expect(page.locator(".payment-details")).toContainText(text("返金完了"));
        }
      } else if (kind === "offers") {
        const offers = page.locator(".transfer-offers");
        await expect(offers.locator(".booking-card")).toHaveCount(3);
        await expect(offers).toContainText("4,950"); await expect(offers).toContainText("3,850"); await expect(offers).toContainText("2,750");
        await page.screenshot({ path: `tmp/storybook-transfers/${language}-${width}-${story.id}.png`, fullPage: true });
        await button("この枠を予約する").first().click();
        await page.getByLabel(text("支払額と返金条件を確認しました"), { exact: true }).first().check();
        await offers.getByRole("button", { name: text("支払い・予約を練習する"), exact: false }).click();
        await expect(page.locator(".booking-complete")).toBeVisible();
        await expect(page.locator(".booking-complete .payment-details")).toContainText("4,950");
        await expect(page.locator("#storybook-root")).not.toContainText("other@example.com");
      } else if (kind === "eligible" || kind === "listed") {
        if (kind === "eligible") {
          await button("キャンセルする").click(); await expect(button("キャンセルを取り消して、予約に戻す")).toBeVisible();
          assert.ok(dialogs.at(-1).includes("3,850") && dialogs.at(-1).includes("4,950"), "confirmation shows both refund amounts");
        }
        await expect(page.locator(".transfer-status")).toContainText("3,850");
        await expect(page.locator(".transfer-status")).toContainText("4,950");
        await expect(button("キャンセルする")).toHaveCount(0);
        await page.screenshot({ path: `tmp/storybook-transfers/${language}-${width}-${story.id}-pending.png`, fullPage: true });
        await expect(button("キャンセルを取り消して、予約に戻す")).toBeVisible();
        await button("キャンセルを取り消して、予約に戻す").click();
        await expect(button("キャンセルする")).toBeVisible();
      } else if (kind === "seller-buying") {
        await expect(page.locator(".transfer-status")).toBeVisible();
        await expect(button("キャンセルを取り消して、予約に戻す")).toHaveCount(0);
      } else if (["buyer-creating", "buyer-paying", "buyer-review"].includes(kind)) {
        if (kind === "buyer-creating") await button("支払い手続きを再開").click();
        await button("支払い状況を確認・予約を確定").click();
        if (kind === "buyer-review") {
          await expect(page.locator("#storybook-root")).toContainText(text("お店での支払い確認が必要です。お問い合わせください。"));
          await expect(page.locator(".booking-complete")).toHaveCount(0);
        } else await expect(page.locator(".booking-complete")).toBeVisible();
      } else if (kind === "received") {
        await expect(page.locator("#storybook-root")).toContainText(text("お得な空き枠からご予約いただきました。"));
        await expect(page.locator("#storybook-root")).not.toContainText("other@example.com");
      } else {
        await expect(page.locator(".transfer-history")).toBeVisible();
        if (kind === "sold") await expect(page.locator(".transfer-history")).toContainText(text("返金完了"));
        if (kind === "pending-refund") await expect(page.locator(".transfer-history")).toContainText(text("PayPalで返金を確認中"));
        if (kind === "refund-review") await expect(page.locator(".transfer-history")).toContainText(text("返金の確認が必要です。お店にお問い合わせください。"));
        if (kind === "expired") await expect(page.locator(".transfer-history")).toContainText(text("返金額が確定しました"));
      }
      await expect(page.locator('#storybook-root [role="alert"]')).toHaveCount(0);
      if (!owner) await expect(page.locator("#storybook-root")).not.toContainText(/譲渡|譲受|transfer/i);
      if (!(owner && kind === "refund") && kind !== "offers") await page.screenshot({ path: `tmp/storybook-transfers/${language}-${width}-${story.id}.png`, fullPage: true });
      assert.deepEqual(errors, [], story.id);
    }
    console.log(`${language} ${width}px: ${stories.length} transfer stories and interactions passed`);
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
