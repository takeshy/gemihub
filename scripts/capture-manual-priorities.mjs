import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, expect } from 'playwright/test';

// Capture real components with fictional Storybook data, never a live shop.
const root = resolve('storybook-static'), checkOnly = process.argv.includes('--check');
const english = JSON.parse(await readFile('shared/en.json', 'utf8'));
const entries = Object.values(JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8')).entries);
const shots = ['59-phone-settings.jpg', '60-phone-calls.jpg', '61-design-compare.jpg', '62-design-mobile.jpg', '63-design-publish.jpg', '64-design-history.jpg', '65-menu-activation.jpg', '66-google-alerts.jpg', '67-phone-rules.jpg'];
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    assert.ok(file.startsWith(root + '/'));
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
  await mkdir('tmp/manual-priorities', { recursive: true });
  for (const locale of ['ja', 'en']) {
    const label = text => locale === 'en' ? english[text] || text : text;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: locale === 'ja' ? 'ja-JP' : 'en-US', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push(`Unexpected live API: ${route.request().url()}`); return route.abort(); });
    async function open(title, suffix) {
      const entry = entries.find(entry => entry.title === title && entry.id.endsWith(`--${suffix}`));
      assert.ok(entry, `${title}/${suffix}`);
      await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${locale}`);
    }
    async function capture(name, target, elementOnly = false) {
      await expect(target).toBeVisible();
      await target.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.evaluate(async () => { document.activeElement?.blur(); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale}/${name}: no overflow`);
      if (!checkOnly) {
        const bytes = await (elementOnly ? target : page).screenshot({ type: 'jpeg', quality: 88, animations: 'disabled' });
        for (const base of ['public/manual', 'storybook-static/manual']) {
          const folder = resolve(base, locale === 'en' ? 'en' : ''); await mkdir(folder, { recursive: true });
          await writeFile(resolve(folder, name), bytes);
        }
      }
    }
    await open('運営/設定/AI電話受付', 'rules');
    const phone = page.locator('.phone-reception-settings');
    await expect(phone.getByRole('button', { name: label('電話受付の設定を保存'), exact: true })).toBeEnabled();
    await phone.getByRole('checkbox', { name: label('時間帯を指定する（指定しない場合は常に応答）'), exact: true }).check();
    await capture(shots[0], phone, true);
    const calls = phone.locator('details').filter({ has: page.locator('.phone-calls') });
    await calls.locator('summary').first().click();
    await phone.getByText(label('通話記録を見る'), { exact: true }).click();
    await capture(shots[1], calls, true);
    await phone.getByRole('button', { name: label('この通話からルールを改善'), exact: true }).click();
    await phone.getByRole('button', { name: label('改善案を作る'), exact: true }).click();
    const proposal = phone.locator('.settings-ai-review');
    await expect(proposal).toBeVisible();
    await capture(shots[8], phone.locator('.settings-ai'), true);
    await proposal.getByRole('button', { name: label('入力欄に反映'), exact: true }).click();
    await expect(phone).toContainText(label('入力欄に反映しました。内容を確認し、「保存」でお店に反映してください。'));
    await phone.getByRole('button', { name: label('電話受付の設定を保存'), exact: true }).click();
    await expect(phone).toContainText(label('電話受付の設定を保存しました。'));

    await open('運営/画面の編集/同期と競合', 'local-changes');
    await expect(page.locator('.conflict-dialog[aria-label]')).toBeVisible();
    await capture(shots[2], page.locator('.editor-toolbar'));
    await page.getByRole('button', { name: label('比較を閉じる'), exact: true }).click();
    await page.getByRole('button', { name: label('スマートフォン'), exact: true }).click();
    await expect(page.locator('.local-preview-screen')).toHaveAttribute('data-device', 'phone');
    await capture(shots[3], page.locator('.editor-toolbar'));
    await page.getByRole('button', { name: label('PC'), exact: true }).click();
    await expect(page.locator('.local-preview-screen')).toHaveAttribute('data-device', 'pc');
    await page.getByRole('button', { name: label('反映する'), exact: true }).click();
    await capture(shots[4], page.locator('.editor-release-dialog[open]'), true);
    await expect(page.locator('.editor-release-dialog[open]').getByRole('button', { name: label('この内容を本番に反映'), exact: true })).toBeEnabled();

    await open('運営/画面の編集/版履歴', 'screen-only');
    await expect(page.locator('.design-version-list')).toBeVisible();
    await capture(shots[5], page.locator('main'), true);
    await page.getByRole('button', { name: label('この画面をこの版に戻す'), exact: true }).first().click();
    await expect(page.locator('.design-version-history .notice')).toBeVisible();

    await open('運営/設定/メニュー・料金', 'hidden-menus');
    const menus = page.locator('.live-settings-menus');
    await menus.getByRole('checkbox', { name: label('非表示も表示'), exact: true }).check();
    await expect(menus.locator('.menu-edit-block')).toHaveCount(2);
    await capture(shots[6], menus);

    await open('運営/ダッシュボード', 'google-integration');
    await expect(page.locator('.integration-alerts li')).toHaveCount(4);
    await expect(page.getByRole('link', { name: label('Googleに再接続する'), exact: true })).toBeVisible();
    await capture(shots[7], page.locator('.integration-alerts'), true);

    await open('運営/使い方', 'manual');
    const prefix = locale === 'en' ? '/manual/en/' : '/manual/';
    const guideIds = ['phone-settings', 'phone-calls', 'phone-rules', 'pen', 'design-restore', 'menu-activation', 'google-integration'];
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const id of guideIds) {
        const section = page.locator(`#guide-${id}`);
        await section.getByRole('heading').scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale}/${id}/${width}: no overflow`);
        for (const img of await section.locator('img').all()) {
          await img.scrollIntoViewIfNeeded();
          await expect.poll(() => img.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
        }
      }
      await page.locator('#guide-pen figure button').nth(1).click();
      await expect(page.locator('.manual-dialog')).toBeVisible();
      await expect(page.locator('.manual-dialog img')).toHaveAttribute('src', prefix + shots[2]);
      await page.getByRole('button', { name: label('拡大画像を閉じる'), exact: true }).click();
      await expect(page.locator('.manual-dialog')).not.toBeVisible();
    }
    const reservation = await page.locator('#guide-reservation ol').innerText();
    assert.ok(reservation.indexOf(label('お名前と「お店へのメッセージ（任意）」を確認します。クーポンを使う場合は予約の確認欄で1枚選び、割引後の合計金額とキャンセル条件を確認します。')) < reservation.indexOf(label('支払いが必要な場合は支払額と返金条件にチェックを入れ、「PayPalで支払いへ進む」から承認します。お店のページに戻り、予約確定を確認してください。支払いが不要な場合は「この内容で予約する」を押します。プレビューでは実際のお支払いは行いません。')));
    if (locale === 'en') assert.doesNotMatch(await page.locator('.manual').innerText(), /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${locale}: phone setup/calls/rules, comparison/mobile/publication, history restoration, hidden menus, Google alerts, and manual images/zoom at 1280/390px passed.`);
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
