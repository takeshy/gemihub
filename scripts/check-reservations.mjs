import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { digest } from '../server/auth.ts';
import { sample } from '../server/domain.ts';
import { dateIn, zonedDate } from '../shared/region.ts';

process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
const english = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:'), server = createApp(store);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
const now = new Date('2026-11-07T02:30:00Z');
let browser;
try {
  await mkdir('tmp/reservations', { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
  for (const locale of ['ja', 'en']) for (const region of [{ country: 'JP', timeZone: 'Asia/Tokyo' }, { country: 'US', timeZone: 'America/Los_Angeles' }]) {
    const label = value => locale === 'en' ? english[value] || value : value;
    const shop = await store.createShop(`reservations-${locale}-${region.country}@example.com`);
    shop.published = structuredClone(sample); shop.published.region = region;
    shop.published.menus[0].name = 'LongMenuName'.repeat(12);
    shop.published.staff[0].name = 'LongStaffName'.repeat(10);
    await store.saveShop(shop);
    const token = `reservations-${locale}-${region.country}`;
    await store.put('session', digest(token), { user: { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id }, expires: Date.now() + 600000 });
    const today = dateIn(now, region.timeZone), tomorrow = dateIn(now.getTime() + 86400000, region.timeZone);
    for (const [id, date, staffId, status] of [['today', today, 'aoi', 'active'], ['cancelled', today, 'haru', 'cancelled'], ['tomorrow', tomorrow, 'aoi', 'active']]) {
      await store.saveBooking({ id: `${shop.id}-${id}`, shopId: shop.id, customer: `${'long-email-'.repeat(8)}@example.com`, name: id === 'today' ? 'LongCustomerName'.repeat(8) : id, menuId: 'simple', staffId, price: 5500, message: 'LongMessage'.repeat(20), start: zonedDate(date, '10:00', region.timeZone).toISOString(), end: zonedDate(date, '11:00', region.timeZone).toISOString(), status, createdAt: now.toISOString() });
    }
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: locale === 'ja' ? 'ja-JP' : 'en-US', timezoneId: region.country === 'JP' ? 'America/Los_Angeles' : 'Asia/Tokyo' });
    await context.addCookies([{ name: 'gemihub_session', value: token, url: origin }]);
    const page = await context.newPage(), errors = [];
    await page.clock.setFixedTime(now);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?shop=${shop.id}&tab=bookings&lang=${locale}`);
    const panel = page.locator('.reservations-panel'), date = panel.locator('.date-input input[type="text"]');
    await expect(date).toHaveValue(today.replaceAll('-', '/'));
    await expect(panel.locator('.reservation-booking')).toHaveCount(2);
    await expect(panel.locator('.section-top .count')).toHaveText('2');
    assert.notEqual(await page.evaluate(() => new Date().toLocaleDateString('en-CA')), today, 'Browser and shop dates differ in this fixture');
    const staff = panel.getByRole('combobox', { name: label('スタッフ'), exact: true });
    await staff.selectOption('aoi'); await expect(panel.locator('.reservation-booking')).toHaveCount(1);
    await date.fill(tomorrow.replaceAll('-', '/')); await date.blur();
    await expect(panel.locator('.reservation-booking')).toContainText('tomorrow');
    await panel.getByRole('button', { name: label('今日'), exact: true }).click();
    await expect(date).toHaveValue(today.replaceAll('-', '/')); await expect(staff).toHaveValue('aoi');
    await panel.getByRole('button', { name: label('絞り込みを解除'), exact: true }).click();
    await expect(date).toHaveValue(''); await expect(staff).toHaveValue(''); await expect(panel.locator('.reservation-booking')).toHaveCount(3);
    await date.fill('2099/01/01'); await date.blur(); await expect(panel.locator('.reservation-booking')).toHaveCount(0);
    await expect(panel.locator('.empty')).toContainText(label('指定した条件の予約はありません。日付・スタッフを変更するか、絞り込みを解除してください。'));
    await panel.getByRole('button', { name: label('今日'), exact: true }).click();
    for (const width of [1280, 768, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale}/${region.country}/${width}: no page overflow`);
      const clipped = await panel.locator('input[type=text], select, button, .reservation-booking-header, .reservation-booking-summary, .reservation-booking-message').evaluateAll(elements => elements.filter(element => {
        const rect = element.getBoundingClientRect(), panel = element.closest('.reservations-panel').getBoundingClientRect();
        return rect.left < panel.left - 1 || rect.right > panel.right + 1 || element.scrollWidth > element.clientWidth + 1;
      }).map(element => ({ text: element.textContent, className: element.className })));
      assert.deepEqual(clipped, [], `${locale}/${region.country}/${width}: content and controls stay within the booking panel`);
      if ([1280, 390].includes(width)) await panel.screenshot({ path: `tmp/reservations/${locale}-${region.country}-${width}.png` });
    }
    await panel.getByRole('button', { name: label('更新'), exact: true }).click();
    await expect(date).toHaveValue(today.replaceAll('-', '/')); await expect(panel.locator('.reservation-booking')).toHaveCount(2);
    page.once('dialog', dialog => dialog.accept());
    await panel.getByRole('button', { name: label('予約をキャンセル'), exact: true }).click();
    await expect(panel.locator('.reservation-booking .status.cancelled')).toHaveCount(2);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${locale}/${region.country}: shop-local today, date/staff filtering, empty states, refresh, cancellation and 320–1280px layouts passed`);
  }
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); }
