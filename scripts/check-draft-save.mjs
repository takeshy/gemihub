import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import * as intelligence from '../server/ai.ts';

process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:');
let modelCalls = 0;
const server = createApp(store, { ...intelligence, async articleMetadata() { modelCalls++; throw new Error('Draft saving must not invoke a model'); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
  for (const language of ['ja', 'en']) for (const width of [1280, 390]) {
    const label = text => language === 'en' ? catalog[text] || text : text;
    const shop = await store.createShop(`draft-${language}-${width}@example.com`);
    shop.published = structuredClone(sample); shop.publication = 'public'; await store.saveShop(shop);
    const token = randomUUID(); await store.put('session', digest(token), { user: { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id }, expires: Date.now() + 600000 });
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
    await context.addCookies([{ name: 'gemihub_session', value: token, url: origin }]);
    const page = await context.newPage(), requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/workspace' || path.startsWith(`/api/shops/${shop.id}/posts`)) requests.push(`${request.method()} ${path}`);
    });
    await page.goto(`${origin}/?tab=blog&shop=${shop.id}&lang=${language}`);
    await page.waitForLoadState('networkidle');
    const title = `Fast draft ${language} ${width}`;
    await page.getByLabel(label('タイトル'), { exact: true }).fill(title);
    await page.getByRole('textbox', { name: label('記事の本文'), exact: true }).fill('A draft with no generated introduction.');
    const before = requests.length;
    await page.getByRole('button', { name: label('下書き保存'), exact: true }).click();
    const draft = page.getByRole('region', { name: label('記事の下書き'), exact: true });
    await expect(draft).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: label('下書きを保存しました。お客様にはまだ表示されません。') })).toBeVisible();
    assert.deepEqual(requests.slice(before), [`POST /api/shops/${shop.id}/posts/drafts`], 'save completes with one write and no metadata, list or workspace reload');
    let [post] = await store.records('post', shop);
    assert.equal(post.published, null); assert.equal(post.draft.excerpt, '');
    await draft.getByRole('button', { name: label('編集に戻る'), exact: true }).click();
    await expect(page.locator('.post-management-item').filter({ hasText: title })).toBeVisible();
    await page.getByRole('textbox', { name: label('記事の本文'), exact: true }).fill('Updated draft text.');
    const updateStart = requests.length;
    await page.getByRole('button', { name: label('下書き保存'), exact: true }).click();
    await expect(draft).toBeVisible();
    assert.deepEqual(requests.slice(updateStart), [`POST /api/shops/${shop.id}/posts/${post.id}/draft`]);
    await draft.getByRole('button', { name: label('公開する'), exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: label('下書きを公開しました。') })).toBeVisible();
    [post] = await store.records('post', shop);
    assert.equal(post.published.body, 'Updated draft text.'); assert.equal(post.published.excerpt, '');
    const response = await context.request.get(`${origin}/s/${shop.slug}/${post.published.category}/${post.published.date}-${post.published.slug}?lang=${language}`);
    assert.equal(response.status(), 200); assert.ok((await response.text()).includes('Updated draft text.'));
    assert.equal(modelCalls, 0); assert.deepEqual(errors, []);
    await context.close();
    console.log(`${language} ${width}px: one-request draft creation/update, local list update and separate publication passed without metadata AI.`);
  }
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); }
