import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from 'playwright/test';

// Capture the current UI with synthetic Storybook data only.
const origin = process.env.STORYBOOK_ORIGIN || 'http://localhost:6005';
const entries = Object.values((await fetch(`${origin}/index.json`).then(response => response.json())).entries);
const english = JSON.parse(await readFile('shared/en.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
try {
  for (const locale of ['ja', 'en']) {
    const label = value => locale === 'en' ? english[value] || value : value;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: locale === 'ja' ? 'ja-JP' : 'en-US', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push(`Unexpected real API request: ${route.request().url()}`); return route.abort(); });
    async function open(title, suffix) {
      const entry = entries.find(entry => entry.title === title && entry.id.endsWith(`--${suffix}`));
      assert.ok(entry, `${title}/${suffix}`);
      await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${locale}`);
    }
    async function capture(name, target, elementOnly = false, focusTitle = false) {
      await expect(target).toBeVisible();
      await target.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.evaluate(async () => { document.activeElement?.blur(); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.mouse.move(0, 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const frame = focusTitle ? await target.boundingBox() : undefined;
      const titleBounds = focusTitle ? await page.getByLabel(label('タイトル'), { exact: true }).boundingBox() : undefined;
      const clip = frame && titleBounds ? { x: frame.x, y: titleBounds.y - 24, width: frame.width, height: frame.width / 1.65 } : undefined;
      const bytes = await (elementOnly ? target : page).screenshot({ type: 'jpeg', quality: 88, animations: 'disabled', ...(clip ? { clip } : {}) });
      for (const root of ['public/manual', 'storybook-static/manual']) {
        // Updating an existing static build lets its manual preview use the same images.
        if (root.startsWith('storybook-static')) { try { await access('storybook-static/index.json'); } catch { continue; } }
        const folder = resolve(root, locale === 'en' ? 'en' : '');
        await mkdir(folder, { recursive: true }); await writeFile(resolve(folder, name), bytes);
      }
    }
    await open('運営/予約・お客様/予約管理', 'reservations');
    await expect(page.locator('.reservation-booking')).toHaveCount(2);
    await capture('09-bookings.jpg', page.locator('.reservations-panel'));

    await open('運営/予約・お客様/お客様', 'detail');
    await expect(page.locator('.customer-profile .customer-stats')).toBeVisible();
    await capture('57-customer-detail.jpg', page.locator('.customer-profile'), true);

    await open('運営/ブログ・お知らせ', 'blog-editor');
    const title = page.getByLabel(label('タイトル'), { exact: true });
    await expect(title).toBeVisible();
    await title.fill(label('秋の新しいデザインができました'));
    await page.getByRole('textbox', { name: label('記事の本文'), exact: true }).fill(label('季節の色を取り入れたデザインをご用意しました。お好みに合わせてご相談ください。'));
    await capture('16-blog-edit.jpg', page.locator('.post-editor'));
    await capture('58-blog-editor.jpg', page.locator('.post-editor'), false, true);
    assert.deepEqual(errors, []);
    console.log(`${locale}: refreshed bookings, customer detail, and current blog editor screenshots`);
    await context.close();
  }
} finally { await browser.close(); }
