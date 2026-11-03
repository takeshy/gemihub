import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createApp } from '../server/app.ts';
import { digest } from '../server/auth.ts';
import { sample } from '../server/domain.ts';
import { Store } from '../server/store.ts';

process.env.NODE_ENV='production';process.env.DEMO_MODE='false';
const store=new Store(':memory:');
const server=createApp(store);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
await mkdir('tmp/shop-reset',{recursive:true});
let activePage;
try{
  for(const width of [1280,390])for(const language of ['ja','en']){
    const shop=await store.createShop(`${language}-${width}@example.com`);
    shop.published=structuredClone(sample);await store.saveShop(shop);
    const user={email:shop.owner,name:'Recording owner',role:'owner',shopId:shop.id,refreshToken:'preserved-google-token'};
    await store.put('user',user.email,user);
    const sessionId=randomUUID();await store.put('session',digest(sessionId),{user,expires:Date.now()+3600000});
    const context=await browser.newContext({viewport:{width,height:900},locale:language==='ja'?'ja-JP':'en-US'});
    await context.addCookies([{name:'gemihub_session',value:sessionId,url:origin}]);
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${origin}/?lang=${language}`);
    const reset=page.getByRole('button',{name:language==='ja'?'自分のお店を初期化':'Reset my shop',exact:true});
    await reset.waitFor();
    const keys={own:`gemihub:local-preview:${shop.owner}:${shop.id}`,other:'gemihub:local-preview:other:keep',language:'recording-preference'};
    await page.evaluate(keys=>{for(const key of Object.values(keys))localStorage.setItem(key,'keep');},keys);
    await reset.click();const dialog=page.getByRole('dialog');await dialog.waitFor();
    const cancel=dialog.getByRole('button',{name:language==='ja'?'やめる':'Cancel',exact:true});
    assert.equal(await cancel.evaluate(el=>el===document.activeElement),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.screenshot({path:`tmp/shop-reset/confirm-${language}-${width}.png`,fullPage:true});
    await cancel.click();assert.equal(await dialog.isVisible(),false);assert.ok(await store.shop(shop.id));
    await reset.click();await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);
    await reset.click();
    const confirm=dialog.getByRole('button',{name:language==='ja'?'初期化して最初からつくる':'Reset and start over',exact:true});
    // A network failure leaves the confirmation available for the same old shop.
    await page.route('**/api/shop-reset',route=>route.abort(),{times:1});
    await confirm.click();await dialog.getByRole('alert').waitFor();
    assert.ok(await store.shop(shop.id));
    let release,arrived;
    const held=new Promise(resolve=>{release=resolve;});const reached=new Promise(resolve=>{arrived=resolve;});
    await page.route('**/api/shop-reset',async route=>{arrived();await held;await route.continue();},{times:1});
    await confirm.click();await reached;
    assert.equal(await cancel.isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);
    release();
    await page.getByRole('button',{name:language==='ja'?'はじめる':'Get started',exact:true}).waitFor();
    const session=await context.request.get(origin+'/api/session').then(r=>r.json());
    assert.equal(session.demo,false);assert.equal(session.user.email,user.email);assert.notEqual(session.user.shopId,shop.id);
    const fresh=await store.shop(session.user.shopId);assert.equal(fresh.published,null);assert.equal(fresh.draft,null);
    assert.equal(await store.ownerToken(fresh),'preserved-google-token');
    const workspace=await context.request.get(origin+'/api/workspace').then(r=>r.json());
    assert.deepEqual(workspace.shops.map(s=>s.id),[fresh.id]);assert.deepEqual(workspace.shops[0].plans,[]);
    assert.equal((await context.request.get(origin+`/api/public/${shop.slug}`)).status(),404);
    assert.deepEqual(await page.evaluate(keys=>Object.fromEntries(Object.entries(keys).map(([label,key])=>[label,localStorage.getItem(key)])),keys),{own:null,other:'keep',language:'keep'});
    await reset.waitFor();await page.screenshot({path:`tmp/shop-reset/after-${language}-${width}.png`,fullPage:true});
    // A second take can be restarted from the initial creation screen too.
    await reset.click();await confirm.click();
    await page.waitForFunction(id=>document.querySelector('dialog')?.open===false,fresh.id);
    await page.getByRole('button',{name:language==='ja'?'はじめる':'Get started',exact:true}).waitFor();
    const again=await context.request.get(origin+'/api/session').then(r=>r.json());assert.notEqual(again.user.shopId,fresh.id);
    assert.equal((await store.get('user',user.email)).refreshToken,user.refreshToken);
    assert.deepEqual(errors,[]);await context.close();
    console.log(`${language} ${width}px: cancellation, retry, pending controls, Google authorization, isolated draft cleanup and two recording takes passed in production mode.`);
  }
}catch(error){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:'tmp/shop-reset/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
