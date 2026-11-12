import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,expect} from 'playwright/test';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {sample} from '../server/domain.ts';
import {requestLocale} from '../server/i18n.ts';

process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
process.env.JUDGE_INVITE='management-menu-fixture-invitation-123456789';process.env.JUDGE_UNTIL='2099-01-01';
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:'),server=createApp(store);
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
try{
 for(const language of ['en','ja'])for(const width of [1920,1280,390]){
  const label=text=>language==='en'?catalog[text]||text:text;
  const context=await browser.newContext({viewport:{width,height:1000},locale:language==='en'?'en-US':'ja-JP'});
  await context.request.post(`${origin}/api/judge/start?lang=${language}`,{headers:{Origin:origin},data:{invite:process.env.JUDGE_INVITE}});
  const {user}=await(await context.request.get(`${origin}/api/session`)).json();const shop=await store.shop(user.shopId);
  shop.published=requestLocale.run(language,()=>({...structuredClone(sample),region:{country:'US',timeZone:'America/New_York'}}));
  shop.publication='public';await store.saveShop(shop);
  const page=await context.newPage();page.setDefaultTimeout(10000);
  const nav=page.locator('.dashboard > aside > nav'),toggle=page.locator('.mobile-menu-toggle');
  const openMenu=async()=>{if(width<=760&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();};
  const payments=nav.getByRole('button',{name:new RegExp(label('決済・返金')+'$')}),transfers=nav.getByRole('button',{name:new RegExp(label('キャンセル枠の再販売')+'$')});
  const selected=async item=>{await openMenu();await expect(item).toHaveAttribute('aria-current','page');await expect(item).toHaveClass('active');assert.notEqual(await item.evaluate(el=>getComputedStyle(el).boxShadow),'none');await expect(nav.locator('button[aria-current="page"]')).toHaveCount(1);};
  await page.goto(`${origin}/?tab=settings&lang=${language}`);await openMenu();
  await transfers.click();await expect(page.locator('.payment-operations h1')).toHaveText(label('キャンセル枠の再販売'));await selected(transfers);
  await expect(nav.getByRole('button',{name:new RegExp(label('公開の設定')+'$')})).not.toHaveAttribute('aria-current','page');
  await payments.click();await selected(payments);await expect(payments.locator('span')).toHaveText('$');
  await page.goBack();await selected(transfers);await page.reload();await selected(transfers);
  await page.goForward();await selected(payments);
  // The shop's country, rather than the viewer's language, decides the money icon.
  shop.published.region={country:'JP',timeZone:'Asia/Tokyo'};await store.saveShop(shop);await page.reload();await openMenu();await expect(payments.locator('span')).toHaveText('¥');
  await context.close();console.log(`${language} ${width}px: sidebar selection after settings/click/back/forward/reload and US/JP currency icons passed.`);
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));await store.close();}
