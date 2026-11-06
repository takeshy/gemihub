import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, expect } from 'playwright/test';

const root = resolve('storybook-static'), checkOnly = process.argv.includes('--check');
const english = JSON.parse(await readFile('shared/en.json', 'utf8'));
const entries = Object.values(JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8')).entries);
const shots = ['46-waitlist-register.jpg', '47-waitlist-manage.jpg'];
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
  await mkdir('tmp/manual-waitlist', { recursive: true });
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
      await focus.scrollIntoViewIfNeeded();
      await focus.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${language} ${width}px: no overflow`);
      await page.screenshot({ path: `tmp/manual-waitlist/${name}-${language}-${width}.png`, animations: 'disabled' });
      if (!checkOnly && width === 1280) {
        const bytes = await page.screenshot({ type: 'jpeg', quality: 86, animations: 'disabled' });
        for (const base of ['public/manual', 'storybook-static/manual']) {
          const folder = resolve(base, language === 'en' ? 'en' : ''); await mkdir(folder, { recursive: true });
          await writeFile(resolve(folder, name), bytes);
        }
      }
    }
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await open('お客様の画面/空き通知', 'registration');
      const form = page.locator('.waitlist-request');
      await expect(form).toHaveAttribute('open', '');
      await expect(form.getByRole('button', { name: label('空き通知を登録'), exact: true })).toBeEnabled();
      await expect(form).toContainText(label('選んだメニューと担当で、希望の時間帯に空きが出るとメールでお知らせします。通知では予約枠は確保されません。予約は先着順です。'));
      await capture(shots[0], form, width);
      await form.locator('input[type=time]').first().fill('10:00');
      await form.locator('input[type=time]').last().fill('18:00');
      await form.getByRole('checkbox', { name: label('お得な空き枠だけ知らせる'), exact: true }).check();
      await form.getByRole('button', { name: label('空き通知を登録'), exact: true }).click();
      await expect(page.getByText(label('空き通知を登録しました。マイページでいつでも止められます。'), { exact: true })).toBeVisible();
      await page.getByRole('button', { name: label('マイページ'), exact: true }).click();
      const wishes = page.locator('.waitlist-wishes');
      await expect(wishes.locator('.booking-card')).toHaveCount(1);
      await expect(wishes).toContainText('10:00–18:00');
      await expect(wishes).toContainText(label('お得な空き枠のみ'));
      await wishes.getByRole('button', { name: label('通知を止める'), exact: true }).click();
      await expect(wishes).toHaveCount(0);

      await open('お客様の画面/空き通知', 'registered');
      await expect(wishes.locator('.booking-card')).toHaveCount(2);
      const remaining = await wishes.locator('.booking-card').last().innerText();
      await capture(shots[1], wishes, width);
      await wishes.getByRole('button', { name: label('通知を止める'), exact: true }).first().click();
      await expect(wishes.locator('.booking-card')).toHaveCount(1);
      assert.equal(await wishes.locator('.booking-card').innerText(), remaining);
      await wishes.getByRole('button', { name: label('通知を止める'), exact: true }).click();
      await expect(wishes).toHaveCount(0);
    }
    await open('運営/使い方', 'manual');
    if (language === 'en') assert.doesNotMatch(await page.locator('.manual').innerText(), /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    const prefix = language === 'en' ? '/manual/en/' : '/manual/';
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const [index, id] of ['waitlist-register', 'waitlist-manage'].entries()) {
        const section = page.locator(`#guide-${id}`), image = section.locator('img');
        await expect(image).toHaveAttribute('src', prefix + shots[index]);
        assert.equal((await context.request.get(origin + prefix + shots[index])).status(), 200);
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate(image => image.complete && image.naturalWidth === 1280)).toBe(true);
        await section.getByRole('heading').scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${language} ${width}px/${id}: no overflow`);
      }
    }
    await page.locator('#guide-waitlist-register figure button').click();
    await expect(page.locator('.manual-dialog')).toBeVisible();
    await expect(page.locator('.manual-dialog img')).toHaveAttribute('src', prefix + shots[0]);
    await page.getByRole('button', { name: label('拡大画像を閉じる'), exact: true }).click();
    await expect(page.locator('.manual-dialog')).not.toBeVisible();
    assert.deepEqual(errors, []);
    console.log(`${language}: registration, independent stop actions, manual images and zoom passed at 1280px and 390px`);
    await context.close();
  }
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
