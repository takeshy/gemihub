import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, shopSchema } from '../server/domain.ts';
import { proposeSettings } from '../server/settings-ai.ts';
import { defaultRefundTiers } from '../server/payment-domain.ts';
import { digest } from '../server/auth.ts';
import { requestLocale } from '../server/i18n.ts';
import { tr } from '../shared/i18n.ts';
import * as intelligence from '../server/ai.ts';

process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:');
let generated = 0, fetched = 0;
const server = createApp(store, { ...intelligence, settings: (section, config, note) => proposeSettings(section, config, note, {
  readPage: async url => {
    fetched++;
    if (url.endsWith('/missing')) throw Object.assign(new Error(tr('参考URLを取得できませんでした。ログイン不要の公開ページを指定するか、内容をメモとして貼り付けてください。')), { status: 400 });
    return { url, title: 'Public reference', text: 'Shop name: Moon Atelier. Care: 90 minutes, 8500 yen.' };
  },
  generate: async () => {
    generated++;
    const facts = section === 'basic' ? { name: 'Moon Atelier' }
      : section === 'menus' ? { items: [{ id: config.menus[0].id, name: config.menus[0].name, price: 6500 }, { name: 'Care', duration: 90, price: 8500 }] }
      : section === 'staff' ? { items: [{ id: config.staff[0].id, name: config.staff[0].name, start: '09:00' }] }
      : section === 'hours' ? { start: '09:00' } : { payment: { refundTiers: [{ hoursBefore: 24, percent: 100 }, { hoursBefore: 12, percent: 80 }, { hoursBefore: 1, percent: 50 }, { hoursBefore: 0, percent: 0 }] } };
    return JSON.stringify({ facts, warnings: [] });
  },
}) });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
const root = resolve('storybook-static'), mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const stories = createServer(async (req, res) => {
  const file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  try { assert.ok(file.startsWith(root + '/')); res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => stories.listen(0, '127.0.0.1', resolve));
const storyOrigin = `http://127.0.0.1:${stories.address().port}`;
const entries = Object.values(JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8')).entries);
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
  await mkdir('tmp/settings-ai', { recursive: true });
  for (const language of ['ja', 'en']) for (const width of [1280, 390]) {
    const label = text => language === 'en' ? (catalog[text] || text) : text;
    const shop = await store.createShop(`settings-${language}-${width}@example.com`);
    shop.published = requestLocale.run(language, () => shopSchema.parse(structuredClone(sample)));
    shop.published.rules.payment = { enabled: true, refundTiers: structuredClone(defaultRefundTiers) };
    shop.publication = 'provisional'; await store.saveShop(shop);
    const token = randomUUID(); await store.put('session', digest(token), { user: { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id }, expires: Date.now() + 3600000 });
    for (const mode of ['app', 'storybook']) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
      const page = await context.newPage(), errors = [], live = [];
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      if (mode === 'app') { await context.addCookies([{ name: 'gemihub_session', value: token, url: origin }]); await page.goto(`${origin}/?lang=${language}`); }
      else page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) live.push(request.url()); });
      for (const section of ['basic', 'menus', 'staff', 'hours', 'rules']) {
        if (mode === 'app') {
          const menu = section === 'menus' ? 'メニュー・料金' : section === 'staff' ? 'スタッフ・勤務' : 'お店の基本情報';
          await page.locator('aside nav').getByRole('button', { name: new RegExp(label(menu) + '$') }).click();
        } else {
          const entry = entries.find(entry => entry.title === '運営/設定/AIで設定' && entry.id.endsWith(`--${section}`)); assert.ok(entry, section);
          await page.goto(`${storyOrigin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${language}`);
        }
        const panel = page.locator(`.live-settings-${section}`), toggle = panel.getByRole('button', { name: label('AIで設定'), exact: true });
        await expect(toggle).toBeEnabled();
        if (section === 'basic') await panel.locator('fieldset textarea').first().fill('Keep this manual description.');
        if (mode === 'storybook') await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        else await toggle.click();
        const notes = panel.getByLabel(label('メモ・参考URL'), { exact: true });
        const memo = section === 'rules' ? '12 hours 80% refund, 1 hour 50% refund; keep other tiers unchanged https://public.example/shop' : 'Shop name: Moon Atelier\nhttps://public.example/shop';
        await notes.fill(memo);
        const generate = panel.getByRole('button', { name: label('設定案を作る'), exact: true });
        const before = structuredClone((await store.shop(shop.id)).published), calls = generated;
        // A failed source must preserve the note and must not invoke the model.
        if (mode === 'app' && language === 'ja' && width === 1280 && section === 'basic') {
          await notes.fill('https://public.example/missing'); await generate.click();
          await expect(panel.getByRole('alert')).toContainText('参考URL'); await expect(notes).toHaveValue('https://public.example/missing'); assert.equal(generated, calls);
          await notes.fill(memo);
          // Lose a completed response, then retry: reuse the same server-side proposal and IDs.
          let lost = false;
          await page.route(`**/live-settings/${section}/ai`, async route => {
            if (!lost) { lost = true; await route.fetch(); await route.abort('failed'); } else await route.continue();
          });
          await generate.click(); await expect(panel.getByRole('alert')).toBeVisible(); await expect(generate).toBeEnabled();
          await expect(notes).toHaveValue(memo);
        }
        await generate.click();
        await expect(panel.getByRole('heading', { name: label('設定案を確認'), exact: true })).toBeVisible();
        await expect(panel.locator('.settings-ai-sources a')).toHaveAttribute('href', 'https://public.example/shop');
        await expect(panel.getByRole('button', { name: label('保存'), exact: true })).toBeDisabled();
        if (mode === 'app') { assert.deepEqual((await store.shop(shop.id)).published, before); assert.equal(generated, calls + 1); }
        if (section === 'rules') {
          const changes = panel.locator('.settings-ai-review dl');
          await expect(changes).toContainText('80%'); await expect(changes).toContainText('50%');
          assert.ok(!(await changes.innerText()).includes('[object Object]'));
        }
        await page.screenshot({ path: `tmp/settings-ai/${mode}-${language}-${width}-${section}.png`, fullPage: true });
        await panel.getByRole('button', { name: label('入力欄に反映'), exact: true }).click();
        await expect(notes).toHaveCount(0);
        if (section === 'basic') {
          await expect(panel.locator('fieldset input').first()).toHaveValue('Moon Atelier');
          await expect(panel.locator('fieldset textarea').first()).toHaveValue('Keep this manual description.');
        }
        if (section === 'rules') {
          const payment = panel.getByLabel(label('予約時にPayPalで全額お支払いいただく'), { exact: true });
          await expect(payment).toBeChecked({ checked: mode === 'app' });
          // A refund-only proposal preserves disabled payment. Enable it manually to inspect its tiers.
          if (mode === 'storybook') await payment.check();
          await expect(panel.getByLabel(label('返金条件{0}・返金率（%）').replace('{0}', '2'), { exact: true })).toHaveValue('80');
          await expect(panel.getByLabel(label('返金条件{0}・返金率（%）').replace('{0}', '3'), { exact: true })).toHaveValue('50');
        }
        if (mode === 'app') {
          assert.deepEqual((await store.shop(shop.id)).published, before, 'apply to form must not save');
          if (section === 'menus') { const row = panel.locator('.menu-edit-block').last(); await expect(row.getByLabel(label('メニュー名'), { exact: true })).toHaveValue('Care'); await expect(row.getByRole('checkbox', { name: label('有効'), exact: true })).not.toBeChecked(); }
        }
        await panel.getByRole('button', { name: label('保存'), exact: true }).click();
        await expect(panel.getByRole('status')).toContainText(label(mode === 'app' ? '保存して仮公開に反映しました。' : '保存して本番に反映しました。'));
        if (mode === 'app') assert.notDeepEqual((await store.shop(shop.id)).published, before, 'save persists the reviewed form');
        if (mode === 'app' && section === 'rules') {
          const payment = (await store.shop(shop.id)).published.rules.payment;
          assert.equal(payment.enabled, true); assert.equal(payment.refundTiers[1].percent, 80); assert.equal(payment.refundTiers[2].percent, 50);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${mode}/${language}/${width}/${section}: overflow`);
      }
      if (mode === 'storybook') {
        const entry = entries.find(entry => entry.title === '運営/設定/AIで設定' && entry.id.endsWith('--refunds')); assert.ok(entry);
        await page.goto(`${storyOrigin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${language}`);
        const panel = page.locator('.live-settings-rules');
        await expect(panel.getByLabel(label('メモ・参考URL'), { exact: true })).toHaveValue(label('12時間前まで80%返金、1時間前まで50%返金に変更。ほかの返金条件はそのまま。'));
        await panel.getByRole('button', { name: label('設定案を作る'), exact: true }).click();
        await expect(panel.locator('.settings-ai-review dl')).toContainText('80%');
        await expect(panel.locator('.settings-ai-review dl')).toContainText('70%');
      }
      assert.deepEqual(errors, []); assert.deepEqual(live, []);
      await context.close(); console.log(`${mode} ${language} ${width}px: all five sections, review/apply/save and responsive layout passed.`);
    }
  }
  assert.equal(generated, 20); assert.equal(fetched, 21);
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => stories.close(resolve)); await store.close();
}
