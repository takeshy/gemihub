import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, expect } from 'playwright/test';

// Capture only synthetic Storybook data; never contact the application API.
const root = resolve('storybook-static'), checkOnly = process.argv.includes('--check');
const english = JSON.parse(await readFile('shared/en.json', 'utf8'));
const entries = Object.values(JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8')).entries);
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
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
  for (const language of ['ja', 'en']) {
    const label = text => language === 'en' ? english[text] || text : text;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: language === 'en' ? 'en-US' : 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push(`Unexpected live API: ${route.request().url()}`); return route.abort(); });
    async function open(title, suffix) {
      const entry = entries.find(entry => entry.title === title && entry.id.endsWith(`--${suffix}`));
      assert.ok(entry, `${title}/${suffix}`);
      await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${language}`);
      await page.locator('#storybook-root h1, #storybook-root h2').first().waitFor({ state: 'attached' });
    }
    async function capture(name, focus, elementOnly = false) {
      await expect(focus).toBeVisible();
      await focus.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.evaluate(async () => { document.activeElement?.blur(); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.mouse.move(0, 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (!checkOnly) {
        const bytes = await (elementOnly ? focus : page).screenshot({ type: 'jpeg', quality: 88, animations: 'disabled' });
        for (const base of ['public/manual', 'storybook-static/manual']) {
          const folder = resolve(base, language === 'en' ? 'en' : '');
          await mkdir(folder, { recursive: true }); await writeFile(resolve(folder, name), bytes);
        }
      }
    }
    await open('運営/予約・お客様/お客様', 'list');
    await expect(page.locator('.customer-table tbody tr').first()).toBeVisible();
    await capture('26-customers.jpg', page.locator('#storybook-root h1:visible, #storybook-root h2:visible').first());

    await open('運営/分析', 'booking-cohorts');
    await expect(page.locator('.diagram-card svg')).toHaveCount(2);
    await capture('51-booking-conversion.jpg', page.locator('.diagram-card').nth(1));

    await open('運営/分析', 'staff-sales');
    await expect(page.locator('.diagram-card svg')).toHaveCount(1);
    await capture('52-staff-sales.jpg', page.locator('.booking-analytics'));
    await capture('56-sales-comparison.jpg', page.locator('.diagram-card'), true);

    await open('運営/分析', 'one-staff-trend');
    await expect(page.getByRole('combobox', { name: label('表示するスタッフ'), exact: true })).toHaveValue('haru');
    await expect(page.locator('.staff-menu-table tbody tr')).toHaveCount(3);
    await expect(page.locator('.diagram-card svg')).toHaveCount(1);
    await capture('53-staff-menu-sales.jpg', page.locator('.booking-analytics'));

    await open('運営/分析', 'menu-sales');
    await expect(page.locator('.diagram-card svg')).toHaveCount(2);
    await capture('54-menu-sales.jpg', page.locator('.menu-sales'));

    await open('運営/分析', 'addon-sales');
    await expect(page.getByRole('combobox', { name: label('売上推移のメニュー'), exact: true })).toHaveValue('care');
    await expect(page.locator('.diagram-card svg')).toHaveCount(2);
    await capture('55-menu-staff-sales.jpg', page.locator('.menu-sales .analytics-staff-filter'));

    await open('運営/使い方', 'manual');
    const prefix = `/manual/${language === 'en' ? 'en/' : ''}`;
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [section, names] of [
        ['customer-list', ['26-customers.jpg']],
        ['booking-conversion', ['51-booking-conversion.jpg']],
        ['staff-sales', ['52-staff-sales.jpg', '53-staff-menu-sales.jpg']],
        ['menu-sales', ['54-menu-sales.jpg', '55-menu-staff-sales.jpg']],
      ]) {
        const images = page.locator(`#guide-${section} figure img`);
        await expect(images).toHaveCount(names.length);
        for (const [index, name] of names.entries()) {
          const image = images.nth(index);
          await expect(image).toHaveAttribute('src', prefix + name);
          await image.scrollIntoViewIfNeeded();
          await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth === 1280)).toBe(true);
          await image.locator('..').click();
          await expect(page.locator('.manual-dialog img')).toHaveAttribute('src', prefix + name);
          await page.getByRole('button', { name: label('拡大画像を閉じる'), exact: true }).click();
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${language}/${section}/${width}: no overflow`);
      }
    }
    if (language === 'en') assert.doesNotMatch(await page.locator('.manual').innerText(), /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    assert.deepEqual(errors, []);
    console.log(`${language}: demo captures, manual images and zoom passed at desktop/mobile widths`);
    await context.close();
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
