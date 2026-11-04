import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, expect } from "playwright/test";

const english = JSON.parse(await readFile("shared/en.json", "utf8"));
let origin = process.env.STORYBOOK_URL;
let server;
if (!origin) {
  const root = resolve("storybook-static");
  server = createServer(async (req, res) => {
    try {
      const path = resolve(root, `.${new URL(req.url, "http://localhost").pathname}`);
      assert.ok(path.startsWith(root + "/"));
      res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg" })[extname(path)] || "application/octet-stream");
      res.end(await readFile(path));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
}
const entries = Object.values((await (await fetch(`${origin}/index.json`)).json()).entries);
const file = name => ({ name, mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
const captures = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox"] });
  await mkdir("tmp", { recursive: true });
  for (const width of [1280, 390]) for (const locale of ["ja", "en"]) {
    const t = text => locale === "en" ? english[text] || text : text;
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: locale === "en" ? "en-US" : "ja-JP", reducedMotion: "reduce" });
    await context.addInitScript(() => {
      const read = FileReader.prototype.readAsDataURL;
      window.__imageReads = [];
      FileReader.prototype.readAsDataURL = function (blob) {
        if (window.__holdImageReads) window.__imageReads.push(() => read.call(this, blob));
        else read.call(this, blob);
      };
      window.SpeechRecognition = class {
        start() { this.onstart?.(); setTimeout(() => { this.onresult?.({ results: [{ isFinal: true, 0: { transcript: "Flowers in soft light" } }] }); this.onend?.(); }, 0); }
        stop() {} abort() {}
      };
    });
    const page = await context.newPage();
    const errors = [];
    const capture = async name => { if (process.env.UPDATE_MANUAL === "1" && width === 1280) captures.push({ path: `public/manual/${locale === "en" ? "en/" : ""}${name}`, bytes: await page.screenshot({ type: "jpeg", quality: 85 }) }); };
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) errors.push(`Live API request: ${request.url()}`); });
    const button = (scope, text) => scope.getByRole("button", { name: t(text), exact: true });
    const dialog = page.getByRole("dialog", { name: t("依頼の画像を選ぶ"), exact: true });
    async function open(exportName) {
      const story = entries.find(entry => entry.title === "運営/設定/画像管理" && entry.exportName === exportName);
      assert.ok(story, exportName);
      await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&lang=${locale}`);
      const scope = ["Library", "Uploading"].includes(exportName) ? page.getByRole("region", { name: t("画像管理"), exact: true }) : dialog;
      await expect(scope).toBeVisible();
      if (exportName === "Uploading") await expect(scope.getByLabel(t("画像をアップロード"), { exact: true })).toBeDisabled();
      else await expect(scope.getByLabel(t("画像をアップロード"), { exact: true })).toBeEnabled();
    }
    async function selectionOnly(scope) {
      for (const text of ["この画像をもとに生成", "名前を変更", "画像管理から削除"])
        await expect(button(scope, text)).toHaveCount(0);
    }
    async function startUpload(scope, name) {
      await page.evaluate(() => { window.__holdImageReads = true; });
      await scope.getByLabel(t("画像をアップロード"), { exact: true }).setInputFiles(file(name));
      const status = scope.locator(".image-upload-status");
      await expect(status).toContainText(t("画像をアップロードしています…"));
      await expect(status).toContainText(name);
      await expect(status.locator(".image-upload-spinner")).toBeVisible();
      await expect(scope.getByLabel(t("画像をアップロード"), { exact: true })).toBeDisabled();
    }
    async function finishUpload(scope) {
      await page.evaluate(() => { window.__holdImageReads = false; window.__imageReads.splice(0).forEach(read => read()); });
      await expect(scope.locator(".image-upload-status")).toHaveCount(0);
    }
    const card = name => dialog.locator("figure").filter({ has: page.locator("figcaption strong", { hasText: name }) });
    await open("RequestPicker");
    await expect(page.locator('aside nav button').filter({ hasText: new RegExp(t("画像管理") + "$") })).toHaveCount(1);
    await selectionOnly(dialog);
    await expect(dialog.locator("figure")).toHaveCount(2);
    await dialog.getByLabel(t("画像をアップロード"), { exact: true }).setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
    await expect(dialog.getByRole("alert")).toContainText(t("5MB以内のPNG・JPEG・GIF・WebP画像を選んでください。"));
    await dialog.getByLabel(t("画像をアップロード"), { exact: true }).setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
    await expect(dialog.locator("figure")).toHaveCount(2);
    await startUpload(dialog, "direct-upload.png");
    await expect(button(dialog, "選択した画像を使う")).toBeDisabled();
    await expect(button(dialog, "閉じる")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await capture("36-image-uploading.jpg");
    await finishUpload(dialog);
    const uploaded = card("direct-upload.png");
    await expect(uploaded.getByRole("button", { pressed: true })).toBeVisible();
    await button(dialog, "選択した画像を使う").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".request-image-selection")).toContainText("direct-upload.png");
    await page.getByRole("textbox", { name: t("AIに伝えたいこと"), exact: true }).fill("Unsent request draft");
    await button(page, "画像を添付").click();
    await expect(card("direct-upload.png").getByRole("button", { pressed: true })).toBeVisible();
    await selectionOnly(dialog);
    await card("direct-upload.png").getByRole("button", { pressed: true }).click();
    await button(dialog, "AIで生成").click();
    await dialog.getByRole("button", { name: new RegExp(t("文章で依頼")) }).click();
    await dialog.getByLabel(t("画像の名前"), { exact: true }).fill("generated.png");
    await dialog.getByLabel(t("生成したい画像"), { exact: true }).fill("Flowers by a bright window");
    // The upload indicator must remain visible even with the AI form expanded.
    await startUpload(dialog, "while-generating.png");
    await finishUpload(dialog);
    await button(dialog, "参考画像を選ぶ").click();
    const nested = page.getByRole("dialog", { name: t("依頼の画像を選ぶ"), exact: true }).last();
    await expect(nested).toBeVisible();
    await expect(button(nested, "AIで生成")).toHaveCount(0);
    await nested.getByLabel(t("画像をアップロード"), { exact: true }).setInputFiles(file("reference.png"));
    await expect(nested.getByRole("button", { pressed: true })).toBeVisible();
    await button(nested, "選択した画像を使う").click();
    await expect(dialog).toHaveCount(1);
    await capture("31-image-generation.jpg");
    await button(dialog, "生成して結果を確認").click();
    const review = dialog.getByRole("region", { name: t("生成した画像を確認"), exact: true });
    await review.locator(".library-image").scrollIntoViewIfNeeded();
    await expect(review.locator("img")).toBeVisible();
    await expect(button(dialog, "これでOK")).toBeEnabled();
    await capture("35-image-generation-result.jpg");
    await button(dialog, "これでOK").click();
    await expect(card("generated.png").getByRole("button", { pressed: true })).toBeVisible();
    await expect(page.locator(".chat-message-user")).toHaveCount(0);
    await capture("32-page-image.jpg");
    await page.screenshot({ path: `tmp/image-picker-${locale}-${width}.png` });
    await button(dialog, "選択した画像を使う").click();
    await expect(page.locator(".request-image-selection")).toContainText("generated.png");
    await button(page, "画像を添付").click();
    await expect(card("generated.png").getByRole("button", { pressed: true })).toBeVisible();
    await button(dialog, "やめる").click();
    await expect(page.getByRole("textbox", { name: t("AIに伝えたいこと"), exact: true })).toHaveValue("Unsent request draft");
    await expect(page.locator(".request-image-selection")).toContainText("generated.png");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "picker fits the viewport");
    await open("GenerateVoice");
    await button(dialog, "音声で指示する").click();
    const speech = page.getByRole("dialog", { name: t("音声入力"), exact: true });
    await expect(speech.getByRole("textbox", { name: t("書き起こした内容"), exact: true })).toHaveValue("Flowers in soft light");
    await page.keyboard.press("Escape");
    await expect(speech).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(t("画像の名前"), { exact: true }).fill("voice-generated.png");
    await expect(dialog.getByLabel(t("音声で伝えた内容・修正"), { exact: true })).toHaveValue("Flowers in soft light");
    await capture("34-image-generation-voice.jpg");
    await button(dialog, "生成して結果を確認").click();
    await review.locator(".library-image").scrollIntoViewIfNeeded();
    await expect(review.locator("img")).toBeVisible();
    await button(dialog, "さらに依頼する").click();
    await dialog.getByRole("button", { name: new RegExp(t("文章で依頼")) }).click();
    await dialog.getByLabel(t("画像の名前"), { exact: true }).fill("iteration.png");
    await dialog.getByLabel(t("生成したい画像"), { exact: true }).fill("Use warmer light");
    await button(dialog, "生成して結果を確認").click();
    await review.locator(".library-image").scrollIntoViewIfNeeded();
    await expect(review.locator("img")).toBeVisible();
    await button(dialog, "これでOK").click();
    await expect(card("iteration.png").getByRole("button", { pressed: true })).toBeVisible();
    const inUse = dialog.locator("figure").filter({ hasText: t("使用中：") }).first();
    await selectionOnly(dialog);
    await inUse.locator(".image-preview-button").click();
    const zoom = page.getByRole("dialog", { name: t("画像の拡大表示"), exact: true });
    await expect(zoom.locator("img")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(zoom).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await button(dialog, "選択した画像を使う").click();
    await expect(page.locator(".request-image-selection")).toContainText("iteration.png");

    await page.locator("aside nav").getByRole("button", { name: new RegExp(t("画面を試す・編集") + "$") }).click();
    await page.getByRole("treeitem", { name: t("ヘッダー"), exact: true }).click();
    await page.getByText(t("ヘッダー") + t("の内容を編集"), { exact: true }).click();
    await button(page, "画像管理から選ぶ・AIで生成").click();
    const editorPicker = page.getByRole("dialog", { name: t("画像を選ぶ"), exact: true });
    await expect(editorPicker).toBeVisible();
    await selectionOnly(editorPicker);
    await expect(button(editorPicker, "AIで生成")).toBeVisible();
    await editorPicker.locator("figure").first().getByRole("button", { pressed: false }).filter({ hasText: t("選択する") }).click();
    await button(editorPicker, "この画像を使う").click();
    const headerImage = page.locator(".local-preview-screen .managed-hero-image");
    await headerImage.scrollIntoViewIfNeeded();
    await expect(headerImage.locator("img")).toBeVisible();
    // The independent management screen owns the image-card management actions.
    await open("Library");
    const manager = page.getByRole("region", { name: t("画像管理"), exact: true });
    const managedCard = name => manager.locator("figure").filter({ has: page.locator("figcaption strong", { hasText: name }) });
    await expect(manager.locator("figure")).toHaveCount(2);
    await expect(button(manager, "名前を変更")).toHaveCount(2);
    await expect(button(manager, "この画像をもとに生成")).toHaveCount(2);
    await expect(button(manager.locator("figure").filter({ hasText: t("使用中：") }), "画像管理から削除")).toBeDisabled();
    await manager.locator(".library-image").first().scrollIntoViewIfNeeded();
    await expect(manager.locator(".library-image img").first()).toBeVisible();
    await capture("30-image-library.jpg");
    await startUpload(manager, "managed-upload.png");
    await finishUpload(manager);
    await expect(manager.getByRole("status")).toContainText(t("画像をアップロードしました。"));
    await button(managedCard("managed-upload.png"), "名前を変更").click();
    await managedCard("managed-upload.png").getByLabel(t("新しい画像名")).fill("renamed.png");
    await button(managedCard("managed-upload.png"), "名前を保存").click();
    await button(managedCard("renamed.png"), "画像管理から削除").click();
    await button(managedCard("renamed.png"), "削除する").click();
    await expect(managedCard("renamed.png")).toHaveCount(0);
    const referenceImage = manager.locator("figure").first();
    await button(referenceImage, "この画像をもとに生成").click();
    await manager.getByRole("button", { name: new RegExp(t("文章で依頼")) }).click();
    await expect(manager.locator(".request-image-selection img")).toBeVisible();
    await open("Empty");
    await expect(dialog.locator("figure")).toHaveCount(0);
    for (let i = 1; i <= (locale === "ja" && width === 1280 ? 16 : 1); i++) {
      await dialog.getByLabel(t("画像をアップロード"), { exact: true }).setInputFiles(file(`empty-${i}.png`));
      await expect(card(`empty-${i}.png`)).toBeVisible();
    }
    if (locale === "ja" && width === 1280) {
      await expect(dialog.getByRole("button", { pressed: true })).toHaveCount(15);
      await expect(dialog.getByRole("alert")).toContainText("15枚まで選択できます。");
    }
    await button(dialog, "選択した画像を使う").click();
    await expect(page.locator(".request-image-selection")).toContainText("empty-1.png");
    await open("UploadRetry");
    await startUpload(dialog, "retry.png");
    await finishUpload(dialog);
    await expect(dialog.getByRole("alert")).toContainText(t("操作できませんでした"));
    await button(dialog, "アップロードを再試行").click();
    await expect(card("retry.png").getByRole("button", { pressed: true })).toBeVisible();
    await expect(card("retry.png")).toHaveCount(1);
    await open("Uploading");
    await expect(page.locator(".image-upload-status")).toContainText("shop-photo.png");
    await expect(page.locator(".image-upload-spinner")).toBeVisible();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${locale} ${width}px: separate management actions, simple pickers, upload spinner through file reading/AI form/failure, selection, generation, limits and retry passed (fixtures).`);
  }
  for (const capture of captures) await writeFile(capture.path, capture.bytes);
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
