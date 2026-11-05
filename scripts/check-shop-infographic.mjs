import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, expect } from "playwright/test";
import { sample } from "../server/domain.ts";
import { systemSvg } from "../server/shop-system.ts";
import { requestLocale } from "../server/i18n.ts";

const root = resolve("storybook-static");
const catalog = JSON.parse(await readFile("shared/en.json", "utf8"));
const entries = Object.values(JSON.parse(await readFile(resolve(root, "index.json"), "utf8")).entries);
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const file = resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  try { assert.ok(file.startsWith(root + "/")); res.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream"); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  const executablePath = process.env.CHROMIUM || process.argv[2];
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ["--no-sandbox"] });
  await mkdir("tmp/shop-infographic", { recursive: true });
  for (const lang of ["ja", "en"]) for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", req => { if (new URL(req.url()).pathname.startsWith("/api/")) errors.push(`Unexpected live API: ${req.url()}`); });
    const label = key => lang === "en" ? catalog[key] || key : key;
    for (const suffix of ["shop-specification", "shop-specification-payment", "shop-specification-owner-only"]) {
      const entry = entries.find(entry => entry.id.endsWith(`--${suffix}`)); assert.ok(entry, suffix);
      await page.goto(`http://127.0.0.1:${server.address().port}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&lang=${lang}`);
      const spec = page.getByRole("region", { name: label("現在のお店の設定"), exact: true });
      await expect(spec.locator(".spec-stats")).toBeVisible();
      const paid = suffix.endsWith("-payment"), owner = suffix.endsWith("-owner-only");
      await expect(spec.locator(".spec-booking-flow li")).toHaveCount(paid ? 5 : 4);
      await expect(spec.locator(".spec-booking-flow")).toContainText(label("メール認証またはGoogleログイン"));
      const payment = spec.locator(".spec-payment");
      await expect(payment).toContainText(label("お支払いとキャンセル"));
      if (paid) {
        await expect(payment).toContainText("PayPal");
        await expect(payment).toContainText("50%");
        await expect(payment).toContainText(label("キャンセル時は予約時の条件で自動返金します。お店都合は全額返金します。"));
      } else {
        await expect(payment).toContainText(label("予約時のオンライン決済はありません。"));
        await expect(spec).not.toContainText("PayPal");
        await expect(payment).not.toContainText("%返金");
      }
      await expect(spec.locator(".spec-stats > div").nth(1).locator("strong")).toHaveText(owner ? "1" : String(sample.staff.length));
      await expect(spec.locator(".spec-stats > div").nth(2).locator("strong")).toHaveText(owner ? "4" : "8");
      await expect(spec.locator(".spec-page-tags span")).toHaveCount(owner ? 4 : 6);
      if (owner) {
        await expect(spec.locator(".spec-page-tags")).not.toContainText(label("ブログ一覧・記事"));
        await expect(spec.locator(".spec-page-tags")).not.toContainText(label("お知らせ一覧・記事"));
        await expect(spec.locator(".spec-staff-list")).toContainText(label("店主"));
      }
      assert.equal(await spec.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${lang}/${width}/${suffix} overflow`);
      await spec.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `tmp/shop-infographic/${lang}-${width}-${suffix}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 940, height: 950 } });
  for (const lang of ["ja", "en"]) for (const paid of [false, true]) {
    const config = structuredClone(sample);
    config.rules.payment = { enabled: paid, refundTiers: [{ hoursBefore: 72, percent: 100 }, { hoursBefore: 24, percent: 50 }, { hoursBefore: 0, percent: 0 }] };
    await page.setContent(requestLocale.run(lang, () => systemSvg(config)));
    const clipped = await page.locator("svg text").evaluateAll(elements => elements.filter(el => { const box = el.getBBox(); return box.x < 0 || box.x + box.width > 901; }).map(el => el.textContent));
    assert.deepEqual(clipped, [], `${lang}/${paid} SVG text bounds`);
    await page.screenshot({ path: `tmp/shop-infographic/${lang}-svg-${paid ? "paid" : "unpaid"}.png`, fullPage: true });
  }
  console.log("Verified Japanese/English infographics at desktop, 390px and 320px: PayPal on/off, refund terms, owner count, enabled pages, SVG text bounds and isolated Storybook requests.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
