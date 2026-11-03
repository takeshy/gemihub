import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,expect} from 'playwright/test';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {sample,ownerStaffId} from '../server/domain.ts';
import {digest} from '../server/auth.ts';
import {encrypt} from '../server/google.ts';
import {requestLocale} from '../server/i18n.ts';
process.env.DEMO_MODE='true';process.env.GOOGLE_CLIENT_ID='owner-browser-test';
const english=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:');
const server=createApp(store,undefined,{async exchange(){throw new Error('Unexpected extra OAuth flow');},async busy(connection){assert.equal(connection.staffId,ownerStaffId);return[];}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
await mkdir('tmp/owner-booking',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
let active;
try{
 for(const width of [1280,390])for(const language of ['ja','en']){
  const label=(text,...args)=>(language==='en'?english[text]||text:text).replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]));
  const email=`owner-${language}-${width}@example.com`,shop=await store.createShop(email);
  shop.published=requestLocale.run(language,()=>structuredClone(sample));shop.published.staff=[shop.published.staff[0]];shop.published.hours.closedWeekdays=[];await store.saveShop(shop);
  await store.put('user',email,{email,name:'Owner',role:'owner',calendarRefreshToken:encrypt('calendar-test')});
  const session=`owner-${language}-${width}`;await store.put('session',digest(session),{user:{email,name:'Owner',role:'owner',shopId:shop.id},expires:Date.now()+600000});
  const context=await browser.newContext({locale:language==='ja'?'ja-JP':'en-US',viewport:{width,height:950}});await context.addCookies([{name:'gemihub_session',value:session,url:origin}]);
  const page=await context.newPage();active=page;const errors=[],calendarRequests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(/\/calendar(?:\?|$)/.test(req.url()))calendarRequests.push(req.url());});
  await page.goto(`${origin}/?shop=${shop.id}&tab=staff&lang=${language}`);
  const staff=page.locator('.live-settings-staff');await expect(staff.locator('.staff-editor')).toHaveCount(1);
  await expect(page.locator('.staff-calendar')).toHaveCount(0);
  const remove=staff.getByRole('button',{name:label('このスタッフを削除'),exact:true});await expect(remove).toBeEnabled();await remove.click();await expect(staff.locator('.staff-editor')).toHaveCount(0);
  await staff.getByRole('button',{name:label('保存'),exact:true}).click();await expect.poll(async()=>(await store.shop(shop.id)).published.staff.length).toBe(0);
  await expect(page.locator('.staff-accounts')).toHaveCount(0);await expect(page.locator('.staff-calendar')).toHaveCount(0);assert.equal((await store.shop(shop.id)).published.ownerBooking,true);
  const owner=staff.locator('.owner-editor');await owner.getByLabel(label('店主の名前'),{exact:true}).fill('Owner Morita');
  await owner.getByRole('button',{name:label('画像をアップロード'),exact:true}).click();
  await owner.locator('input[type=file]').setInputFiles({name:'owner.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')});
  await expect(owner.locator('img')).toBeVisible();await staff.getByRole('button',{name:label('保存'),exact:true}).click();
  await expect.poll(async()=>(await store.shop(shop.id)).published.staff.map(person=>({id:person.id,name:person.name}))).toEqual([{id:ownerStaffId,name:'Owner Morita'}]);
  await expect(page.locator('.staff-accounts,.staff-calendar')).toHaveCount(0);await page.reload();await expect(page.getByLabel(label('店主の名前'),{exact:true})).toHaveValue('Owner Morita');await expect(page.locator('.owner-editor img')).toBeVisible();
  await page.screenshot({path:`tmp/owner-booking/staff-${language}-${width}.png`,fullPage:true});
  await page.goto(`${origin}/?shop=${shop.id}&tab=basic&lang=${language}`);
  const hours=page.locator('.live-settings-hours');await expect(hours.getByLabel(label('開店'),{exact:true})).toBeVisible();
  await hours.getByLabel(label('開店'),{exact:true}).fill('09:00');await hours.getByLabel(label('閉店'),{exact:true}).fill('19:00');
  for(const day of ['火','金']){await hours.getByLabel(label('{0}曜の営業時間を変更',label(day)),{exact:true}).check();await hours.getByLabel(label('{0}曜の閉店',label(day)),{exact:true}).fill('21:00');}
  await hours.getByRole('button',{name:label('保存'),exact:true}).click();
  await expect.poll(async()=>(await store.shop(shop.id)).published.hours.weekdayHours).toEqual([{day:2,start:'09:00',end:'21:00'},{day:5,start:'09:00',end:'21:00'}]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await hours.screenshot({path:`tmp/owner-booking/hours-${language}-${width}.png`});
  await page.reload();await expect(page.locator('.live-settings-hours').getByLabel(label('{0}曜の閉店',label('火')),{exact:true})).toHaveValue('21:00');
  await page.goto(`${origin}/s/${shop.slug}?pane=reserve&lang=${language}`);
  await expect(page.getByRole('heading',{name:label('02 日時'),exact:true})).toBeVisible();
  await expect(page.getByLabel(label('スタッフ'),{exact:true})).toHaveCount(0);
  await expect(page.locator('.salon-details').first()).toContainText(`${label('{0}曜',label('火'))} 09:00 – 21:00`);
  assert.equal(calendarRequests.length,0,'owners have no calendar status panel or extra status request');assert.deepEqual(errors,[]);
  await page.screenshot({path:`tmp/owner-booking/reservation-${language}-${width}.png`,fullPage:true});
  await page.goto(`${origin}/s/${shop.slug}?pane=about&lang=${language}`);await expect(page.locator('.public-staff-list')).toContainText('Owner Morita');await expect(page.locator('.public-staff-list img')).toBeVisible();await page.screenshot({path:`tmp/owner-booking/profile-${language}-${width}.png`,fullPage:true});
  await context.close();console.log(`${language} ${width}px: last staff deletion, owner name/photo save and reload, public profile, owner-only booking, hidden owner Calendar panel and weekday hours passed.`);
 }
}catch(error){if(active&&!active.isClosed())await active.screenshot({path:'tmp/owner-booking/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
