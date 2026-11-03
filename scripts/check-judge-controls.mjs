import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import { Store } from '../server/store.ts';

process.env.NODE_ENV = 'production';
process.env.DEMO_MODE = 'false';
process.env.JUDGE_INVITE = 'judge-controls-browser-test-invitation';
process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:'), server = createApp(store);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
  await mkdir('tmp/judge-controls', { recursive: true });
  for (const language of ['ja', 'en']) for (const width of [1280, 390]) {
    const label = text => language === 'en' ? catalog[text] || text : text;
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
    const started = await context.request.post(`${origin}/api/judge/start?lang=${language}`, { headers: { Origin: origin }, data: { invite: process.env.JUDGE_INVITE } });
    assert.equal(started.status(), 200);
    const { user: owner } = await (await context.request.get(`${origin}/api/session`)).json();
    const shop = await store.shop(owner.shopId);
    shop.published = structuredClone(sample); shop.publication = 'public';
    await store.saveShop(shop);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    const header = page.locator('.app-header');
    const menu = header.locator('a[href="/judge-menu"]');
    const banner = page.locator('.judge-banner');
    const bar = page.locator('.judge-bar');
    const toggle = () => page.keyboard.press('Control+Shift+L');
    await page.goto(`${origin}/?lang=${language}`);
    await expect(header).toContainText('John');
    await expect(menu).toHaveCount(0); await expect(banner).toHaveCount(0);
    await page.keyboard.press('Control+Shift+Alt+L'); await expect(menu).toHaveCount(0);
    await toggle(); await expect(menu).toBeVisible(); await expect(banner).toBeVisible();
    await expect(header).toContainText(owner.name); await expect(header).not.toContainText('John');
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true, repeat: true })));
    await expect(menu).toBeVisible();
    await toggle(); await expect(menu).toHaveCount(0); await expect(banner).toHaveCount(0); await expect(header).toContainText('John');
    await page.reload(); await expect(header).toContainText('John'); await expect(menu).toHaveCount(0);
    await page.screenshot({ path: `tmp/judge-controls/owner-${language}-${width}.png`, fullPage: true });
    assert.equal((await store.get('user', owner.email)).name, owner.name, 'the display alias never overwrites the judge account');

    // The same shortcut exposes customer switching on the real storefront.
    await page.goto(`${origin}/s/${shop.slug}?pane=about&lang=${language}`);
    await expect(page.locator('.public-nav')).toBeVisible(); await expect(bar).toHaveCount(0);
    await toggle(); await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: label('お客様として試す'), exact: true }).click();
    const registration = page.locator('.customer-registration');
    await expect(registration).toBeVisible();
    await expect(registration.getByLabel(label('お名前'), { exact: true })).toHaveValue('John');
    await expect(bar).toHaveCount(0);
    const customer = await (await context.request.get(`${origin}/api/session`)).json();
    assert.equal(customer.judgeCustomer, true); assert.notEqual(customer.user.name, 'John');
    await toggle(); await expect(bar).toContainText(label('審査用のお客様としてログイン中です。'));
    await toggle(); await expect(bar).toHaveCount(0);
    await expect(registration.getByLabel(label('お名前'), { exact: true })).toHaveValue('John');
    await page.screenshot({ path: `tmp/judge-controls/customer-${language}-${width}.png`, fullPage: true });
    await toggle(); await bar.getByRole('button', { name: label('店主に戻る'), exact: true }).click();
    await expect(header).toContainText('John'); await expect(menu).toHaveCount(0);
    const restored = await (await context.request.get(`${origin}/api/session`)).json();
    assert.equal(restored.user.email, owner.email); assert.equal(restored.user.judge, true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${language} ${width}px: judge controls, John alias, customer switching and original account verified.`);
  }
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await store.close();
}
