import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, shopSchema } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import { exampleTheme } from '../src/stories/themes.ts';
import { defaultAppearance } from '../shared/theme-editing.ts';
import { draftKey } from '../src/local-preview.ts';

process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:'), server = createApp(store);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
  await mkdir('tmp/theme-editors', { recursive: true });
  for (const language of ['ja', 'en']) for (const width of [1280, 390]) {
    const label = text => language === 'en' ? catalog[text] || text : text;
    const shop = await store.createShop(`theme-editor-${language}-${width}@example.com`);
    shop.published = JSON.parse(JSON.stringify(shopSchema.parse({ ...sample, appearance: { ...defaultAppearance, theme: exampleTheme } }), (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value));
    shop.publication = 'public'; await store.saveShop(shop);
    const token = randomUUID(); await store.put('session', digest(token), { user: { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id }, expires: Date.now() + 600000 });
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
    await context.addCookies([{ name: 'gemihub_session', value: token, url: origin }]);
    const page = await context.newPage(), errors = [], writes = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
    const storageKey = draftKey(shop.owner, shop.id);
    const readDraft = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    const preview = page.locator('.local-preview-screen');
    const treeitem = text => page.getByRole('treeitem', { name: new RegExp('^' + label(text)), includeHidden: true });
    async function choose(text) {
      if (width <= 760) {
        const toggle = page.locator('.mobile-menu-toggle');
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      }
      await treeitem(text).click();
      await expect(page.locator('.editor-toolbar > div > strong')).toHaveText(label(text));
    }
    const area = text => page.getByRole('textbox', { name: label(text), exact: true });
    async function openPart(part) {
      await choose(part === 'header' ? 'ヘッダー' : 'フッター');
      await page.locator('summary').filter({ hasText: label(part === 'header' ? 'ヘッダーの HTML を編集' : 'フッターの HTML を編集') }).click();
    }
    async function apply({ valid = true, unchanged = false } = {}) {
      await page.getByRole('button', { name: label('プレビューに反映'), exact: true }).click();
      if (!valid) return;
      await expect(page.getByRole('status').filter({ hasText: label(unchanged ? 'プレビューは編集内容と同じです。変更はありません。' : '編集内容をプレビューに反映しました。') })).toBeInViewport();
      await expect(preview).toBeFocused();
      await expect.poll(() => preview.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
      await expect(preview).toBeInViewport();
    }
    async function discardHeader() {
      const trigger = page.locator('.editor-toolbar').getByRole('button', { name: label('変更を取り消す'), exact: true });
      const dialog = page.getByRole('dialog', { name: label('この画面の変更を取り消す'), exact: true });
      const before = await readDraft();
      await trigger.click();
      await expect(dialog).toBeInViewport(); await expect(dialog.getByRole('heading')).toBeFocused();
      await expect(dialog.getByRole('button', { name: label('この画面の変更を取り消す'), exact: true })).toBeInViewport();
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
      assert.deepEqual((await readDraft()).config, before.config, 'cancelling does not discard edits');
      await trigger.click(); await dialog.getByRole('button', { name: label('戻る'), exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await trigger.click();
      let failRead;
      await page.route(`**/api/shops/${shop.id}/local-editor/shared`, async route => {
        await new Promise(resolve => { failRead = resolve; });
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary discard failure' }) });
      }, { times: 1 });
      await dialog.getByRole('button', { name: label('この画面の変更を取り消す'), exact: true }).click();
      await expect.poll(() => typeof failRead).toBe('function');
      await expect(dialog.getByRole('status')).toHaveText(label('変更を取り消しています…'));
      await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); failRead();
      await expect(dialog.getByRole('alert')).toHaveText('Temporary discard failure');
      await expect(dialog.getByRole('alert')).toBeInViewport();
      assert.deepEqual((await readDraft()).config, before.config, 'failed reads retain edits');
      await page.screenshot({ path: `tmp/theme-editors/${language}-${width}-discard.png`, fullPage: false });
      await dialog.getByRole('button', { name: label('この画面の変更を取り消す'), exact: true }).click();
      await expect(dialog).toHaveCount(0); await expect(trigger).toHaveCount(0);
      await expect(page.locator('.editor-toolbar .editor-change-badge')).toHaveCount(0);
      await expect(treeitem('ヘッダー').locator('.sync-badge')).toHaveCount(0);
      const after = await readDraft();
      assert.equal(after.config.appearance.theme.headerHtml, exampleTheme.headerHtml);
      assert.equal(after.config.appearance.theme.footerHtml, before.config.appearance.theme.footerHtml);
      assert.equal(after.config.appearance.theme.css, before.config.appearance.theme.css);
      assert.deepEqual(after.fixtures, before.fixtures, 'discarding a part keeps sample data');
      assert.equal(writes.length, 0, 'discarding local changes never writes to production');
    }
    let publication = 0;
    async function publish() {
      publication++;
      await expect(page.locator('.editor-toolbar .primary')).toBeEnabled();
      await page.locator('.editor-toolbar .primary').click();
      const review = page.getByRole('dialog', { name: label('本番への反映内容'), exact: true });
      await expect(review).toBeInViewport();
      await expect(review.getByRole('button', { name: label('この内容を本番に反映'), exact: true })).toBeInViewport();
      await expect(review.getByRole('heading')).toBeFocused();
      const revision = (await store.shop(shop.id)).revision;
      if (publication === 1) {
        await page.keyboard.press('Escape'); await expect(review).toHaveCount(0);
        await expect(page.locator('.editor-toolbar .primary')).toBeFocused();
        assert.equal((await store.shop(shop.id)).revision, revision, 'opening or cancelling the review cannot publish');
        await page.locator('.editor-toolbar .primary').click();
        // A failed request must be visible inside the modal and remain retryable.
        let failPlan;
        await page.route(`**/api/shops/${shop.id}/plan`, async route => {
          await new Promise(resolve => { failPlan = resolve; });
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary publication failure' }) });
        }, { times: 1 });
        await review.getByRole('button', { name: label('この内容を本番に反映'), exact: true }).click();
        await expect.poll(() => typeof failPlan).toBe('function');
        await expect(review.getByRole('status')).toHaveText(label('本番に反映しています…このままお待ちください。'));
        await expect(review.getByRole('button', { name: label('この内容を本番に反映'), exact: true })).toBeDisabled();
        await page.keyboard.press('Escape'); await expect(review).toBeVisible();
        failPlan();
        await expect(review.getByRole('alert')).toHaveText('Temporary publication failure');
        await expect(review.getByRole('alert')).toBeInViewport();
        await expect(review.getByRole('button', { name: label('この内容を本番に反映'), exact: true })).toBeEnabled();
        assert.equal((await store.shop(shop.id)).revision, revision);
      }
      await page.screenshot({ path: `tmp/theme-editors/${language}-${width}-release.png`, fullPage: false });
      await review.getByRole('button', { name: label('この内容を本番に反映'), exact: true }).click();
      await expect(review).toHaveCount(0);
      await expect(page.locator('.editor-toolbar .primary')).toHaveCount(0);
      assert.equal((await store.shop(shop.id)).revision, revision + 1, 'confirmed publication runs once');
    }
    await page.goto(`${origin}/?tab=try&shop=${shop.id}&screen=about&lang=${language}`);
    await expect(preview).toBeVisible();
    await expect(page.locator('.editor-toolbar .editor-change-badge')).toHaveCount(0);
    await expect(page.locator('.screen-tree .sync-badge')).toHaveCount(0);
    // Recover the old failed no-change attempt, including a stale baseline whose local
    // content was already published elsewhere. Reordered keys alone are not changes.
    await expect.poll(async () => !!await readDraft()).toBe(true);
    const cached = await readDraft();
    cached.source.description = 'An obsolete baseline';
    cached.pending = { requestId: randomUUID(), config: structuredClone(cached.config), scope: { kind: 'shared' } };
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: cached });
    await page.reload();
    await expect(preview).toBeVisible();
    await expect.poll(async () => (await readDraft()).pending).toBe(undefined);
    await expect.poll(async () => (await readDraft()).source.description).toBe(shop.published.description);
    await expect(page.locator('.editor-toolbar .editor-change-badge')).toHaveCount(0);
    await expect(page.locator('.editor-toolbar .primary')).toHaveCount(0);
    await expect(page.locator('.screen-tree .sync-badge')).toHaveCount(0);
    assert.equal(writes.length, 0, 'matching production does not create a publication request');
    await expect(page.getByText(label('ヘッダー・フッター・全体の枠の HTML を編集'), { exact: true })).toHaveCount(0);
    await openPart('header');
    await expect(area('ヘッダーの HTML')).toHaveValue(exampleTheme.headerHtml);
    await apply({ unchanged: true });
    await expect(page.locator('.editor-toolbar .editor-change-badge')).toHaveCount(0);
    await expect(treeitem('ヘッダー').locator('.sync-badge')).toHaveCount(0);
    await expect(page.locator('.editor-toolbar .primary')).toHaveCount(0);
    await expect(area('フッターの HTML')).toHaveCount(0);
    await expect(area('全体の CSS（ヘッダー・枠・フッター共通）')).toHaveCount(0);
    await area('ヘッダーの HTML').fill('<script>alert(1)</script>');
    await apply({ valid: false }); await expect(page.locator('.design-editor [role="alert"]')).toBeInViewport();
    await expect(area('ヘッダーの HTML')).toHaveValue('<script>alert(1)</script>');
    assert.equal((await readDraft()).config.appearance.theme.headerHtml, exampleTheme.headerHtml, 'invalid HTML retains the previous preview');
    const headerHtml = '<header class="theme-masthead"><h2>EDITED HEADER</h2><slot name="navigation"></slot></header>';
    await area('ヘッダーの HTML').fill(headerHtml);
    await expect(preview.getByRole('heading', { name: 'EDITED HEADER' })).toHaveCount(0);
    await apply();
    await expect(preview.getByRole('heading', { name: 'EDITED HEADER' })).toBeVisible();
    await expect(preview.getByRole('heading', { name: 'EDITED HEADER' })).toBeInViewport();
    await page.screenshot({ path: `tmp/theme-editors/${language}-${width}-applied.png`, fullPage: false });
    assert.equal((await store.shop(shop.id)).published.appearance.theme.headerHtml, exampleTheme.headerHtml, 'preview edits remain local');
    await openPart('footer');
    const footerHtml = '<footer class="theme-footer"><h2>EDITED FOOTER</h2><slot name="content"></slot></footer>';
    await area('フッターの HTML').fill(footerHtml); await apply();
    await expect(preview.getByRole('heading', { name: 'EDITED FOOTER' })).toBeVisible();
    await choose('全体の枠');
    await expect(area('ヘッダーの HTML')).toHaveCount(0); await expect(area('フッターの HTML')).toHaveCount(0);
    await expect(preview.getByRole('heading', { name: 'EDITED HEADER' })).toBeVisible();
    await expect(preview.getByRole('heading', { name: 'EDITED FOOTER' })).toBeVisible();
    const bodyHtml = '<main class="edited-frame"><h2>EDITED FRAME</h2><slot name="content"></slot></main>';
    const css = exampleTheme.css + '\n.edited-frame{padding:20px;background:#f0f5ef}';
    await area('全体の枠の HTML').fill(bodyHtml);
    await area('全体の CSS（ヘッダー・枠・フッター共通）').fill(css.replace('padding:20px', 'padding:10px')); await apply();
    await expect(preview.getByRole('heading', { name: 'EDITED FRAME' })).toBeVisible();
    await expect(preview.locator('.edited-frame')).toHaveCSS('padding-top', '10px');
    await area('全体の CSS（ヘッダー・枠・フッター共通）').fill(css); await apply();
    await expect(preview.locator('.edited-frame')).toHaveCSS('padding-top', '20px');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'editor fits the viewport');
    await page.screenshot({ path: `tmp/theme-editors/${language}-${width}-frame.png`, fullPage: true });
    await choose('ヘッダー'); await discardHeader();
    await openPart('header'); await area('ヘッダーの HTML').fill(headerHtml); await apply();
    await expect(page.locator('.editor-toolbar .editor-change-badge')).toBeVisible();
    await expect(treeitem('ヘッダー').locator('.sync-badge')).toHaveText(label('未反映'));
    await publish();
    let live = (await store.shop(shop.id)).published.appearance.theme;
    assert.equal(live.headerHtml, headerHtml); assert.equal(live.footerHtml, exampleTheme.footerHtml);
    assert.equal(live.bodyHtml, exampleTheme.bodyHtml); assert.equal(live.css, exampleTheme.css);
    await openPart('footer'); await expect(area('フッターの HTML')).toHaveValue(footerHtml); await publish();
    live = (await store.shop(shop.id)).published.appearance.theme;
    assert.equal(live.headerHtml, headerHtml); assert.equal(live.footerHtml, footerHtml); assert.equal(live.css, exampleTheme.css);
    await choose('全体の枠');
    await expect(area('全体の枠の HTML')).toHaveValue(bodyHtml); await expect(area('全体の CSS（ヘッダー・枠・フッター共通）')).toHaveValue(css);
    await publish();
    live = (await store.shop(shop.id)).published.appearance.theme;
    assert.deepEqual(live, { headerHtml, footerHtml, bodyHtml, css });
    await choose('お店のこと');
    await page.locator('summary').filter({ hasText: label('この画面の HTML を編集') }).click();
    await page.getByRole('button', { name: label('この画面を HTML で作る'), exact: true }).click();
    await area('この画面の HTML').fill('<section><h2>EDITED ABOUT HTML</h2><slot name="menus"></slot></section>');
    await apply(); await expect(preview.getByRole('heading', { name: 'EDITED ABOUT HTML' })).toBeVisible();
    await expect(preview.getByRole('heading', { name: 'EDITED ABOUT HTML' })).toBeInViewport();
    await publish();
    assert.ok((await store.shop(shop.id)).published.screens.about.html.includes('EDITED ABOUT HTML'));
    await choose('全体の枠');
    await page.reload();
    await expect(page.locator('.editor-toolbar > div > strong')).toHaveText(label('全体の枠'));
    await expect(area('全体の枠の HTML')).toHaveValue(bodyHtml);
    const response = await context.request.get(`${origin}/s/${shop.slug}?lang=${language}`);
    assert.equal(response.status(), 200); const html = await response.text();
    for (const text of ['EDITED HEADER', 'EDITED FOOTER', 'EDITED FRAME']) assert.ok(html.includes(text), 'published storefront contains the selected edits');
    assert.deepEqual(errors, []); await context.close();
    console.log(`${language} ${width}px: HTML preview/publication, visible modal review, cancellation/focus, error retry, isolated parts and URL reload passed.`);
  }
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); }
