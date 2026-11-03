import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
const root = resolve("storybook-static");
const server = createServer(async (req, res) => {
  try {
    const path = resolve(
      root,
      `.${new URL(req.url, "http://localhost").pathname}`,
    );
    assert.ok(path.startsWith(root + "/"));
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".jpg": "image/jpeg",
      }[extname(path)] || "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
    args: ["--no-sandbox"],
  });
  const entries = Object.values(
    JSON.parse(await readFile(resolve(root, "index.json"), "utf8")).entries,
  );
  assert.equal(
    entries.filter((entry) => entry.title === "運営/家族・スタッフ").length,
    0,
  );
  await mkdir("tmp", { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      locale: "ja-JP",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        errors.push(`Live API: ${request.url()}`);
    });
    const open = async (title, suffix) => {
      const entry = entries.find(
        (entry) => entry.title === title && entry.id.endsWith(`--${suffix}`),
      );
      assert.ok(entry, `${title}/${suffix}`);
      await page.goto(
        `http://127.0.0.1:${server.address().port}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story`,
      );
    };
    await open("運営/スタッフ・勤務", "staff");
    const accounts = page.getByRole("region", {
      name: "スタッフのGoogleログイン",
      exact: true,
    });
    await accounts.waitFor();
    assert.equal(
      await page.getByRole("button", { name: /家族・スタッフ$/ }).count(),
      0,
    );
    const row = accounts.locator(".staff-account-row").nth(1);
    await row.getByRole("textbox").fill("new-staff@example.com");
    await row.getByRole("button", { name: "登録する", exact: true }).click();
    await row.getByRole("status").filter({ hasText: "登録しました" }).waitFor();
    assert.equal(
      await row.getByRole("textbox").inputValue(),
      "new-staff@example.com",
    );
    page.once("dialog", (dialog) => dialog.accept());
    await row
      .getByRole("button", { name: "ログイン登録を解除", exact: true })
      .click();
    await row.getByRole("status").filter({ hasText: "解除しました" }).waitFor();
    assert.equal(await row.getByRole("textbox").inputValue(), "");
    await accounts
      .getByRole("link", { name: "スタッフ用ログイン画面を開く", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "スタッフ用ログイン", exact: true })
      .waitFor();
    assert.match(
      await page
        .getByRole("link", {
          name: "Googleでログインしてカレンダーを許可",
          exact: true,
        })
        .getAttribute("href"),
      /staffShop=story-shop/,
    );
    await open("運営/スタッフ・勤務", "my-photo");
    const self = page.getByRole("region", {
      name: "自分のスタッフ写真",
      exact: true,
    });
    await self.waitFor();
    assert.equal(await page.locator(".staff-accounts").count(), 0);
    await self
      .getByRole("button", { name: "画像をアップロード", exact: true })
      .click();
    await self
      .getByLabel("スタッフ写真（任意）", { exact: true })
      .setInputFiles({
        name: "自分の写真.png",
        mimeType: "image/png",
        buffer: png,
      });
    await self.getByRole("button", { name: "写真を保存", exact: true }).click();
    await self
      .getByRole("status")
      .filter({ hasText: "スタッフ写真を保存" })
      .waitFor();
    await self.locator("img").waitFor();
    await self
      .getByRole("button", { name: "既存の画像から選ぶ", exact: true })
      .click();
    let dialog = page.getByRole("dialog", { name: "画像を選ぶ", exact: true });
    await dialog.waitFor();
    assert.equal(
      await dialog.getByRole("button", { name: /を選択$/ }).count(),
      1,
    );
    assert.equal(
      await dialog
        .getByRole("button", { name: "一覧を更新", exact: true })
        .count(),
      0,
    );
    await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: `tmp/staff-photo-${width}.png`,
      fullPage: true,
    });
    console.log(
      `${width}px: staff registration, removal, login link and own photo verified.`,
    );
    await open("運営/メニュー画像", "editor");
    let editor = page.locator(".menu-image-editor").first();
    await editor
      .getByRole("button", { name: "画像をアップロード", exact: true })
      .waitFor();
    assert.equal(await editor.locator('input[type="file"]').count(), 0);
    await editor
      .getByRole("button", { name: "既存の画像から選ぶ", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "画像を選ぶ", exact: true });
    await dialog
      .getByRole("button", { name: "お店の紹介.pngを選択", exact: true })
      .waitFor();
    await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
    await page
      .locator("aside nav")
      .getByRole("button", { name: /画像管理$/ })
      .click();
    await page
      .getByLabel("画像をアップロード", { exact: true })
      .setInputFiles({
        name: "最新の画像.png",
        mimeType: "image/png",
        buffer: png,
      });
    await page
      .locator("figure")
      .filter({ hasText: "最新の画像.png" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "一覧を更新", exact: true })
        .count(),
      0,
    );
    await page
      .locator("aside nav")
      .getByRole("button", { name: /メニュー・料金$/ })
      .click();
    editor = page.locator(".menu-image-editor").first();
    await editor
      .getByRole("button", { name: "既存の画像から選ぶ", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "画像を選ぶ", exact: true });
    await dialog
      .getByRole("button", { name: "最新の画像.pngを選択", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "この画像を使う", exact: true })
      .click();
    await editor.locator("img").waitFor();
    await editor
      .getByRole("button", { name: "画像をアップロード", exact: true })
      .click();
    await editor
      .getByLabel("メニュー画像（任意）", { exact: true })
      .setInputFiles({
        name: "メニュー用の写真.png",
        mimeType: "image/png",
        buffer: png,
      });
    await page.waitForFunction(
      () =>
        document.querySelector('.menu-image-editor input[type="file"]')
          ?.disabled === false,
    );
    await page
      .locator(".live-settings-menus")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page.getByRole("status").filter({ hasText: "保存して" }).waitFor();
    console.log(
      `${width}px: menu upload/existing choices, picker open refresh and automatic list refresh verified.`,
    );
    await open("運営/画像管理", "library");
    const library = page.getByRole("region", { name: "画像管理", exact: true });
    await library.waitFor();
    for (let index = 1; index <= 16; index++) {
      const name = `添付テスト${String(index).padStart(2, "0")}.png`;
      await library
        .getByLabel("画像をアップロード", { exact: true })
        .setInputFiles({ name, mimeType: "image/png", buffer: png });
      await library.locator("figure").filter({ hasText: name }).waitFor();
    }
    await page
      .locator("aside nav")
      .getByRole("button", { name: /AIとお店をつくる$/ })
      .click();
    await page.getByRole("button", { name: "修正", exact: true }).click();
    await page.getByRole("button", { name: "はじめる", exact: true }).click();
    await page.getByRole("button", { name: "画像を添付", exact: true }).click();
    dialog = page.getByRole("dialog", {
      name: "依頼の画像を選ぶ",
      exact: true,
    });
    await dialog.waitFor();
    assert.ok((await dialog.textContent()).includes("合計75MB"));
    for (let index = 1; index <= 15; index++)
      await dialog
        .getByRole("button", {
          name: `添付テスト${String(index).padStart(2, "0")}.pngを選択`,
          exact: true,
        })
        .click();
    await dialog
      .getByRole("button", { name: "添付テスト16.pngを選択", exact: true })
      .click();
    await dialog.getByRole("alert").filter({ hasText: "15枚まで" }).waitFor();
    assert.equal(await dialog.locator('[aria-pressed="true"]').count(), 15);
    await dialog
      .getByRole("button", { name: "選択した画像を使う", exact: true })
      .click();
    assert.equal(
      await page.locator(".request-image-selection > div").count(),
      15,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `${width}px: 15 selected images accepted; 16th rejected (fixtures).`,
    );
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
