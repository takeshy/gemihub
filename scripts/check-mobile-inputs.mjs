import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium, expect } from 'playwright/test';

const root = resolve('storybook-static');
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, `.${new URL(req.url, 'http://localhost').pathname}`);
    assert.ok(path.startsWith(root + '/'));
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg' })[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const entries = Object.values(JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8')).entries);
const catalog = JSON.parse(await readFile('shared/en.json', 'utf8'));
const requested = [
  ['Menus'], ['Staff'], ['Reservations'], ['Inquiries'], ['Customers'], ['ImageLibrary'], ['Data'],
  ['SettingsAi', 'Basic'], ['SettingsAi', 'Hours'], ['SettingsAi', 'Rules'],
  ['BuildStart'], ['BuildRequests'], ['Customer', 'Customer'], ['Customer', 'Contact'],
  ['Registration', 'Registration'], ['EmailLogin', 'Email'], ['Blog', 'BlogEditor'],
  ['Blog', 'RichTextArticle'], ['Blog', 'BlogEditor', 'ai'], ['Editor', 'LocalEditor', 'header'], ['Editor', 'LocalEditor', 'theme'],
].map(([file, name, screen]) => {
  const entry = entries.find(entry => entry.type === 'story' && entry.importPath.endsWith(`/${file}.stories.tsx`) && (!name || entry.exportName === name));
  assert.ok(entry, `${file}/${name || 'first'}`); return { entry, screen };
});
let browser, controls = 0;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
  await mkdir('tmp/mobile-inputs', { recursive: true });
  for (const language of ['ja', 'en']) {
    const label = text => language === 'en' ? catalog[text] || text : text;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    for (const { entry, screen } of requested) {
      await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${language}`);
      await page.locator('#storybook-root h1, #storybook-root h2').first().waitFor({ state: 'attached' });
      if (entry.exportName === 'RichTextArticle') await page.locator('.article-wysimark [contenteditable=true]').waitFor();
      if (screen === 'ai') {
        await page.getByRole('textbox', { name: label('タイトル'), exact: true }).fill('Input font audit');
        await page.getByRole('textbox', { name: label('記事の本文'), exact: true }).fill('A sample article for checking mobile text input.');
        await page.getByRole('button', { name: label('下書き保存'), exact: true }).click();
        await page.getByRole('button', { name: label('AIで修正'), exact: true }).click();
        await page.locator('.article-ai-chat textarea').waitFor();
      }
      if (entry.importPath.endsWith('/SettingsAi.stories.tsx')) await page.locator('.settings-ai textarea').waitFor();
      if (screen && screen !== 'ai') {
        await page.locator('.local-preview-screen').waitFor();
        await page.locator('.mobile-menu-toggle').click();
        await page.locator('aside nav').getByRole('button', { name: new RegExp(label('AIとお店をつくる') + '$') }).click();
        if (await page.locator('.mobile-menu-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('.mobile-menu-toggle').click();
        await page.getByRole('treeitem', { name: label('ページ全体'), exact: true }).click();
        await page.locator('summary').filter({ hasText: label('ページ全体の HTML を編集') }).click();
        await page.locator('textarea.code-input').first().waitFor();
      }
      await page.evaluate(() => {
        document.querySelectorAll('.editor-secondary details, .live-settings details, .article-ai-chat details').forEach(element => { element.open = true; });
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const audit = await page.evaluate(() => {
        const excluded = new Set(['hidden', 'checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'image', 'color']);
        const fields = [...document.querySelectorAll('input,textarea,select,[contenteditable]')].filter(element => {
          if (element instanceof HTMLInputElement && excluded.has(element.type)) return false;
          if (element.getAttribute('contenteditable') === 'false' || element.closest('[aria-hidden=true]')) return false;
          const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
          return bounds.width > 1 && bounds.height > 1 && style.visibility !== 'hidden' && style.display !== 'none';
        });
        return { count: fields.length, small: fields.filter(element => parseFloat(getComputedStyle(element).fontSize) < 16).map(element => ({ tag: element.tagName, type: element.type, label: element.getAttribute('aria-label') || element.closest('label')?.textContent, font: getComputedStyle(element).fontSize })) };
      });
      assert.deepEqual(audit.small, [], `${language} ${entry.id} ${screen || ''}: no small mobile input text`); controls += audit.count;
      if (screen === 'header' || entry.exportName === 'Contact') await page.screenshot({ path: `tmp/mobile-inputs/${language}-${screen || 'contact'}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []); await context.close();
    console.log(`${language}: checked rendered controls in ${requested.length} mobile screens, editors and dialogs.`);
  }
  // A late theme rule with !important must not shrink slotted form controls.
  // Touch landscape also needs protection even above the phone width breakpoint.
  for (const [touch, width] of [[true, 844], [false, 1280]]) {
    const context = await browser.newContext({ viewport: { width, height: 600 }, isMobile: touch, hasTouch: touch });
    const page = await context.newPage();
    const css = await readFile('src/style.css', 'utf8');
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>.theme .slotted input,.theme .slotted textarea,.theme .slotted select,.theme .slotted [contenteditable]{font-size:11px!important}</style><div class="theme"><div class="slotted"><input value="Text"><textarea class="code-input">HTML</textarea><select><option>Select</option></select><div contenteditable="true">Editable</div></div></div><div style="font-size:24px"><input id="large" value="Large text"></div>`);
    const fonts = await page.locator('.slotted > *').evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
    assert.deepEqual(fonts, touch ? [16, 16, 16, 16] : [11, 11, 11, 11]);
    assert.equal(await page.locator('#large').evaluate(element => getComputedStyle(element).fontSize), '24px', 'larger inherited text is preserved');
    assert.doesNotMatch(await page.locator('meta[name=viewport]').getAttribute('content'), /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
    await context.close();
  }
  assert.doesNotMatch(await readFile('index.html', 'utf8'), /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
  console.log(`${controls} rendered controls passed; touch landscape, late theme CSS, desktop fonts and pinch-zoom settings passed.`);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
