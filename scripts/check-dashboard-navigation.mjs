import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, shopSchema } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import { requestLocale } from '../server/i18n.ts';
import { draftKey } from '../src/local-preview.ts';
process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:'), server = createApp(store);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
const owner = 'history-owner@example.com';
const shops = [];
for (let i = 0; i < 3; i++) {
 const shop = await store.createShop(i ? `history-other-${i}@example.com` : owner);
 shop.owner = owner;
 shop.published = requestLocale.run('ja', () => shopSchema.parse(structuredClone(sample)));
 shop.published.name = `History shop ${i + 1}`;
 shop.published.pages = [{ id: 'faq', title: 'FAQ', navigationLabel: 'FAQ', slug: 'faq', body: '<p>History navigation FAQ</p>', layout: 'standard', imageUrl: '' }];
 shop.publication = i === 2 ? 'provisional' : 'public'; await store.saveShop(shop); shops.push(shop);
 await store.put('customer', `${shop.id}:guest@example.com`, { shopId: shop.id, email: 'guest@example.com', name: 'History guest' });
 const content = { category: 'blogs', date: '2026-11-01', slug: 'history-post', title: 'Exact history article', excerpt: 'History test', body: 'An exact article restored from its URL.' };
 const at = '2026-11-01T00:00:00Z';
 await store.put('post', `${shop.id}:history-post`, { id: 'history-post', shopId: shop.id, draft: content, published: content, version: 1, createdAt: at, updatedAt: at, updatedBy: owner, publishedAt: at });
}
const token = randomUUID(); await store.put('session', digest(token), { user: { email: owner, name: 'Owner', role: 'owner', shopId: shops[0].id }, expires: Date.now() + 3600000 });
let browser;
try {
 browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
 await mkdir('tmp/dashboard-navigation', { recursive: true });
 for (const language of ['ja', 'en']) for (const width of [1280, 390]) {
  const label = text => language === 'en' ? catalog[text] || text : text;
  const context = await browser.newContext({ viewport: { width, height: 950 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
  await context.addCookies([{ name: 'gemihub_session', value: token, url: origin }]);
  const page = await context.newPage(), errors = [], documents = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url()); });
  const nav = page.locator('aside nav');
  const item = text => nav.getByRole('button', { name: new RegExp(label(text) + '$') });
  const query = () => new URL(page.url()).searchParams;
  const tab = async value => { await expect.poll(() => query().get('tab')).toBe(value); assert.equal(query().get('lang'), language); };
  await page.goto(`${origin}/?lang=${language}&shop=${shops[0].id}&tab=basic`);
  await expect(page.locator('.live-settings-basic')).toBeVisible();
  const originalHistoryLength = await page.evaluate(() => history.length);
  await item('お店の基本情報').click();
  assert.equal(await page.evaluate(() => history.length), originalHistoryLength, 'query parameter order does not create duplicate history');
  const loaded = documents.length;
  for (const [name, id, selector] of [['メニュー・料金', 'menus', '.live-settings-menus'], ['スタッフ・勤務', 'staff', '.live-settings-staff'], ['画像管理', 'images', '.image-library'], ['公開の設定', 'settings', '.shop-export'], ['お店の基本情報', 'basic', '.live-settings-basic']]) {
   await item(name).click(); await tab(id); await expect(page.locator(selector).first()).toBeVisible(); assert.equal(query().get('shop'), shops[0].id);
  }
  assert.equal(documents.length, loaded, 'menu navigation must not reload the document');
  await page.goBack(); await tab('settings'); await expect(page.locator('.shop-export')).toBeVisible();
  await page.goBack(); await tab('images'); await expect(page.locator('.image-library')).toBeVisible();
  await page.goForward(); await tab('settings'); await expect(page.locator('.shop-export')).toBeVisible();
  const sameHistoryLength = await page.evaluate(() => history.length);
  await item('公開の設定').click(); assert.equal(await page.evaluate(() => history.length), sameHistoryLength, 'repeat menu clicks do not create duplicate history');
  for (const [id, selector] of [['menus', '.live-settings-menus'], ['images', '.image-library'], ['settings', '.shop-export'], ['blog', '.blog-editor-layout'], ['manual', '.manual']]) {
   await page.goto(`${origin}/?lang=${language}&shop=${shops[0].id}&tab=${id}`);
   await expect(page.locator(selector).first()).toBeVisible(); await page.reload(); await expect(page.locator(selector).first()).toBeVisible(); await tab(id);
  }
  // Restoring the bare root must use the default editor, not the tab used at initial load.
  await page.goto(`${origin}/?lang=${language}`); await expect(page.locator('.local-preview-screen').first()).toBeVisible();
  await item('メニュー・料金').click(); await tab('menus'); await page.goBack(); await expect(page.locator('.local-preview-screen').first()).toBeVisible(); assert.equal(query().get('tab'), null);
  // A history transition must not recreate the editor or erase locally saved drafts.
  const localKey = draftKey(owner, shops[0].id);
  await page.waitForFunction(key => !!localStorage.getItem(key), localKey);
  const draft = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), localKey);
  draft.config.description = 'Preserve the local draft across browser history.';
  await page.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), { key: localKey, draft });
  await page.reload();
  const screen = name => nav.getByRole('treeitem', { name: new RegExp('^' + label(name)) });
  await screen('お店のこと').click(); await tab('try'); await expect.poll(() => query().get('screen')).toBe('about'); await expect(screen('お店のこと')).toHaveAttribute('aria-selected', 'true');
  await screen('お問い合わせ').click(); await expect.poll(() => query().get('screen')).toBe('contact'); await expect(screen('お問い合わせ')).toHaveAttribute('aria-selected', 'true');
  await page.goBack(); await expect.poll(() => query().get('screen')).toBe('about'); await expect(screen('お店のこと')).toHaveAttribute('aria-selected', 'true');
  await page.goForward(); await expect(screen('お問い合わせ')).toHaveAttribute('aria-selected', 'true');
  await item('メニュー・料金').click(); await tab('menus'); await page.goBack(); await tab('try'); await expect(screen('お問い合わせ')).toHaveAttribute('aria-selected', 'true');
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).config.description, localKey), draft.config.description);
  await page.reload(); await expect(screen('お問い合わせ')).toHaveAttribute('aria-selected', 'true');
  await screen('ヘッダー').click(); await expect.poll(() => query().get('screen')).toBe('part:header'); await page.reload(); await expect(screen('ヘッダー')).toHaveAttribute('aria-selected', 'true');
  await nav.getByRole('treeitem', { name: 'FAQ', exact: true }).click(); await expect.poll(() => query().get('screen')).toBe('page:faq'); await page.reload(); await expect(page.locator('.local-preview-screen')).toContainText('History navigation FAQ');
  const editorUrl = page.url();
  // Exact articles and customer deep links remain compatible with old URL shapes.
  await page.goto(`${origin}/?lang=${language}&shop=${shops[0].id}&tab=try&screen=blogs:article&article=2026-11-01-history-post`);
  await expect(page.locator('.local-preview-screen')).toContainText('Exact history article');
  await screen('ブログ一覧').click(); await expect.poll(() => query().get('article')).toBe(null); await page.goBack(); await expect(page.locator('.local-preview-screen')).toContainText('Exact history article');
  await page.goto(`${origin}/?lang=${language}&shop=${shops[0].id}&customer=guest@example.com&customerView=images&inquiry=old`);
  await expect(page.locator('.customer-image-gallery')).toBeVisible(); await item('メニュー・料金').click(); await tab('menus'); assert.equal(query().get('customer'), null); assert.equal(query().get('inquiry'), null);
  await page.goBack(); await expect(page.locator('.customer-image-gallery')).toBeVisible(); assert.equal(query().get('customer'), 'guest@example.com');
  // Shop choice is part of the URL and is restored by back/forward and reload.
  await page.goto(editorUrl); await expect(page.locator('.local-preview-screen')).toContainText('History navigation FAQ');
  await page.locator('aside > select').selectOption(shops[1].id); await expect.poll(() => query().get('shop')).toBe(shops[1].id); await expect.poll(() => query().get('screen')).toBe('reserve');
  await page.goBack(); await expect.poll(() => query().get('shop')).toBe(shops[0].id); await expect(page.locator('.local-preview-screen')).toContainText('History navigation FAQ');
  await page.goForward(); await page.reload(); await expect(page.locator('aside > select')).toHaveValue(shops[1].id);
  // Hidden pre-publication pages resolve to an available destination without adding a history entry.
  await page.goto(`${origin}/?lang=${language}&shop=${shops[2].id}&tab=bookings`); await tab('try'); await expect(page.locator('.local-preview-screen').first()).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `tmp/dashboard-navigation/${language}-${width}.png`, fullPage: true });
  assert.deepEqual(errors, []); await context.close(); console.log(`${language} ${width}px: tab/screen/shop URLs, back/forward, direct links, reload, draft preservation and publication guards passed.`);
 }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await store.close(); }
