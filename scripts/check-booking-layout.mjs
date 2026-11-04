import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { digest } from '../server/auth.ts';
import { optionShop } from '../tests/fixtures/option-shop.ts';
import { exampleTheme } from '../src/stories/themes.ts';

process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
const store = new Store(':memory:'), server = createApp(store);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
const config = optionShop();
config.menus = [
  { id: 'hand', name: 'マニキュア　爪の形成磨き　ポリッシュワンカラー', duration: 30, price: 2000, active: true },
  { id: 'foot', name: 'BEBECARE（フットケア）LongUnbrokenServiceName', duration: 90, price: 10000, active: true, imageId: 'a'.repeat(64) },
];
config.appearance = { accent: 'sage', layout: 'standard', imageUrl: '', theme: { ...exampleTheme, css: exampleTheme.css + ' .theme-page{font-size:18px}.menu-options button,.time-grid button{font-size:18px}.menu-options b,.menu-options strong{font-size:inherit}' } };
config.screens = { reserve: { html: '<section class="booking-frame"><slot name="booking"></slot></section>', css: '.booking-frame{display:grid;gap:16px;padding:16px}' } };
const shop = await store.createShop('layout-owner@example.com'); shop.published = config; shop.publication = 'public'; await store.saveShop(shop);
for (const [token, role, email] of [['owner', 'owner', shop.owner], ['customer', 'customer', 'layout-customer@example.com']]) {
  await store.put('session', digest(token), { user: { email, name: 'Layout user', role, shopId: shop.id }, expires: Date.now() + 3600000 });
}
await store.put('customer', `${shop.id}:layout-customer@example.com`, { shopId: shop.id, email: 'layout-customer@example.com', name: 'Layout user', birthDate: '1990-01-01', gender: 'not_specified' });
await mkdir('tmp/booking-layout', { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
  for (const language of ['ja', 'en']) for (const mode of ['customer', 'editor']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
    await context.addCookies([{ name: 'gemihub_session', value: mode === 'editor' ? 'owner' : 'customer', url: origin }]);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/menu-images/**', route => route.fulfill({ json: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR5nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=' } }));
    await page.goto(mode === 'editor' ? `${origin}/?shop=${shop.id}&tab=try&lang=${language}` : `${origin}/s/${shop.slug}?pane=reserve&lang=${language}`);
    await expect(page.locator('.time-grid button').first()).toBeVisible();
    for (const width of [320, 390, 640, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      // An editor can also be narrower than its browser (for example, beside a chat panel).
      if (mode === 'editor' && width === 1280) await page.addStyleTag({ content: '.workspace{max-width:600px}' });
      await page.screenshot({ path: `tmp/booking-layout/${language}-${mode}-${width}.png`, fullPage: true });
      const clipped = await page.locator('.reservation-layout').evaluate(root => {
        const targets = root.querySelectorAll('.menu-options button,.date-input-controls,.date-input-controls button,.time-grid button,.field input,.field textarea');
        return [...targets].flatMap(element => {
          const rect = element.getBoundingClientRect();
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const bounds = parent.getBoundingClientRect(), style = getComputedStyle(parent);
            if (parent === root || style.contain.includes('paint') || ['hidden', 'clip'].includes(style.overflowX)) {
              if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) return [{ text: element.textContent, className: element.className, right: rect.right, boundary: bounds.right }];
            }
          }
          return [];
        });
      });
      assert.deepEqual(clipped, [], `${language} ${mode} ${width}px: all booking controls fit their visible boundaries`);
      const overflowing = await page.locator('.menu-options b,.menu-options strong,.time-grid button').evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));
      assert.deepEqual(overflowing, [], `${language} ${mode} ${width}px: labels and times fit inside their controls`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${language} ${mode} ${width}px: no horizontal page overflow`);
    }
    await page.locator('.menu-options button').last().click();
    await page.locator('.time-grid button').first().click();
    await expect(page.locator('.time-grid button.selected')).toHaveCount(1);
    assert.deepEqual(errors, []); await context.close();
    console.log(`${language} ${mode}: booking fits phone, tablet and narrow desktop containers; menu and time selection work.`);
  }
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); }
