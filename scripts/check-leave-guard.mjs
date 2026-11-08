import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, planSummary } from '../server/domain.ts';
import * as intelligence from '../server/ai.ts';
import { digest } from '../server/auth.ts';
import { requestLocale } from '../server/i18n.ts';

// Leaving the screen editor while the pen AI is working, or before its proposal is applied, asks first.
process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:');let release=()=>{};
const server=createApp(store,{...intelligence,visualReview:async()=>({approved:true,issues:[]}),
  async identifyVisual(){await new Promise(resolve=>{release=resolve;});return{ids:['description'],explanation:'I’ll change the introduction.'};},
  async propose(_text,current){const config={...structuredClone(current),description:'Changed introduction'};return{config,summary:planSummary(current,config)};},
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
await mkdir('tmp/leave-guard',{recursive:true});let active;
try{
 for(const language of ['ja','en']){
  const label=text=>language==='en'?(catalog[text]||text):text;
  const shop=await store.createShop(`leave-${language}@example.com`);
  shop.published=requestLocale.run(language,()=>structuredClone(sample));shop.publication='public';await store.saveShop(shop);
  const user={email:shop.owner,name:'Owner',role:'owner',shopId:shop.id};await store.put('user',user.email,user);
  const session=randomUUID();await store.put('session',digest(session),{user,expires:Date.now()+3600000});
  const context=await browser.newContext({viewport:{width:1280,height:950},locale:language==='en'?'en-US':'ja-JP'});await context.addCookies([{name:'gemihub_session',value:session,url:origin}]);
  const page=await context.newPage();active=page;page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const dialogs=[];let accept=false;
  page.on('dialog',dialog=>{dialogs.push(dialog.message());void(accept?dialog.accept():dialog.dismiss());});
  await page.goto(`${origin}/?lang=${language}`);
  const nav=name=>page.locator('aside nav').getByRole('button',{name:new RegExp(label(name)+'$')});
  await expect(page.locator('.management-dashboard')).toBeVisible();
  await nav('AIとお店をつくる').click();await page.getByRole('treeitem',{name:label('予約'),exact:true}).click();
  await expect(page.locator('.local-preview-screen')).toBeVisible();
  // Without AI work, moving needs no confirmation.
  await nav('ダッシュボード').click();await expect(page.locator('.management-dashboard')).toBeVisible();assert.equal(dialogs.length,0);
  await page.goBack();await expect(page.locator('.local-preview-screen')).toBeVisible();assert.equal(dialogs.length,0);
  await page.getByRole('button',{name:label('修正する'),exact:true}).click();
  const chat=page.locator('.visual-chat-panel'),canvas=page.locator('.annotation-canvas');
  await expect(canvas).toBeVisible();await expect.poll(()=>canvas.evaluate(element=>element.height)).toBeGreaterThan(100);
  const rect=await canvas.boundingBox();await page.mouse.move(rect.x+20,rect.y+30);await page.mouse.down();await page.mouse.move(rect.x+130,rect.y+60);await page.mouse.up();
  const input=chat.getByRole('textbox',{name:label('ここをどう変えたいですか'),exact:true});
  await input.fill(language==='ja'?'紹介文を変えてください。':'Change the introduction.');await input.press('Control+Enter');
  await expect.poll(()=>chat.locator('.chat-message-user').count()).toBeGreaterThan(0);
  // While the AI works, staying keeps the chat; the URL is unchanged.
  await nav('ダッシュボード').click();
  await expect.poll(()=>dialogs.length).toBe(1);assert.equal(dialogs[0],label('AIが画面を修正しています。移動すると修正が中断され、内容が失われます。移動しますか？'));
  await expect(chat).toBeVisible();assert.equal(new URL(page.url()).searchParams.get('tab'),'try');
  // Back/forward also asks and restores the current address when staying.
  await page.goBack();await expect.poll(()=>dialogs.length).toBe(2);
  await expect(chat).toBeVisible();assert.equal(new URL(page.url()).searchParams.get('tab'),'try');
  // The pending proposal is guarded too; confirming leaves.
  release();const review=page.getByRole('dialog',{name:label('修正案を比較'),exact:true});await expect(review).toBeVisible();
  accept=true;await page.goBack();
  await expect.poll(()=>dialogs.length).toBe(3);assert.equal(dialogs[2],label('AIの修正案をまだ「OK」で取り込んでいません。移動すると修正案が失われます。移動しますか？'));
  // The previous entry is the whole-page screen; the pen chat and its proposal are gone.
  await expect.poll(()=>new URL(page.url()).searchParams.get('screen')).toBe('theme');await expect(review).toHaveCount(0);await expect(chat).toHaveCount(0);
  assert.deepEqual(errors,[]);await context.close();console.log(`${language}: leaving during pen AI work and before applying its proposal asks first; staying keeps the chat and address.`);
 }
}catch(error){if(active&&!active.isClosed())await active.screenshot({path:'tmp/leave-guard/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{release();server.closeAllConnections?.();await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
