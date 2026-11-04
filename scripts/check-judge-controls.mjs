import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { createApp } from '../server/app.ts';
import { sample, ownerStaffId, shopDate } from '../server/domain.ts';
import { encrypt } from '../server/google.ts';
import { Store } from '../server/store.ts';

process.env.NODE_ENV = 'production';
process.env.DEMO_MODE = 'false';
process.env.JUDGE_INVITE = 'judge-controls-browser-test-invitation';
process.env.JUDGE_UNTIL = new Date(Date.now() + 86400000).toISOString();
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:'), server = createApp(store, undefined, {
  async exchange() { throw new Error('Unexpected Google sign-in'); },
  async busy(connection) { assert.equal(connection.staffId, ownerStaffId); return []; },
});
await store.put('demoGoogle', 'current', {email:'demo@example.com',refreshToken:encrypt('calendar-test'),connectedAt:'',connectedBy:'admin@example.com'});
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
    shop.published.staff = []; shop.published.ownerBooking = true; shop.published.hours.closedWeekdays = [];
    await store.saveShop(shop);
    const page = await context.newPage(), errors = [], roleChanges = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && /\/api\/judge\/(customer|owner)$/.test(new URL(request.url()).pathname)) roleChanges.push(request.url()); });
    page.setDefaultTimeout(10000);
    const header = page.locator('.app-header');
    const menu = header.locator('a[href="/judge-menu"]');
    const banner = page.locator('.judge-banner');
    const bar = page.locator('.judge-bar');
    const toggle = () => page.keyboard.press('Control+Shift+L');
    await page.goto(`${origin}/?lang=${language}`);
    // Judges see their controls by default; the shortcut hides them for clean recordings.
    await expect(menu).toBeVisible(); await expect(banner).toBeVisible();
    await expect(header).toContainText(owner.name); await expect(header).not.toContainText('John');
    await page.keyboard.press('Control+Shift+Alt+L'); await expect(menu).toBeVisible();
    await toggle(); await expect(menu).toHaveCount(0); await expect(banner).toHaveCount(0); await expect(header).toContainText('John');
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true, repeat: true })));
    await expect(menu).toHaveCount(0);
    // A new tab starts with the controls shown; this tab keeps them hidden across reloads.
    const fresh = await context.newPage();
    await fresh.goto(`${origin}/?lang=${language}`); await expect(fresh.locator('.app-header a[href="/judge-menu"]')).toBeVisible(); await fresh.close();
    assert.equal(roleChanges.length,0,'the shortcut only shows controls and never switches roles');
    assert.equal((await (await context.request.get(`${origin}/api/session`)).json()).user.email,owner.email);
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
    await expect(bar).toContainText(label('審査用のお客様としてログイン中です。'));
    const customer = await (await context.request.get(`${origin}/api/session`)).json();
    assert.equal(customer.judgeCustomer, true); assert.notEqual(customer.user.name, 'John');
    await toggle(); await expect(bar).toHaveCount(0);
    await page.reload(); await expect(registration).toBeVisible(); await expect(bar).toHaveCount(0);
    await expect(registration.getByLabel(label('お名前'), { exact: true })).toHaveValue('John');
    await page.screenshot({ path: `tmp/judge-controls/customer-${language}-${width}.png`, fullPage: true });
    // An owner-only shop must offer real slots after trial-customer registration.
    await registration.getByLabel(label('生年月日'),{exact:true}).fill('1990-01-01');
    await registration.getByLabel(label('性別'),{exact:true}).selectOption('not_specified');
    await registration.getByRole('button',{name:label('登録して予約へ進む'),exact:true}).click();
    await expect(page.locator('.reservation-layout')).toBeVisible();
    assert.equal(await page.getByLabel(label('スタッフ'),{exact:true}).count(),0);
    const date=shopDate(shop.published,Date.now()+4*86400000);
    await page.locator('.date-input input[type=text]').fill(date.replaceAll('-','/'));
    await expect(page.locator('.time-grid button').first()).toBeVisible();
    // A failed availability request must be shown as a failure, with a retry action.
    let failSlots=true;
    await page.route('**/slots?*',route=>failSlots?route.fulfill({status:503,json:{error:'Calendar unavailable'}}):route.continue());
    await page.locator('.menu-options button').last().click();
    const availabilityError=page.getByRole('alert').filter({hasText:'Calendar unavailable'});
    await expect(availabilityError).toBeVisible(); await expect(page.locator('.empty-slots')).toHaveCount(0);
    failSlots=false; await availabilityError.getByRole('button',{name:label('再試行'),exact:true}).click();
    await expect(page.locator('.time-grid button').first()).toBeVisible();
    await page.locator('.time-grid button').first().click();
    await page.getByRole('button',{name:new RegExp(label('この内容で予約する'))}).click();
    await expect(page.locator('.booking-complete')).toBeVisible();
    assert.equal((await store.bookings(shop.id)).length,1);
    // Opening management as the trial customer offers recovery instead of an empty workspace.
    await page.goto(`${origin}/?lang=${language}`);
    await expect(page.locator('.judge-menu')).toBeVisible();
    await expect(page.getByRole('button',{name:label('アカウントデータを初期化'),exact:true})).toHaveCount(0);
    await Promise.all([page.waitForNavigation(),page.getByRole('button', { name: label('店主に戻る'), exact: true }).click()]);
    await expect(header).toContainText('John'); await expect(menu).toHaveCount(0);
    const restored = await (await context.request.get(`${origin}/api/session`)).json();
    assert.equal(restored.user.email, owner.email); assert.equal(restored.user.judge, true);
    // Both actions are reachable from the judge menu; reopening the invitation resumes the same shop.
    await page.goto(`${origin}/judge-menu?lang=${language}`);
    await page.getByRole('button',{name:label('お客様として試す'),exact:true}).click();
    await expect(page.locator('.customer-registration')).toBeVisible();
    const shopsBefore=(await store.list('shop')).length;
    await page.goto(`${origin}/judge/${process.env.JUDGE_INVITE}?lang=${language}`);
    await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:label('続きから試す'),exact:true}).click()]);
    await expect(header).toContainText('John');
    const resumed=await (await context.request.get(`${origin}/api/session`)).json();
    assert.equal(resumed.user.email,owner.email);assert.equal(resumed.user.shopId,shop.id);
    assert.equal((await store.list('shop')).length,shopsBefore);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${language} ${width}px: shortcut preserves roles; owner-only slots, availability retry, booking, management recovery and invitation resume verified.`);
  }
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await store.close();
}
