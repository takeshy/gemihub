import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium,expect} from 'playwright/test';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {sample} from '../server/domain.ts';
import {digest} from '../server/auth.ts';
import {paypalValue} from '../shared/region.ts';
process.env.DEMO_MODE='true';
const english=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:');
const orders=new Map(),refunds=[];
const gateway={environment:'sandbox',async ready(){},async create(id,amount,_back,_cancel,currency='JPY'){const order={id,status:'APPROVED',purchase_units:[{custom_id:id,amount:{currency_code:currency,value:paypalValue(amount,currency)}}],links:[{rel:'payer-action',href:`https://www.sandbox.paypal.com/checkoutnow?token=${id}`}]};orders.set(id,order);return structuredClone(order);},async order(id){return structuredClone(orders.get(id));},async capture(id){const order=orders.get(id);order.purchase_units[0].payments={captures:[{id:`cap-${id}`,status:'COMPLETED',amount:order.purchase_units[0].amount}]};return structuredClone(order);},async refund(_capture,amount,id,currency='JPY'){refunds.push(amount);return{id,status:'COMPLETED',amount:{currency_code:currency,value:paypalValue(amount,currency)}};},async refundStatus(){throw new Error('Unexpected refund poll');}};
const tiers=[{hoursBefore:0,percent:0}];
const server=createApp(store,undefined,undefined,undefined,gateway);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
await mkdir('tmp/phone-booking',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});let active;
try{
for(const language of ['ja','en'])for(const width of [1280,390]){
 const label=text=>language==='en'?english[text]||text:text;
 const shop=await store.createShop(`owner-${randomUUID()}@example.com`),config=structuredClone(sample);
 config.staff=[];config.ownerBooking=true;config.hours={...config.hours,start:'00:00',end:'23:45',closedWeekdays:[]};config.rules.sameDay=true;config.rules.leadMinutes=0;config.rules.interval=15;config.rules.payment={enabled:true,refundTiers:tiers};
 shop.published=config;shop.publication='public';await store.saveShop(shop);
 const token=randomUUID(),alice=randomUUID(),aliceEmail=`alice-${randomUUID()}@example.com`;await store.put('session',digest(token),{user:{email:shop.owner,name:'Owner',role:'owner',shopId:shop.id},expires:Date.now()+600000});
 await store.put('session',digest(alice),{user:{email:aliceEmail,name:'Alice',role:'customer',shopId:shop.id},expires:Date.now()+600000});await store.put('customer',`${shop.id}:${aliceEmail}`,{shopId:shop.id,email:aliceEmail,name:'Alice',birthDate:'1990-11-01',gender:'female'});
 const context=await browser.newContext({viewport:{width,height:1000},locale:language==='ja'?'ja-JP':'en-US'});await context.addCookies([{name:'gemihub_session',value:token,url:origin}]);
 const page=await context.newPage();active=page;const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(`${origin}/?tab=bookings&shop=${shop.id}&lang=${language}`);
 const form=page.locator('.phone-booking');await form.locator('summary').click();
 const time=form.getByLabel(label('今日の時間'),{exact:true});
 await expect.poll(()=>time.locator('option').count()).toBeGreaterThan(1);
 await time.selectOption({index:1});
 await form.getByLabel(label('お名前'),{exact:true}).fill('Hanako');await form.getByLabel(label('電話番号'),{exact:true}).fill('03-1234-5678');
 await page.screenshot({path:`tmp/phone-booking/form-${language}-${width}.png`,fullPage:true});
 await form.getByRole('button',{name:label('電話予約を登録する'),exact:true}).click();
 await expect(form.getByRole('status')).toBeVisible();
 await expect(page.locator('.booking-card').filter({hasText:'Hanako'})).toContainText('03-1234-5678');
 const bookings=await store.bookings(shop.id);assert.equal(bookings.length,1);assert.equal(bookings[0].customer,'tel:0312345678');assert.equal(bookings[0].phone,'03-1234-5678');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.screenshot({path:`tmp/phone-booking/saved-${language}-${width}.png`,fullPage:true});
 await page.goto(`${origin}/?tab=customers&shop=${shop.id}&lang=${language}`);
 await expect(page.locator('tr').filter({hasText:'03-1234-5678'})).toContainText('Hanako');
 const register=page.locator('.phone-customer');await register.locator('summary').click();
 await register.getByLabel(label('お名前'),{exact:true}).fill('Taro');await register.getByLabel(label('電話番号'),{exact:true}).fill('090-1111-2222');
 await register.getByRole('button',{name:label('お客様を登録する'),exact:true}).click();
 await expect(page.locator('tr').filter({hasText:'090-1111-2222'})).toContainText('Taro');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.screenshot({path:`tmp/phone-booking/customers-${language}-${width}.png`,fullPage:true});
 await page.locator('tr').filter({hasText:'090-1111-2222'}).getByRole('button').click();
 await expect(page.locator('.customer-basic-info')).toContainText('090-1111-2222');
 // A returning caller's number fills in their name.
 await page.goto(`${origin}/?tab=bookings&shop=${shop.id}&lang=${language}`);
 const again=page.locator('.phone-booking').first();await again.locator('summary').click();
 await again.getByLabel(label('電話番号'),{exact:true}).fill('０３－１２３４－５６７８');await again.getByLabel(label('お名前'),{exact:true}).focus();
 await expect(again.getByLabel(label('お名前'),{exact:true})).toHaveValue('Hanako');
 // A slot awaiting a replacement goes to a cash customer, and the holder's refund rises.
 const call=async(path,data)=>{const r=await fetch(origin+`/api/public/${shop.slug}${path}`,{method:data===undefined?'GET':'POST',headers:{Cookie:`gemihub_session=${alice}`,Origin:origin,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return r.json();};
 const menu=config.menus.find(item=>!item.optionFor),date=new Intl.DateTimeFormat('sv',{timeZone:'Asia/Tokyo'}).format(new Date());
 const open=(await call(`/slots?date=${date}&menu=${menu.id}`)).filter(slot=>Date.parse(slot.start)>Date.now()+3600000);assert.ok(open.length,'a later slot today');
 const begun=await call('/bookings',{name:'Alice',menuId:menu.id,start:open[0].start,requestId:randomUUID(),expectedPrice:menu.price,paymentConsent:{amount:menu.price,policy:tiers}});
 const id=begun.checkout.id;await call(`/checkouts/${id}/capture`,{});const quote=await call(`/bookings/${id}/cancel-quote`);await call(`/bookings/${id}/cancel`,{expectedRefund:quote.amount,expectedTransfer:quote.transfer});
 await page.reload();const replace=page.locator('.booking-card').filter({hasText:'Alice'}).locator('.phone-booking');await replace.locator('summary').click();
 await replace.getByLabel(label('電話番号'),{exact:true}).fill('080-5555-6666');await replace.getByLabel(label('お名前'),{exact:true}).fill('Jiro');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:`tmp/phone-booking/replace-${language}-${width}.png`,fullPage:true});
 const paidBefore=refunds.length;await replace.getByRole('button',{name:label('差し替えて返金を増やす'),exact:true}).click();
 await expect(page.locator('.booking-card').filter({hasText:'Jiro'})).toContainText('080-5555-6666');
 assert.equal(refunds.length,paidBefore+1);assert.equal(refunds.at(-1),quote.transfer.price);
 assert.deepEqual(errors,[]);await context.close();console.log(`${language} ${width}px: phone booking, customers, name autofill and cash replacement passed`);
}
}catch(e){if(active&&!active.isClosed())await active.screenshot({path:'tmp/phone-booking/failure.png',fullPage:true}).catch(()=>{});throw e;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await store.close();}
