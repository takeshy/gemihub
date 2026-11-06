import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { sample } from '../server/domain.ts';
import { customerLogKey } from '../server/shop-logs.ts';

process.env.DEMO_MODE = 'true';
const store = new Store(':memory:');
const shop = await store.createShop('activity-owner@example.com');
shop.published = structuredClone(sample); shop.publication = 'public'; await store.saveShop(shop);
const server = createApp(store);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
await mkdir('tmp/customer-activity', { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
  for (const [language, width] of [['ja', 1280], ['en', 390]]) {
    const email = `activity-${language}@example.com`;
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const login = await context.request.post(`${origin}/api/demo-login`, { headers: { Origin: origin }, data: { role: 'customer', email, shopId: shop.id } });
    assert.equal(login.status(), 200);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/s/${shop.slug}?pane=mine&lang=${language}`);
    await expect(page.locator('.public-nav')).toBeVisible();
    await expect.poll(async () => (await store.queryShopLogs(shop.id, new Date(0).toISOString(), new Date().toISOString(), 200, customerLogKey(shop.id, email))).filter(row => row.kind === 'activity' && row.operation === 'mypage_view').length).toBeGreaterThan(0);
    await page.locator('.public-nav').getByRole('button', { name: language === 'ja' ? 'ご予約' : 'Book now', exact: true }).click();
    await expect.poll(async () => (await store.queryShopLogs(shop.id, new Date(0).toISOString(), new Date().toISOString(), 200, customerLogKey(shop.id, email))).filter(row => row.kind === 'activity' && row.operation === 'reserve_view').length).toBeGreaterThan(0);
    await context.close();

    const operator = await browser.newContext({ viewport: { width, height: 1000 } });
    await operator.request.post(`${origin}/api/demo-login`, { headers: { Origin: origin }, data: { role: 'owner', email: shop.owner, shopId: shop.id } });
    const crm = await operator.newPage(); crm.on('pageerror', error => errors.push(error.message));
    await crm.goto(`${origin}/?shop=${shop.id}&customer=${encodeURIComponent(email)}&lang=${language}`);
    const history = crm.getByRole('region', { name: language === 'ja' ? '行動履歴' : 'Activity history', exact: true });
    await expect(history).toBeVisible();
    await expect(history.getByRole('heading', { name: language === 'ja' ? 'ログインした' : 'Signed in', exact: true })).toHaveCount(1);
    await expect(history.getByRole('heading', { name: language === 'ja' ? '予約画面を開いた' : 'Opened the booking screen', exact: true })).toHaveCount(1);
    await expect(history.getByRole('heading', { name: language === 'ja' ? 'マイページを開いた' : 'Opened My page', exact: true })).toHaveCount(1);
    await history.scrollIntoViewIfNeeded();
    await crm.screenshot({ path: `tmp/customer-activity/crm-${language}-${width}.png` });
    assert.ok(await crm.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'CRM has no horizontal overflow');
    assert.deepEqual(errors, []);
    await operator.close();
  }
  console.log('Customer sign-in → My page → booking screen → CRM history passed (Japanese desktop, English mobile).');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await store.close();
}
