import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, expect } from 'playwright/test';

// All coupon interactions run against isolated Storybook fixtures.
const root = resolve('storybook-static'), checkOnly = process.argv.includes('--check');
const english = JSON.parse(await readFile('shared/en.json', 'utf8'));
const entries = Object.values(JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8')).entries);
const shots = ['42-coupon-proposal.jpg', '43-coupon-activation.jpg', '44-coupon-manual.jpg', '45-coupon-campaigns.jpg'];
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
  await mkdir('tmp/manual-coupons', { recursive: true });
  for (const language of ['ja', 'en']) {
    const label = (text, ...values) => (language === 'en' ? english[text] || text : text).replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)]));
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: language === 'ja' ? 'ja-JP' : 'en-US', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) errors.push(`Unexpected live API request: ${request.url()}`); });
    async function open(title, suffix) {
      const entry = entries.find(entry => entry.title === title && entry.id.endsWith(`--${suffix}`));
      assert.ok(entry, `${title}/${suffix}`);
      await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${language}`);
      await page.locator('#storybook-root h1, #storybook-root h2').first().waitFor({ state: "attached" });
    }
    async function capture(name, focus) {
      await expect(focus).toBeVisible();
      await focus.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const bytes = await page.screenshot({ type: 'jpeg', quality: 86, animations: 'disabled' });
      for (const base of ['public/manual', 'storybook-static/manual']) {
        const folder = resolve(base, language === 'en' ? 'en' : ''); await mkdir(folder, { recursive: true });
        await writeFile(resolve(folder, name), bytes);
      }
    }
    if (!checkOnly) {
      await open('運営/予約・お客様/クーポン', 'management');
      const panel = page.locator('.coupon-management');
      await panel.locator('.coupon-actions').getByRole('button', { name: label('新しく作る'), exact: true }).click();
      await panel.getByRole('textbox', { name: label('作りたいクーポン'), exact: true }).fill(language === 'ja' ? '誕生日月の会員に毎月1日9時に20%引き、30日間有効。' : '20% off for members in their birthday month, issued on the 1st at 9 AM, valid for 30 days.');
      await panel.getByRole('button', { name: label('クーポン案を作る'), exact: true }).click();
      const form = panel.locator('.coupon-create > form');
      await expect(form.getByLabel(label('クーポン名'), { exact: true })).toHaveValue(label('誕生日月'));
      await expect(form.getByRole('button', { name: label('この内容で自動配布を有効にする'), exact: true })).toBeEnabled();
      await capture(shots[0], panel.locator('.coupon-create'));
      await capture(shots[1], form.locator('.coupon-condition').first());

      await panel.locator('.coupon-actions').getByRole('button', { name: label('手動付与'), exact: true }).click();
      const manual = panel.locator('.manual-coupons');
      await manual.locator('input[type=checkbox]').first().check();
      await expect(manual.getByRole('button', { name: label('選んだ{0}人に付与する', 1), exact: true })).toBeEnabled();
      await expect(manual.locator('.selected-recipients')).toContainText('guest@example.com');
      await capture(shots[2], panel.locator('.coupon-workspace-title'));

      await panel.locator('.coupon-actions').getByRole('button', { name: label('配布中・停止中のクーポン'), exact: true }).click();
      await panel.getByRole('button', { name: label('配布を停止'), exact: true }).first().click();
      await expect(panel.locator('.coupon-campaigns .booking-card').first()).toContainText(label('配布停止中'));
      await capture(shots[3], panel);
    }

    await open('運営/使い方', 'manual');
    const chapter = page.locator('#guide-coupons');
    await expect(chapter.getByRole('heading', { name: label('クーポンを作成・配布する'), exact: true })).toBeVisible();
    await expect(page.locator('.manual-toc a[href="#guide-coupons"]')).toHaveText(new RegExp(label('クーポンを作成・配布する')));
    for (const text of ['クーポンを作成して、自動配布を有効にする', '選んだ会員にクーポンを手動で付与する', 'クーポンの配布を停止・再開する']) {
      await expect(chapter.getByRole('heading', { name: label(text), exact: true })).toHaveCount(1);
    }
    const instructions = await page.locator('.manual').innerText();
    if (language === 'en') assert.doesNotMatch(instructions, /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    const prefix = language === 'en' ? '/manual/en/' : '/manual/';
    assert.deepEqual(await chapter.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src'))), shots.map(name => prefix + name));
    for (const path of await page.locator('.manual img').evaluateAll(images => images.map(image => image.getAttribute('src')))) {
      assert.equal((await context.request.get(origin + path)).status(), 200, path);
    }
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const id of ['coupons-create', 'coupons-manual', 'coupons-manage']) {
        const section = page.locator(`#guide-${id}`);
        await section.scrollIntoViewIfNeeded();
        for (const image of await section.locator('img').all()) {
          await image.scrollIntoViewIfNeeded();
          await expect.poll(() => image.evaluate(image => image.complete && image.naturalWidth === 1280)).toBe(true);
        }
        await section.getByRole('heading').scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${language} ${width}px/${id}: no overflow`);
        await page.screenshot({ path: `tmp/manual-coupons/${id}-${language}-${width}.png`, fullPage: false });
      }
    }
    await page.locator('#guide-coupons-create figure button').first().click();
    await expect(page.locator('.manual-dialog')).toBeVisible();
    await expect(page.locator('.manual-dialog img')).toHaveAttribute('src', prefix + shots[0]);
    await page.getByRole('button', { name: label('拡大画像を閉じる'), exact: true }).click();
    await expect(page.locator('.manual-dialog')).not.toBeVisible();
    assert.deepEqual(errors, []);
    console.log(`${language}: ${checkOnly ? 'checked' : 'captured'} 4 coupon screenshots; chapter, translations, all manual image URLs, zoom and desktop/mobile layouts passed`);
    await context.close();
  }
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
