import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium,expect} from 'playwright/test';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {digest} from '../server/auth.ts';
import {sample} from '../server/domain.ts';
process.env.DEMO_MODE='true';
const english=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:'),server=createApp(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
await mkdir('tmp/settings-recovery',{recursive:true});let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
 for(const language of ['ja','en'])for(const width of [1280,390]){
  const label=text=>language==='en'?english[text]||text:text;
  const old=structuredClone(sample);old.staff=[old.staff[1]];
  const shop=await store.createShop(`recovery-${language}-${width}@example.com`);shop.published={...structuredClone(old),staff:[],ownerBooking:true};await store.saveShop(shop);
  const session=randomUUID();await store.put('session',digest(session),{user:{email:shop.owner,name:'Owner',role:'owner',shopId:shop.id},expires:Date.now()+600000});
  const key=`gemihub:live-save:${shop.owner}:${shop.id}:staff`,url=`${origin}/?shop=${shop.id}&tab=staff&lang=${language}`,path=`/api/shops/${shop.id}/live-settings/staff`;
  const context=await browser.newContext({locale:language==='ja'?'ja-JP':'en-US',viewport:{width,height:1000}});await context.addCookies([{name:'gemihub_session',value:session,url:origin}]);
  const page=await context.newPage();await page.goto(origin);await page.evaluate(({key,config})=>localStorage.setItem(key,JSON.stringify({config,requestId:crypto.randomUUID()})),{key,config:old});
  let posts=0;page.on('request',request=>{if(request.url()===origin+path&&request.method()==='POST')posts++;});
  await page.goto(url);const panel=page.locator('.live-settings-staff'),cancel=panel.getByRole('button',{name:label('保存待ちを取り消して本番の設定に戻す'),exact:true});
  await expect(panel.locator('.staff-editor')).toHaveCount(1);await expect(panel.locator('.staff-editor').getByRole('button',{name:label('このスタッフを削除'),exact:true})).toBeDisabled();await expect(cancel).toBeEnabled();
  assert.equal((await store.shop(shop.id)).published.staff.length,0,'the stale row exists only in the browser');
  // A failed/unfinished publication must retain its retry state until the server can be read.
  await page.route(origin+path,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Publication in progress'})}));
  await cancel.click();await expect(panel.getByRole('alert')).toContainText('Publication in progress');assert.ok(await page.evaluate(key=>localStorage.getItem(key),key));await expect(panel.locator('fieldset').first()).toHaveJSProperty('disabled',true);
  await page.unroute(origin+path);await cancel.click();await expect(panel.locator('.staff-editor')).toHaveCount(0);await expect(cancel).toHaveCount(0);await expect(panel.locator('fieldset').first()).toHaveJSProperty('disabled',false);assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null);assert.equal(posts,0,'discarding browser-only changes never writes production settings');
  await page.reload();await expect(panel.locator('.staff-editor')).toHaveCount(0);await page.screenshot({path:`tmp/settings-recovery/${language}-${width}.png`,fullPage:true});
  // A completed save with a lost response is recovered automatically after reload.
  const existing=await store.shop(shop.id);existing.published=structuredClone(old);await store.saveShop(existing);await page.reload();await expect(panel.locator('.staff-editor')).toHaveCount(1);
  await panel.getByRole('button',{name:label('このスタッフを削除'),exact:true}).click();
  let releaseSave;const heldResponse=new Promise(resolve=>{releaseSave=resolve;});
  await page.route(origin+path,async route=>{if(route.request().method()==='POST'){await route.fetch();await heldResponse;await route.abort('failed');}else await route.continue();});
  await panel.getByRole('button',{name:label('保存'),exact:true}).click();try{await expect(panel.getByRole('button',{name:label('保存しています…'),exact:true})).toBeDisabled();}finally{releaseSave();}await expect(cancel).toBeVisible();await expect(panel.getByRole('alert')).toBeVisible();assert.equal((await store.shop(shop.id)).published.staff.length,0);assert.ok(await page.evaluate(key=>localStorage.getItem(key),key));
  await page.unroute(origin+path);await page.reload();await expect(cancel).toHaveCount(0);await expect(panel.getByRole('status')).toContainText(label('保存しました。'));await expect(panel.locator('.staff-editor')).toHaveCount(0);await expect(panel.locator('fieldset').first()).toHaveJSProperty('disabled',false);assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null);assert.equal(posts,1,'restoring a completed save does not submit it again');
  await context.close();console.log(`${language} ${width}px: stale Haru cache reproduced; failed recovery preserves retry state; discard loads saved zero-staff data without POST; lost successful response recovers automatically.`);
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await store.close();}
