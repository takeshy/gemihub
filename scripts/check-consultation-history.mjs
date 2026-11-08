import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import * as intelligence from '../server/ai.ts';
process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const store=new Store(':memory:');let calls=0;
const server=createApp(store,{...intelligence,assistant:async input=>{calls++;return{answer:`Saved answer: ${input.question}`,sources:[{path:'spec.md',title:'Shop settings'}]};}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
await mkdir('tmp/consultations',{recursive:true});let active;
try {
 for(const lang of ['ja','en'])for(const width of [1280,390]){
  const label=text=>lang==='en'?catalog[text]||text:text;
  const shop=await store.createShop(`consult-${lang}-${width}@example.com`);shop.published=structuredClone(sample);shop.publication='public';await store.saveShop(shop);
  const token=randomUUID();await store.put('session',digest(token),{user:{email:shop.owner,name:'Owner',role:'owner'},expires:Date.now()+600000});
  const proposal={id:'proposal',alertId:'alert',operation:'resync',bookingId:'attention-booking',target:'Attention booking',expected:'Check state',fingerprint:'fingerprint'};
  await store.put('paypalAlertState',shop.id,{shopId:shop.id,checkedAt:new Date().toISOString(),items:[{id:'alert',kind:'state_mismatch',severity:'medium',bookingId:'attention-booking',target:'Attention booking',fingerprint:'fingerprint',proposal}]});
  const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:'gemihub_session',value:token,url:origin}]);
  const page=await context.newPage();active=page;const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const openMenu=async()=>{if(width<760&&await page.locator('.mobile-menu-toggle').getAttribute('aria-expanded')!=='true')await page.locator('.mobile-menu-toggle').click();};
  const choose=async name=>{await openMenu();await page.locator('aside').getByRole('button',{name:new RegExp('^'+label(name))}).click();};
  const openHistory=async()=>{const toggle=page.locator('.consultation-history-toggle');if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();};
  await page.goto(`${origin}/?lang=${lang}`);await expect(page.locator('.management-dashboard .paypal-alerts')).toBeVisible();
  await page.locator('.paypal-alert-settings summary').click();await page.locator('.paypal-alert-settings select').selectOption('14');
  await page.getByRole('button',{name:label('通知設定を保存'),exact:true}).click();
  await expect.poll(async()=>(await store.shop(shop.id))?.paypalOps?.digestHour).toBe(14);
  // Dashboard CTA creates exactly one private consultation, then submits the chosen record.
  const before=calls;await page.locator('.paypal-alert-list').getByRole('button',{name:label('相談する'),exact:true}).click();
  const assistant=page.locator('.assistant'),input=page.getByRole('textbox',{name:label('アシスタントへの質問'),exact:true});
  await expect(assistant.locator('.chat-message-assistant')).toContainText('attention-booking');assert.equal(calls,before+1);
  await expect(page.locator('.paypal-alerts')).toHaveCount(0);
  const first=new URL(page.url()).searchParams.get('conversation');assert.ok(first);
  await input.fill('Draft for first consultation');
  await openHistory();
  const history=page.locator('.consultation-history');
  await history.locator('.consultation-history-toggle').click();await expect(history.locator('.consultation-history-body')).toBeHidden();
  await expect(input).toHaveValue('Draft for first consultation');
  await openHistory();await expect(history.locator('li').first()).toBeVisible();

  await openHistory();await expect(page.locator('.consultation-history li')).toHaveCount(1);
  await page.locator('.consultation-new').click();await expect(input).toHaveValue('');await expect(input).toBeEditable();
  const second=new URL(page.url()).searchParams.get('conversation');assert.notEqual(first,second);
  await input.fill('Second question');await assistant.getByRole('button',{name:label('送信'),exact:true}).click();
  await expect(assistant.locator('.chat-message-assistant')).toContainText('Saved answer: Second question');
  await input.fill('Draft for second consultation');await openHistory();
  const firstButton=page.locator('.consultation-history li > button:first-child').filter({hasText:'attention-booking'});await firstButton.click();
  await expect(input).toHaveValue('Draft for first consultation');await expect(assistant).not.toContainText('Second question');
  await page.reload();await expect(input).toHaveValue('Draft for first consultation');await expect(assistant.locator('.assistant-sources')).toContainText('Shop settings');
  await openHistory();await page.locator('.consultation-history li > button:first-child').filter({hasText:'Second question'}).click();
  await expect(input).toHaveValue('Draft for second consultation');await expect(assistant).toContainText('Saved answer: Second question');
  await openHistory();await page.locator('.consultation-history li').filter({hasText:'Second question'}).locator('.consultation-delete').click();
  const dialog=page.getByRole('dialog',{name:label('相談を削除'),exact:true});await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:label('やめる'),exact:true}).click();await expect(page.locator('.consultation-history li')).toHaveCount(2);
  await page.locator('.consultation-history li').filter({hasText:'Second question'}).locator('.consultation-delete').click();await dialog.getByRole('button',{name:label('削除する'),exact:true}).click();
  await expect(input).toHaveValue('Draft for first consultation');await openHistory();await expect(page.locator('.consultation-history li')).toHaveCount(1);
  await page.locator('.consultation-delete').click();await dialog.getByRole('button',{name:label('削除する'),exact:true}).click();
  await openHistory();await expect(page.locator('.consultation-history li')).toHaveCount(0);await expect(page.locator('.consultation-history')).toContainText(label('過去の相談はありません。'));
  await openHistory();await page.locator('.consultation-new').click();await expect(input).toBeEditable();await expect(input).toHaveValue('');
  await choose('ダッシュボード');await expect(page.locator('.management-dashboard .paypal-alerts')).toBeVisible();
  await page.getByRole('button',{name:label('今すぐチェック'),exact:true}).click();await expect(page.locator('.paypal-check-result')).toBeVisible();
  // Import the old single browser conversation and retain its unfinished text and sources.
  await page.evaluate(({shopId,email})=>localStorage.setItem(`gemihub:assistant:${shopId}:${email}`,JSON.stringify({messages:[{role:'user',text:'Legacy question'},{role:'assistant',text:'Legacy answer',sources:[{path:'history.md',title:'Legacy source'}]}],text:'Legacy unfinished draft'})),{shopId:shop.id,email:shop.owner});
  await page.reload();await choose('相談・質問');await openHistory();await page.locator('.consultation-history li > button:first-child').filter({hasText:'Legacy question'}).click();
  await expect(assistant).toContainText('Legacy answer');await expect(assistant.locator('.assistant-sources')).toContainText('Legacy source');await expect(input).toHaveValue('Legacy unfinished draft');
  await openHistory();await page.screenshot({path:`tmp/consultations/history-${lang}-${width}.png`});
  assert.deepEqual(errors,[]);await context.close();console.log(`${lang} ${width}px: attention/settings, new/switch/reload/draft, deletion and legacy migration passed.`);
 }
} catch(error){await active?.screenshot({path:'tmp/consultations/failure.png'});throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await store.close();}
