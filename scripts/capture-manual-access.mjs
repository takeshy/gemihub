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
      await open('運営/予約・お客様/お客様', 'traffic');
      const traffic = page.getByRole('region', { name: label('お店のアクセス数'), exact: true });
      await expect(traffic.locator('details')).toHaveAttribute('open', '');
      await traffic.getByLabel(label('アクセス数の集計期間'), { exact: true }).selectOption('7');
      await expect(traffic.locator('tbody tr')).toHaveCount(7);
      await capture(shots[0], traffic, width);
      await traffic.getByLabel(label('アクセス数の集計期間'), { exact: true }).selectOption('90');
      await expect(traffic.locator('tbody tr')).toHaveCount(90);
      await traffic.getByRole('button', { name: label('更新'), exact: true }).click();
      await expect(traffic.locator('tbody tr')).toHaveCount(90);

      await open('運営/ブログ・お知らせ', 'access');
      const articles = page.getByRole('region', { name: label('お店のアクセス数'), exact: true });
      await expect(articles.locator('details')).toHaveAttribute('open', '');
      await expect(articles.locator('tbody tr').first()).toBeVisible();
      await expect(articles.locator('thead')).toContainText(label('ユニーク（ブラウザ）'));
      await capture(shots[1], articles, width);

      await open('運営/予約・お客様/お客様', 'activity');
      const activity = page.getByRole('region', { name: label('行動履歴'), exact: true });
      for (const text of ['ログインした', '予約画面を開いた', 'マイページを開いた', '予約の支払いを開始した', '予約が確定した', 'キャンセルして代わりの予約を受け付けた', 'キャンセルを取り消した', '予約をキャンセルした']) {
        await expect(activity.getByRole('heading', { name: label(text), exact: true })).toHaveCount(1);
      }
      await capture(shots[2], activity, width);
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
    console.log(`${language}: traffic periods, article counts, all activity states, manual images and zoom passed at desktop/mobile widths`);
    await context.close();
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
