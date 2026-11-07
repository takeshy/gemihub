import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { mock } from 'node:test';
import { chromium, expect } from 'playwright/test';
import { google } from 'googleapis';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import { encrypt } from '../server/google.ts';
import { savePhoneCustomer } from '../server/customers.ts';

const capture = process.argv.includes('--capture');
const english = JSON.parse(await readFile('shared/en.json', 'utf8'));
const root = resolve('storybook-static');
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
await mkdir('tmp/inquiry-workflow', { recursive: true });
let browser, app, store;
const sent = [];
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
  for (const language of ['ja', 'en']) {
    const label = text => language === 'en' ? english[text] || text : text;
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) errors.push('Unexpected live API request'); });
      async function open(suffix) {
        const entry = entries.find(entry => entry.title === '運営/予約・お客様/お問い合わせ' && entry.id.endsWith('--' + suffix));
        assert.ok(entry, suffix);
        await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${language}`);
      }
      async function shot(name, locator) {
        await locator.scrollIntoViewIfNeeded();
        await page.evaluate(async () => { await document.fonts.ready; if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
        await page.screenshot({ path: `tmp/inquiry-workflow/${name}-${language}-${width}.png` });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no horizontal overflow`);
        if (capture && width === 1280) {
          const bytes = await page.screenshot({ type: 'jpeg', quality: 86, animations: 'disabled' });
          for (const base of ['public/manual', 'storybook-static/manual']) {
            const folder = resolve(base, language === 'en' ? 'en' : ''); await mkdir(folder, { recursive: true }); await writeFile(resolve(folder, name + '.jpg'), bytes);
          }
        }
      }
      await open('inquiries');
      const list = page.getByRole('region', { name: label('お問い合わせ一覧'), exact: true });
      await expect(list.locator('.inquiry-list-item')).toHaveCount(2);
      await shot('10-inquiries', list.getByRole('heading', { name: label('お問い合わせ'), exact: true }));
      await open('board-pages');
      const board = page.getByLabel(label('お問い合わせカンバン'), { exact: true });
      await expect(board).toBeVisible();
      const column = status => board.getByRole('region', { name: label('{0}のお問い合わせ').replace('{0}', label(status)), exact: true });
      const newColumn = column('未対応'), waitingColumn = column('確認待ち');
      await expect(newColumn.locator('.inquiry-board-card')).toHaveCount(10);
      await newColumn.getByRole('button', { name: label('次のページ'), exact: true }).click();
      await expect(newColumn.locator('.inquiry-board-card')).toHaveCount(1);
      await expect(waitingColumn.locator('.inquiry-board-card')).toHaveCount(10);
      await newColumn.getByRole('button', { name: label('前のページ'), exact: true }).click();
      await expect(newColumn.locator('.inquiry-board-card')).toHaveCount(10);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const moving = newColumn.locator('.inquiry-board-card').first();
      if (width === 1280) await moving.locator('.inquiry-drag-handle').dragTo(waitingColumn.locator(':scope > h3'));
      else await moving.getByRole('combobox').selectOption('waiting');
      await expect(newColumn.locator('.inquiry-board-card')).toHaveCount(10);
      await expect(newColumn.locator('.pagination')).toHaveCount(0);
      await expect(waitingColumn.locator('h3 > .count')).toHaveText('12');
      await waitingColumn.locator('.inquiry-board-card').first().getByRole('combobox').selectOption('in_progress');
      await expect(waitingColumn.locator('h3 > .count')).toHaveText('11');
      await shot('10-inquiries-board', board);

      await open('manual');
      const form = page.getByRole('form', { name: label('お問い合わせを新規作成'), exact: true });
      await expect(form).toBeVisible();
      await form.getByLabel(label('お客様の氏名'), { exact: true }).fill('Workflow customer');
      await form.getByLabel(label('電話番号（任意）'), { exact: true }).fill('03-5555-1234');
      await form.getByLabel(label('件名（任意）'), { exact: true }).fill('Phone consultation');
      await form.getByLabel(label('お問い合わせ内容'), { exact: true }).fill('Initial call about colors');
      await shot('10-inquiry-create', form);
      await form.getByRole('button', { name: label('お問い合わせを作成'), exact: true }).click();
      const detail = page.getByRole('region', { name: label('お問い合わせの詳細'), exact: true });
      await expect(detail).toBeVisible();
      await expect(detail.getByRole('button', { name: label('メールで返信'), exact: true })).toHaveCount(0);
      const record = detail.getByRole('form', { name: label('対応を記録する'), exact: true });
      for (const [kind, text] of [['phone', 'Phone response'], ['note', 'Private note'], ['customer', 'Customer follow-up']]) {
        await record.getByLabel(label('記録の種類'), { exact: true }).selectOption(kind);
        await record.getByRole('textbox', { name: label('対応内容'), exact: true }).fill(text);
        await record.getByRole('button', { name: label('記録を追加'), exact: true }).click();
        await expect(detail.locator('.inquiry-history')).toContainText(text);
      }
      await detail.locator('.inquiry-contact summary').click();
      await detail.getByLabel(label('メールアドレス（任意）'), { exact: true }).fill('workflow@example.com');
      await detail.getByRole('button', { name: label('連絡先を保存'), exact: true }).click();
      await expect(detail.getByRole('button', { name: label('メールで返信'), exact: true })).toBeVisible();
      await detail.getByRole('combobox', { name: label('対応状況'), exact: true }).selectOption('waiting');
      for (const text of ['First email reply', 'Second email reply']) {
        await detail.getByRole('textbox', { name: label('返信内容'), exact: true }).fill(text);
        await detail.getByRole('button', { name: label('メールで返信'), exact: true }).click();
        await expect(detail.locator('.inquiry-history')).toContainText(text);
      }
      await expect(detail.locator('.inquiry-history .inquiry-entry')).toHaveCount(5);
      await expect(detail.getByRole('combobox', { name: label('対応状況'), exact: true })).toHaveValue('waiting');
      await shot('10-inquiry-reply', detail.locator('.inquiry-history'));
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`${language}/${width}: kanban pagination and movement, manual phone reception, internal/incoming records, contact edits and two email replies passed`);
    }
  }

  // Exercise the same flow through the real local API, including persistence and the mail worker.
  process.env.DEMO_MODE = 'true';
  store = new Store(':memory:');
  const shop = await store.createShop('workflow-owner@example.com');
  shop.published = structuredClone(sample); shop.publication = 'public'; shop.google = { folderId: 'folder', specId: 'spec', historyId: 'history' }; await store.saveShop(shop);
  await store.put('user', shop.owner, { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id, refreshToken: encrypt('test-token') });
  mock.method(google, 'gmail', () => ({ users: { messages: { send: async input => { sent.push(Buffer.from(input.requestBody.raw, 'base64url').toString()); } } } }));
  app = createApp(store); await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const actualOrigin = `http://127.0.0.1:${app.address().port}`; process.env.APP_ORIGIN = actualOrigin;
  for (const [language, width] of [['ja', 1280], ['en', 390]]) {
    const label = text => language === 'en' ? english[text] || text : text;
    const token = `inquiry-workflow-${language}`;
    await store.put('session', digest(token), { user: { email: shop.owner, name: 'Owner', role: 'owner', shopId: shop.id }, expires: Date.now() + 600000 });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'gemihub_session', value: token, url: actualOrigin }]);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${actualOrigin}/?shop=${shop.id}&tab=inquiries&lang=${language}`);
    const list = page.getByRole('region', { name: label('お問い合わせ一覧'), exact: true });
    await list.getByRole('button', { name: label('お問い合わせを新規作成'), exact: true }).click();
    const form = list.getByRole('form', { name: label('お問い合わせを新規作成'), exact: true });
    await form.getByLabel(label('お客様の氏名'), { exact: true }).fill(`Actual ${language}`);
    await form.getByLabel(label('メールアドレス（任意）'), { exact: true }).fill(`workflow-${language}@example.com`);
    await form.getByLabel(label('お問い合わせ内容'), { exact: true }).fill('Actual inquiry');
    await form.getByRole('button', { name: label('お問い合わせを作成'), exact: true }).click();
    const detail = page.getByRole('region', { name: label('お問い合わせの詳細'), exact: true });
    await expect(detail).toBeVisible(); assert.equal(sent.length, language === 'ja' ? 0 : 2);
    const record = detail.getByRole('form', { name: label('対応を記録する'), exact: true });
    await record.getByLabel(label('記録の種類'), { exact: true }).selectOption('phone');
    await record.getByRole('textbox', { name: label('対応内容'), exact: true }).fill('Actual phone record');
    await record.getByRole('button', { name: label('記録を追加'), exact: true }).click();
    await expect(detail.locator('.inquiry-history')).toContainText('Actual phone record');
    const replyDraft = detail.getByRole('textbox', { name: label('返信内容'), exact: true });
    await replyDraft.fill('Keep this draft when the recipient is missing');
    const replyPattern = '**/inquiries/*/reply';
    await page.route(replyPattern, async route => {
      const { previousEmail: _reviewed, ...oldClientReply } = route.request().postDataJSON();
      await route.continue({ postData: JSON.stringify(oldClientReply) });
    });
    const rejectedReply = page.waitForResponse(response => response.url().endsWith('/reply'));
    await detail.getByRole('button', { name: label('メールで返信'), exact: true }).click();
    assert.equal((await rejectedReply).status(), 409);
    await expect(replyDraft).toHaveValue('Keep this draft when the recipient is missing');
    await expect(detail.getByRole('alert')).toContainText(label('返信先が更新されています。最新の状態を確認してください。'));
    await page.unroute(replyPattern);
    await detail.getByRole('button', { name: label('最新の状態を確認'), exact: true }).click();
    await expect(detail.getByRole('alert')).toHaveCount(0);
    await expect(replyDraft).toHaveValue('Keep this draft when the recipient is missing');
    for (const text of ['Actual first email', 'Actual second email']) {
      await detail.getByRole('textbox', { name: label('返信内容'), exact: true }).fill(text);
      const replyRequest = page.waitForRequest(request => request.url().endsWith('/reply'));
      await detail.getByRole('button', { name: label('メールで返信'), exact: true }).click();
      assert.equal((await replyRequest).postDataJSON().previousEmail, `workflow-${language}@example.com`);
      await expect(detail.locator('.inquiry-history')).toContainText(text);
    }
    const q = (await store.records('inquiry', shop)).find(q => q.email === `workflow-${language}@example.com`);
    const history = (await store.records('inquiryInteraction', shop)).filter(entry => entry.inquiryId === q.id);
    assert.equal(history.length, 3); assert.equal(history.filter(entry => entry.kind === 'email' && entry.delivery === 'sent').length, 2);
    assert.equal((await store.list('job')).length, 0);
    await page.goto(`${actualOrigin}/?shop=${shop.id}&customer=${encodeURIComponent(q.email)}&inquiry=${q.id}&lang=${language}`);
    const target = page.locator(`[data-inquiry-id="${q.id}"]`);
    await expect(target).toBeFocused(); await expect(target.locator('.inquiry-history .inquiry-entry')).toHaveCount(3);
    await expect(target.locator('.inquiry-history')).toContainText('Actual first email');
    await expect(target.locator('.inquiry-history')).toContainText('Actual second email');

    await page.goto(`${actualOrigin}/?shop=${shop.id}&tab=inquiries&lang=${language}`);
    const inquiriesList = page.getByRole('region', { name: label('お問い合わせ一覧'), exact: true });
    const completedToggle = inquiriesList.getByRole('checkbox', { name: label('対応済みも表示する'), exact: true });
    await expect(completedToggle).not.toBeChecked();
    await inquiriesList.getByRole('button', { name: label('カンバン表示'), exact: true }).click();
    await expect(completedToggle).toHaveCount(0);
    const actualBoard = page.getByLabel(label('お問い合わせカンバン'), { exact: true });
    const actualColumn = status => actualBoard.getByRole('region', { name: label('{0}のお問い合わせ').replace('{0}', label(status)), exact: true });
    const card = column => actualColumn(column).locator('.inquiry-board-card', { hasText: `Actual ${language}` });
    await expect(card('未対応')).toHaveCount(1);
    assert.notEqual(await card('未対応').locator('.inquiry-status-new').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.notEqual(await card('未対応').locator('.inquiry-reply-replied').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    let workspaceReads = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/workspace') workspaceReads++; });
    // Another operator moves the inquiry while this board is open.
    await store.put('inquiry', q.id, { ...(await store.get('inquiry', q.id)), status: 'waiting' });
    await card('未対応').getByRole('combobox').selectOption('completed');
    await expect(inquiriesList.getByRole('alert')).toBeVisible();
    await expect(card('確認待ち')).toHaveCount(1);
    await expect(card('未対応')).toHaveCount(0);
    await card('確認待ち').getByRole('combobox').selectOption('completed');
    await expect(card('対応済み')).toHaveCount(1);
    assert.equal(workspaceReads, 0, 'board changes refresh inquiries without reloading the workspace');
    await inquiriesList.getByRole('button', { name: label('一覧表示'), exact: true }).click();
    await expect(completedToggle).not.toBeChecked();
    await expect(inquiriesList.locator('.inquiry-list-item', { hasText: `Actual ${language}` })).toHaveCount(0);
    const phone = language === 'ja' ? '03-5555-0001' : '03-5555-0002';
    const phoneCustomer = { email: await savePhoneCustomer(store, shop.id, `Phone ${language}`, phone, shop.owner), phone };
    await page.goto(`${actualOrigin}/?shop=${shop.id}&customer=${encodeURIComponent(phoneCustomer.email)}&lang=${language}`);
    const phoneResponses = page.getByRole('region', { name: label('お問い合わせへの対応'), exact: true });
    await phoneResponses.getByRole('button', { name: label('お問い合わせを新規作成'), exact: true }).click();
    const phoneForm = phoneResponses.getByRole('form', { name: label('お問い合わせを新規作成'), exact: true });
    await expect(phoneForm.getByLabel(label('メールアドレス（任意）'), { exact: true })).toHaveValue('');
    await expect(phoneForm.getByLabel(label('電話番号（任意）'), { exact: true })).toHaveValue(phoneCustomer.phone);
    await phoneForm.getByLabel(label('お問い合わせ内容'), { exact: true }).fill('Inquiry for a phone customer');
    await phoneForm.getByRole('button', { name: label('お問い合わせを作成'), exact: true }).click();
    const phoneInquiry = phoneResponses.locator('[data-inquiry-id]');
    await expect(phoneInquiry).toHaveCount(1);
    await expect(phoneInquiry).toBeFocused();
    await expect(phoneInquiry.getByRole('button', { name: label('メールで返信'), exact: true })).toHaveCount(0);
    await expect(phoneInquiry).toContainText('Inquiry for a phone customer');
    assert.deepEqual(errors, []); await context.close();
    console.log(`${language}/${width}: real API creation, internal history, Gmail delivery, durable reload, CRM deep link, stale board recovery and independent list filters passed`);
  }
  assert.equal(sent.length, 4);
} finally {
  mock.restoreAll(); await browser?.close();
  if (app) await new Promise(resolve => app.close(resolve));
  await store?.close(); await new Promise(resolve => server.close(resolve));
}
