import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import * as intelligence from '../server/ai.ts';

process.env.DEMO_MODE = 'true';
delete process.env.GOOGLE_CLOUD_PROJECT;
const markdown = '## Refund policy\n\nYour **saved booking policy** applies.\n\n- Open My page.\n- Check the refund before cancelling.\n\n| Time before booking | Refund |\n| --- | --- |\n| 72 hours | 100% |\n| 24 hours | 50% |\n\nRead `rules.payment.refundTiers`.\n\n```text\nbooking    →    cancellation    →    refund\n```\n\n[Open the manual](/manual)\n\n<script>window.__assistantInjected = true</script>\n\n![Do not fetch](https://untrusted.invalid/image.png)\n\n[Unsafe link](javascript:alert(1))';
const calls = [];
const store = new Store(':memory:');
const server = createApp(store, { ...intelligence, assistant: async input => {
  calls.push(input);
  return { answer: input.question === 'plain' ? 'Ordinary answer.\n\nAnother paragraph.' : markdown, sources: [{ path: 'spec.md', title: 'spec.md' }] };
} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] });
  await mkdir('tmp/assistant-markdown', { recursive: true });
  for (const language of ['ja', 'en']) for (const width of [1280, 390, 320]) {
    const shop = await store.createShop(`assistant-${language}-${width}@example.com`);
    await store.saveShop({ ...shop, published: structuredClone(sample), publication: 'provisional' });
    const session = randomUUID();
    await store.put('session', digest(session), { user: { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id }, expires: Date.now() + 3600000 });
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: language === 'ja' ? 'ja-JP' : 'en-US' });
    await context.addCookies([{ name: 'gemihub_session', value: session, url: origin }]);
    const page = await context.newPage(), errors = [], remoteImages = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().startsWith('https://untrusted.invalid/')) remoteImages.push(request.url()); });
    await page.goto(`${origin}/?tab=assistant&shop=${shop.id}&lang=${language}`);
    const input = page.getByRole('textbox', { name: language === 'ja' ? 'アシスタントへの質問' : 'Question for the assistant', exact: true });
    await expect(input).toBeVisible();
    const typography = await page.evaluate(() => {
      const size = element => parseFloat(getComputedStyle(element).fontSize);
      const brand = document.querySelector('.app-header .brand').getBoundingClientRect();
      const controls = document.querySelector('.app-header .header-right').getBoundingClientRect();
      return {
        heading: size(document.querySelector('.assistant > .section-top h2')),
        note: size(document.querySelector('.assistant > .section-top p')),
        header: [...document.querySelectorAll('.app-header .text-button')].map(size),
        menus: [...document.querySelectorAll('.dashboard aside nav button')].map(size),
        headerOverlap: brand.left < controls.right - 1 && brand.right > controls.left + 1 && brand.top < controls.bottom - 1 && brand.bottom > controls.top + 1,
      };
    });
    assert.ok(typography.heading >= 22 && typography.note >= 14, 'headings and explanatory notes remain readable');
    assert.ok(typography.header.every(size => size >= 14) && typography.menus.every(size => size >= 14), 'header and navigation text do not shrink on mobile');
    assert.equal(typography.headerOverlap, false, 'larger header controls wrap without covering the brand');
    const question = '**Keep my question literal**\nSecond line.';
    await input.fill(question);
    await input.press('Control+Enter');
    const answer = page.locator('.assistant-markdown').first();
    await expect(answer).toHaveCSS('font-size', '16px');
    await expect(answer.getByRole('heading', { name: 'Refund policy' })).toBeVisible();
    await expect(answer.locator('strong')).toHaveText('saved booking policy');
    await expect(answer.locator('ul > li')).toHaveCount(2);
    await expect(answer.getByRole('table')).toHaveCount(1);
    await expect(answer.locator('tbody tr')).toHaveCount(2);
    await expect(answer.locator('pre code')).toHaveText('booking    →    cancellation    →    refund\n');
    assert.equal(await answer.locator('pre').evaluate(element => getComputedStyle(element).whiteSpace), 'pre');
    await expect(answer.getByRole('link', { name: 'Open the manual' })).toHaveAttribute('href', '/manual');
    await expect(answer.locator('script, img')).toHaveCount(0);
    assert.ok(!String(await answer.getByText('Unsafe link', { exact: true }).getAttribute('href')).startsWith('javascript:'));
    assert.equal(await page.evaluate(() => window.__assistantInjected), undefined);
    assert.deepEqual(remoteImages, []);
    await expect(page.locator('.chat-message-user .pre-wrap')).toHaveText(question);
    await expect(page.locator('.assistant-sources .pill')).toHaveText('spec.md');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `tmp/assistant-markdown/${language}-${width}.png`, fullPage: true });
    await input.fill('plain'); await input.press('Control+Enter');
    await expect(page.locator('.assistant-markdown').nth(1).locator('p')).toHaveCount(2);
    assert.equal(calls.at(-1).messages.at(-1).text, markdown, 'formatting does not rewrite model history');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${language} ${width}px: formatted answer, table, code, sources, literal question and safe links passed.`);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await store.close();
}
