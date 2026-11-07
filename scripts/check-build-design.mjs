import assert from 'node:assert/strict';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, shopSchema, planSummary } from '../server/domain.ts';
import { standardTheme } from '../shared/theme-editing.ts';
import { proposeVisualAppearance } from '../server/visual.ts';
import { digest } from '../server/auth.ts';
import * as intelligence from '../server/ai.ts';

process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:');
let identified = 0;
const sharedCss = 'button.primary{background:#783b65;border-radius:24px} input{border:2px solid #783b65}';
const server = createApp(store, {
  ...intelligence,
  visualReview: async () => ({ approved: true, issues: [] }),
  identifyVisual: async (media, targets, _instruction, screen) => {
    assert.deepEqual(targets.map(target => target.id), ['theme']);
    assert.equal(screen.id, 'theme'); assert.ok(media.data.length > 1000);
    const { data, info } = await sharp(Buffer.from(media.data, 'base64')).raw().toBuffer({ resolveWithObject: true });
    let red = 0;
    for (let offset = 0; offset < data.length; offset += info.channels) if (data[offset] > 180 && data[offset + 1] < 80 && data[offset + 2] < 100) red++;
    assert.ok(red > 100, 'the actual red annotation reaches the AI request'); identified++;
    return { ids: ['theme'], explanation: 'Update shared component styles.' };
  },
  visualAppearance: (config, instruction, images, options) => proposeVisualAppearance(config, instruction, images, {
    ...options, generate: async () => JSON.stringify({ appearance: { theme: { css: sharedCss } } }),
  }),
  explainSystem: async () => ({ answer: 'Review the new page and overall design.', changeRequest: true, ready: true }),
  propose: async (_text, current) => {
    const config = shopSchema.parse({ ...current,
      pages: [...current.pages.map(page => ({ ...page, body: '<h2>Updated content</h2>' })), { id: 'new-page', slug: 'new-page', title: 'New FAQ', navigationLabel: 'New FAQ', body: '<h2>New FAQ</h2>', css: '', layout: 'standard', imageUrl: '' }],
      appearance: { ...current.appearance, accent: 'navy', theme: { ...standardTheme, css: sharedCss }, articles: { blogs: false, announcements: true } },
    });
    return { config, summary: planSummary(current, config) };
  },
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
await mkdir('tmp/build-design', { recursive: true });
let page;
try {
  for (const language of ['ja', 'en']) for (const width of [1280, 390]) {
    const label = text => language === 'en' ? catalog[text] || text : text;
    const shop = await store.createShop(`build-design-${language}-${width}@example.com`);
    shop.published = shopSchema.parse({ ...structuredClone(sample), pages: [{ id: 'existing-page', slug: 'existing-page', title: 'Existing page', navigationLabel: 'Existing page', body: '<h2>Existing content</h2>', layout: 'standard', imageUrl: '' }], appearance: { accent: 'sage', layout: 'standard', imageUrl: '', theme: standardTheme, articles: { blogs: true, announcements: false } } });
    await store.saveShop(shop);
    const cookie = randomUUID();
    await store.put('session', digest(cookie), { user: { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id }, expires: Date.now() + 3600000 });
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
    await context.addCookies([{ name: 'gemihub_session', value: cookie, url: origin }]);
    page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const navigate = async title => {
      if (width < 760) await page.locator('.mobile-menu-toggle').click();
      await page.locator('aside nav').getByRole('button', { name: new RegExp(label(title) + '$') }).click();
    };
    await page.goto(`${origin}/?tab=build&lang=${language}`);
    const preview = page.locator('.shop-theme-editor .local-preview-screen');
    await expect(preview.locator('.theme-placeholder input')).toBeVisible();
    await expect(page.getByRole('treeitem', { name: label('ページ全体'), exact: true })).toHaveCount(0);
    await expect(preview.locator('.theme-preview')).toHaveAttribute('inert', '');
    await page.screenshot({ path: `tmp/build-design/current-${language}-${width}.png`, fullPage: true });

    await page.locator('.shop-theme-editor .editor-pen-button').click();
    const canvas = page.locator('.annotation-canvas'), chat = page.locator('.visual-chat-panel');
    await expect(canvas).toBeVisible(); await expect(chat).toBeVisible();
    if (width > 1000) {
      const left = await canvas.boundingBox(), right = await chat.boundingBox();
      assert.ok(left.x + left.width <= right.x + 1, 'editing chat is to the right of the image');
    }
    await canvas.evaluate(element => element.scrollIntoView({ block: 'start' }));
    const rect = await canvas.boundingBox();
    await page.mouse.move(rect.x + 20, rect.y + 30); await page.mouse.down();
    await page.mouse.move(rect.x + 100, rect.y + 60); await page.mouse.up();
    await chat.getByRole('textbox', { name: label('ここをどう変えたいですか'), exact: true }).fill('Round the primary buttons and make them purple across all screens.');
    await chat.getByRole('textbox', { name: label('ここをどう変えたいですか'), exact: true }).press('Control+Enter');
    const review = page.getByRole('dialog', { name: label('修正案を比較'), exact: true });
    await expect(review).toBeVisible();
    await expect(review.locator('.theme-placeholder')).toHaveCount(2);
    await review.getByRole('button', { name: 'OK', exact: true }).click();
    await chat.getByRole('button', { name: label('閉じる'), exact: true }).click();
    await expect(preview).toBeVisible();
    await expect(preview.locator('button.primary')).toHaveCSS('background-color', 'rgb(120, 59, 101)');
    assert.deepEqual((await store.shop(shop.id)).published, shop.published, 'pen edits stay local until approval');

    await navigate('画面を試す・編集');
    await expect(page.locator('.local-preview-screen button.primary').first()).toHaveCSS('background-color', 'rgb(120, 59, 101)');
    await navigate('AIとお店をつくる');
    await expect(preview.locator('button.primary')).toHaveCSS('background-color', 'rgb(120, 59, 101)');
    await page.reload();
    await expect(preview.locator('button.primary')).toHaveCSS('background-color', 'rgb(120, 59, 101)');

    const consultation = page.locator('.shop-consultation');
    await consultation.getByRole('button', { name: label('はじめる'), exact: true }).click();
    const composer = consultation.getByRole('textbox', { name: label('AIに伝えたいこと'), exact: true });
    await composer.fill('Add an FAQ page and update the overall design.'); await composer.press('Control+Enter');
    await consultation.getByRole('button', { name: label('変更案を確認する'), exact: true }).click();
    const proposal = consultation.getByRole('region', { name: label('変更案の確認'), exact: true });
    await expect(proposal.locator('.config-summary')).toHaveCount(0);
    await expect(proposal.locator('.screen-name-list li').filter({ hasText: 'New FAQ' })).toContainText(label('追加'));
    await expect(proposal.locator('.screen-name-list .screen-removed')).toHaveCount(2);
    await expect(proposal.locator('.screen-name-list li').filter({ hasText: 'Existing page' })).toContainText(label('変更'));
    await expect(proposal).toContainText(label('ページ全体のデザインに変更があります。変更前と変更後を切り替えて確認できます。'));
    const after = proposal.locator('.theme-placeholder button.primary');
    await expect(after).toHaveCSS('background-color', 'rgb(120, 59, 101)');
    await proposal.getByRole('button', { name: label('変更前'), exact: true }).click();
    await expect(after).not.toHaveCSS('background-color', 'rgb(120, 59, 101)');
    await proposal.getByRole('button', { name: label('変更後'), exact: true }).click();
    await expect(after).toHaveCSS('background-color', 'rgb(120, 59, 101)');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page fits the viewport');
    await page.screenshot({ path: `tmp/build-design/proposal-${language}-${width}.png`, fullPage: true });
    assert.deepEqual((await store.shop(shop.id)).published, shop.published);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${language} ${width}px: red pen, side chat, shared styles on real screens, preserved local draft and proposal screen/design review passed.`);
  }
  assert.equal(identified, 4);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: 'tmp/build-design/failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); await store.close();
}
