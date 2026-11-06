import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium,expect} from 'playwright/test';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {digest} from '../server/auth.ts';
import {shopDate} from '../server/domain.ts';
import {defaultRefundTiers} from '../server/payment-domain.ts';
import {paypalValue} from '../shared/region.ts';
import {optionShop} from '../tests/fixtures/option-shop.ts';
import {bookingReminderHours} from '../shared/booking-reminders.ts';
process.env.DEMO_MODE='true';
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:'),orders=new Map(),returnUrls=new Map();let captures=0,creates=0;
const gateway={environment:'sandbox',async ready(){},async create(id,amount,returnUrl,_cancel,currency){creates++;returnUrls.set(id,returnUrl);const order={id:`order-${id}`,status:'CREATED',purchase_units:[{custom_id:id,amount:{currency_code:currency,value:paypalValue(amount,currency)}}],links:[{rel:'payer-action',href:`https://www.sandbox.paypal.com/checkoutnow?token=${id}`}]};orders.set(order.id,{...structuredClone(order),status:'APPROVED'});return order;},async order(id){return structuredClone(orders.get(id));},async capture(id){captures++;const order=orders.get(id);order.status='COMPLETED';order.purchase_units[0].payments={captures:[{id:`capture-${id}`,status:'COMPLETED',amount:order.purchase_units[0].amount}]};return structuredClone(order);},async refund(){throw new Error('Unexpected refund');},async refundStatus(){throw new Error('Unexpected refund');}};
const server=createApp(store,undefined,undefined,undefined,gateway);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
await mkdir('tmp/booking-complete',{recursive:true});let browser,active;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
 async function exercise(language,width,mode='normal',usd=false){
  const label=text=>language==='en'?catalog[text]||text:text;
  const paid=mode==='paid'||mode==='pending'||mode==='failed';
  const config=optionShop(usd);config.rules.payment={enabled:paid,refundTiers:structuredClone(defaultRefundTiers)};
  const shop=await store.createShop(`receipt-${randomUUID()}@example.com`);shop.published=config;shop.publication='public';await store.saveShop(shop);
  const email=`customer-${randomUUID()}@example.com`,token=randomUUID();await store.put('session',digest(token),{user:{email,name:'Receipt Customer',role:'customer',shopId:shop.id},expires:Date.now()+600000});await store.put('customer',`${shop.id}:${email}`,{shopId:shop.id,email,name:'Receipt Customer',birthDate:'1990-01-01',gender:'not_specified'});
  const context=await browser.newContext({locale:language==='ja'?'ja-JP':'en-US',viewport:{width,height:1000}});await context.addCookies([{name:'gemihub_session',value:token,url:origin}]);const page=await context.newPage();active=page;const errors=[],submits=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith(`/api/public/${shop.slug}/bookings`))submits.push(r.url());});
  await page.route('https://www.sandbox.paypal.com/**',async route=>{const id=new URL(route.request().url()).searchParams.get('token');assert.ok(returnUrls.has(id));await route.fulfill({status:302,headers:{location:returnUrls.get(id)},body:''});});
  if(mode==='pending'||mode==='failed')await page.route('**/checkouts/*/capture',async route=>{
   if(mode==='failed'){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Payment confirmation unavailable'})});return;}
   const id=new URL(route.request().url()).pathname.split('/').at(-2),checkout=await store.get('checkout',id);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:false,checkout:{id,phase:'capturing',expires:checkout.expires,start:checkout.booking.start,amount:checkout.booking.price,currency:checkout.currency}})});
  });
  const createsBefore=creates,capturesBefore=captures;
  await page.goto(`${origin}/s/${shop.slug}?pane=reserve&lang=${language}`);
  await page.locator('.menu-options button').filter({hasText:'Foot'}).click();for(const name of ['Other removal','Foot care'])await page.locator('.booking-option').filter({hasText:name}).getByRole('checkbox').check();
  await page.locator('.reservation-layout .date-input input[type=text]').first().fill(shopDate(config,Date.now()+4*86400000).replaceAll('-','/'));await page.locator('.time-grid button').first().click();await page.getByLabel(label('お店へのメッセージ（任意）'),{exact:true}).fill('Please use soft colors.');
  if(mode==='foreign'||mode==='missing')await page.route(`**/api/public/${shop.slug}/bookings`,async route=>{if(route.request().method()!=='POST'){await route.continue();return;}const input=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,...(mode==='foreign'?{booking:{...input,id:'private-booking',shopId:shop.id,customer:'another@example.com',name:'Private Customer',staffId:'owner',end:new Date(Date.parse(input.start)+130*60000).toISOString(),price:10500,status:'active',createdAt:new Date().toISOString()}}:{})})});});
  if(paid)await page.getByLabel(label('支払額と返金条件を確認しました'),{exact:true}).check();
  await page.getByRole('button',{name:new RegExp(label(paid?'PayPalで支払いへ進む':'この内容で予約する'))}).click();
  const complete=page.locator('.booking-complete');
  if(['pending','failed','foreign','missing'].includes(mode)){
   if(mode==='pending')await expect(page.getByRole('status').filter({hasText:label('支払いを確認中です。マイページで状況を再確認できます。')})).toBeVisible();
   else if(mode==='failed')await expect(page.getByRole('alert')).toContainText('Payment confirmation unavailable');
   else await expect(page.getByRole('status').filter({hasText:label('予約内容はマイページで確認してください。')})).toBeVisible();
   await expect(complete).toHaveCount(0);assert.equal((await store.bookings(shop.id)).length,0);assert.equal(captures,capturesBefore);await expect(page.locator('body')).not.toContainText('Private Customer');
  }else{
   await expect(complete.getByRole('heading',{name:label('予約が完了しました'),exact:true})).toBeVisible();const booking=(await store.bookings(shop.id))[0];assert.equal((await store.bookings(shop.id)).length,1);
   for(const text of ['Receipt Customer','Foot','Foot care','Other removal','Please use soft colors.',usd?'85.06':'10,500'])await expect(complete).toContainText(text);
   await expect(complete).not.toContainText(booking.id);
   assert.equal(booking.locale,language,'scheduled reminders retain the customer booking language');
   await expect(complete).toContainText(label('開始{0}時間前を目安に、予約日時と確認・キャンセル用リンクをメールでお知らせします。ご来店が難しい場合は、早めにマイページからキャンセルをお願いします。').replace('{0}',String(bookingReminderHours(config,booking))));
   assert.equal(Date.parse(booking.end)-Date.parse(booking.start),130*60000);assert.equal(booking.price,usd?85.06:10500);assert.equal(await page.evaluate(()=>document.activeElement?.id),'booking-complete-title');await expect(page.locator('.reservation-layout')).toHaveCount(0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   const returnHref=page.url();
   if(paid){await expect(complete.locator('.payment-details')).toBeVisible();assert.equal(captures,capturesBefore+1);await page.reload();await expect(complete).toContainText('Receipt Customer');await expect(complete).not.toContainText(booking.id);assert.equal(captures,capturesBefore+1,'refreshing a payment return must not charge twice');}
   await page.screenshot({path:`tmp/booking-complete/${language}-${width}-${mode}-${usd?'usd':'jpy'}.png`,fullPage:true});
   await complete.getByRole('button',{name:label('マイページで予約を確認'),exact:true}).click();await expect(page.locator('.booking-card')).toContainText('Foot');await expect(page.locator('.booking-card')).not.toContainText(booking.id);if(paid)assert.equal(new URL(page.url()).searchParams.has('checkout'),false);
   if(paid){await page.goto(returnHref);await expect(complete).toContainText('Receipt Customer');await expect(complete).not.toContainText(booking.id);}else await page.locator('.public-nav').getByRole('button',{name:label('ご予約'),exact:true}).click();
   if(await complete.count())await complete.getByRole('button',{name:label('続けて予約する'),exact:true}).click();
   await expect(page.locator('.reservation-layout')).toBeVisible();await page.locator('.reservation-layout .date-input input[type=text]').first().fill(shopDate(config,Date.now()+4*86400000).replaceAll('-','/'));await expect(page.locator('.time-grid button').first()).toBeVisible();assert.equal((await store.bookings(shop.id)).length,1);assert.equal(submits.length,1);if(paid){assert.equal(new URL(page.url()).searchParams.has('checkout'),false);assert.equal(captures,capturesBefore+1);}
  }
  assert.equal(creates,createsBefore+(paid?1:0));assert.deepEqual(errors,[]);await context.close();console.log(`${language} ${width}px ${mode} ${usd?'USD':'JPY'}: confirmed receipt or non-success state verified without real PayPal calls.`);
 }
 if(!process.argv.includes('--edge-only'))for(const language of ['ja','en'])for(const width of [1280,390]){await exercise(language,width);await exercise(language,width,'paid');await exercise(language,width,'paid',true);}
 for(const mode of ['pending','failed','foreign','missing'])await exercise('ja',390,mode);
}catch(error){if(active&&!active.isClosed())await active.screenshot({path:'tmp/booking-complete/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await store.close();}
