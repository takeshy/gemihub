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
    // Exercise the live-voice controls without microphone permissions or a remote AI connection.
    let voiceEnabled = true;
    await page.route('**/api/session', async route => {
      const response = await route.fetch(), session = await response.json();
      await route.fulfill({ response, json: { ...session, assistantVoice: voiceEnabled } });
    });
    await page.addInitScript(() => {
      window.__microphoneStops = 0;
      window.__audioCloses = 0;
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
        if (window.__delayMicrophone) await new Promise(resolve => { window.__resolveMicrophone = resolve; });
        return { getTracks: () => [{ stop() { window.__microphoneStops++; } }] };
      } } });
      window.AudioContext = class {
        audioWorklet = { addModule: async () => {} };
        async resume() {} async close() { window.__audioCloses++; }
        createMediaStreamSource() { return { connect() {} }; }
      };
      window.AudioWorkletNode = class { port = {}; connect() {} };
    });
    let voiceSocket, voiceConnections = 0;
    await page.routeWebSocket('**/assistant/live', socket => { voiceSocket = socket; voiceConnections++; socket.send(JSON.stringify({ type: 'ready' })); });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().startsWith('https://untrusted.invalid/')) remoteImages.push(request.url()); });
    await page.goto(`${origin}/?tab=assistant&shop=${shop.id}&lang=${language}`);
    const input = page.getByRole('textbox', { name: language === 'ja' ? 'アシスタントへの質問' : 'Question for the assistant', exact: true });
    const chatMode = page.locator('.assistant-modes button').nth(0), voiceMode = page.locator('.assistant-modes button').nth(1);
    await expect(input).toBeVisible();
    const assertComposer = async () => {
      const layout = await page.locator('.assistant .chat-composer').evaluate(form => {
        const send = form.querySelector('.chat-send').getBoundingClientRect();
        const textarea = form.querySelector('textarea').getBoundingClientRect();
        return { height: form.getBoundingClientRect().height, inputHeight: textarea.height, sendGap: send.top - textarea.bottom, textSize: parseFloat(getComputedStyle(form.querySelector('textarea')).fontSize) };
      });
      assert.ok(layout.inputHeight <= 100 && layout.height < 170 && layout.sendGap <= 10, 'chat composer stays compact without an unused action row');
      assert.ok(layout.textSize >= 16, 'input stays readable without iPhone focus zoom');
    };
    await assertComposer();
    await expect(chatMode).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.assistant-voice')).toHaveCount(0);
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
    await page.reload();
    await expect(input).toBeEditable();
    // Saved consultations live on the server now; start a fresh one for the voice lifecycle checks.
    const historyToggle=page.locator('.consultation-history-toggle');
    if(await historyToggle.getAttribute('aria-expanded')==='false')await historyToggle.click();
    const previousConversation=new URL(page.url()).searchParams.get('conversation');
    await page.locator('.consultation-new').click();
    await expect.poll(()=>new URL(page.url()).searchParams.get('conversation')).not.toBe(previousConversation);
    await expect(input).toBeEditable();await expect(page.locator('.assistant-log .chat-message')).toHaveCount(0);
    await input.fill('Keep this unsent draft.');
    await voiceMode.click();
    await expect(voiceMode).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.assistant .chat-composer, .assistant .chat-send')).toHaveCount(0);
    await expect(input).toHaveCount(0);
    await expect(page.locator('.assistant-voice button')).toHaveAttribute('aria-pressed', 'false');
    assert.equal(voiceConnections, 0, 'switching modes alone does not open the microphone connection');
    await page.locator('.assistant-voice button').click();
    await expect(page.locator('.assistant-voice button')).toHaveAttribute('aria-pressed', 'true');
    voiceSocket.send(JSON.stringify({ type: 'turn', question: 'どういうところがこのシステムのポイント？', answer: 'システムの強みを確認しますね。' }));
    await expect(page.locator('.assistant-log .chat-message')).toHaveCount(2);
    const bubbles = await page.locator('.assistant-log .chat-message').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom, margin: style.margin, background: style.backgroundColor };
    }));
    assert.ok(bubbles.every(bubble => bubble.margin === '0px'), 'conversation spacing comes from one consistent gap');
    assert.ok(bubbles[1].top - bubbles[0].bottom <= 13, `short voice turns do not leave a large blank gap: ${JSON.stringify(bubbles)}`);
    assert.notEqual(bubbles[0].background, bubbles[1].background, 'user and assistant messages are visually distinct');
    await expect(page.locator('.assistant .chat-composer')).toHaveCount(0);
    await page.screenshot({ path: `tmp/assistant-markdown/voice-${language}-${width}.png`, fullPage: true });
    voiceSocket.send(JSON.stringify({ type: 'heard', text: 'A long live transcript that can wrap safely below the voice and send buttons. '.repeat(2) }));
    await expect(page.locator('.assistant-caption')).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await chatMode.click();
    await expect(page.locator('.assistant-voice')).toHaveCount(0);
    await expect(input).toHaveValue('Keep this unsent draft.');
    await expect(page.locator('.assistant-log .chat-message')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => window.__microphoneStops)).toBe(1);
    assert.equal(await page.evaluate(() => window.__audioCloses), 2, 'switching to chat closes capture and playback');
    await assertComposer();
    // Leaving while microphone permission is pending must not leak a late stream or connection.
    await page.evaluate(() => { window.__delayMicrophone = true; });
    await voiceMode.click();
    await page.locator('.assistant-voice button').click();
    await page.waitForFunction(() => !!window.__resolveMicrophone);
    await chatMode.click();
    await page.evaluate(() => { window.__resolveMicrophone(); window.__delayMicrophone = false; });
    await expect.poll(() => page.evaluate(() => window.__microphoneStops)).toBe(2);
    assert.equal(voiceConnections, 1, 'cancelled microphone setup never opens a connection');
    await voiceMode.click();
    await page.locator('.assistant-voice button').click();
    await expect(page.locator('.assistant-voice button')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.assistant-voice button').click();
    await expect(page.locator('.assistant-voice button')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.assistant .chat-composer')).toHaveCount(0);
    voiceEnabled = false;
    await page.reload();
    await expect(input).toHaveValue('Keep this unsent draft.');
    await expect(page.locator('.assistant-modes, .assistant-voice')).toHaveCount(0);
    await assertComposer();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${language} ${width}px: formatted answers, chat/voice modes, draft/history preservation and microphone cleanup passed.`);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await store.close();
}
