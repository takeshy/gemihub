import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import { postKey } from '../server/post-domain.ts';

process.env.DEMO_MODE = 'true';
const store = new Store(':memory:'), shop = await store.createShop('access-owner@example.com');
shop.published = structuredClone(sample); shop.publication = 'public'; await store.saveShop(shop);
const posts = ['blogs', 'announcements'].map(category => {
  const content = { category, title: `${category} article`, slug: 'hello', date: '2026-11-06', excerpt: 'Hello', body: '<p>Hello readers</p>' }, at = new Date().toISOString();
  return { id: randomUUID(), shopId: shop.id, draft: content, published: content, publishedAt: at, version: 1, createdAt: at, updatedAt: at, updatedBy: shop.owner };
});
for (const post of posts) await store.put('post', post.id, post);
const server = createApp(store); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
await mkdir('tmp/site-access', { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
  const errors = [], urls = posts.map(post => `${origin}/s/${shop.slug}/${post.published.category}/${postKey(post.published)}`);
  const visit = async (page, url) => {
    const recorded = page.waitForResponse(response => response.url().endsWith('/page-views') && response.request().method() === 'POST');
    await page.goto(url); assert.equal((await recorded).status(), 200);
  };
  const first = await browser.newContext(), page = await first.newPage(); page.on('pageerror', error => errors.push(error.message));
  await visit(page, `${origin}/s/${shop.slug}`);
  await visit(page, urls[0]); await visit(page, urls[0]); await visit(page, urls[1]);
  await visit(page, `${origin}/s/${shop.slug}?pane=reserve`);
  const visitor = await page.evaluate(slug => JSON.parse(localStorage.getItem(`gemihub:visitor:${slug}`)).id, shop.slug);
  assert.match(visitor, /^[a-f0-9-]{36}$/);
  const second = await browser.newContext(), secondPage = await second.newPage();
  await visit(secondPage, urls[0]);
  const noStorage = await browser.newContext();
  await noStorage.addInitScript(() => { for (const method of ['getItem', 'setItem']) Storage.prototype[method] = () => { throw new Error('storage disabled'); }; });
  const blockedPage = await noStorage.newPage(); await visit(blockedPage, urls[1]); await visit(blockedPage, urls[1]);

  const owner = await browser.newContext();
  await owner.request.post(`${origin}/api/demo-login`, { headers: { Origin: origin }, data: { role: 'owner', email: shop.owner, shopId: shop.id } });
  const get = async path => { const response = await owner.request.get(`${origin}/api/shops/${shop.id}/${path}`); assert.equal(response.status(), 200); return response.json(); };
  const articles = await get('posts/access?days=7'), traffic = await get('access?days=7');
  assert.equal(articles.rows.find(row => row.postId === posts[0].id).views, 3);
  assert.equal(articles.rows.find(row => row.postId === posts[0].id).uniqueBrowsers, 2);
  assert.equal(articles.rows.find(row => row.postId === posts[1].id).views, 3);
  assert.equal(articles.rows.find(row => row.postId === posts[1].id).uniqueBrowsers, 1);
  assert.equal(traffic.rows[0].views, 8); assert.equal(traffic.rows[0].uniqueBrowsers, 2);
  const ownerArticle = await owner.newPage(); await visit(ownerArticle, urls[0]);
  assert.equal((await get('access?days=7')).totalViews, traffic.totalViews, 'owner visits are excluded');

  for (const [language, width] of [['ja', 1280], ['en', 390]]) {
    const admin = await owner.newPage(); await admin.setViewportSize({ width, height: 1000 }); admin.on('pageerror', error => errors.push(error.message));
    await admin.goto(`${origin}/?shop=${shop.id}&lang=${language}`);
    if (width < 600) await admin.locator('.mobile-menu-toggle').click();
    await admin.getByRole('button', { name: language === 'ja' ? /お客様$/ : /Customers$/ }).click();
    const panel = admin.getByRole('region', { name: language === 'ja' ? 'お店のアクセス数' : 'Shop traffic', exact: true });
    await panel.locator('summary').click();
    await expect(panel.locator('tbody tr').first()).toContainText('8');
    await panel.getByLabel(language === 'ja' ? 'アクセス数の集計期間' : 'Traffic period', { exact: true }).selectOption('7');
    await expect(panel.locator('tbody tr')).toHaveCount(7);
    await panel.getByLabel(language === 'ja' ? '表示する集計' : 'Report', { exact: true }).selectOption('articles');
    await expect(panel.locator('tbody tr')).toHaveCount(2);
    await expect(panel).toContainText('blogs article'); await expect(panel).toContainText('announcements article');
    await panel.scrollIntoViewIfNeeded(); await admin.screenshot({ path: `tmp/site-access/articles-${language}-${width}.png` });
    await panel.getByLabel(language === 'ja' ? '表示する集計' : 'Report', { exact: true }).selectOption('daily');
    await expect(panel.locator('tbody tr')).toHaveCount(7);
    await admin.screenshot({ path: `tmp/site-access/daily-${language}-${width}.png` });
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page overflow');
    await admin.close();
  }
  assert.deepEqual(errors, []);
  console.log('Anonymous/repeat/new-browser/storage-disabled traffic → daily PV/unique browsers → article PV/unique browsers → Japanese desktop and English mobile CRM passed.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await store.close(); }
