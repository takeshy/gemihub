import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, expect } from 'playwright/test';
import { drawAnnotationCircle } from './draw-annotation-circle.mjs';

const root = resolve('storybook-static'), checkOnly = process.argv.includes('--check');
const english = JSON.parse(await readFile('shared/en.json', 'utf8'));
const entries = Object.values(JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8')).entries);
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
    const label = text => locale === 'en' ? english[text] || text : text;
    const context = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: locale === 'ja' ? 'ja-JP' : 'en-US', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push(`Unexpected real API: ${route.request().url()}`); return route.abort(); });
    async function open(title, suffix) {
      const entry = entries.find(entry => entry.title === title && entry.id.endsWith(`--${suffix}`));
      assert.ok(entry, `${title}/${suffix}`);
      await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${locale}`);
    }
    async function capture(name, target) {
      await expect(target).toBeVisible();
      await target.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.evaluate(async () => { document.activeElement?.blur(); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale}/${name}: no overflow`);
      if (!checkOnly) {
        const bytes = await page.screenshot({ type: 'jpeg', quality: 88, animations: 'disabled' });
        for (const base of ['public/manual', 'storybook-static/manual']) {
          const folder = resolve(base, locale === 'en' ? 'en' : ''); await mkdir(folder, { recursive: true }); await writeFile(resolve(folder, name), bytes);
        }
      }
    }
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 950 });
      await open('運営/設定/公開の設定', 'published-history');
      const entry = page.locator('.publication-review-entry');
      const link = entry.getByRole('link', { name: label('画面の確認・本番公開'), exact: true });
      await expect(link).toHaveAttribute('href', '/publication-preview/story-shop');
      if (width === 1280) await capture('68-history-entry.jpg', entry);
      await link.click();
      const review = page.locator('.publication-preview');
      await expect(review.locator('.pill')).toHaveText(label('本番公開済み'));
      await expect(review.getByRole('button', { name: label('本番公開する'), exact: true })).toHaveCount(0);
      await expect(review).toContainText(label('本番公開済みです。下の版履歴から、公開済みのデザイン全体を復元できます。'));
      const history = review.locator('.design-version-history');
      await history.locator('summary').click();
      const restore = history.getByRole('button', { name: label('この版に戻す'), exact: true });
      await expect(restore).toBeEnabled();
      await expect(history.getByRole('button', { name: label('この画面をこの版に戻す'), exact: true })).toHaveCount(0);
      if (width === 1280) await capture('69-published-history.jpg', review);
      await restore.click();
      await expect(history.locator('.notice')).toBeVisible();
      await expect(review.locator('.pill')).toHaveText(label('本番公開済み'));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await page.setViewportSize({ width: 1280, height: 950 });
    await open('運営/画面の編集/AIとお店をつくる', 'local-editor');
    await page.getByRole('treeitem', { name: label('ページ全体'), exact: true }).click();
    await page.getByRole('button', { name: label('修正する'), exact: true }).click();
    const canvas = page.locator('.annotation-canvas');
    await expect.poll(() => canvas.evaluate(element => element.height)).toBeGreaterThan(100);
    await drawAnnotationCircle(page, canvas);
    await page.locator('.visual-chat-panel').getByRole('textbox').fill(locale === 'ja' ? '赤丸で囲んだお店の名前を、もっと大きくしてください。' : 'Make the shop name circled in red larger.');
    await capture('22-pen.jpg', page.locator('.editor-toolbar'));

    await open('運営/お店づくり/仮公開・本番公開', 'production-preview');
    const provisional = page.locator('.publication-preview');
    await expect(provisional.locator('.pill')).toHaveText(label('仮公開中・本人のみ閲覧'));
    await provisional.getByRole('button', { name: label('本番公開する'), exact: true }).click();
    await expect(provisional.locator('.pill')).toHaveText(label('本番公開済み'));
    await expect(provisional).toContainText(label('本番公開しました。ログインしていない方もページを表示できます。'));

    await open('運営/使い方', 'manual');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 950 });
      const guide = page.locator('#guide-design-restore');
      await expect(guide).toContainText(label('「公開の設定」の「画面の確認・本番公開」を開き、その画面の「版履歴」から全体の履歴を確認します。この入口は本番公開後も使えます。'));
      for (const name of ['68-history-entry.jpg', '69-published-history.jpg', '22-pen.jpg']) {
        const img = page.locator(`.manual img[src$="/${name}"]`);
        await img.scrollIntoViewIfNeeded();
        await expect.poll(() => img.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
        await img.locator('..').click();
        await expect(page.locator('.manual-dialog')).toBeVisible();
        await page.getByRole('button', { name: label('拡大画像を閉じる'), exact: true }).click();
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    assert.deepEqual(errors, []); await context.close();
    console.log(`${locale}: published settings → full history → restore at 1280/390px; closed red circle pixels; manual images and zoom passed.`);
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
