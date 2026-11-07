import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import { proposePhoneRules } from '../server/phone-rules-ai.ts';
import * as intelligence from '../server/ai.ts';

process.env.DEMO_MODE = 'true'; delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const store = new Store(':memory:');
let generated = 0, shopNumber = 0;
const server = createApp(store, { ...intelligence, phoneRules: (config, rules, note, call) => proposePhoneRules(config, rules, note, call, {
  generate: async input => {
    generated++;
    const context = JSON.parse(input.contents[0].parts[0].text);
    assert.equal(context.call.transcript, 'Caller requested foot nails with removal.');
    return JSON.stringify({ rules: `${rules}\nCheck compatible addons.`, explanation: 'Added addon checks.', warnings: ['Register addon compatibility in menu settings.'] });
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
const entry = entries.find(entry => entry.title === '運営/設定/AI電話受付' && entry.id.endsWith('--rules'));
assert.ok(entry);
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
  await mkdir('tmp/phone-rules', { recursive: true });
  for (const language of ['ja', 'en']) for (const width of [1280, 390]) for (const mode of ['app', 'storybook']) {
    const label = text => language === 'en' ? catalog[text] || text : text;
    const shop = await store.createShop(`phone-rules-${language}-${width}-${mode}@example.com`);
    shop.published = structuredClone(sample); shop.publication = 'public';
    shop.phone = { enabled: true, twilioNumber: `+1831216${String(++shopNumber).padStart(4, '0')}`, cashBookings: true, rules: 'Keep the greeting brief.' };
    await store.saveShop(shop);
    await store.appendShopLog({ id: randomUUID(), shopId: shop.id, at: new Date().toISOString(), requestId: randomUUID(), kind: 'phone', operation: 'phone_call', ok: false, callId: `CA-${shop.id}`, outcome: 'error', transcript: 'Caller requested foot nails with removal.' });
    const token = randomUUID(); await store.put('session', digest(token), { user: { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id }, expires: Date.now() + 3600000 });
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
    const page = await context.newPage(), errors = [], live = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    if (mode === 'app') {
      await context.addCookies([{ name: 'gemihub_session', value: token, url: origin }]);
      await page.goto(`${origin}/?tab=settings&shop=${shop.id}&lang=${language}`);
    } else {
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) live.push(request.url()); });
      await page.goto(`${storyOrigin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${language}`);
    }
    const panel = page.locator('.phone-reception-settings');
    const rules = panel.getByRole('textbox', { name: label('電話AIの応対ルール'), exact: true });
    await expect(rules).toBeVisible({ timeout: 15000 });
    const manual = 'Keep the greeting brief. Ask before booking.';
    await rules.fill(manual);
    const recent = panel.locator('details:has(> .phone-calls)');
    await recent.locator('summary').first().click();
    await panel.getByRole('button', { name: label('この通話からルールを改善'), exact: true }).click();
    const note = panel.getByRole('textbox', { name: label('ルールの改善依頼'), exact: true });
    await note.fill('Improve addon checks and keep all existing rules.');
    const generate = panel.getByRole('button', { name: label('改善案を作る'), exact: true });
    const before = generated;
    if (mode === 'app' && language === 'ja' && width === 1280) {
      let lost = false;
      await page.route('**/phone/rules/ai', async route => {
        if (!lost) { lost = true; await route.fetch(); await route.abort('failed'); } else await route.continue();
      });
      await generate.click();
      await expect(panel.getByRole('alert')).toBeVisible();
      await expect(note).toHaveValue('Improve addon checks and keep all existing rules.');
      await expect(rules).toHaveValue(manual);
    }
    await generate.click();
    await expect(panel.locator('.settings-ai-review')).toBeVisible();
    await expect(rules).toBeDisabled();
    await expect(panel.locator('.settings-ai-change')).toContainText(manual);
    if (mode === 'app') {
      assert.equal(generated, before + 1, 'retry reuses the completed proposal');
      assert.equal((await store.shop(shop.id)).phone.rules, 'Keep the greeting brief.', 'generation does not save');
    }
    await panel.getByRole('button', { name: label('入力欄に反映'), exact: true }).click();
    await expect(rules).toBeEnabled();
    await expect(rules).toHaveValue(new RegExp('^' + manual.replaceAll('.', '\\.')));
    const draft = await rules.inputValue();
    if (mode === 'app') assert.equal((await store.shop(shop.id)).phone.rules, 'Keep the greeting brief.', 'applying the proposal does not save');
    await panel.getByRole('button', { name: label('電話受付の設定を保存'), exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText(label('電話受付の設定を保存しました。'));
    await expect(rules).toHaveValue(draft);
    if (mode === 'app') {
      assert.equal((await store.shop(shop.id)).phone.rules, draft);
      await page.reload(); await expect(rules).toHaveValue(draft);
      if (language === 'ja' && width === 1280) {
        await rules.fill('Local unsaved change');
        const fresh = await store.shop(shop.id); fresh.phone.rules = 'Changed in another tab'; await store.saveShop(fresh);
        await panel.getByRole('button', { name: label('電話受付の設定を保存'), exact: true }).click();
        await expect(panel.getByRole('alert')).toContainText('更新されています');
        await expect(rules).toHaveValue('Local unsaved change');
        await panel.getByRole('button', { name: label('最新の設定を読み込む'), exact: true }).click();
        await expect(rules).toHaveValue('Changed in another tab');
      }
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${mode} ${language} ${width}: overflow`);
    await panel.screenshot({ path: `tmp/phone-rules/${mode}-${language}-${width}.png` });
    assert.deepEqual(errors, []); assert.deepEqual(live, [], 'Storybook stays isolated from live API');
    console.log(`${mode} ${language} ${width}: rules, proposal, apply, save and persistence passed`);
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => stories.close(resolve));
  await new Promise(resolve => server.close(resolve));
  await store.close();
}
