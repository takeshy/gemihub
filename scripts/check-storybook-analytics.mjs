import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, expect } from 'playwright/test';

const root = resolve('storybook-static'), english = JSON.parse(await readFile('shared/en.json', 'utf8'));
const entries = Object.values(JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8')).entries);
const stories = entries.filter(entry => entry.type === 'story' && (entry.title === '運営/分析' || entry.title === '運営/相談・質問' && /--(charts|booking-flow|invalid-diagram)$/.test(entry.id)));
assert.equal(stories.length, 22, 'All analytics and assistant diagram examples are registered');
const expectedDiagrams = { 'management-page': 1, 'daily-traffic': 1, 'article-traffic': 1, 'monthly-traffic': 1, 'monthly-cohorts': 2, 'monthly-sales': 1, 'booking-cohorts': 2, 'staff-sales': 1, 'one-staff-trend': 1, 'dollar-sales': 1, 'empty-cohorts': 0, 'empty-sales': 1, 'truncated-cohorts': 0, 'truncated-staff': 1, charts: 2, 'booking-flow': 1, 'invalid-diagram': 0 };
Object.assign(expectedDiagrams, { 'menu-sales': 2, 'monthly-menu-sales': 2, 'empty-menu-sales': 1, 'addon-sales': 2 });
Object.assign(expectedDiagrams, { 'one-staff-no-sales': 1 });
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, `.${new URL(req.url, 'http://localhost').pathname}`); assert.ok(path.startsWith(`${root}/`));
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://storybook.test:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox', '--no-proxy-server', '--host-resolver-rules=MAP storybook.test 127.0.0.1'] });
  await mkdir('tmp/storybook-analytics', { recursive: true });
  for (const language of ['ja', 'en']) for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage(), errors = [], label = text => language === 'en' ? english[text] || text : text;
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) errors.push(`Live API: ${request.url()}`); });
    for (const story of stories) {
      const kind = story.id.split('--').at(-1), count = expectedDiagrams[kind]; assert.notEqual(count, undefined, kind);
      await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=locale:${language}`);
      const canvas = page.locator('#storybook-root');
      await expect(canvas.locator('h2:visible').first()).toBeVisible();
      if (kind === 'invalid-diagram') {
        await expect(canvas.getByText(label('図を表示できません。元のデータを確認してください。'), { exact: true })).toBeVisible();
        await canvas.getByText(label('図のデータ'), { exact: true }).click();
        await expect(canvas.locator('pre code')).toContainText('a[Incomplete');
      } else if (kind.startsWith('truncated-')) {
        await expect(canvas.getByText(label('記録件数が上限を超えたため、予約導線の集計を表示できません。期間を短くしてください。売上集計は全予約が対象です。'), { exact: true })).toBeVisible();
      } else if (kind === 'empty-cohorts') {
        await expect(canvas.getByText(label('この期間の予約ページ閲覧記録はありません。'), { exact: true })).toBeVisible();
      } else if (kind === 'one-staff-no-sales') {
        await expect(canvas.getByText(label('このスタッフは選択期間内に施術が終了した予約がありません。'), { exact: true })).toBeVisible();
      }
      await expect.poll(() => canvas.locator('.pele-diagram').evaluateAll(elements => elements.filter(el => !el.hidden && el.querySelector('svg')).length)).toBe(count);
      if (kind !== 'invalid-diagram') await expect(canvas.getByText(label('図を表示できません。元のデータを確認してください。'), { exact: true })).toHaveCount(0);
      if (kind !== 'invalid-diagram') await expect(canvas.locator('.diagram-source')).toHaveCount(0);
      if (['booking-cohorts', 'monthly-cohorts'].includes(kind)) {
        const legend = canvas.locator('.pele-legend');
        await expect(legend.locator('.pele-legend-item').nth(0)).toHaveAttribute('data-id', label('予約ページ閲覧'));
        await expect(legend.locator('.pele-legend-item').nth(1)).toHaveAttribute('data-id', label('予約確定'));
        await expect(legend.locator('.pele-legend-item')).toHaveCount(2);
      }
      if (['daily-traffic', 'monthly-traffic'].includes(kind)) {
        await expect(canvas.locator('.pele-legend-item').nth(0)).toHaveAttribute('data-id', label('PV（表示回数）'));
        await expect(canvas.locator('.pele-legend-item').nth(1)).toHaveAttribute('data-id', label('訪問ブラウザ数'));
      }
      if (kind === 'charts') await expect(canvas.locator('.pele-legend-item')).toHaveCount(2);
      await expect(canvas.locator('[role="alert"]')).toHaveCount(0);
      if (kind === 'one-staff-trend') await expect(canvas.getByRole('combobox', { name: label('表示するスタッフ') })).toHaveValue('haru');
      if (kind === 'dollar-sales') await expect(canvas.locator('.analytics-kpis')).toContainText('$');
      if (kind === 'booking-cohorts') {
        const nav = canvas.getByRole('navigation', { name: label('{0}のページ切替').replace('{0}', label('予約ページ閲覧と予約確定')), exact: true });
        const first = await canvas.locator('tbody tr').first().textContent();
        await nav.getByRole('button', { name: label('次のページ'), exact: true }).click();
        await expect(canvas.locator('tbody tr').first()).not.toHaveText(first);
      }
      if (kind.startsWith('monthly-')) {
        await expect(canvas.getByRole('combobox', { name: label('表示単位') })).toHaveValue('month');
        await canvas.getByLabel(label('アクセス数の集計期間'), { exact: true }).selectOption('90');
        await expect.poll(() => canvas.locator('.pele-diagram').evaluateAll(elements => elements.filter(el => !el.hidden && el.querySelector('svg')).length)).toBe(count);
        if (!['monthly-sales', 'monthly-menu-sales'].includes(kind)) {
          await expect(canvas.locator('tbody tr')).toHaveCount(4);
          await expect(canvas.locator('tbody')).toContainText('2026-08');
          await expect(canvas.locator('tbody')).toContainText('2026-11');
        }
        await expect(canvas.locator('.pele-diagram').last()).toContainText('2026-08');
      }
      if (kind === 'addon-sales') await expect(canvas.getByRole('combobox', { name: label('売上推移のメニュー') })).toHaveValue('care');
      if (['staff-sales', 'monthly-sales', 'dollar-sales', 'truncated-staff', 'one-staff-trend', 'menu-sales', 'monthly-menu-sales', 'addon-sales'].includes(kind)) {
        const menus = ['one-staff-trend', 'menu-sales', 'monthly-menu-sales'].includes(kind);
        const trend = canvas.locator('.diagram-card').last();
        await expect(trend.locator('.pele-line')).toHaveCount(menus ? 3 : 2);
        await expect(trend.locator('.diagram-legend .pele-legend-item')).toHaveCount(menus ? 3 : 2);
      }
      if (kind === 'one-staff-trend') {
        await expect(canvas.locator('.staff-menu-table tbody tr')).toHaveCount(3);
        await expect(canvas.locator('.staff-menu-table')).toContainText(label('追加ケア'));
        await expect(canvas.locator('.analytics-kpis')).toContainText('707,000');
        await canvas.getByRole('combobox', { name: label('表示単位') }).selectOption('month');
        await expect(canvas.getByRole('combobox', { name: label('表示するスタッフ') })).toHaveValue('haru');
        const previous = await canvas.locator('.analytics-kpis').textContent();
        await canvas.getByLabel(label('アクセス数の集計期間'), { exact: true }).selectOption('90');
        await expect(canvas.locator('.analytics-kpis')).not.toHaveText(previous);
        await expect(canvas.getByRole('combobox', { name: label('表示するスタッフ') })).toHaveValue('haru');
        await expect(canvas.locator('.staff-menu-table tbody tr')).toHaveCount(3);
        await expect(canvas.locator('.pele-line')).toHaveCount(3);
        await expect(canvas.locator('.diagram-card')).toHaveCount(1);
      }
      if (['menu-sales', 'monthly-menu-sales', 'addon-sales'].includes(kind)) {
        await expect(canvas.locator('tbody')).toContainText(label('追加メニュー'));
        await expect(canvas.locator('tbody')).toContainText(label('追加ケア'));
        await expect(canvas.locator('.sales-pie svg path')).toHaveCount(3);
        await expect(canvas.locator('.sales-pie-legend')).toContainText('55.0%');
        await expect(canvas.locator('.sales-pie-legend')).toContainText('10.0%');
      }
      if (kind === 'addon-sales') {
        const pie = canvas.locator('.sales-pie'), table = canvas.locator('.menu-sales table'), kpis = canvas.locator('.analytics-kpis');
        const beforePie = await pie.textContent(), beforeTable = await table.textContent(), beforeKpis = await kpis.textContent();
        const select = canvas.getByRole('combobox', { name: label('売上推移のメニュー') });
        await select.selectOption('simple');
        await expect(canvas.locator('.diagram-card').last().locator('.pele-legend-item')).toHaveCount(2);
        await expect(canvas.locator('.diagram-card').last().locator('.diagram-legend')).toContainText(label('あおい'));
        await expect(canvas.locator('.diagram-card').last().locator('.diagram-legend')).toContainText(label('はる'));
        await expect(pie).toHaveText(beforePie); await expect(table).toHaveText(beforeTable); await expect(kpis).toHaveText(beforeKpis);
        await select.selectOption('');
        await expect(canvas.locator('.diagram-card').last().locator('.pele-line')).toHaveCount(3);
        await expect(pie).toHaveText(beforePie); await expect(table).toHaveText(beforeTable); await expect(kpis).toHaveText(beforeKpis);
      }
      if (kind === 'management-page') {
        const nav = page.locator('aside nav');
        if (width < 600) await page.locator('.mobile-menu-toggle').click();
        await expect(nav.getByRole('button', { name: new RegExp(`${label('分析')}$`) })).toBeVisible();
        await nav.getByRole('button', { name: new RegExp(`${label('お客様')}$`) }).click();
        await expect(canvas.locator('.customers')).toBeVisible();
        await expect(canvas.locator('.shop-access')).toHaveCount(0);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${kind}/${language}/${width}: page overflow`);
      assert.deepEqual(errors, [], `${kind}/${language}/${width}`);
      if (width === 390 && kind !== 'management-page') await page.screenshot({ path: `tmp/storybook-analytics/${language}-${kind}.png`, fullPage: true });
    }
    await context.close(); console.log(`${language} ${width}px: ${stories.length} analytics and assistant stories passed`);
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
