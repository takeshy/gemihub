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
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
    args: ["--no-sandbox"],
  });
  const origin = process.env.STORYBOOK_URL || `http://127.0.0.1:${server.address().port}`;
  const index = process.env.STORYBOOK_URL ? await (await fetch(`${origin}/index.json`)).json() : JSON.parse(await readFile(resolve(root,"index.json"),"utf8"));
  const entries = Object.values(index.entries);
  const entry = entries.find((entry) => entry.id.endsWith("--blog-editor"));
  assert.ok(entry);
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
    const open = async () => {
      await page.goto(
        `${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story`,
      );
      await page
        .getByRole("heading", { name: "新しいお便りを書く", exact: true })
        .waitFor();
    };
    const assertSidebarLayout = async () => {
      const panel = page.locator('.article-ai-chat');
      const panelBounds = await panel.boundingBox(), editorBounds = await page.locator('.post-editor').boundingBox();
      const viewport = page.viewportSize();
      assert.ok(panelBounds.x >= 0 && panelBounds.x + panelBounds.width <= viewport.width + 1, 'AI panel fits the viewport');
      if (viewport.width >= 1000) assert.ok(editorBounds.x + editorBounds.width <= panelBounds.x + 1, 'article and right sidebar remain side by side');
      else assert.ok(panelBounds.y > 0 && Math.abs(panelBounds.y + panelBounds.height - viewport.height) < 2, 'phone uses the existing bottom panel layout');
      const actions = await panel.locator('.article-composer-actions > button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().toJSON()));
      assert.ok(Math.abs(actions[0].top - actions[1].top) < 1 && actions[0].right <= actions[1].left, 'attachment and send controls share a row without overlap');
      const formBounds = await panel.locator('form').boundingBox();
      assert.ok(actions.every(action => action.top >= formBounds.y - 1 && action.bottom <= formBounds.y + formBounds.height + 1), 'attachment and send buttons remain fully visible inside the composer');
      const overflow = await page.locator('.post-editor input,.post-editor select,.article-ai-chat textarea,.article-ai-chat select,.article-composer-actions > button').evaluateAll(elements => elements.filter(element => {
        if (!element.checkVisibility()) return false;
        const rect = element.getBoundingClientRect(), parent = element.closest('.article-ai-chat,.post-editor').getBoundingClientRect();
        return rect.right > parent.right + 1 || rect.left < parent.left - 1;
      }).map(element => element.className));
      assert.deepEqual(overflow, [], 'metadata and sidebar controls fit their panels');
      const focus = await panel.locator('.article-ai-composer').evaluate(form => {
        const input = form.querySelector('textarea'), style = getComputedStyle(input), rect = input.getBoundingClientRect(), bounds = form.getBoundingClientRect();
        const ring = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
        return { focused: document.activeElement === input, left: rect.left - ring, right: rect.right + ring, top: rect.top - ring, bottom: rect.bottom + ring, clipLeft: bounds.left + form.clientLeft, clipRight: bounds.left + form.clientLeft + form.clientWidth, clipTop: bounds.top + form.clientTop, clipBottom: bounds.top + form.clientTop + form.clientHeight };
      });
      if (focus.focused) assert.ok(focus.left >= focus.clipLeft - 1 && focus.right <= focus.clipRight + 1 && focus.top >= focus.clipTop - 1 && focus.bottom <= focus.clipBottom + 1, `the complete input focus ring fits the scroll area: ${JSON.stringify(focus)}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    };
    const openEditorImage = async () => {
      const toolbar = page.locator('.article-wysimark');
      const image = toolbar.getByRole('button', { name: '画像', exact: true });
      if (await image.isVisible()) await image.click();
      else {
        await toolbar.getByRole('button', { name: '挿入', exact: true }).click();
        await page.locator('.--title').filter({ hasText: /^画像$/ }).click();
      }
      await page.getByRole('button', { name: '登録', exact: true }).waitFor();
    };
    await open();
    assert.equal(await page.getByRole('button', { name: '＋ 新しい記事', exact: true }).count(), 0);
    assert.equal(
      await page.getByText("メモから下書きを作る", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "一覧を更新", exact: true })
        .count(),
      0,
    );
    const textMode = page.getByRole('button', { name: 'テキスト', exact: true });
    const visualMode = page.getByRole('button', { name: 'リッチテキスト', exact: true });
    assert.equal(await textMode.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('textbox', { name: 'AIに伝える内容', exact: true }).count(), 0);
    await page.getByText('まずは自分の言葉で書いてみましょう。書いた文章はAIで清書できます。', { exact: true }).waitFor();
    const textEditor = page.getByRole('textbox', { name: '記事の本文', exact: true });
    await page.getByLabel('タイトル', { exact: true }).fill(`自分で書いた記事${width}`);
    await textEditor.fill('自分の言葉で書いたお便りです。');
    const preview = page.getByRole('region', { name: '記事のプレビュー', exact: true });
    await preview.getByText('自分の言葉で書いたお便りです。', { exact: true }).waitFor();
    // Add two images in separate uploads, then select an existing one in Wysimark.
    // Previously added images and text must survive every upload and mode switch.
    for (const name of ['テキスト画像1.png', 'テキスト画像2.png']) {
      await page.getByRole('button', { name: '画像を追加', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '記事に使う画像', exact: true });
      await dialog.getByRole('button', { name: '画像をアップロード', exact: true }).click();
      await dialog.locator('input[type="file"]').setInputFiles({
        name,
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      });
      await dialog.waitFor({ state: 'detached' });
      await preview.locator('.article-managed-image').last().scrollIntoViewIfNeeded();
      await preview.getByRole('img', { name: `${name}の画像`, exact: true }).waitFor();
    }
    assert.equal(await preview.locator('.article-managed-image').count(), 2);
    const uploadedBody = await textEditor.inputValue();
    assert.ok(uploadedBody.includes('自分の言葉で書いたお便りです。'));
    await visualMode.click();
    await page.locator('.article-wysimark [contenteditable="true"]').waitFor();
    await textMode.click();
    assert.equal(await textEditor.inputValue(), uploadedBody);
    await page.screenshot({ path: `tmp/article-text-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '保存して本番に反映しました' }).waitFor();
    await page.getByRole('heading', { name: '記事を編集する', exact: true }).waitFor();
    await visualMode.click();
    assert.equal(await page.getByRole('button', { name: '画像を挿入', exact: true }).count(), 0);
    assert.equal(await page.getByText('記事の紹介文とアドレスは、保存時にAIが自動で作成します。既存記事のアドレスは維持します。', { exact: true }).count(), 0);
    let editor = page.locator('.article-wysimark [contenteditable="true"]');
    await editor.waitFor();
    await page
      .getByLabel("タイトル", { exact: true })
      .fill(`自分で書いた記事${width}`);
    await editor.click();
    await editor.press('Control+End');
    await editor.press('Enter');
    await editor.press('Enter');
    await editor.pressSequentially("今月もご来店をお待ちしています。");
    await preview
      .getByText("今月もご来店をお待ちしています。", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByLabel("記事のアドレス（英小文字・数字・ハイフン）", {
          exact: true,
        })
        .count(),
      0,
    );
    assert.equal(
      await page.getByLabel("短い紹介（一覧に表示）", { exact: true }).count(),
      0,
    );
    await openEditorImage();
    await page.getByRole('radio', { name: 'アップロード済み', exact: true }).check();
    await page.getByRole('button', { name: 'アップロード済み', exact: true }).click();
    let chooser = page.getByRole("dialog", {
      name: "記事に使う画像",
      exact: true,
    });
    await chooser
      .getByRole("button", { name: "既存の画像から選ぶ", exact: true })
      .click();
    let picker = page.getByRole("dialog", { name: "画像を選ぶ", exact: true });
    await picker
      .getByRole("button", { name: "お店の紹介.pngを選択", exact: true })
      .click();
    await picker
      .getByRole("button", { name: "この画像を使う", exact: true })
      .click();
    await chooser.waitFor({ state: "detached" });
    await page.getByRole('button', { name: '登録', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.post-preview .article-managed-image').length === 3);
    await preview.locator(".article-managed-image").last().scrollIntoViewIfNeeded();
    await preview.locator(".article-managed-image").last().locator("img").waitFor();
    await openEditorImage();
    await page.getByRole('radio', { name: 'アップロード', exact: true }).check();
    await page.locator('input[type="file"][accept="image/*"]')
      .setInputFiles({
        name: "記事にアップロード.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await page.getByRole('button', { name: '登録', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.post-preview .article-managed-image').length === 4);
    await preview.locator(".article-managed-image").last().scrollIntoViewIfNeeded();
    await preview.locator(".article-managed-image").last().locator("img").waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: `tmp/article-write-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "保存して本番に反映しました" })
      .waitFor();
    await page.locator('.post-editor').getByRole('button', { name: '新しいお便りを書く', exact: true }).click();
    await page.getByRole('heading', { name: '新しいお便りを書く', exact: true }).waitFor();
    assert.equal(await page.getByLabel('タイトル', { exact: true }).inputValue(), '', 'new authoring starts with an empty title');
    assert.equal(await textEditor.inputValue(), '', 'new authoring starts with an empty body');
    assert.equal(await textMode.getAttribute('aria-pressed'), 'true');
    await page.locator('.post-management-item').filter({ hasText: `自分で書いた記事${width}` }).click();
    await page.getByLabel('タイトル', { exact: true }).waitFor();
    await page.locator(".post-published-note").getByRole("link").click();
    await page
      .locator(".article-page")
      .getByRole("heading", { name: `自分で書いた記事${width}`, exact: true })
      .waitFor();
    await page.locator(".article-page .article-managed-image").nth(1).scrollIntoViewIfNeeded();
    await page.locator(".article-page .article-managed-image").nth(1).locator("img").waitFor();
    for (const name of ['テキスト画像1.png', 'テキスト画像2.png']) {
      await page.locator('.article-page').getByRole('img', { name: `${name}の画像`, exact: true }).waitFor();
    }
    console.log(
      `${width}px: text default, repeated uploads, mode switches, Wysimark, preview and text/visual saves with published images verified.`,
    );
    await open();
    await textEditor.fill('清書したい文章です。');
    const originalDraft = await textEditor.inputValue();
    await page.getByRole('button', { name: 'AIで清書する', exact: true }).click();
    await page.locator('.article-ai-chat').waitFor();
    assert.equal(await page.locator('.post-management-list').count(), 0, 'AI authoring hides the article list');
    const previewBounds = await preview.boundingBox(), mainEditorBounds = await page.locator('.post-editor').boundingBox();
    assert.ok(previewBounds.y >= 0 && previewBounds.y < mainEditorBounds.y, 'AI authoring brings the current preview to the top');
    const articleBounds = await preview.getByText(originalDraft, { exact: true }).boundingBox(), aiBounds = await page.locator('.article-ai-chat').boundingBox();
    assert.ok(articleBounds.y >= 0 && articleBounds.y + articleBounds.height < (width < 1000 ? aiBounds.y : 900), 'the article text is visible alongside the AI conversation');
    assert.equal(await textEditor.inputValue(), originalDraft, 'article remains editable while AI is open');
    const pendingRequest = 'この依頼は閉じても保持します。';
    await page.getByRole('textbox', { name: 'AIに伝える内容', exact: true }).fill(pendingRequest);
    await assertSidebarLayout();
    await page.keyboard.press('Escape');
    await page.locator('.article-ai-chat').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.post-management-list').isVisible(), true, 'closing AI restores the article list');
    assert.equal(await page.evaluate(() => document.body.classList.contains('article-ai-open')), false);
    await page.getByRole('button', { name: 'AIで清書する', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'AIに伝える内容', exact: true }).inputValue(), pendingRequest);
    await page.getByRole('button', { name: '自分で編集する', exact: true }).click();
    assert.equal(await textEditor.inputValue(), originalDraft, 'opening AI and returning preserves the draft');
    await page.getByRole('button', { name: 'AIで清書する', exact: true }).click();
    const composer = page.getByRole("textbox", {
      name: "AIに伝える内容",
      exact: true,
    });
    await composer.fill("写真を使ってお店のお知らせを書いてください。");
    await page.getByRole("button", { name: /画像を添付$/ }).click();
    chooser = page.getByRole("dialog", { name: "記事に使う画像", exact: true });
    await chooser
      .getByRole("button", { name: "既存の画像から選ぶ", exact: true })
      .click();
    picker = page.getByRole("dialog", { name: "画像を選ぶ", exact: true });
    await picker
      .getByRole("button", { name: "お店の紹介.pngを選択", exact: true })
      .click();
    await picker
      .getByRole("button", { name: "この画像を使う", exact: true })
      .click();
    await chooser.waitFor({ state: "detached" });
    assert.ok((await composer.inputValue()).includes("[[images/"));
    await page.locator('.article-ai-references summary').click();
    await page
      .getByRole("combobox", { name: "記事の参照ファイル", exact: true })
      .selectOption("spec.md");
    assert.ok((await composer.inputValue()).includes("[[spec.md]]"));
    await page.waitForFunction(() => {
      const form = document.querySelector('.article-ai-composer');
      return form.querySelector('label').getBoundingClientRect().top >= form.getBoundingClientRect().top - 1;
    });
    await assertSidebarLayout();
    await page.screenshot({ path: `tmp/article-ai-sidebar-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "送信する", exact: true }).click();
    await page
      .getByRole("log", { name: "記事の依頼", exact: true })
      .getByText(
        "記事の案を作成しました。下のプレビューを確認してください。追加の依頼もできます。",
        { exact: true },
      )
      .waitFor();
    await preview.locator(".article-managed-image").first().scrollIntoViewIfNeeded();
    await preview.locator(".article-managed-image").first().locator("img").waitFor();
    assert.ok((await textEditor.inputValue()).includes(originalDraft), 'AI updates the visible article without hiding its editor');
    await page
      .getByRole("button", { name: "自分で編集する", exact: true })
      .click();
    await textEditor.waitFor();
    assert.ok((await textEditor.inputValue()).includes(originalDraft), 'AI receives the manually written source');
    await visualMode.click();
    editor = page.locator('.article-wysimark [contenteditable="true"]');
    await editor.waitFor();
    assert.ok((await editor.textContent()).includes(originalDraft));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: `tmp/article-ai-${width}.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:en`);
    await page.getByRole('button', { name: 'Polish with AI', exact: true }).click();
    await page.locator('.article-ai-chat').waitFor();
    await assertSidebarLayout();
    for (const size of width < 1000 ? [{ width: 320, height: 900 }, { width: 390, height: 500 }] : [{ width: 1280, height: 500 }]) {
      await page.setViewportSize(size);
      await page.locator('.article-ai-chat textarea').fill('Keep the full input outline visible.');
      await assertSidebarLayout();
      const bottom = await page.locator('.article-ai-chat').evaluate(panel => {
        const form = panel.querySelector('form').getBoundingClientRect(), bounds = panel.getBoundingClientRect();
        return bounds.bottom - form.bottom;
      });
      assert.ok(bottom >= 19, 'composer keeps clear of the bottom edge on short screens');
      await page.locator('.article-ai-chat').screenshot({ path: `tmp/article-ai-panel-${size.width}-${size.height}.png` });
    }
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.article-ai-chat .visual-chat-heading button').click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('article-ai-open')), false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `${width}px: AI composer, image wiki paths, reference file and switch to direct editing verified (fixtures).`,
    );
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
