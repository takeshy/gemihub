import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

const root = resolve("storybook-static");
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, `.${new URL(req.url, "http://localhost").pathname}`); assert.ok(path.startsWith(root + "/"));
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg" })[extname(path)] || "application/octet-stream");
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox"] });
  const entries = Object.values(JSON.parse(await readFile(resolve(root, "index.json"), "utf8")).entries);
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "ja-JP", timezoneId: "Asia/Tokyo", reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.__imageWrites = [];
      const save = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key.startsWith("omaiweb:local-preview:")) { const draft = JSON.parse(value); window.__imageWrites.push({ pages: draft.config.pages.map(page => ({ id: page.id, imageId: page.imageId })), header: draft.config.header.imageId }); } return save.call(this, key, value); };
      // Deterministic speech recognition: no microphone or cloud speech service is used.
      window.SpeechRecognition = class {
        start() { setTimeout(() => { this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: "やわらかな光が差し込む春の花の写真" } } } }); this.onend?.(); }, 0); }
        stop() { this.onend?.(); }
        abort() { this.onend?.(); }
      };
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) errors.push(`Live API request: ${request.url()}`); });
    async function open(name) {
      const entry = entries.find(entry => entry.title === "運営/画像管理" && entry.exportName === name); assert.ok(entry, name);
      await page.goto(`http://127.0.0.1:${server.address().port}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story`);
    }
    await open("Library");
    await page.getByRole("heading", { name: "画像管理", exact: true }).waitFor();
    await page.locator(".image-library-grid figure").nth(1).waitFor();
    assert.equal(await page.locator(".image-library-grid figure").count(), 2);
    const file = { name: "upload-test.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") };
    await page.getByLabel("画像をアップロード", { exact: true }).setInputFiles(file);
    await page.getByRole("status").filter({ hasText: "画像を登録しました" }).waitFor();
    let uploaded = page.locator(".image-library-grid figure").filter({ hasText: "upload-test.png" });
    await uploaded.getByRole("button", { name: "名前を変更", exact: true }).click();
    await uploaded.getByLabel("新しい画像名", { exact: true }).fill("名前変更の確認.png");
    await uploaded.getByRole("button", { name: "名前を保存", exact: true }).click();
    uploaded = page.locator(".image-library-grid figure").filter({ hasText: "名前変更の確認.png" });
    await uploaded.getByRole("button", { name: "画像管理から削除", exact: true }).click();
    await uploaded.getByRole("button", { name: "削除する", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "画像管理から削除しました" }).waitFor();
    await page.getByRole("button", { name: "AIで生成", exact: true }).click();
    assert.equal(await page.getByLabel("生成したい画像", { exact: true }).count(), 0);
    const methods = page.getByRole("group", { name: "画像生成の依頼方法" });
    await methods.getByRole("button", { name: /文章で依頼/ }).click();
    assert.equal(await page.getByRole("button", { name: "音声で指示する", exact: true }).count(), 0);
    await methods.getByRole("button", { name: /音声で依頼/ }).click();
    await page.getByLabel("画像の名前", { exact: true }).fill("音声で生成した画像.png");
    await page.getByRole("button", { name: "音声で指示する", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".image-generation textarea")?.value.includes("春の花"));
    await page.getByRole("button", { name: "参考画像を選ぶ", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "依頼の画像を選ぶ", exact: true });
    await dialog.getByRole("button", { name: "お店の紹介.pngを選択", exact: true }).click();
    await dialog.getByRole("button", { name: "選択した画像を使う", exact: true }).click();
    await page.getByLabel("画像の比率").selectOption("16:9");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "image generation should fit viewport");
    await mkdir(resolve("tmp"), { recursive: true }); await page.screenshot({ path: resolve(`tmp/image-library-generation-${width}.png`) });
    await page.getByRole("button", { name: "生成して結果を確認", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "AIで生成した画像を画像管理に保存しました" }).waitFor();
    const imageReview = page.getByRole("region", { name: "生成した画像を確認", exact: true });
    await imageReview.locator(".library-image").scrollIntoViewIfNeeded();
    await imageReview.locator("img").waitFor();
    await imageReview.getByRole("button", { name: "これでOK", exact: true }).click();
    const generated = page.locator(".image-library-grid figure").filter({ hasText: "音声で生成した画像.png" });
    await generated.scrollIntoViewIfNeeded();
    await generated.locator("img").waitFor();
    await generated.getByRole("button", { name: "音声で生成した画像.pngを拡大", exact: true }).click();
    await page.getByRole("dialog", { name: "画像の拡大表示", exact: true }).locator("img").waitFor();
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await page.getByLabel("画像の種類").selectOption("ai");
    assert.equal(await page.locator(".image-library-grid figure").count(), 2);
    await page.getByLabel("画像を検索", { exact: true }).fill("音声で生成");
    assert.equal(await page.locator(".image-library-grid figure").count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "image library should fit viewport");
    assert.equal(await page.getByLabel("画像を使う場所").count(), 0);
    assert.equal(await page.getByRole("button", { name: "ページに使う", exact: true }).count(), 0);
    await page.getByRole("tab", { name: "お客様メモの画像", exact: true }).click();
    const memos = page.getByRole("region", { name: "お客様メモの画像", exact: true });
    await memos.locator("figure").nth(2).waitFor();
    assert.equal(await memos.locator("figure").count(), 3);
    assert.equal(await memos.getByRole("button", { name: /名前を変更|削除|生成|使う/ }).count(), 0);
    assert.equal(await memos.locator('input[type="file"]').count(), 0);
    await memos.locator("figure").first().scrollIntoViewIfNeeded();
    await memos.locator("figure").first().locator("img").waitFor();
    await memos.locator("figure").first().getByRole("button").click();
    await page.getByRole("dialog", { name: "画像の拡大表示", exact: true }).locator("img").waitFor();
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await page.locator("aside nav").getByRole("button", { name: /お店をつくる・直す$/ }).click();
    await page.getByRole("button", { name: /文章で依頼/ }).click();
    await page.getByRole("button", { name: "依頼に使う画像を選ぶ", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "依頼の画像を選ぶ", exact: true });
    await dialog.getByRole("button", { name: "音声で生成した画像.pngを選択", exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: /ショートボブ|肩まで|カラーの記録/ }).count(), 0);
    await dialog.getByRole("button", { name: "音声で生成した画像.pngを選択", exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "picker fits viewport");
    await dialog.getByRole("button", { name: "選択した画像を使う", exact: true }).click();
    await page.getByLabel("質問・変更したいこと").fill("選んだ画像をよくある質問のページに使って変更したい");
    await page.getByRole("button", { name: "依頼して結果を確認", exact: true }).click();
    await page.getByRole("heading", { name: "依頼の結果を確認", exact: true }).waitFor();
    await page.getByRole("button", { name: "これでOK", exact: true }).click();
    await page.getByRole("button", { name: "お店のページを公開 →", exact: true }).click();
    await page.getByText("予約ページを公開しました。お客様の予約を受け付けられます。", { exact: true }).waitFor();
    await page.locator("aside nav").getByRole("button", { name: /画像管理$/ }).click();
    const used = page.locator(".image-library-grid figure").filter({ hasText: "音声で生成した画像.png" });
    await used.getByText("使用中：ページ：よくある質問", { exact: true }).waitFor();
    assert.equal(await used.getByRole("button", { name: "画像管理から削除", exact: true }).isDisabled(), true);
    await page.locator("aside nav").getByRole("button", { name: /画面を試す・編集$/ }).click();
    await page.getByRole("treeitem", { name: "ヘッダー", exact: true }).click();
    await page.getByText("ヘッダーの内容を編集", { exact: true }).click();
    await page.getByRole("button", { name: "画像管理から選ぶ・AIで生成", exact: true }).click();
    const picker = page.getByRole("region", { name: "画像を選ぶ", exact: true });
    await picker.locator(".image-library-grid figure").first().getByRole("button", { name: "この画像を使う", exact: true }).click();
    await page.locator(".local-preview-screen").scrollIntoViewIfNeeded();
    await page.locator(".local-preview-screen .managed-hero-image img").waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "editor layout should fit viewport");
    await page.locator("aside nav").getByRole("button", { name: /ページをつくる$/ }).click();
    await page.getByRole("button", { name: "要望を書いて作る", exact: true }).click();
    await page.getByRole("button", { name: "依頼に使う画像を選ぶ", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "依頼の画像を選ぶ", exact: true });
    await dialog.getByRole("button", { name: "音声で生成した画像.pngを選択", exact: true }).click();
    await dialog.getByRole("button", { name: "選択した画像を使う", exact: true }).click();
    await page.getByLabel("作りたいページの要望", { exact: true }).fill("選んだ画像を使ってFAQを作ってください");
    await page.getByRole("button", { name: "ページ案を作る", exact: true }).click();
    await page.getByRole("heading", { name: "ページ案を確認", exact: true }).waitFor();
    await page.locator(".page-proposal .managed-hero-image").scrollIntoViewIfNeeded();
    await page.locator(".page-proposal .managed-hero-image img").waitFor();
    await open("Page");
    await page.getByRole("heading", { name: "よくある質問", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".managed-hero-image img").length === 2 && [...document.querySelectorAll(".managed-hero-image img")].every(img => img.complete && img.naturalWidth > 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "public page should fit viewport");
    await mkdir(resolve("tmp"), { recursive: true }); await page.screenshot({ path: resolve(`tmp/image-library-public-${width}.png`) });
    await open("Empty");
    await page.getByText("まだ画像はありません。アップロードするか、AIで生成してください。", { exact: true }).waitFor();
    await open("CustomerMemos");
    await page.locator(".customer-memo-images figure").nth(2).waitFor();
    await open("RequestPicker");
    await page.getByRole("dialog", { name: "依頼の画像を選ぶ", exact: true }).waitFor();
    await open("GenerateResult");
    const generatedResult = page.getByRole("region", { name: "生成した画像を確認", exact: true });
    await generatedResult.waitFor();
    await generatedResult.getByRole("button", { name: "さらに依頼する", exact: true }).click();
    await page.getByRole("group", { name: "画像生成の依頼方法" }).getByRole("button", { name: /文章で依頼/ }).click();
    await page.getByLabel("生成したい画像", { exact: true }).fill("同じ画像をもっと明るい雰囲気にして");
    await page.locator(".image-generation .request-image-selection").getByText("生成画像.png", { exact: true }).waitFor();
    await page.getByRole("button", { name: "生成して結果を確認", exact: true }).click();
    await generatedResult.waitFor();
    await generatedResult.getByRole("button", { name: "これでOK", exact: true }).click();
    assert.equal(await page.locator(".image-generation").count(), 0);
    assert.deepEqual(errors, []); await context.close();
    console.log(`${width}px: upload, rename, archive, voice instruction, reference generation, search, private read-only tab, request picker, proposal approval/publication, header selection and public images passed (Storybook fixtures).`);
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
