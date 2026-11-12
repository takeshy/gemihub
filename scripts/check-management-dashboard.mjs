import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, shopSchema, planSummary } from '../server/domain.ts';
import { dateIn, zonedDate, regionOf } from '../shared/region.ts';
import { digest } from '../server/auth.ts';
import { phoneKey } from '../server/customers.ts';
import * as intelligence from '../server/ai.ts';

process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
const store = new Store(':memory:');
const server = createApp(store, { ...intelligence,
  explainSystem: async () => ({ answer: 'Review the new FAQ page.', changeRequest: true, ready: true }),
  propose: async (_text, current) => {
    const config = shopSchema.parse({ ...current, pages: [...current.pages, { id: 'new-faq', slug: 'new-faq', title: 'New FAQ', navigationLabel: 'New FAQ', body: '<h2>New FAQ</h2>', layout: 'standard', imageUrl: '' }] });
    return { config, summary: planSummary(current, config) };
  },
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
await mkdir('tmp/management-dashboard', { recursive: true });
const session = async (context, user) => {
  const token = randomUUID(); await store.put('session', digest(token), { user, expires: Date.now() + 3600000 });
  await context.addCookies([{ name: 'gemihub_session', value: token, url: origin }]);
};
let active;
try {
  for (const language of ['ja', 'en']) for (const width of [1280, 390]) {
    const label = text => language === 'en' ? catalog[text] || text : text;
    const shop = await store.createShop(`dashboard-${language}-${width}@example.com`);
    const region = language === 'en' ? { country: 'US', timeZone: 'America/New_York' } : { country: 'JP', timeZone: 'Asia/Tokyo' };
    shop.published = shopSchema.parse({ ...structuredClone(sample), region, appearance: { accent: 'sage', layout: 'standard', imageUrl: '', articles: { blogs: false, announcements: true } }, pages: [{ id: 'faq', slug: 'faq', title: 'Existing FAQ', navigationLabel: 'FAQ', body: '<h2>FAQ</h2>', layout: 'standard', imageUrl: '' }] });
    await store.saveShop(shop);
    const foreign = await store.createShop('different-owner@example.com'); foreign.published = structuredClone(sample); await store.saveShop(foreign);
    const today = dateIn(Date.now(), region.timeZone);
    const nextDate = dateIn(Date.now() + 86400000, region.timeZone);
    const previousDate = dateIn(Date.now() - 86400000, region.timeZone);
    for (const [id, date, name, status] of [
      ...Array.from({ length: 12 }, (_, i) => [`today-${i}`, today, `Today guest ${i}`, i === 0 ? 'cancelled' : i === 1 ? 'no_show' : 'active']),
      ['yesterday', previousDate, 'Yesterday guest', 'active'], ['tomorrow', nextDate, 'Tomorrow guest', 'active'],
    ]) await store.put('booking', `${shop.id}:${id}`, { id: `${shop.id}:${id}`, shopId: shop.id, customer: id === 'today-8' ? phoneKey('03-1234-5678') : 'guest@example.com', ...(id === 'today-8' ? { phone: '03-1234-5678' } : {}), name, menuId: shop.published.menus[0].id, staffId: shop.published.staff[0].id, price: 6500, start: zonedDate(date, '10:00', region.timeZone).toISOString(), end: zonedDate(date, '11:00', region.timeZone).toISOString(), status, createdAt: new Date().toISOString(), message: 'Booking details message' });
    for (const [index, status] of ['new', 'new', 'in_progress', 'waiting', 'completed', 'replied'].entries()) await store.put('inquiry', `${shop.id}:inquiry-${index}`, { id: `${shop.id}:inquiry-${index}`, shopId: shop.id, name: `Inquiry guest ${index}`, email: index === 1 ? '' : 'guest@example.com', phone: index === 1 ? '03-9876-5432' : '', subject: `Question ${index}`, message: `Message ${index}`, reply: '', status, at: new Date(Date.now() - index * 10000).toISOString() });
    await store.put('inquiry', `${foreign.id}:private`, { id: `${foreign.id}:private`, shopId: foreign.id, name: 'Foreign private guest', email: 'private@example.com', message: 'Foreign private message', reply: '', status: 'new' });
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: language === 'ja' ? 'ja-JP' : 'en-US', timezoneId: language === 'ja' ? 'America/Los_Angeles' : 'Asia/Tokyo' });
    await session(context, { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id });
    const page = await context.newPage(); active = page; page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const openMenu = async () => { if (width < 760 && await page.locator('.mobile-menu-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('.mobile-menu-toggle').click(); };
    const choose = async title => { await openMenu(); await page.getByRole('treeitem', { name: label(title), exact: true }).click(); };
    await page.goto(`${origin}/?lang=${language}`);
    const dashboard = page.locator('.management-dashboard'); await expect(dashboard).toBeVisible();
    await expect(dashboard).toContainText(today);
    await expect(dashboard.locator('.dashboard-today .count')).toHaveText('12');
    await expect(dashboard.locator('.dashboard-booking')).toHaveCount(10);
    await dashboard.getByRole('navigation', { name: label('{0}のページ切替').replace('{0}', label('本日の予約')) }).getByRole('button', { name: label('次のページ'), exact: true }).click();
    await expect(dashboard.locator('.dashboard-booking')).toHaveCount(2);
    await expect(dashboard.locator('.dashboard-inquiries .count')).toHaveText('2');
    await expect(dashboard.locator('.dashboard-inquiry')).toHaveCount(2);
    for (const value of ['Yesterday guest', 'Tomorrow guest', 'Inquiry guest 2', 'Inquiry guest 3', 'Foreign private']) await expect(dashboard).not.toContainText(value);
    await expect(dashboard.locator('.shop-spec')).toBeVisible();
    await dashboard.locator('.dashboard-summary-grid').screenshot({ path: `tmp/management-dashboard/summary-${language}-${width}.png` });
    const writes=[];const recordWrite=request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/api/'))writes.push(request.url());};page.on('request',recordWrite);
    const bookingTrigger=dashboard.getByRole('button',{name:label('{0}の予約を開く').replace('{0}','Today guest 8'),exact:true});
    await bookingTrigger.focus();await page.keyboard.press('Enter');
    const bookingDialog=page.getByRole('dialog',{name:label('予約の詳細'),exact:true});await expect(bookingDialog).toBeVisible();
    await expect(bookingDialog).toContainText('Booking details message');await expect(bookingDialog).toContainText('03-1234-5678');
    assert.equal(await bookingDialog.locator('input,select,textarea,form').count(),0,'booking modal is read-only');
    await page.screenshot({path:`tmp/management-dashboard/booking-modal-${language}-${width}.png`});
    await page.keyboard.press('Escape');await expect(bookingDialog).toHaveCount(0);await expect(bookingTrigger).toBeFocused();
    assert.deepEqual(writes,[],'previewing and dismissing records makes no writes');
    await bookingTrigger.click();await bookingDialog.getByRole('link',{name:label('お客様情報を開く →'),exact:true}).click();
    await expect(page.locator('.customer-bookings')).toBeVisible();await expect(page.locator('.customers')).toContainText('Today guest 8');
    assert.equal(new URL(page.url()).searchParams.get('customer'),phoneKey('03-1234-5678'));
    await page.reload();await expect(page.locator('.customer-bookings')).toBeVisible();
    await page.goBack();await expect(dashboard).toBeVisible();
    for(const index of [0,1]){
      await dashboard.getByRole('button',{name:label('{0}のお問い合わせを開く').replace('{0}',`Inquiry guest ${index}`),exact:true}).click();
      const inquiryDialog=page.getByRole('dialog',{name:label('お問い合わせの詳細'),exact:true});await expect(inquiryDialog).toContainText(`Message ${index}`);
      assert.equal(await inquiryDialog.locator('input,select,textarea,form').count(),0,'inquiry modal is read-only');
      if(index===0)await page.screenshot({path:`tmp/management-dashboard/inquiry-modal-${language}-${width}.png`});
      await inquiryDialog.getByRole('link',{name:label('お問い合わせを開く →'),exact:true}).click();
      const detail=page.locator('.inquiry-detail');await expect(detail).toContainText(`Message ${index}`);
      await expect(detail.getByRole('combobox',{name:label('対応状況'),exact:true})).toBeEnabled();
      assert.equal(new URL(page.url()).searchParams.get('inquiry'),`${shop.id}:inquiry-${index}`);
      await page.reload();await expect(detail).toContainText(`Message ${index}`);
      await detail.getByRole('button',{name:label('← お問い合わせ一覧へ'),exact:true}).click();await expect(page.locator('.inquiries-list')).toBeVisible();
      await page.goBack();await expect(detail).toContainText(`Message ${index}`);
      await page.goBack();await expect(dashboard).toBeVisible();
    }
    page.off('request',recordWrite);assert.deepEqual(writes,[],'previews, destinations and history navigation make no writes');
    await page.goto(`${origin}/?tab=inquiries&shop=${shop.id}&inquiry=${encodeURIComponent(`${foreign.id}:private`)}&lang=${language}`);
    await expect(page.locator('.inquiry-detail').getByRole('alert')).toHaveText(label('お問い合わせが見つかりません。お問い合わせ一覧を確認してください。'));
    await expect(page.locator('.inquiry-detail')).not.toContainText('Foreign private');
    await page.goBack();await expect(dashboard).toBeVisible();
    await dashboard.getByRole('link', { name: label('予約一覧へ →'), exact: true }).click();
    await expect(page.locator('.reservations-panel')).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'bookings');
    const listTrigger=page.locator('.reservation-booking-open').first();await listTrigger.click();
    await expect(bookingDialog).toBeVisible();await expect(bookingDialog).toContainText('Booking details message');
    await page.screenshot({path:`tmp/management-dashboard/reservation-modal-${language}-${width}.png`});
    await bookingDialog.getByRole('button',{name:label('閉じる'),exact:true}).click();await expect(bookingDialog).toHaveCount(0);await expect(listTrigger).toBeFocused();
    await page.goBack(); await expect(dashboard).toBeVisible();
    await dashboard.getByRole('link', { name: label('お問い合わせ一覧へ →'), exact: true }).click();
    await expect(page.locator('.inquiries-list')).toBeVisible();
    await page.goBack(); await expect(dashboard).toBeVisible();

    await choose('ページ追加・機能変更');
    await expect(page.locator('.page-change-inventory .screen-name-list li')).toHaveCount(7);
    await expect(page.locator('.shop-changes .shop-spec')).toHaveCount(0);
    const toolbar = await page.locator('.page-change-inventory .editor-toolbar').boundingBox();
    const history = await page.locator('.shop-change-history').boundingBox();
    const screens = await page.locator('.page-change-screens').boundingBox();
    assert.ok(toolbar.y + toolbar.height <= history.y + 1 && history.y + history.height <= screens.y + 1, 'history sits between the toolbar and the screen inventory');
    await page.locator('.page-change-inventory .editor-pen-button').click();
    const chat = page.locator('.shop-change-chat'); await expect(chat).toBeVisible();
    const input = chat.getByRole('textbox', { name: label('AIに伝えたいこと'), exact: true }); await expect(input).toBeEditable();
    if (width > 1000) { const left = await page.locator('.page-change-inventory').boundingBox(), right = await chat.boundingBox(); assert.ok(left.x + left.width <= right.x + 1, 'chat is on the right'); }
    await chat.getByRole('button', { name: label('画像を添付'), exact: true }).click();
    const imageDialog = page.getByRole('dialog', { name: label('依頼の画像を選ぶ'), exact: true });
    await expect(imageDialog).toBeVisible(); await page.keyboard.press('Escape');
    await expect(imageDialog).toHaveCount(0); await expect(chat).toBeVisible();
    await page.screenshot({ path: `tmp/management-dashboard/chat-${language}-${width}.png`, fullPage: false });
    await input.fill('Saved unfinished request');
    await chat.getByRole('button', { name: label('チャットを折り畳む'), exact: true }).click();
    await expect(chat).toBeHidden(); await expect(page.locator('.chat-panel-restore')).toBeVisible();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body)[innerWidth > 760 ? 'paddingRight' : 'paddingBottom'])).toBe('0px');
    await page.locator('.chat-panel-restore').click(); await expect(chat).toBeVisible();
    await expect(input).toHaveValue('Saved unfinished request'); await expect(input).toBeFocused();
    await chat.getByRole('button', { name: label('チャットを折り畳む'), exact: true }).click();
    await page.locator('.page-change-inventory .editor-pen-button').click();
    await expect(chat).toBeVisible(); await expect(input).toHaveValue('Saved unfinished request');
    await chat.getByRole('button', { name: label('閉じる'), exact: true }).click();
    await expect(page.locator('.page-change-inventory .editor-pen-button')).toBeFocused();
    await page.locator('.page-change-inventory .editor-pen-button').click(); await expect(input).toHaveValue('Saved unfinished request');
    await input.fill('Add a new FAQ page'); await input.press('Control+Enter');
    await chat.getByRole('button', { name: label('変更案を確認する'), exact: true }).click();
    const proposal = page.locator('.shop-change-review .request-review'); await expect(proposal).toBeVisible();
    await expect(proposal.locator('.screen-added')).toHaveText(label('追加'));
    await expect(proposal.locator('.theme-preview')).toHaveCount(0); // A page addition keeps the shared theme unchanged.
    await expect(chat).toBeVisible();
    await proposal.getByRole('button', { name: label('変更内容を反映する'), exact: true }).click({ trial: true });
    await page.keyboard.press('Escape'); await expect(proposal).toHaveCount(0); await expect(input).toBeFocused();
    await chat.getByRole('button', { name: label('変更案を確認する'), exact: true }).click();
    await expect(proposal).toBeVisible();
    assert.equal((await store.shop(shop.id)).published.pages.length, 1, 'viewing the proposal never publishes it');
    await proposal.getByRole('button', { name: label('チャットに戻る'), exact: true }).click(); await expect(chat).toBeVisible();
    await chat.getByRole('button', { name: label('閉じる'), exact: true }).click();
    await choose('ページ全体'); await expect(page.locator('.local-preview-screen .theme-placeholder')).toBeVisible();
    await page.locator('.local-preview .editor-pen-button').click(); await expect(page.locator('.visual-chat-panel:not(.shop-change-chat)')).toBeVisible();
    await page.locator('.visual-chat-panel:not(.shop-change-chat)').getByRole('button', { name: label('閉じる'), exact: true }).click();
    await choose('ページ追加・機能変更'); await page.locator('.page-change-inventory .editor-pen-button').click();
    await expect(chat.getByRole('log')).toContainText('Add a new FAQ page');
    await input.fill('Draft after navigation'); await input.press('Escape'); await expect(chat).toBeHidden();
    await page.reload(); await page.locator('.page-change-inventory .editor-pen-button').click();
    await expect(input).toHaveValue('Draft after navigation');
    await chat.getByRole('button', { name: label('閉じる'), exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `tmp/management-dashboard/features-${language}-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []); await context.close();

    const staffContext = await browser.newContext({ viewport: { width, height: 950 } });
    const staff = { email: `staff-${shop.id}@example.com`, name: 'Staff', role: 'customer', shopId: shop.id };
    await store.put('member', `${shop.id}:${staff.email}`, { shopId: shop.id, email: staff.email, accepted: true });
    await session(staffContext, staff); const staffPage = await staffContext.newPage();
    await staffPage.goto(`${origin}/?lang=${language}`); await expect(staffPage.locator('.management-dashboard')).toBeVisible();
    await expect(staffPage.locator('.sidebar-editor')).toHaveCount(0);
    await staffPage.goto(`${origin}/?tab=try&lang=${language}`); await expect(staffPage.locator('.management-dashboard')).toBeVisible();
    for (const tab of ['payments', 'transfers']) {
      await staffPage.goto(`${origin}/?tab=${tab}&lang=${language}`); await expect(staffPage.locator('.management-dashboard')).toBeVisible();
      await expect(staffPage.locator('.payment-operations')).toHaveCount(0);
      assert.deepEqual((await (await staffContext.request.get(`${origin}/api/shops/${shop.id}/operations?lang=${language}`)).json()).transferHistory, []);
    }
    await staffContext.close();
    console.log(`${language} ${width}px: default dashboard, shop-timezone bookings, new inquiries, list links, pagination, scope separation, both side chats, saved drafts, proposals and staff permissions passed.`);
  }
  const shop = await store.createShop('dashboard-provisional@example.com'); shop.published = structuredClone(sample); shop.publication = 'provisional'; await store.saveShop(shop);
  const context = await browser.newContext(); await session(context, { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id });
  const page = await context.newPage(); active = page; await page.goto(`${origin}/?lang=en`);
  await expect(page.locator('.management-dashboard')).toBeVisible();
  await expect(page.locator('.dashboard-today a')).toHaveCount(0);
  await expect(page.locator('.dashboard-inquiry')).toHaveCount(0);
  await expect(page.locator('.dashboard-inquiries')).toContainText(catalog['未対応のお問い合わせはありません。'] || '');
  await context.close();
} catch (error) {
  if (active && !active.isClosed()) await active.screenshot({ path: 'tmp/management-dashboard/failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await store.close(); }
