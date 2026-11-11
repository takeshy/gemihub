import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, expect } from 'playwright/test';

// Capture real components with fictional Storybook data, never a live shop.
const root = resolve('storybook-static'), checkOnly = process.argv.includes('--check');
const english = JSON.parse(await readFile('shared/en.json', 'utf8'));
const entries = Object.values(JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8')).entries);
const shots = ['70-menu-addons.jpg', '71-customer-phone.jpg', '72-paypal-attention.jpg', '73-paypal-consult.jpg'];
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
  for (const locale of ['ja', 'en']) {
    const label = (text, ...values) => (locale === 'en' ? english[text] || text : text).replace(/\{(\d+)\}/g, (_, index) => values[index]);
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

    await open('運営/設定/メニュー・料金', 'addons');
    const addon = page.locator('.menu-edit-block').filter({ has: page.locator('.menu-option-settings') }).first();
    await expect(addon.getByRole('checkbox', { name: label('ほかのメニューに追加して予約する（単独予約不可）'), exact: true })).toBeChecked();
    await expect(addon.getByText(label('追加できるメニュー'), { exact: true })).toBeVisible();
    await expect(addon.getByLabel(label('選択グループ（同じグループは1つまで・任意）'))).toBeVisible();
    await capture(shots[0], addon);

    await open('運営/予約・お客様/お客様', 'list');
    const form = page.locator('.phone-customer');
    await form.locator('summary').click();
    await form.getByLabel(label('お名前'), { exact: true }).fill(locale === 'en' ? 'Mika Sato' : '佐藤 美香');
    await form.getByLabel(label('電話番号'), { exact: true }).fill('090-5550-0100');
    await capture(shots[1], page.locator('.customers'), true);
    await form.getByRole('button', { name: label('お客様を登録する'), exact: true }).click();
    await expect(form.getByRole('status')).toHaveText(label('{0} 様を登録しました。', locale === 'en' ? 'Mika Sato' : '佐藤 美香'));
    await page.getByLabel(label('氏名・メール・電話番号で検索')).fill('090-5550-0100');
    await expect(page.locator('.customers tbody tr')).toHaveCount(1);

    await open('運営/ダッシュボード/PayPal', 'attention');
    const alerts = page.locator('.paypal-alerts');
    await expect(alerts.getByRole('button', { name: label('今すぐチェック'), exact: true })).toBeEnabled();
    await expect(alerts.getByRole('button', { name: label('相談する'), exact: true }).first()).toBeVisible();
    await expect(alerts.getByRole('button', { name: label('承認して実行'), exact: true }).first()).toBeVisible();
    await alerts.locator('.paypal-alert-settings summary').click();
    await expect(alerts.getByRole('checkbox', { name: label('メールで通知する'), exact: true })).toBeVisible();
    await expect(alerts.getByLabel(label('ダイジェストの時刻'))).toBeVisible();
    await expect(alerts.getByRole('button', { name: label('通知設定を保存'), exact: true })).toBeVisible();
    await capture(shots[2], alerts, true);
    await alerts.getByRole('button', { name: label('相談する'), exact: true }).first().click();
    const proposals = page.locator('.paypal-proposals');
    await expect(proposals.getByRole('button', { name: label('承認して実行'), exact: true }).first()).toBeVisible();
    await capture(shots[3], proposals.locator('xpath=..'), true);

    await open('運営/使い方', 'manual');
    const manual = page.locator('.manual');
    await expect(manual).toBeVisible();
    // Every in-page link in the manual must lead to a section that exists.
    for (const href of await manual.locator('a[href^="#guide-"]').evaluateAll(links => links.map(link => link.getAttribute('href')))) {
      assert.equal(await page.locator(`[id="${href.slice(1)}"]`).count(), 1, `${locale}: ${href}`);
    }
    await expect(manual.locator('.manual-goals a')).toHaveText(['初めてお店を作る', '画面を直す', 'AIに相談する', '予約・決済・返金を管理する'].map(text => label(text)));
    await expect(page.locator('#guide-phone-calls .manual-related a')).toHaveAttribute('href', '#guide-customer-phone');
    await expect(page.locator('#guide-system .manual-related a')).toHaveAttribute('href', '#guide-paypal-attention');
    const prefix = locale === 'en' ? '/manual/en/' : '/manual/';
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await manual.locator('.manual-goals a').last().click();
      await expect(page.locator('#guide-operations')).toBeInViewport();
      for (const id of ['menu-addons', 'customer-phone', 'paypal-attention', 'system', 'phone-calls', 'mypage', 'customer-list', 'staff-login']) {
        const section = page.locator(`#guide-${id}`);
        await section.getByRole('heading').scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale}/${id}/${width}: no overflow`);
        for (const img of await section.locator('img').all()) {
          await img.scrollIntoViewIfNeeded();
          await expect.poll(() => img.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
        }
      }
      await page.locator('#guide-paypal-attention figure button').first().click();
      await expect(page.locator('.manual-dialog img')).toHaveAttribute('src', prefix + shots[2]);
      await page.getByRole('button', { name: label('拡大画像を閉じる'), exact: true }).click();
      await expect(page.locator('.manual-dialog')).not.toBeVisible();
    }
    if (locale === 'en') assert.doesNotMatch(await manual.innerText(), /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${locale}: add-on menus, phone customer registration, PayPal attention/consult, goal and related links, and manual images/zoom at 1280/390px passed.`);
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
