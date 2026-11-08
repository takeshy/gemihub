import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import { defaultRefundTiers } from '../server/payment-domain.ts';
import * as intelligence from '../server/ai.ts';

process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
process.env.JUDGE_INVITE = 'browser-fixture-'.repeat(3); process.env.JUDGE_UNTIL = '2099-01-01';
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8')), store = new Store(':memory:');
let refundReads = 0, searches = 0;
const gateway = {
  environment: 'sandbox', ready: async () => {},
  create: async () => { throw new Error('unexpected write'); }, capture: async () => { throw new Error('unexpected write'); }, refund: async () => { throw new Error('unexpected write'); },
  order: async () => { throw new Error('unexpected order'); },
  refundStatus: async id => { refundReads++; return { id, status: 'COMPLETED', amount: { currency_code: 'USD', value: '55.00' } }; },
  captureStatus: async id => ({ id, status: 'REFUNDED', amount: { currency_code: 'USD', value: '55.00' } }),
  transactions: async () => { searches++; throw new Error('Transaction Search is not authorized'); },
};
const server = createApp(store, { ...intelligence, assistant: async input => {
  assert.ok(input.data.paypal, 'judge accounts receive the same owned read tools');
  const ledger = (await input.data.paypal.invoke('ledger_find_booking_payments', { type: 'refund' })).result;
  const row = ledger.rows[0]; assert.equal(row.refund.id, 'TEST-REFUND');
  const refund = await input.data.paypal.invoke('paypal_get_refund', { refundId: row.refund.id });
  return { answer: `Refund ${refund.result.id}: ${refund.result.status}, USD 55.00.`, sources: [refund.source] };
} }, undefined, undefined, gateway);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
let browser;
try {
  await mkdir('tmp/judge-paypal', { recursive: true });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
  for (const language of ['ja', 'en']) for (const width of [1280, 390]) {
    const label = text => language === 'en' ? catalog[text] || text : text;
    const shop = await store.createShop(`judge-${language}-${width}@judge.gemihub.invalid`);
    shop.published = structuredClone(sample); shop.published.region = { country: 'US', timeZone: 'America/New_York' };
    shop.publication = 'public'; shop.judge = { createdAt: new Date().toISOString() }; await store.saveShop(shop);
    const at = new Date().toISOString(), booking = { id: randomUUID(), shopId: shop.id, customer: 'test-customer@example.com', name: 'Test Customer', menuId: 'simple', staffId: 'aoi', price: 55, message: '', start: '2026-11-09T19:00:00Z', end: '2026-11-09T20:00:00Z', status: 'cancelled', createdAt: at, payment: { provider: 'paypal', environment: 'sandbox', orderId: 'TEST-ORDER', captureId: 'TEST-CAPTURE', amount: 5500, currency: 'USD', policy: defaultRefundTiers, cancellation: { at, by: 'test-customer@example.com', reason: 'customer', percent: 100, amount: 5500, status: 'completed', requestId: 'TEST-REQUEST', refundId: 'TEST-REFUND' } } };
    await store.saveBooking(booking);
    await store.put('checkout', booking.id, { id: booking.id, shopId: shop.id, customer: booking.customer, booking, policy: defaultRefundTiers, environment: 'sandbox', phase: 'confirmed', expires: Date.now() + 600000, createdAt: Date.now(), returnUrl: '', cancelUrl: '', orderId: 'TEST-ORDER', currency: 'USD' });
    // Reproduce a background summary saved in Japanese before switching to the English UI.
    await store.put('paypalAlertState', shop.id, { shopId: shop.id, checkedAt: at, summary: '対応が必要な項目はありません。', locale: 'ja', items: [] });
    const token = randomUUID(); await store.put('session', digest(token), { user: { email: shop.owner, name: 'Judge', role: 'owner', shopId: shop.id, judge: true }, expires: Date.now() + 600000 });
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: language === 'en' ? 'en-US' : 'ja-JP' });
    await context.addCookies([{ name: 'gemihub_session', value: token, url: origin }]);
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?tab=bookings&shop=${shop.id}&lang=${language}`);
    await page.getByRole('button', { name: label('絞り込みを解除'), exact: true }).click();
    await expect(page.locator('.reservations-panel .section-top .count')).toHaveText('1');
    await expect(page.locator('.booking-list .booking-card')).toHaveCount(1);
    await expect(page.locator('.sidebar-bottom')).toHaveCount(0);
    if (language === 'en') await expect(page.locator('.payment-details')).toContainText('$55.00 (Sandbox)');
    const date = page.locator('.reservation-filters .date-input');
    await expect(date.locator('input[type=text]')).toHaveAttribute('placeholder', 'YYYY/MM/DD');
    await expect(date.locator('.date-input-format')).toHaveCount(0);
    const dateInput = date.locator('input[type=text]');
    await dateInput.fill('2026/11/10'); await dateInput.blur();
    await expect(page.locator('.reservations-panel .section-top .count')).toHaveText('0');
    await dateInput.fill('2026/02/30'); await expect(date.getByRole('status')).toBeVisible();
    await page.screenshot({ path: `tmp/judge-paypal/bookings-${language}-${width}.png`, fullPage: true });
    await page.goto(`${origin}/?tab=dashboard&shop=${shop.id}&lang=${language}`);
    const panel = page.locator('.paypal-alerts');
    await expect(panel).toContainText(label('対応が必要な項目はありません。'));
    if (language === 'en') await expect(panel).not.toContainText('対応が必要な項目はありません。');
    await panel.getByRole('button', { name: label('今すぐチェック'), exact: true }).click();
    await expect(panel.getByRole('status')).toContainText(label('確認が完了しました。要対応：{0}件。').replace('{0}', '0'));
    await expect(panel.locator('time')).toHaveAttribute('datetime', /\d{4}-\d\d-\d\dT/);
    await expect(panel.locator('.paypal-proposal')).toHaveCount(0);
    await page.goto(`${origin}/?tab=assistant&shop=${shop.id}&lang=${language}`);
    await page.getByRole('textbox', { name: label('アシスタントへの質問'), exact: true }).fill('Did the latest refund go through on PayPal?');
    await page.locator('.assistant').getByRole('button', { name: label('送信'), exact: true }).click();
    await expect(page.getByRole('log', { name: label('アシスタントとの会話'), exact: true })).toContainText('TEST-REFUND: COMPLETED, USD 55.00');
    await expect(page.locator('.assistant-sources')).toContainText('TEST-REFUND');
    await page.screenshot({ path: `tmp/judge-paypal/consult-${language}-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []); await context.close();
    console.log(`${language} ${width}px: judge refund read/source, cancelled booking count/filter, date/error, Sandbox text, published sidebar and visible empty check passed.`);
  }
  assert.ok(refundReads >= 4); assert.equal(searches, 0);
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); }
