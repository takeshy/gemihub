import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,expect} from 'playwright/test';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {digest} from '../server/auth.ts';
import {artifacts} from '../server/artifacts.ts';
import {shopDate} from '../server/domain.ts';
import {optionShop} from '../tests/fixtures/option-shop.ts';
process.env.DEMO_MODE='true';
const english=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:'),server=createApp(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
await mkdir('tmp/menu-addons/offline',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});let active;
async function exercise(page,label,date,screenshot){
 const choice=name=>page.locator('.booking-option').filter({hasText:name}).getByRole('checkbox');
 const summary=page.locator('.booking-summary');
 await page.locator('.menu-options button').filter({hasText:'Foot'}).click();
 await expect(page.locator('.menu-options button')).toHaveCount(2);await expect(choice('Foot care')).toBeVisible();
 await choice('Our removal').check();await expect(summary).toContainText(label('合計 {0}分',95));
 await choice('Other removal').check();await expect(choice('Our removal')).not.toBeChecked();await expect(summary.locator('.price')).toContainText('6,500');
 await choice('Foot care').check();await expect(summary).toContainText(label('合計 {0}分',130));await expect(summary.locator('.price')).toContainText('10,500');
 await page.locator('.menu-options button').filter({hasText:'Hand'}).click();await expect(choice('Foot care')).toHaveCount(0);await expect(choice('Other removal')).not.toBeChecked();await expect(summary).toContainText(label('合計 {0}分',60));
 await page.locator('.menu-options button').filter({hasText:'Foot'}).click();await choice('Other removal').check();await choice('Foot care').check();
 await page.locator('.date-input input[type=text]').fill(date.replaceAll('-','/'));
 await expect(page.locator('.time-grid button').first()).toBeVisible();await page.locator('.time-grid button').first().click();
 await expect(summary).toContainText(label('合計 {0}分',130));await expect(summary.locator('.price')).toContainText('10,500');
 if(page.viewportSize().width<700){const mobile=page.locator('.booking-mobile-summary');await expect(mobile).toBeVisible();await expect(mobile).toContainText(label('合計 {0}分',130));await expect(mobile).toContainText('10,500');await expect(mobile).toContainText('Foot care');}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.screenshot({path:screenshot,fullPage:true});
 await page.getByRole('button',{name:new RegExp(label('この内容で予約する'))}).click();
 await expect(page.getByRole('heading',{name:label('予約が完了しました'),exact:true})).toBeVisible();await expect(page.locator('.booking-complete')).toContainText('10,500');await expect(page.locator('.booking-complete')).toContainText('Foot care');
 await page.getByRole('button',{name:label('マイページで予約を確認'),exact:true}).click();
 await expect(page.locator('.booking-card')).toContainText('Foot + Foot care + Other removal');
}
try{
 for(const width of [1280,390])for(const language of ['ja','en']){
  const label=(text,...args)=>(language==='en'?english[text]||text:text).replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]));
  const shop=await store.createShop(`owner-addon-${language}-${width}@example.com`),config=optionShop();
  config.menus.find(menu=>menu.id==='care').active=false;delete config.menus.find(menu=>menu.id==='care').optionFor;
  shop.published=config;await store.saveShop(shop);
  const owner=`owner-${language}-${width}`,customer=`customer-${language}-${width}`,email=`${customer}@example.com`;
  for(const [session,userEmail,role] of [[owner,shop.owner,'owner'],[customer,email,'customer']])await store.put('session',digest(session),{user:{email:userEmail,name:'Customer',role,shopId:shop.id},expires:Date.now()+600000});
  await store.put('customer',`${shop.id}:${email}`,{shopId:shop.id,email,name:'Customer',birthDate:'1990-01-01',gender:'not_specified'});
  const admin=await browser.newContext({locale:language==='ja'?'ja-JP':'en-US',viewport:{width,height:950}});await admin.addCookies([{name:'gemihub_session',value:owner,url:origin}]);const editor=await admin.newPage();active=editor;await editor.goto(`${origin}/?shop=${shop.id}&tab=basic&lang=${language}`);await editor.getByRole('button',{name:label('メニュー・料金')}).click();
  const panel=editor.locator('.live-settings-menus'),care=panel.locator('.menu-edit-block').filter({has:editor.locator('input[value="Foot care"]')});
  await care.getByLabel(label('ほかのメニューに追加して予約する（単独予約不可）'),{exact:true}).check();await care.locator('.menu-option-settings').getByLabel('Foot',{exact:true}).check();await care.getByLabel(label('有効'),{exact:true}).check();
  await panel.getByRole('button',{name:label('保存'),exact:true}).click();await expect.poll(async()=> (await store.shop(shop.id)).published.menus.find(menu=>menu.id==='care').optionFor).toEqual(['foot']);await admin.close();
  const context=await browser.newContext({locale:language==='ja'?'ja-JP':'en-US',viewport:{width,height:950}});await context.addCookies([{name:'gemihub_session',value:customer,url:origin}]);const page=await context.newPage();active=page;const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`${origin}/s/${shop.slug}?pane=reserve&lang=${language}`);
  await exercise(page,label,shopDate(config,Date.now()+4*86400000),`tmp/menu-addons/booking-${language}-${width}.png`);
  const booked=(await store.bookings(shop.id))[0];assert.equal(booked.price,10500);assert.deepEqual(booked.optionIds,['care','other-off']);assert.equal(Date.parse(booked.end)-Date.parse(booked.start),130*60000);assert.deepEqual(errors,[]);await context.close();console.log(`${language} ${width}px: add-on configuration, eligible choices, exclusion group, total, duration and stored booking passed.`);
 }
 const config=optionShop(),files=artifacts(config,await readFile('dist/index.html','utf8'));
 await writeFile('tmp/menu-addons/offline/index.html',files['web/index.html']);await writeFile('tmp/menu-addons/offline/data.js',files['web/data.js']);
 const context=await browser.newContext({locale:'ja-JP',viewport:{width:1280,height:950}}),page=await context.newPage();active=page;const external=[];page.on('request',request=>{if(/^https?:/.test(request.url()))external.push(request.url());});const url=pathToFileURL(resolve('tmp/menu-addons/offline/index.html'));url.searchParams.set('lang','ja');await page.goto(url.href);
 const label=(text,...args)=>text.replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]));
 await page.locator('.public-nav').getByText('ご予約',{exact:true}).click();await exercise(page,label,shopDate(config,Date.now()+4*86400000),'tmp/menu-addons/offline.png');assert.deepEqual(external,[]);await context.close();console.log('file://: exported page books combined options with no HTTP requests or external writes.');
}catch(error){if(active&&!active.isClosed())await active.screenshot({path:'tmp/menu-addons/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
