// Browser check: a holder offers a paid booking for transfer, another customer takes it over through
// (mocked) PayPal, and the holder sees the refund. Run after `npm run build`.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium,expect} from 'playwright/test';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {digest} from '../server/auth.ts';
import {sample,slots,shopDate} from '../server/domain.ts';
import {defaultRefundTiers} from '../server/payment-domain.ts';
import {paymentService} from '../server/payments.ts';
import {paypalValue} from '../shared/region.ts';
process.env.DEMO_MODE='true';
const store=new Store(':memory:'),orders=new Map(),returnUrls=new Map(),refunds=[];
const gateway={environment:'sandbox',async ready(){},
 async create(id,amount,returnUrl,_cancel,currency){returnUrls.set(id,returnUrl);const order={id:`order-${id}`,status:'CREATED',purchase_units:[{custom_id:id,amount:{currency_code:currency,value:paypalValue(amount,currency)}}],links:[{rel:'payer-action',href:`https://www.sandbox.paypal.com/checkoutnow?token=${id}`}]};orders.set(order.id,{...structuredClone(order),status:'APPROVED'});return order;},
 async order(id){return structuredClone(orders.get(id));},
 async capture(id){const order=orders.get(id);order.status='COMPLETED';order.purchase_units[0].payments={captures:[{id:`capture-${id}`,status:'COMPLETED',amount:order.purchase_units[0].amount}]};return structuredClone(order);},
 async refund(capture,amount,requestId,currency){refunds.push({capture,amount});return {id:`refund-${requestId}`,status:'COMPLETED',amount:{currency_code:currency,value:paypalValue(amount,currency)}};},
 async refundStatus(id){return {id,status:'COMPLETED'};}};
const server=createApp(store,undefined,undefined,undefined,gateway);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
await mkdir('tmp/booking-transfer',{recursive:true});
let browser;
try{
 const config=structuredClone(sample);
 config.hours={start:'00:00',end:'23:30',closedWeekdays:[],holidays:[]};config.staff=config.staff.map(person=>({...person,start:'00:00',end:'23:30'}));config.rules.leadMinutes=0;
 config.rules.payment={enabled:true,refundTiers:structuredClone(defaultRefundTiers)};
 const shop=await store.createShop('owner@example.com');shop.published=config;shop.publication='public';await store.saveShop(shop);
 // Alice's paid booking about 18 hours ahead: the 10%-off zone.
 const target=Date.now()+18*3600000;
 const slot=[0,1].flatMap(day=>slots(config,[],shopDate(config,target+(day-1)*86400000),'simple')).find(s=>Date.parse(s.start)>=target);
 const booking={id:digest(randomUUID()),shopId:shop.id,customer:'alice@example.com',name:'Alice',menuId:'simple',price:5500,message:'',...slot,status:'active',createdAt:new Date().toISOString()};
 const payments=paymentService(store,gateway);const checkout=await payments.begin(booking,defaultRefundTiers,'https://s.invalid/r','https://s.invalid/c');await payments.capture(checkout,async()=>true);
 for(const id of ['alice','bob']){await store.put('session',digest(`check-${id}`),{user:{email:`${id}@example.com`,name:id,role:'customer',shopId:shop.id},expires:Date.now()+600000});await store.put('customer',`${shop.id}:${id}@example.com`,{shopId:shop.id,email:`${id}@example.com`,name:id==='bob'?'Bob':'Alice',birthDate:'1990-01-01',gender:'not_specified'});}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
 const open=async(id,query)=>{const context=await browser.newContext({locale:'ja-JP',viewport:{width:1100,height:1200}});await context.addCookies([{name:'gemihub_session',value:`check-${id}`,url:origin}]);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());await page.route('https://www.sandbox.paypal.com/**',async route=>{const token=new URL(route.request().url()).searchParams.get('token');await route.fulfill({status:302,headers:{location:returnUrls.get(token)},body:''});});await page.goto(`${origin}/s/${shop.slug}?${query}`);return {page,errors};};
 const alice=await open('alice','pane=mine&lang=ja');
 await alice.page.getByRole('button',{name:'キャンセルする',exact:true}).click();
 await expect(alice.page.getByText(/返金額が¥4,950に増えます/)).toBeVisible();
 await expect(alice.page.getByRole('button',{name:'キャンセルを取り消して、予約に戻す'})).toBeVisible();
 await alice.page.screenshot({path:'tmp/booking-transfer/1-holder-listed.png',fullPage:true});
 const bob=await open('bob','pane=reserve&lang=ja');
 await expect(bob.page.getByRole('heading',{name:'お得に予約できる空き枠'})).toBeVisible();
 await bob.page.getByRole('button',{name:'この枠を予約する'}).click();
 await bob.page.getByLabel('支払額と返金条件を確認しました').first().check();
 await bob.page.screenshot({path:'tmp/booking-transfer/2-transferee-offer.png',fullPage:true});
 await bob.page.locator('.transfer-offers').getByRole('button',{name:/PayPalで支払いへ進む/}).click();
 await expect(bob.page.locator('.booking-complete')).toBeVisible({timeout:15000});
 await bob.page.screenshot({path:'tmp/booking-transfer/3-transferee-complete.png',fullPage:true});
 await alice.page.reload();
 await expect(alice.page.getByText('代わりの予約が入りました')).toBeVisible();
 await expect(alice.page.getByText(/返金完了：¥4,950/)).toBeVisible();
 await alice.page.screenshot({path:'tmp/booking-transfer/4-holder-sold.png',fullPage:true});
 assert.deepEqual(refunds,[{capture:`capture-order-${booking.id}`,amount:4950}]);
 assert.deepEqual([...alice.errors,...bob.errors],[]);
 console.log('Booking transfer browser check passed; screenshots in tmp/booking-transfer/');
}finally{await browser?.close();server.close();await store.close();}
