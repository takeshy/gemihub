import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import { digest } from '../server/auth.ts';

process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:'), server = createApp(store);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
  for (const language of ['ja', 'en']) for (const width of [1280, 390]) {
    const label = text => language === 'en' ? catalog[text] || text : text;
    const shop = await store.createShop(`proposal-${language}-${width}@example.com`);
    shop.published = structuredClone(sample); shop.publication = 'public'; await store.saveShop(shop);
    const token = randomUUID(); await store.put('session', digest(token), { user: { email: shop.owner, role: 'owner', name: 'Owner', shopId: shop.id }, expires: Date.now() + 600000 });
    const proposal = { id: 'old-proposal', alertId: 'old-alert', operation: 'retry_refund', bookingId: 'missing-booking', target: 'Stale refund', amount: 4950, currency: 'JPY', expected: 'Confirm the current refund.', fingerprint: 'old-fingerprint' };
    await store.put('paypalAlertState', shop.id, { shopId: shop.id, checkedAt: new Date().toISOString(), summary: 'One old alert', items: [{ id: proposal.alertId, kind: 'refund_stalled', severity: 'medium', bookingId: proposal.bookingId, target: proposal.target, fingerprint: proposal.fingerprint, proposal }] });
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
    await context.addCookies([{ name: 'gemihub_session', value: token, url: origin }]);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`**/api/shops/${shop.id}/assistant`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: 'Review this refund proposal.', sources: [], paypalProposals: [proposal] }) }));
    await page.goto(`${origin}/?tab=dashboard&shop=${shop.id}&lang=${language}`);
    await expect(page.locator('.paypal-alert-list li')).toHaveCount(1);
    await page.goto(`${origin}/?tab=assistant&shop=${shop.id}&lang=${language}`);
    await page.getByRole('textbox', { name: label('アシスタントへの質問'), exact: true }).fill('Check this refund');
    await page.locator('.assistant').getByRole('button', { name: label('送信'), exact: true }).click();
    await expect(page.locator('.paypal-proposals .paypal-proposal')).toHaveCount(1);
    const response = page.waitForResponse(response => response.url().endsWith('/paypal/proposals/execute'));
    await page.locator('.paypal-proposals').getByRole('button', { name: label('承認して実行'), exact: true }).click();
    assert.equal((await response).status(), 409, 'exercise the actual non-2xx useApi exception path');
    await expect(page.locator('.paypal-proposals')).toHaveCount(0);
    await expect(page.locator('.assistant').getByRole('alert')).toContainText(label('状態が変わっています。最新の状態を確認してください。'));
    await expect(page.getByRole('log', { name: label('アシスタントとの会話'), exact: true })).toContainText('Review this refund proposal.');
    await page.goto(`${origin}/?tab=dashboard&shop=${shop.id}&lang=${language}`);
    await expect(page.locator('.paypal-alert-list li')).toHaveCount(0);
    assert.deepEqual(errors, []); await context.close();
    console.log(`${language} ${width}px: actual 409 reloads current alerts, removes expired consult proposals and preserves the conversation.`);
  }
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); }
