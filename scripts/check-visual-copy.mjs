import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, shopSchema } from '../server/domain.ts';
import * as intelligence from '../server/ai.ts';
import { proposeVisualAppearance } from '../server/visual.ts';
import { digest } from '../server/auth.ts';

process.env.DEMO_MODE = 'true';
delete process.env.GOOGLE_CLOUD_PROJECT;
const store = new Store(':memory:');
const server = createApp(store, { ...intelligence, visualReview: async () => ({approved:true,issues:[]}),
  async identifyVisual(_media, targets, instruction, screen) {
    const target = /配置/.test(instruction) ? `screen:${screen.id}` : 'copy:recentPosts';
    assert.ok(targets.some(candidate => candidate.id === target), `the AI can select ${target}`);
    assert.ok(!targets.some(candidate => candidate.id === 'screen:contact'), 'another screen is outside the selection');
    return { ids: [target], explanation: '指定された見出しや配置を変更できます。' };
  },
  async visualAppearance(current, instruction, images, options) {
    const patch = options.target === 'copy:recentPosts'
      ? { appearance: { copy: { recentPosts: 'アトリエからのお知らせ' } } }
      : { screens: { mine: { html: '<section class="news-layout"><h2>ようこそアトリエへ</h2><slot name="news"></slot><slot name="mypage"></slot></section>', css: '.news-layout { display: grid; gap: 28px; }' } } };
    return proposeVisualAppearance(current, instruction, images, { ...options, generate: async () => JSON.stringify(patch) });
  },
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
await mkdir('tmp/visual-copy', { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
  for (const width of [1280, 390]) {
    const shop = await store.createShop(`copy-${width}@example.com`);
    shop.published = shopSchema.parse(structuredClone(sample));
    shop.publication = 'public';
    await store.saveShop(shop);
    const token = `copy-${width}`;
    await store.put('session', digest(token), { user: { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id }, expires: Date.now() + 3600000 });
    const article = { category: 'blogs', title: '本日のアトリエ', date: '2030-01-01', slug: 'today', excerpt: '', body: 'お待ちしています。' };
    await store.put('post', `post-${width}`, { id: `post-${width}`, shopId: shop.id, draft: article, published: article, version: 1, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z', publishedAt: '2030-01-01T00:00:00Z', updatedBy: shop.owner });
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: 'ja-JP' });
    await context.addCookies([{ name: 'gemihub_session', value: token, url: origin }]);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?lang=ja`);
    if (width <= 760) await page.locator('.mobile-menu-toggle').click();
    await page.locator('aside nav').getByRole('button', { name: /画面を試す・編集$/ }).click();
    if (width <= 760) await page.locator('.mobile-menu-toggle').click();
    await page.getByRole('treeitem', { name: 'マイページ', exact: true }).click();
    const preview = page.locator('.local-preview-screen');
    await expect(preview.getByRole('heading', { name: 'お店からのお便り', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '修正する', exact: true }).click();
    const chat = page.getByRole('complementary', { name: '画面の修正チャット' });
    await chat.getByRole('textbox', { name: 'ここをどう変えたいですか', exact: true }).fill('「お店からのお便り」を「アトリエからのお知らせ」に変えてください。');
    await chat.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByRole('dialog', { name: '修正案を比較', exact: true }).getByRole('button', { name: 'OK', exact: true }).click();
    await expect(preview.getByRole('heading', { name: 'アトリエからのお知らせ', exact: true })).toBeVisible();
    assert.equal((await store.shop(shop.id)).published.appearance?.copy, undefined, 'the edit stays unpublished');
    await page.getByRole('button', { name: '前の状態に戻る', exact: true }).click();
    await expect(preview.getByRole('heading', { name: 'お店からのお便り', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '次の状態に進む', exact: true }).click();
    await chat.getByRole('textbox', { name: 'ここをどう変えたいですか', exact: true }).fill('マイページの配置をゆったりさせて、歓迎の見出しを追加してください。');
    await chat.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByRole('dialog', { name: '修正案を比較', exact: true }).getByRole('button', { name: 'OK', exact: true }).click();
    await expect(preview.getByRole('heading', { name: 'ようこそアトリエへ', exact: true })).toBeVisible();
    await expect(preview.getByRole('heading', { name: 'アトリエからのお知らせ', exact: true })).toBeVisible();
    await expect(preview.getByRole('heading', { name: 'あなたのご予約', exact: true })).toBeVisible();
    await chat.getByRole('button', { name: '閉じる', exact: true }).click();
    // Reproduce a cached baseline whose business settings predate the current menu.
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find(key => key.startsWith('gemihub:local-preview:'));
      const draft = JSON.parse(localStorage.getItem(key));
      draft.source.menus[0].name = 'OLD_MENU_MUST_NOT_APPEAR';
      draft.source.staff[0].name = 'OLD_STAFF_MUST_NOT_APPEAR';
      draft.fixtures.customerName = '比較用のお客様';
      draft.fixtures.posts[0].title = '同じ記事サンプル';
      localStorage.setItem(key, JSON.stringify(draft));
    });
    await page.reload();
    await expect(preview.getByRole('heading', { name: 'アトリエからのお知らせ', exact: true })).toBeVisible();
    await expect(preview.getByRole('heading', { name: 'ようこそアトリエへ', exact: true })).toBeVisible();
    await page.screenshot({ path: `tmp/visual-copy/preview-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '変更を比較', exact: true }).click();
    const comparison = page.getByRole('region', { name: '変更内容の比較' });
    const before = comparison.locator('.conflict-columns > div').nth(1);
    const after = comparison.locator('.conflict-columns > div').nth(0);
    await expect(after.getByRole('heading', { name: 'アトリエからのお知らせ', exact: true })).toBeVisible();
    await expect(before.getByRole('heading', { name: 'お店からのお便り', exact: true })).toBeVisible();
    assert.equal(await before.getByRole('heading', { name: 'ようこそアトリエへ', exact: true }).count(), 0, 'the published side does not inherit the local layout');
    await expect(after.getByRole('heading', { name: 'ようこそアトリエへ', exact: true })).toBeVisible();
    for (const side of [before, after]) {
      await expect(side.getByRole('heading', { name: 'あなたのご予約', exact: true })).toBeVisible();
      await expect(side).toContainText('比較用のお客様');
      await expect(side).toContainText('同じ記事サンプル');
      assert.equal(await side.locator('.site-header').count(), 0, 'header visibility matches the editing screen');
      assert.doesNotMatch(await side.innerText(), /OLD_MENU|OLD_STAFF/);
    }
    assert.equal(await before.locator('.booking-card').innerText(), await after.locator('.booking-card').innerText(), 'both sides use the same reservation and current menu');
    assert.equal(await before.locator('.recent-post-list').innerText(), await after.locator('.recent-post-list').innerText(), 'both sides use the same articles');
    await page.screenshot({ path: `tmp/visual-copy/comparison-${width}.png`, fullPage: true });
    await comparison.getByRole('button', { name: '比較を閉じる', exact: true }).click();
    if (width <= 760) await page.locator('.mobile-menu-toggle').click();
    await page.getByRole('treeitem', { name: /^ブログ記事/ }).click();
    await expect(preview.locator('.post-content h1')).toHaveText('同じ記事サンプル');
    await page.getByRole('button', { name: '変更を比較', exact: true }).click();
    for (const side of [before, after]) await expect(side.locator('.post-content h1')).toHaveText('同じ記事サンプル');
    await comparison.getByRole('button', { name: '比較を閉じる', exact: true }).click();
    await page.getByRole('button', { name: '反映する', exact: true }).click();
    await page.getByRole('button', { name: 'この内容を本番に反映', exact: true }).click();
    await expect.poll(async () => (await store.shop(shop.id)).published.appearance?.copy?.recentPosts).toBe('アトリエからのお知らせ');
    assert.deepEqual((await store.shop(shop.id)).published.rules, shop.published.rules);
    const publicHtml = await (await fetch(`${origin}/s/${shop.slug}?lang=ja`)).text();
    assert.match(publicHtml, /アトリエからのお知らせ/);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${width}px: heading/layout selection, undo/redo, reload, matching comparison data and article, required components and explicit publication passed.`);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await store.close();
}
