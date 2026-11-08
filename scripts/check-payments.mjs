import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
const root = resolve("storybook-static");
const index = JSON.parse(await readFile(resolve(root, "index.json"), "utf8"));
const entries = Object.values(index.entries).filter(e => e.type === "story" && ["お客様の画面/お支払い・返金", "運営/予約・お客様/お支払いと返金"].includes(e.title));
assert.equal(entries.length, 10);
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, `.${new URL(req.url, "http://localhost").pathname}`);
    assert.ok(path.startsWith(root + "/"));
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json" })[extname(path)] || "application/octet-stream");
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox"] });
  await mkdir("tmp/payment-screenshots", { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("request", req => { if (new URL(req.url()).pathname.startsWith("/api/") || new URL(req.url()).hostname.endsWith("paypal.com")) errors.push(`Unexpected real request: ${req.url()}`); });
    async function open(suffix, locale = "ja") {
      const entry = entries.find(e => e.id.endsWith(`--${suffix}`)); assert.ok(entry);
      await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&lang=${locale}`);
      await page.locator("#storybook-root h2").first().waitFor({ state: "attached" });
    }
    await open("payment");
    const day = new Date(Date.now() + 2 * 86400000 + 9 * 3600000).toISOString().slice(0, 10);
    await page.getByLabel("ご希望の日付（日本時間）").fill(day);
    await page.getByLabel("ご希望の日付（日本時間）").blur();
    await page.locator(".time-grid button").first().click();
    const pay = page.getByRole("button", { name: "支払い・予約を練習する →", exact: true });
    assert.equal(await pay.isDisabled(), true);
    await page.getByLabel("支払額と返金条件を確認しました").check();
    assert.equal(await pay.isEnabled(), true);
    await pay.click();
    await page.getByRole("button", { name: "マイページ", exact: true }).click();
    // There is an existing sample booking too; cancel the new booking by its final position.
    const booking = page.locator(".booking-card").last();
    await booking.getByText("PayPal 支払済み：¥5,500", { exact: false }).waitFor();
    let confirmation = "";
    page.once("dialog", async dialog => { confirmation = dialog.message(); await dialog.accept(); });
    await booking.getByRole("button", { name: "キャンセルする", exact: true }).click();
    await booking.getByText("返金完了：¥5,500（100%）", { exact: false }).waitFor();
    assert.ok(confirmation.includes("5,500"));
    await page.screenshot({ path: `tmp/payment-screenshots/full-refund-${width}.png`, fullPage: true });
    await open("owner");
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "店都合でキャンセル・全額返金", exact: true }).click();
    await page.getByText("返金完了：¥5,500（100%）", { exact: false }).waitFor();
    await open("insufficient-funds");
    await page.getByText("PayPalの返金用残高が不足しています。", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.getByRole("button", { name: "返金状況を再確認", exact: true }).click();
    await page.getByText("返金完了：¥5,500（100%）", { exact: false }).waitFor();
    await open("policy");
    await page.getByLabel("返金条件2・返金率（%）").fill("60");
    await page.locator(".live-settings-rules").getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("保存しました。", { exact: true }).waitFor();
    for (const [suffix, text] of [["partial-refund", "返金完了：¥3,850"], ["zero-refund", "返金なし：¥0"], ["full-refund", "返金完了：¥5,500"], ["pending-refund", "PayPalで返金を確認中"], ["failed-refund", "返金の確認が必要です"]]) {
      await open(suffix); await page.getByText(text, { exact: false }).waitFor();
      assert.deepEqual(await page.locator('[role="alert"]').allTextContents(), []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    }
    await open("payment", "en");
    await page.getByRole("heading", { name: "Payment and refund policy", exact: true }).waitFor();
    await page.getByLabel("I have reviewed the payment amount and refund policy").waitFor();
    assert.equal(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(await page.locator(".payment-policy").innerText()), false);
    await open("insufficient-funds", "en");
    await page.getByText("The PayPal refund balance is insufficient.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Check refund status", exact: true }).click();
    await page.getByText("Refund complete: ¥5,500 (100%)", { exact: false }).waitFor();
    assert.equal(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test((await page.locator(".payment-details").allInnerTexts()).join("\n")), false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${width}px: payment consent, simulated booking, full refund, 70% partial refund, shop full refund, policy save, refund states and English payment/recovery UI passed.`);
  }
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
