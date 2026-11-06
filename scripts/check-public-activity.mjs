import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from 'playwright/test';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { sample } from '../server/domain.ts';
import { ShopLogs } from '../server/shop-logs.ts';

process.env.DEMO_MODE = 'true';
const store = new Store(':memory:'), shop = await store.createShop('activity-owner@example.com');
shop.published = structuredClone(sample); shop.publication = 'public'; await store.saveShop(shop);
const server = createApp(store); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`; process.env.APP_ORIGIN = origin;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const email = 'spa-guest@example.com';
  await context.request.post(`${origin}/api/demo-login`, { headers: { Origin: origin }, data: { role: 'customer', email, shopId: shop.id } });
  // Mount the real PublicShop without a key so category transitions preserve the same component,
  // as an embedded SPA does. Network calls still use the real application/session/CRM backend.
  const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{PublicShop}from'./src/App.tsx';
    function Harness(){const[category,setCategory]=useState();return <><button onClick={()=>setCategory('blogs')}>Show blog</button><button onClick={()=>setCategory(undefined)}>Back to booking</button><PublicShop session={${JSON.stringify({ user: { email, role: 'customer', name: 'Guest', shopId: shop.id } })}} slug=${JSON.stringify(shop.slug)} category={category} initialPane="reserve" navigate={()=>{}} search="" busy={false} run={fn=>fn()} notify={()=>{}}/></>};createRoot(document.getElementById('root')).render(<Harness/>);`;
  const bundled = await build({ stdin: { contents: entry, loader: 'tsx', sourcefile: 'activity-harness.tsx', resolveDir: process.cwd() }, bundle: true, write: false, outdir: 'tmp/public-activity-harness', format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const js = bundled.outputFiles.find(file => file.path.endsWith('.js')).text, css = bundled.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/activity-harness.js', route => route.fulfill({ contentType: 'application/javascript', body: js }));
  await page.route('**/activity-harness', route => route.fulfill({ contentType: 'text/html', body: `<html><head><style>${css}</style></head><body><div id="root"></div><script type="module" src="/activity-harness.js"></script></body></html>` }));
  const logs = new ShopLogs(store);
  const opens = async () => (await logs.customerActivity(shop.id, email)).rows.filter(row => row.operation === 'reserve_view').length;
  await page.goto(`${origin}/activity-harness`);
  await expect.poll(opens).toBe(1);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Show blog', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ブログ', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to booking', exact: true }).click();
    await expect.poll(opens).toBe(i + 2);
  }
  await context.close();
  const staffEmail = 'activity-staff@example.com';
  await store.put('member', `${shop.id}:${staffEmail}`, { shopId: shop.id, email: staffEmail, accepted: true });
  const staff = await browser.newContext();
  await staff.request.post(`${origin}/api/demo-login`, { headers: { Origin: origin }, data: { role: 'customer', email: staffEmail, shopId: shop.id } });
  const staffPage = await staff.newPage(); let activityRequests = 0;
  staffPage.on('request', request => { if (request.url().endsWith('/activity') && request.method() === 'POST') activityRequests++; });
  await staffPage.goto(`${origin}/s/${shop.slug}?pane=reserve`);
  await expect(staffPage.locator('.reservation-layout')).toBeVisible();
  await staffPage.waitForLoadState('networkidle');
  assert.equal(activityRequests, 0, 'staff do not send customer-only activity');
  assert.equal((await logs.customerActivity(shop.id, staffEmail)).rows.length, 0);
  assert.deepEqual(errors, []);
  console.log('Preserved-component booking → blog → booking revisits are recorded; staff browsing emits no customer activity or spurious 403.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await store.close(); }
