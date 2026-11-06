import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import { digest } from '../server/auth.ts';

process.env.DEMO_MODE = 'true';
const english = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:'), server = createApp(store);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
await mkdir('tmp/coupon-proposal', { recursive: true });
let active;
try {
  for (const language of ['ja', 'en']) for (const width of [1280, 390]) {
    const label = text => language === 'en' ? english[text] || text : text;
    const shop = await store.createShop(`coupon-proposal-${randomUUID()}@example.com`);
    shop.published = structuredClone(sample); shop.published.region = { country: "US", timeZone: "America/New_York" }; await store.saveShop(shop);
    const token = randomUUID();
    await store.put('session', digest(token), { user: { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id }, expires: Date.now() + 600000 });
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: 'gemihub_session', value: token, url: origin }]);
    const page = active = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?tab=coupons&shop=${shop.id}&lang=${language}`);
    const panel = page.locator('.coupon-management'), actions = panel.locator('.coupon-actions');
    await actions.getByRole('button', { name: label('新しく作る'), exact: true }).click();
    await page.clock.install();
    // Deliberately ignore AbortSignal to verify that late responses cannot overwrite edits or newer proposals.
    await page.evaluate(() => {
      const original = window.fetch.bind(window);
      window.couponRequests = [];
      window.fetch = (url, options) => String(url).endsWith('/coupons/propose')
        ? new Promise(resolve => window.couponRequests.push({ resolve, signal: options.signal, body: JSON.parse(options.body) }))
        : original(url, options);
    });
    const proposal = panel.getByRole('button', { name: label('クーポン案を作る'), exact: true });
    const note = panel.getByRole("textbox", { name: label('作りたいクーポン'), exact: true });
    const form = panel.locator('.coupon-create > form'), title = form.getByLabel(label('クーポン名'), { exact: true });
    const save = form.getByRole('button', { name: label('この内容で自動配布を有効にする'), exact: true });
    const progress = panel.locator('.coupon-proposal-progress');
    const response = (name = 'AI Welcome') => ({ rule: { title: name, match: 'all', conditions: [{ type: 'first_visit' }], discount: { type: 'percent', value: 10 }, schedule: { type: 'registration' }, validDays: 30 }, question: '' });
    const settle = async (index, body, status = 200) => {
      await page.evaluate(({ index, body, status }) => window.couponRequests[index].resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })), { index, body, status });
      await page.clock.runFor(50);
    };
    const start = async count => {
      await proposal.click();
      await expect.poll(() => page.evaluate(() => window.couponRequests.length)).toBe(count);
      await expect(progress.getByRole('status')).toHaveText(label('AIがクーポン案を作成しています…（最大35秒）'));
      await expect(proposal).toBeDisabled(); await expect(save).toBeDisabled();
      await expect(note).toBeEditable(); await expect(title).toBeEditable();
      await expect(actions.getByRole('button').first()).toBeEnabled();
    };
    await note.fill('10% off for first-time customers, valid 30 days');
    await title.fill('Keep my edits');
    await start(1);
    await proposal.evaluate(button => { button.click(); button.click(); });
    assert.equal(await page.evaluate(() => window.couponRequests.length), 1);
    await page.screenshot({ path: `tmp/coupon-proposal/pending-${language}-${width}.png`, fullPage: true });
    await progress.getByRole('button', { name: label('作成を中止'), exact: true }).click();
    await expect(progress).toHaveCount(0); await expect(proposal).toBeEnabled(); await expect(save).toBeEnabled();
    await expect(note).toHaveValue('10% off for first-time customers, valid 30 days');
    assert.equal(await page.evaluate(() => window.couponRequests[0].signal.aborted), true);
    await start(2);
    await settle(0, response('Cancelled response'));
    await expect(title).toHaveValue('Keep my edits'); await expect(progress).toBeVisible();
    await title.fill('Manual while waiting'); // Manual edits stop generation immediately.
    await expect(progress).toHaveCount(0); await expect(save).toBeEnabled();
    await settle(1, response('Stale response'));
    await expect(title).toHaveValue('Manual while waiting');

    await start(3);
    await page.clock.fastForward(35001);
    await expect(panel.getByRole('alert')).toContainText(label('クーポン案の作成が時間切れになりました。もう一度試すか、下の項目から手入力で作成してください。'));
    await expect(progress).toHaveCount(0); await expect(save).toBeEnabled();
    await expect(note).toHaveValue('10% off for first-time customers, valid 30 days');
    await page.screenshot({ path: `tmp/coupon-proposal/timeout-${language}-${width}.png`, fullPage: true });
    await panel.getByRole('button', { name: label('もう一度試す'), exact: true }).click();
    await expect(progress).toBeVisible();
    await settle(2, response('Timed-out response'));
    await expect(title).toHaveValue('Manual while waiting'); await expect(progress).toBeVisible();
    await settle(3, { error: 'AI temporarily unavailable' }, 503);
    await expect(panel.getByRole('alert')).toContainText('AI temporarily unavailable');
    await expect(proposal).toBeEnabled(); await expect(save).toBeEnabled();
    await panel.getByRole('button', { name: label('もう一度試す'), exact: true }).click();
    await settle(4, { rule: null, question: 'Which anniversary date?' });
    await expect(panel.locator('.coupon-feedback')).toHaveText('Which anniversary date?');
    await expect(title).toHaveValue('Manual while waiting'); await expect(progress).toHaveCount(0);

    await start(6);
    await actions.getByRole('button', { name: label('配布中・停止中のクーポン'), exact: true }).click();
    await settle(5, response('Response after navigation'));
    await expect(panel.locator('.coupon-campaigns')).toBeVisible();
    await expect(panel.locator('.coupon-feedback')).toHaveCount(0);
    await actions.getByRole('button', { name: label('新しく作る'), exact: true }).click();
    await note.fill('10% off for first-time customers, valid 30 days'); await start(7);
    await settle(6, response());
    await expect(title).toHaveValue('AI Welcome');
    await expect(form.getByLabel(label('割引の値'), { exact: true })).toHaveValue('10');
    await expect(form.getByLabel(label('付与からの有効日数'), { exact: true })).toHaveValue('30');
    await expect(form.getByLabel(label('配布条件 {0}').replace('{0}', '1'), { exact: true })).toHaveValue('first_visit');
    await expect(form.getByLabel(label('付与計算のタイミング'), { exact: true })).toHaveValue('registration');
    await expect(save).toBeEnabled(); await expect(progress).toHaveCount(0);
    const fixedRequest = '$5 off for customers who have visited 3 times, valid 60 days, calculated after each visit';
    await note.fill(fixedRequest); await start(8);
    // The server normally catches this. Also protect the UI against malformed responses.
    await settle(7, { ...response(), rule: { ...response().rule, discount: { type: 'cash', value: 5 } } });
    await expect(panel.getByRole('alert')).toContainText(label('クーポン案を作成できませんでした。もう一度お試しください。'));
    await expect(panel.getByRole('alert')).not.toContainText(/discriminator|Zod|rule\.discount/);
    await expect(note).toHaveValue(fixedRequest);
    await expect(title).toHaveValue('AI Welcome');
    await expect(form.getByLabel(label('割引の値'), { exact: true })).toHaveValue('10');
    await expect(save).toBeEnabled();
    await page.screenshot({ path: `tmp/coupon-proposal/invalid-output-${language}-${width}.png`, fullPage: true });
    await panel.getByRole('button', { name: label('もう一度試す'), exact: true }).click();
    const fixed = { title: 'AI Visit Reward', match: 'all', conditions: [{ type: 'visit_count', count: 3, comparison: 'exact' }], discount: { type: 'amount', value: 5 }, schedule: { type: 'after_visit' }, validDays: 60 };
    await settle(8, { rule: fixed, question: '' });
    await expect(title).toHaveValue('AI Visit Reward');
    await expect(form.getByLabel(label('割引の種類'), { exact: true })).toHaveValue('amount');
    await expect(form.getByLabel(label('割引の値'), { exact: true })).toHaveValue('5');
    await expect(form.getByLabel(label('付与からの有効日数'), { exact: true })).toHaveValue('60');
    await expect(form.getByLabel(label('配布条件 {0}').replace('{0}', '1'), { exact: true })).toHaveValue('visit_count');
    await expect(form.getByLabel(label('回数'), { exact: true })).toHaveValue('3');
    await expect(form.getByLabel(label('回数の条件'), { exact: true })).toHaveValue('exact');
    await expect(form.getByLabel(label('付与計算のタイミング'), { exact: true })).toHaveValue('after_visit');
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(panel.locator('.coupon-feedback')).toHaveText(label('AIの案を下の項目で確認・編集してください。まだ配布は有効になっていません。'));
    await expect(save).toBeEnabled();
    assert.equal((await store.records('couponCampaign', shop)).length, 0);
    assert.equal((await store.records('couponGrant', shop)).length, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: `tmp/coupon-proposal/success-${language}-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${language} ${width}px: progress, cancel, late responses, manual edits, timeout, retry, clarification, navigation, fixed-amount fields, friendly validation errors, and proposal-only success passed`);
  }
} catch (error) {
  if (active && !active.isClosed()) await active.screenshot({ path: 'tmp/coupon-proposal/failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close();
}
