import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, shopSchema } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog=JSON.parse(await readFile('shared/en.json','utf8')),store=new Store(':memory:'),shop=await store.createShop('booking-owner@example.com');shop.published=shopSchema.parse(structuredClone(sample));shop.publication='public';await store.saveShop(shop);
for(const [token,email,role,shopId] of [['owner',shop.owner,'owner',shop.id],['member','member@example.com','customer',shop.id],['new','new@example.com','customer',shop.id],['foreign','other@example.com','customer','another-shop']])await store.put('session',digest(token),{user:{email,role,shopId,name:token},expires:Date.now()+3600000});
await store.put('customer',`${shop.id}:member@example.com`,{shopId:shop.id,email:'member@example.com',name:'Member',birthDate:'1990-01-01',gender:'not_specified'});
const server=createApp(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});await mkdir('tmp/booking-login',{recursive:true});
 for(const language of ['ja','en'])for(const width of [1280,390]){
  const label=text=>language==='en'?catalog[text]||text:text;
  for(const user of ['anonymous','owner','foreign','new','member']){
   if(user==='new')await store.put('customer',`${shop.id}:new@example.com`,{shopId:shop.id,email:'new@example.com',name:'New member'});
   const context=await browser.newContext({viewport:{width,height:950},locale:language==='ja'?'ja-JP':'en-US'});
   if(user!=='anonymous')await context.addCookies([{name:'gemihub_session',value:user,url:origin}]);
   const page=await context.newPage(),errors=[],slots=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/slots'))slots.push(request.url());});
   await page.goto(`${origin}/s/${shop.slug}?pane=reserve&lang=${language}`);
   const denied=['anonymous','owner','foreign'].includes(user);
   if(denied){
    const prompt=page.getByRole('region',{name:label('ご予約にはログインが必要です。'),exact:true});await expect(prompt).toBeVisible();await expect(page.locator('.reservation-layout')).toHaveCount(0);assert.equal(slots.length,0);
    await prompt.getByRole('link',{name:label('会員登録・ログインへ'),exact:true}).click();assert.equal(new URL(page.url()).hash,'#customer-signin');await expect(page.locator('#customer-signin')).toBeInViewport();
    const response=await context.request.post(`${origin}/api/public/${shop.slug}/bookings`,{headers:{Origin:origin},data:{}});assert.equal(response.status(),401,'the server also refuses unauthenticated booking');
   }else if(user==='new'){
    const registration=page.locator('.customer-registration');await expect(registration).toBeVisible();await expect(page.locator('.reservation-layout')).toHaveCount(0);assert.equal(slots.length,0);
    const response=await context.request.post(`${origin}/api/public/${shop.slug}/bookings`,{headers:{Origin:origin},data:{}});assert.equal(response.status(),428,'profile registration remains required');
    await registration.getByLabel(label('お名前'),{exact:true}).fill('New member');await registration.getByLabel(label('生年月日'),{exact:true}).fill('1990-01-01');await registration.getByLabel(label('性別'),{exact:true}).selectOption('not_specified');await registration.getByRole('button',{name:label('登録して予約へ進む'),exact:true}).click();await expect(page.locator('.reservation-layout')).toBeVisible();await expect.poll(()=>slots.length).toBeGreaterThan(0);
   }else{await expect(page.locator('.reservation-layout')).toBeVisible();await expect.poll(()=>slots.length).toBeGreaterThan(0);}
   if(user==='anonymous')await page.screenshot({path:`tmp/booking-login/${language}-${width}.png`,fullPage:true});
   assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await context.close();
  }
  console.log(`${language} ${width}px: anonymous/owner/foreign accounts see sign-in; customers complete registration before booking; no guest slot requests; server auth enforced.`);
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await store.close();}
