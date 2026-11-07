import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import sharp from 'sharp';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, shopSchema } from '../server/domain.ts';
import * as intelligence from '../server/ai.ts';
import { proposeVisualAppearance } from '../server/visual.ts';
import { standardTheme } from '../shared/theme-editing.ts';
import { digest } from '../server/auth.ts';

process.env.DEMO_MODE = 'true';
delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:');
let annotated, failNext = false, generations = 0;
const server = createApp(store, { ...intelligence,
  async identifyVisual(media, targets) {
    assert.ok(targets.some(t => t.id === 'part:header'));
    assert.ok(targets.some(t => t.id === 'copy:navReserve'), 'header navigation has a precise text target');
    assert.ok(!targets.some(t => t.id === 'screen:reserve'));
    annotated = media;
    const { data, info } = await sharp(Buffer.from(media.data, 'base64')).raw().toBuffer({ resolveWithObject: true });
    let red = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i] > 180 && data[i+1] < 80 && data[i+2] < 100) red++;
    assert.ok(red > 100, 'the AI receives the actual red marks');
    return { ids: ['part:header'], explanation: 'Header navigation' };
  },
  async visualAppearance(current, instruction, images, options) {
    assert.deepEqual(options.media, annotated, 'generation and each refinement receive the same annotated pixels');
    if (failNext) { failNext = false; throw Object.assign(new Error('Retry this proposal'), { status: 400 }); }
    const refining = instruction.includes('24');
    if (refining) {
      assert.equal(current.appearance.copy.navReserve, 'Reserve a visit', 'refinement starts from the unaccepted proposal');
      assert.match(instruction, /do not apply these again:\n.*Reserve a visit[\s\S]*New request:\nMake the menu gap 24 pixels\.$/, 'applied requests are context, not new work');
    }
    generations++;
    return proposeVisualAppearance(current, instruction, images, { ...options, generate: async input => {
      assert.deepEqual(input.contents[0].parts.at(-1), { inlineData: annotated });
      return JSON.stringify({ appearance: { copy: { navReserve: 'Reserve a visit' }, theme: {
        headerHtml: standardTheme.headerHtml,
        headerCss: `.public-nav{gap:${refining ? 24 : 12}px}`,
      } } });
    } });
  },
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
await mkdir('tmp/visual-header', { recursive: true });
let browser, active;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
  for (const [language, width] of [['ja', 1280], ['en', 390]]) {
    const label = text => language === 'en' ? catalog[text] || text : text;
    const shop = await store.createShop(`header-${width}@example.com`);
    shop.published = shopSchema.parse({ ...structuredClone(sample), appearance: { accent: 'sage', layout: 'standard', imageUrl: '', theme: standardTheme } });
    await store.saveShop(shop);
    const session = randomUUID();
    await store.put('session', digest(session), { user: { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id }, expires: Date.now() + 600000 });
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    await context.addCookies([{ name: 'gemihub_session', value: session, url: origin }]);
    const page = await context.newPage(); active = page;
    page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?lang=${language}`);
    if (width < 760) await page.locator('.mobile-menu-toggle').click();
    await page.locator('aside nav').getByRole('button', { name: new RegExp(label('画面を試す・編集') + '$') }).click();
    await expect(page.locator('.local-preview-screen')).toBeVisible();
    if (width < 760) await page.locator('.mobile-menu-toggle').click();
    await page.getByRole('treeitem', { name: new RegExp('^' + label('ヘッダー')) }).click();
    const draft = () => page.evaluate(() => {
      const key = Object.keys(localStorage).find(key => key.startsWith('gemihub:local-preview:'));
      return JSON.parse(localStorage.getItem(key));
    });
    const original = (await draft()).config;
    const begin = async () => {
      await page.getByRole('button', { name: label('修正する'), exact: true }).click();
      const canvas = page.locator('.annotation-canvas');
      await expect.poll(() => canvas.evaluate(el => el.height)).toBeGreaterThan(100);
      const bounds = await canvas.boundingBox();
      await page.mouse.move(bounds.x+20, bounds.y+30); await page.mouse.down();
      await page.mouse.move(bounds.x+180, bounds.y+30); await page.mouse.move(bounds.x+180, bounds.y+80); await page.mouse.up();
      const chat = page.locator('.visual-chat-panel');
      await chat.getByRole('textbox').fill('Change the circled menu to Reserve a visit.');
      await chat.getByRole('button', { name: label('送信'), exact: true }).click();
      await chat.getByRole('button', { name: label('この箇所を修正する'), exact: true }).click();
      const review = page.getByRole('dialog', { name: label('修正案を比較'), exact: true });
      await expect(review).toBeVisible();
      await expect(review.getByRole('region', { name: label('修正案'), exact: true }).locator('.public-nav')).toContainText('Reserve a visit');
      assert.deepEqual((await draft()).config, original, 'a generated proposal does not change local storage');
      return review;
    };
    let review = await begin();
    await page.screenshot({ path: `tmp/visual-header/review-${language}-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
    await review.getByRole('button', { name: label('キャンセル'), exact: true }).click();
    assert.deepEqual((await draft()).config, original, 'cancel discards the proposal');
    assert.deepEqual((await store.shop(shop.id)).published, shop.published);
    review = await begin();
    await review.getByRole('button', { name: label('さらに変更'), exact: true }).click();
    const refinement = review.getByRole('textbox', { name: label('さらに変更したいこと'), exact: true });
    await refinement.fill('Make the menu gap 24 pixels.');
    failNext = true;
    await review.getByRole('button', { name: label('修正案を更新'), exact: true }).click();
    await expect(review.getByRole('alert')).toHaveText('Retry this proposal');
    await expect(refinement).toHaveValue('Make the menu gap 24 pixels.');
    await review.getByRole('button', { name: label('修正案を更新'), exact: true }).click();
    await expect(review.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => review.getByRole('region', { name: label('修正案'), exact: true }).locator('.public-nav').evaluate(el => getComputedStyle(el).gap)).toBe('24px');
    assert.deepEqual((await draft()).config, original, 'refinements stay unaccepted');
    const count = generations;
    await review.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(review).toHaveCount(0);
    assert.equal((await draft()).config.appearance.copy.navReserve, 'Reserve a visit');
    assert.equal(generations, count, 'OK does not run the AI again');
    assert.deepEqual((await store.shop(shop.id)).published, shop.published, 'OK does not publish');
    await page.locator('.visual-chat-panel').getByRole('button', { name: label('閉じる'), exact: true }).click();
    await page.locator('.editor-secondary').getByText(label('ヘッダーの HTML を編集'), { exact: true }).click();
    const css = page.getByRole('textbox', { name: label('ヘッダー専用の CSS'), exact: true });
    await expect(css).toHaveValue('.public-nav{gap:24px}');
    await page.getByRole('button', { name: label('前の状態に戻る'), exact: true }).click();
    assert.deepEqual((await draft()).config, original, 'undo returns to the original version in one step');
    await expect(css).toHaveValue('');
    await page.getByRole('button', { name: label('次の状態に進む'), exact: true }).click();
    await expect(css).toHaveValue('.public-nav{gap:24px}');
    await page.getByRole('button', { name: label('反映する'), exact: true }).click();
    await page.getByRole('button', { name: label('この内容を本番に反映'), exact: true }).click();
    await expect.poll(async () => (await store.shop(shop.id)).published.appearance.copy?.navReserve).toBe('Reserve a visit');
    const published = (await store.shop(shop.id)).published;
    assert.equal(published.appearance.theme.headerCss, '.public-nav{gap:24px}');
    for (const key of ['rules', 'menus', 'staff', 'hours', 'footer']) assert.deepEqual(published[key], original[key]);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${language} ${width}px: red marks reach generation/refinement, HTML comparison, cancel, retry, OK, undo/redo and header-only publication passed.`);
  }
} catch (error) {
  if (active && !active.isClosed()) await active.screenshot({ path: 'tmp/visual-header/failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); await store.close();
}
