import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, shopSchema } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import { draftKey } from '../src/local-preview.ts';

process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:'), server = createApp(store);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
  await mkdir('tmp/fixture-scope', { recursive: true });
  for (const language of ['ja', 'en']) for (const width of [1280, 390]) {
    const label = text => language === 'en' ? catalog[text] || text : text;
    const shop = await store.createShop(`fixtures-${language}-${width}@example.com`);
    shop.published = shopSchema.parse({ ...sample, pages: [{ id: 'faq', slug: 'faq', title: 'FAQ', navigationLabel: 'FAQ', body: '<p>FAQ sample page</p>', layout: 'standard', imageUrl: '' }] });
    shop.publication = 'public'; await store.saveShop(shop);
    const original = structuredClone(shop.published), key = draftKey(shop.owner, shop.id);
    const token = randomUUID(); await store.put('session', digest(token), { user: { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id }, expires: Date.now() + 600000 });
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
    await context.addCookies([{ name: 'gemihub_session', value: token, url: origin }]);
    const page = await context.newPage(), errors = [], writes = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/')) writes.push(request.url()); });
    const samples = page.locator('.editor-secondary > details').filter({ has: page.locator('summary').filter({ hasText: label('サンプルデータを編集') }) });
    const field = text => samples.getByRole('textbox', { name: label(text), exact: true });
    async function choose(text) {
      if (width <= 760) {
        const toggle = page.locator('.mobile-menu-toggle');
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      }
      await page.getByRole('treeitem', { name: new RegExp('^' + (text === 'FAQ' ? text : label(text))) }).click();
      await expect(page.locator('.editor-toolbar > div > strong')).toHaveText(text === 'FAQ' ? text : label(text));
    }
    async function openSamples() {
      await expect(samples).toHaveCount(1);
      if (await samples.getAttribute('open') === null) await samples.locator(':scope > summary').click();
    }
    async function apply() {
      await samples.getByRole('button', { name: label('サンプルをプレビューに反映'), exact: true }).click();
      await expect(samples.getByRole('button', { name: label('サンプルをプレビューに反映'), exact: true, includeHidden: true })).toBeEnabled();
      await expect(page.getByRole('status').filter({ hasText: label('サンプルデータを保存しました。') })).toBeVisible();
    }
    const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    await page.goto(`${origin}/?tab=try&shop=${shop.id}&screen=reserve&lang=${language}`);
    await expect(page.locator('.local-preview-screen')).toBeVisible();
    await openSamples();
    await expect(field('サンプルのお客様名')).toBeVisible();
    await expect(samples.getByRole('heading', { name: label('サンプル予約'), exact: true })).toBeVisible();
    await expect(samples.getByRole('heading', { name: label('サンプル記事'), exact: true })).toHaveCount(0);
    await expect(field('予約のお名前')).toHaveCount(0);
    await apply(); assert.equal(new URL(page.url()).searchParams.get('screen'), 'reserve');
    const initial = (await read()).fixtures;
    for (const screen of ['お店のこと', 'ページ全体', 'FAQ']) {
      await choose(screen); await expect(samples).toHaveCount(0);
    }
    await choose('ブログ一覧'); await openSamples();
    await expect(field('記事タイトル')).toHaveCount(1); await expect(field('記事の本文')).toHaveCount(0);
    await expect(field('サンプルのお客様名')).toHaveCount(0);
    await expect(field('記事の紹介文')).toHaveCount(0);
    await field('記事タイトル').fill('Scoped blog title'); await apply();
    assert.equal(new URL(page.url()).searchParams.get('screen'), 'blogs');
    await expect(page.locator('.local-preview-screen').getByRole('heading', { name: 'Scoped blog title', exact: true })).toBeVisible();
    await choose('お知らせ一覧'); await openSamples();
    await expect(field('記事タイトル')).toHaveCount(1);
    assert.equal(await field('記事タイトル').inputValue(), initial.posts.find(post => post.category === 'announcements').title);
    const addArticle = samples.getByRole('button', { name: label('サンプル記事を追加'), exact: true });
    const [title, date, picker, add, applyButton] = await Promise.all([
      field('記事タイトル').boundingBox(),
      field('記事の日付').boundingBox(),
      samples.getByRole('button', { name: label('カレンダーで日付を選ぶ'), exact: true }).boundingBox(),
      addArticle.boundingBox(),
      samples.getByRole('button', { name: label('サンプルをプレビューに反映'), exact: true }).boundingBox(),
    ]);
    assert.ok(title && date && picker && add && applyButton, 'sample article controls are visible');
    if (width <= 760) {
      assert.ok(date.y > title.y + title.height && Math.abs(date.x - title.x) < 1, 'article fields stack and share a left edge on mobile');
      assert.ok(Math.abs(picker.x + picker.width - title.x - title.width) < 1, 'the calendar button aligns with the title field’s right edge');
    } else {
      assert.ok(Math.abs(title.y - date.y) < 1 && date.x > title.x + title.width, 'article fields align side by side on desktop');
      assert.ok(title.width > date.width + picker.width, 'the title field has more room than the date controls');
    }
    assert.ok(applyButton.y > add.y + add.height, 'add and apply buttons have vertical space between them');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'the article editor fits the viewport');
    await addArticle.click(); await apply();
    let saved = (await read()).fixtures;
    assert.equal(saved.posts.filter(post => post.category === 'announcements').length, 2);
    assert.equal(saved.posts.find(post => post.category === 'blogs').title, 'Scoped blog title');
    await choose('ブログ記事'); await openSamples();
    await expect(field('記事タイトル')).toHaveCount(1); await expect(field('記事の本文')).toHaveCount(1);
    await field('記事タイトル').fill('Only this article');
    await field('記事の日付').fill('2026/12/01'); await field('記事の日付').blur();
    await field('記事の本文').fill('Only the selected article body changed.'); await apply();
    assert.equal(new URL(page.url()).searchParams.get('screen'), 'blogs:article');
    assert.match(new URL(page.url()).searchParams.get('article'), /^2026-12-01-/);
    await expect(page.locator('.local-preview-screen').getByRole('heading', { name: 'Only this article', exact: true })).toBeVisible();
    await expect(page.locator('.local-preview-screen')).toContainText('Only the selected article body changed.');
    await page.reload();
    await expect(page.locator('.local-preview-screen').getByRole('heading', { name: 'Only this article', exact: true })).toBeVisible();
    await choose('マイページ'); await openSamples();
    await expect(field('サンプルのお客様名')).toBeVisible(); await expect(field('予約のお名前').first()).toBeVisible();
    await expect(field('記事タイトル')).toHaveCount(3); await expect(field('記事の本文')).toHaveCount(0);
    // A retired menu in a hidden booking must not prevent editing a contact-screen sample.
    const draft = await read(); draft.fixtures.bookings[0].menuId = 'retired-menu';
    await page.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), { key, draft });
    await page.goto(`${origin}/?tab=try&shop=${shop.id}&screen=contact&lang=${language}`);
    await expect(page.locator('.local-preview-screen .contact-form')).toBeVisible(); await openSamples();
    await expect(samples.locator('input:not([type="hidden"]):not([aria-hidden="true"])')).toHaveCount(1);
    await expect(field('記事タイトル')).toHaveCount(0);
    await field('サンプルのお客様名').fill('Screen sample customer'); await apply();
    assert.equal(new URL(page.url()).searchParams.get('screen'), 'contact');
    await expect(page.locator('.local-preview-screen .contact-form').getByRole('textbox', { name: label('お名前'), exact: true })).toHaveValue('Screen sample customer');
    saved = (await read()).fixtures;
    assert.deepEqual(saved.bookings, draft.fixtures.bookings); assert.deepEqual(saved.posts, draft.fixtures.posts);
    assert.deepEqual((await store.shop(shop.id)).published, original); assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `tmp/fixture-scope/${language}-${width}-contact.png`, fullPage: true });
    await context.close();
    console.log(`${language} ${width}px: screen-specific fields, hidden sections, category isolation, same-screen apply and article date/URL persistence passed without live writes.`);
  }
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); }
