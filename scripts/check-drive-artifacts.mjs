import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { artifacts } from '../server/artifacts.ts';
import { defaultRefundTiers } from '../server/payment-domain.ts';
import { sample, dateJST, slots } from '../server/domain.ts';
import { renderMockScript } from '../server/drive-mock.ts';

const shell = await readFile('dist/index.html', 'utf8');
assert.ok(!shell.includes('./data.js'), 'served build must not reference Drive data');
const config = structuredClone(sample);
if (process.env.PAYMENT_PREVIEW === 'true') config.rules.payment = { enabled: true, refundTiers: structuredClone(defaultRefundTiers) };
const imageId = 'c'.repeat(64);
const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };
config.header.imageId = imageId;
config.pages = [{ id: 'gallery', slug: 'gallery', title: '画像を使ったページ', navigationLabel: '画像のページ', body: '## お店のご案内', layout: 'standard', imageUrl: '', imageId }];
const output = artifacts(config, shell, undefined, { [imageId]: image });
const directory = await mkdtemp(join(tmpdir(), 'gemihub-drive-'));
for (const [path, content] of Object.entries(output)) {
  const target = join(directory, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}
const file = join(directory, 'web/index.html');
const dataFile = join(directory, 'web/data.js');
const originalData = await readFile(dataFile, 'utf8');
const source = JSON.parse(output['web/mock.json']);
const errors = [];
const apiCalls = [];
const serverConfig = { ...config, name: '配信サーバーのお店' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/')) {
    apiCalls.push(path);
    res.setHeader('Content-Type', 'application/json');
    if (path === '/api/session') res.end(JSON.stringify({ demo: false, hosted: 'hosted', user: { ...source.auth, role: 'customer', shopId: 'hosted-id' } }));
    else if (path === '/api/public/hosted') res.end(JSON.stringify({ config: serverConfig, shopId: 'hosted-id', recentPosts: [] }));
    else if (path === `/api/public/hosted/images/${imageId}`) res.end(JSON.stringify(image));
    else if (path === '/api/public/hosted/bookings' || path === '/api/public/hosted/slots' || path === '/api/public/hosted/checkouts' || path === '/api/public/hosted/transfers') res.end('[]');
    else if (path === '/api/public/hosted/transfers/mine') res.end('{"selling":[],"buying":[]}');
    else { res.writeHead(404); res.end('{"error":"unexpected request"}'); }
    return;
  }
  try {
    const root = path.startsWith('/export/') ? directory : resolve('dist');
    const relative = path.startsWith('/export/') ? path.slice('/export/'.length) : path === '/' ? 'index.html' : path.slice(1);
    const target = resolve(root, relative);
    assert.ok(target.startsWith(root + '/'));
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(target)] || 'application/octet-stream');
    res.end(await readFile(target));
  } catch { res.writeHead(404); res.end(); }
});
let browser;
try {
  browser = await chromium.launch({ headless: true, ...((process.env.CHROMIUM || process.argv[2]) ? { executablePath: process.env.CHROMIUM || process.argv[2] } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP' });
  page.setDefaultTimeout(10000);
  const remoteRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
  await page.goto(pathToFileURL(file).href);
  await page.getByRole('heading', { name: config.name, exact: true }).waitFor();
  await page.getByRole('heading', { name: 'あなたのご予約', exact: true }).waitFor();
  await page.locator('.site-header .managed-hero-image img').waitFor();
  assert.ok(await page.locator('.site-header .managed-hero-image img').evaluate(img => img.complete && img.naturalWidth > 0));
  assert.equal(await page.locator('.public-nav button').first().textContent(), 'マイページ');
  await page.getByRole('button', { name: 'ご予約', exact: true }).click();
  await page.getByRole('heading', { name: '自分のための、ひとときを。', exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: new RegExp(config.menus[0].name) }).count());
  assert.deepEqual(await page.locator('script[src]').evaluateAll(elements => elements.map(e => e.getAttribute('src'))), ['./data.js']);
  assert.equal(await page.locator('link[rel="stylesheet"]').count(), 0);
  let date, slot;
  for (let offset = 1; offset <= config.rules.advanceDays; offset++) {
    date = dateJST(new Date(Date.now() + offset * 86400000));
    slot = slots(config, [], date, config.menus[0].id)[0];
    if (slot) break;
  }
  assert.ok(slot, 'fixture must have an available booking day');
  await page.getByLabel('ご希望の日付（日本時間）').fill(date);
  const time = new Date(slot.start).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
  await page.getByRole('button', { name: time, exact: true }).click();
  await page.getByLabel('お名前', { exact: true }).fill('保存しない予約');
  if (config.rules.payment?.enabled) {
    await page.getByText('プレビューの練習です。実際の支払い・返金は行いません。', { exact: true }).waitFor();
    await page.getByLabel('支払額と返金条件を確認しました').check();
    await page.getByRole('button', { name: '支払い・予約を練習する →', exact: true }).click();
  } else await page.getByRole('button', { name: 'この内容で予約する →', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'ご予約を承りました' }).waitFor();
  await page.getByRole('button', { name: 'マイページ', exact: true }).click();
  await page.getByText('予約確定', { exact: true }).waitFor();
  if (config.rules.payment?.enabled) {
    await page.getByText('PayPal 支払済み：¥5,500', { exact: false }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'キャンセルする', exact: true }).click();
    await page.getByText('キャンセル済み', { exact: true }).waitFor();
  }
  assert.deepEqual(await page.evaluate(() => window.__GEMIHUB_MOCK__), source);
  assert.equal(await readFile(dataFile, 'utf8'), originalData);
  await page.reload();
  await page.getByRole('button', { name: 'マイページ', exact: true }).click();
  await page.getByText('ご予約はまだありません。', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'お問い合わせ', exact: true }).click();
  await page.getByLabel('ご相談内容', { exact: true }).fill('保存しない問い合わせ');
  await page.getByRole('button', { name: 'お問い合わせを送る →', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'お問い合わせを受け付けました' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__GEMIHUB_MOCK__.inquiries), []);
  await page.getByRole('button', { name: '画像のページ', exact: true }).click();
  await page.getByRole('heading', { name: '画像を使ったページ', exact: true }).waitFor();
  await page.locator('.custom-page .managed-hero-image').scrollIntoViewIfNeeded();
  await page.locator('.custom-page .managed-hero-image img').waitFor();
  assert.ok(await page.locator('.custom-page .managed-hero-image img').evaluate(img => img.complete && img.naturalWidth > 0));
  assert.deepEqual(remoteRequests, [], 'file preview must not call a server');
  const changed = { ...source, shop: { ...source.shop, name: '分離データで変更したお店' } };
  await writeFile(dataFile, renderMockScript(changed));
  await page.reload();
  await page.getByRole('heading', { name: changed.shop.name, exact: true }).waitFor();
  assert.equal(await page.title(), `${changed.shop.name} — ご予約`);
  assert.equal(await readFile(file, 'utf8'), output['web/index.html'], 'data edit must not change index.html');
  await page.screenshot({ path: join(directory, 'preview.png') });
  // A standalone index.html keeps its static content even with JavaScript enabled.
  await mkdir(join(directory, 'missing-data'));
  await copyFile(file, join(directory, 'missing-data/index.html'));
  await page.goto(pathToFileURL(join(directory, 'missing-data/index.html')).href);
  await page.getByRole('heading', { name: config.name, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'この内容で予約する →', exact: true }).count(), 0);
  assert.equal(await page.getByText(config.menus[0].name, { exact: false }).count(), 1);
  assert.deepEqual(remoteRequests, []);
  // Valid global mock data on HTTP must still use the server API.
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin + '/export/web/index.html');
  await page.getByRole('heading', { name: serverConfig.name, exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__GEMIHUB_MOCK__.shop.name), changed.shop.name);
  assert.ok(apiCalls.includes('/api/session'));
  assert.ok(apiCalls.includes('/api/public/hosted'));
  await page.goto(origin + '/');
  await page.getByRole('heading', { name: serverConfig.name, exact: true }).waitFor();
  assert.equal(await page.locator('script[src="./data.js"]').count(), 0);
  assert.deepEqual(errors, []);
  // Save the same runnable set in the workspace for easy manual inspection.
  await writeFile(dataFile, originalData);
  const destination = config.rules.payment?.enabled ? 'tmp/drive-payment-artifacts' : 'tmp/drive-artifacts';
  await mkdir(destination, { recursive: true });
  await cp(join(directory, 'web'), join(destination, 'web'), { recursive: true });
  console.log('PASS: file:// store/menu/booking, discarded writes and reload, data.js edits, missing-data static fallback, HTTP double guard, unchanged served shell.');
  console.log(`Generated artifacts: ${directory}`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
