import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, expect } from 'playwright/test';

const root = resolve('storybook-static'), checkOnly = process.argv.includes('--check');
const english = JSON.parse(await readFile('shared/en.json', 'utf8'));
const entries = Object.values(JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8')).entries);
const shots = ['48-daily-traffic.jpg', '49-article-traffic.jpg', '50-customer-activity.jpg'];
const sections = ['shop-traffic', 'article-access', 'customer-activity'];
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    assert.ok(file.startsWith(root + '/'));
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
  await mkdir('tmp/manual-access', { recursive: true });
  for (const language of ['ja', 'en']) {
    const label = text => language === 'en' ? english[text] || text : text;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: language === 'ja' ? 'ja-JP' : 'en-US', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) errors.push(`Unexpected live API request: ${request.url()}`); });
    async function open(title, suffix) {
      const entry = entries.find(entry => entry.title === title && entry.id.endsWith(`--${suffix}`));
      assert.ok(entry, `${title}/${suffix}`);
      await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${language}`);
      await page.locator('#storybook-root h1, #storybook-root h2').first().waitFor({ state: 'attached' });
    }
    async function capture(name, focus, width) {
      await expect(focus).toBeVisible(); await focus.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      await page.mouse.move(0, 0);
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${language}/${width}: no page overflow`);
      await page.screenshot({ path: `tmp/manual-access/${name}-${language}-${width}.png`, animations: 'disabled' });
      if (!checkOnly && width === 1280) {
        const bytes = await page.screenshot({ type: 'jpeg', quality: 86, animations: 'disabled' });
        for (const base of ['public/manual', 'storybook-static/manual']) {
          const folder = resolve(base, language === 'en' ? 'en' : ''); await mkdir(folder, { recursive: true }); await writeFile(resolve(folder, name), bytes);
        }
      }
    }
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await open('運営/分析', 'daily-traffic');
      const traffic = page.getByRole('region', { name: label('お店のアクセス数'), exact: true });
      await expect(traffic.locator('details').first()).toHaveAttribute('open', '');
      await traffic.getByLabel(label('アクセス数の集計期間'), { exact: true }).selectOption('7');
      await expect(traffic.locator('tbody tr')).toHaveCount(7);
      await capture(shots[0], traffic, width);
      await traffic.getByLabel(label('アクセス数の集計期間'), { exact: true }).selectOption('90');
      const dailyNavigation = traffic.getByRole('navigation', { name: label('{0}のページ切替').replace('{0}', label('日別の訪問数')), exact: true });
      const dates = [];
      for (let index = 0; index < 9; index++) {
        await expect(traffic.locator('tbody tr')).toHaveCount(10);
        dates.push(...await traffic.locator('tbody time').allTextContents());
        if (index < 8) await dailyNavigation.getByRole('button', { name: label('次のページ'), exact: true }).click();
      }
      assert.equal(new Set(dates).size, 90, 'Every day appears on exactly one page');
      await expect(dailyNavigation.getByRole('button', { name: label('次のページ'), exact: true })).toBeDisabled();
      await traffic.getByRole('button', { name: label('更新'), exact: true }).click();
      await expect(traffic.locator('tbody tr')).toHaveCount(10);
      await expect(dailyNavigation.getByRole('button', { name: label('前のページ'), exact: true })).toBeDisabled();

      await open('運営/分析', 'article-traffic');
      const articles = page.getByRole('region', { name: label('お店のアクセス数'), exact: true });
      await expect(articles.locator('details').first()).toHaveAttribute('open', '');
      await expect(articles.locator('tbody tr').first()).toBeVisible();
      await expect(articles.locator('thead')).toContainText(label('ユニーク（ブラウザ）'));
      await capture(shots[1], articles, width);

      await open('運営/予約・お客様/お客様', 'activity');
      const activity = page.getByRole('region', { name: label('行動履歴'), exact: true });
      for (const text of ['ログインした', '予約画面を開いた', 'マイページを開いた', '予約の支払いを開始した', '予約が確定した', 'キャンセルして代わりの予約を受け付けた', 'キャンセルを取り消した', '予約をキャンセルした']) {
        await expect(activity.getByRole('heading', { name: label(text), exact: true })).toHaveCount(1);
      }
      await capture(shots[2], activity, width);
      assert.ok(await activity.evaluate(element => element.nextElementSibling === null), 'Activity history is the last customer detail section');

      await open('運営/予約・お客様/お客様', 'activity-long');
      const longActivity = page.getByRole('region', { name: label('行動履歴'), exact: true });
      const nav = (scope, name) => scope.getByRole('navigation', { name: label('{0}のページ切替').replace('{0}', label(name)), exact: true });
      const next = navigation => navigation.getByRole('button', { name: label('次のページ'), exact: true });
      const previous = navigation => navigation.getByRole('button', { name: label('前のページ'), exact: true });
      const activityNavigation = nav(longActivity, '行動履歴');
      await expect(longActivity.locator('ol > li')).toHaveCount(10);
      await expect(previous(activityNavigation)).toBeDisabled();
      await next(activityNavigation).click(); await expect(longActivity.locator('ol > li')).toHaveCount(10);
      await next(activityNavigation).click(); await expect(longActivity.locator('ol > li')).toHaveCount(3);
      await expect(next(activityNavigation)).toBeDisabled();
      await previous(activityNavigation).click(); await expect(longActivity.locator('ol > li')).toHaveCount(10);
      await longActivity.getByRole('button', { name: label('更新'), exact: true }).click();
      await expect(longActivity.locator('ol > li')).toHaveCount(10);
      await expect(previous(activityNavigation)).toBeDisabled();

      await open('運営/予約・お客様/お客様', 'paged-detail');
      const bookings = page.getByRole('region', { name: label('予約内容'), exact: true });
      const upcoming = bookings.locator('div[tabindex="-1"]').first();
      await expect(upcoming.locator('.customer-booking')).toHaveCount(10);
      await next(nav(bookings, '今後の予約')).click();
      await expect(upcoming.locator('.customer-booking')).toHaveCount(10);
      await next(nav(bookings, '今後の予約')).click();
      await expect(upcoming.locator('.customer-booking')).toHaveCount(3);
      await bookings.locator('summary').click();
      const past = bookings.locator('details');
      await expect(past.locator('.customer-booking')).toHaveCount(10);
      await next(nav(past, '過去の予約・キャンセル')).click();
      await expect(past.locator('.customer-booking')).toHaveCount(10);
      await expect(upcoming.locator('.customer-booking')).toHaveCount(3);
      const responses = page.getByRole('region', { name: label('お問い合わせへの対応'), exact: true });
      await expect(responses.locator('.customer-inquiry-target:visible')).toHaveCount(10);
      await responses.getByRole('combobox', { name: label('対応の種類'), exact: true }).first().selectOption('email');
      const replyDraft = responses.getByRole('textbox', { name: label('対応内容'), exact: true }).first();
      await replyDraft.fill('Draft kept across pages');
      await next(nav(responses, 'お問い合わせへの対応')).click();
      await expect(responses.locator('.customer-inquiry-target:visible')).toHaveCount(10);
      await previous(nav(responses, 'お問い合わせへの対応')).click();
      await expect(replyDraft).toHaveValue('Draft kept across pages');
      const timeline = page.getByRole('heading', { name: label('お客様のタイムライン'), exact: true }).locator('..');
      await expect(timeline.locator('ol > li:visible')).toHaveCount(10);
      await next(nav(timeline, 'お客様のタイムライン')).click();
      await timeline.getByRole('checkbox', { name: label('予約'), exact: true }).uncheck();
      await expect(previous(nav(timeline, 'お客様のタイムライン'))).toBeDisabled();
      await timeline.getByRole('checkbox', { name: label('お問い合わせ'), exact: true }).uncheck();
      await expect(timeline.locator('ol > li:visible')).toHaveCount(10);
      await timeline.getByRole('button', { name: label('メモを編集'), exact: true }).first().click();
      const noteDraft = timeline.getByRole('textbox', { name: label('メモ本文'), exact: true }).first();
      await noteDraft.fill('Note draft kept across pages');
      await next(nav(timeline, 'お客様のタイムライン')).click();
      await previous(nav(timeline, 'お客様のタイムライン')).click();
      await expect(noteDraft).toHaveValue('Note draft kept across pages');
      await timeline.getByRole('checkbox', { name: label('メモ'), exact: true }).uncheck();
      await expect(timeline.locator('ol > li:visible')).toHaveCount(0);
      await expect(timeline.locator('.pagination')).toHaveCount(0);
      await timeline.getByRole('checkbox', { name: label('お問い合わせ'), exact: true }).check();
      await next(nav(timeline, 'お客様のタイムライン')).click();
      const inquiryLink = timeline.getByRole('button', { name: label('お問い合わせの対応を見る'), exact: true }).first();
      await inquiryLink.click();
      await expect(responses.locator('.customer-inquiry-target:visible')).toHaveCount(10);
      assert.ok(await responses.locator('.customer-inquiry-target:visible').evaluateAll(nodes => nodes.some(node => node === document.activeElement)), 'Timeline link focuses the inquiry on its page');

      await open('運営/予約・お客様/お客様', 'paged-inquiry');
      const linkedInquiry = page.locator('[data-inquiry-id="pagination-inquiry-22"]');
      await expect(linkedInquiry).toBeVisible(); await expect(linkedInquiry).toBeFocused();
      const linkedResponses = page.getByRole('region', { name: label('お問い合わせへの対応'), exact: true });
      await expect(linkedResponses.locator('.customer-inquiry-target:visible')).toHaveCount(3);
      await expect(next(nav(linkedResponses, 'お問い合わせへの対応'))).toBeDisabled();

      await open('運営/予約・お客様/お客様', 'paged-list');
      await expect(page.locator('.customer-table tbody tr')).toHaveCount(10);
      const customerNav = nav(page, 'お客様一覧');
      await next(customerNav).click(); await expect(page.locator('.customer-table tbody tr')).toHaveCount(10);
      await next(customerNav).click(); await expect(page.locator('.customer-table tbody tr')).toHaveCount(4);
      await page.getByRole('searchbox', { name: label('氏名・メール・電話番号で検索'), exact: true }).fill('customer23@');
      await expect(page.locator('.customer-table tbody tr')).toHaveCount(1);
      await page.getByRole('searchbox', { name: label('氏名・メール・電話番号で検索'), exact: true }).fill('');
      await expect(page.locator('.customer-table tbody tr')).toHaveCount(10);
      await expect(previous(customerNav)).toBeDisabled();

      await open('運営/予約・お客様/予約管理', 'pagination');
      await page.getByRole('button', { name: label('絞り込みを解除'), exact: true }).click();
      await expect(page.locator('.booking-list > .booking-card')).toHaveCount(10);
      await next(nav(page, '予約一覧')).click();
      await expect(page.locator('.booking-list > .booking-card')).toHaveCount(10);
      await page.getByRole('combobox', { name: label('スタッフ'), exact: true }).selectOption('aoi');
      await expect(previous(nav(page, '予約一覧'))).toBeDisabled();

      await open('運営/予約・お客様/お問い合わせ', 'pagination');
      await expect(page.locator('.inquiry-list-item')).toHaveCount(10);
      await next(nav(page, 'お問い合わせ一覧')).click();
      await page.getByRole('searchbox', { name: label('お問い合わせを検索'), exact: true }).fill(label('お問い合わせ') + ' 23');
      await expect(page.locator('.inquiry-list-item')).toHaveCount(1);
      await page.getByRole('searchbox', { name: label('お問い合わせを検索'), exact: true }).fill('');
      await expect(page.locator('.inquiry-list-item')).toHaveCount(10);
      await expect(previous(nav(page, 'お問い合わせ一覧'))).toBeDisabled();

      await open('運営/ブログ・お知らせ', 'pagination');
      await expect(page.locator('.post-management-item')).toHaveCount(10);
      await next(nav(page, 'お店のお便り')).click();
      await expect(page.locator('.post-management-item')).toHaveCount(10);
      await next(nav(page, 'お店のお便り')).click();
      await expect(page.locator('.post-management-item')).toHaveCount(3);
      await expect(next(nav(page, 'お店のお便り'))).toBeDisabled();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${language}/${width}/pagination: no overflow`);
    }
    await open('運営/使い方', 'manual');
    if (language === 'en') assert.doesNotMatch(await page.locator('.manual').innerText(), /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    const prefix = language === 'en' ? '/manual/en/' : '/manual/';
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const [index, id] of sections.entries()) {
        const section = page.locator(`#guide-${id}`), image = section.locator('img');
        await expect(image).toHaveAttribute('src', prefix + shots[index]);
        assert.equal((await context.request.get(origin + prefix + shots[index])).status(), 200);
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate(image => image.complete && image.naturalWidth === 1280)).toBe(true);
        await section.locator('figure button').click();
        await expect(page.locator('.manual-dialog')).toBeVisible();
        await expect(page.locator('.manual-dialog img')).toHaveAttribute('src', prefix + shots[index]);
        await page.getByRole('button', { name: label('拡大画像を閉じる'), exact: true }).click();
        await expect(page.locator('.manual-dialog')).not.toBeVisible();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${language}/${width}/${id}: no overflow`);
      }
    }
    assert.deepEqual(errors, []);
    console.log(`${language}: traffic periods, all list pagination, deep inquiry links, reply/note drafts, activity states, manual images and zoom passed at desktop/mobile widths`);
    await context.close();
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
