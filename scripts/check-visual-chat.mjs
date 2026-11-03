import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, planSummary } from '../server/domain.ts';
import * as intelligence from '../server/ai.ts';
import { digest } from '../server/auth.ts';

process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:');const identified=[];
const server=createApp(store,{...intelligence,
  async identifyVisual(media,targets,instruction){assert.equal(media.mimeType,'image/png');assert.ok(targets.some(target=>target.id==='name'));identified.push(instruction);return{ids:['name'],explanation:/ください|します/.test(instruction)?'店名を修正します。対象を確認してください。':'Please confirm the shop name change.'};},
  async propose(text,current){const config={...structuredClone(current),name:text.includes('Moon Two')?'Moon Two':'Moon One'};return{config,summary:planSummary(current,config)};}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
await mkdir('tmp/side-chat',{recursive:true});let active;
try{
 for(const width of [1280,390])for(const language of ['ja','en']){
  const label=text=>language==='en'?(catalog[text]||text):text;
  const shop=await store.createShop(`visual-${width}-${language}@example.com`);shop.published=structuredClone(sample);await store.saveShop(shop);
  const user={email:shop.owner,name:'Owner',role:'owner',shopId:shop.id};await store.put('user',user.email,user);
  const session=randomUUID();await store.put('session',digest(session),{user,expires:Date.now()+3600000});
  const context=await browser.newContext({viewport:{width,height:950},locale:language==='en'?'en-US':'ja-JP'});await context.addCookies([{name:'gemihub_session',value:session,url:origin}]);
  const page=await context.newPage();active=page;page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/?lang=${language}`);
  await page.locator('aside nav').getByRole('button',{name:new RegExp(label('画面を試す・編集')+'$')}).click();
  const preview=page.locator('.local-preview-screen');await expect(preview).toBeVisible();
  await page.locator('.preview-display-menu summary').click();await page.getByLabel(label('ヘッダーを表示'),{exact:true}).check();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:label('修正する'),exact:true}).click();
  const chat=page.getByRole('complementary',{name:label('画面の修正チャット'),exact:true}),canvas=page.locator('.annotation-canvas');
  await expect(chat).toBeVisible();await expect(canvas).toBeVisible();await expect(preview).toBeHidden();
  if(width>=1000){const left=await canvas.boundingBox(),right=await chat.boundingBox();assert.ok(left.x+left.width<=right.x+1);}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const input=chat.getByRole('textbox',{name:label('ここをどう変えたいですか'),exact:true});
  const rectangle=await canvas.boundingBox();await page.mouse.move(rectangle.x+80,rectangle.y+70);await page.mouse.down();await page.mouse.move(rectangle.x+160,rectangle.y+90);await page.mouse.up();
  await input.fill(language==='ja'?'店名を「Moon One」にしてください。':'Use Moon One as the shop name.');await input.press('Control+Enter');
  await expect(chat.getByLabel(label('変更する対象を確認'))).toHaveValue('name');
  await expect(chat.locator('.chat-message-assistant')).toHaveCount(1);
  assert.equal((await store.shop(shop.id)).published.name,shop.published.name);
  await input.fill(language==='ja'?'今の色は変えないでください。':'Keep the current colors.');await chat.getByRole('button',{name:label('送信'),exact:true}).click();
  await expect(chat.locator('.chat-message-assistant')).toHaveCount(2);assert.match(identified.at(-1),/Moon One[\s\S]*(?:Keep the current colors|今の色)/);
  await page.screenshot({path:`tmp/side-chat/normal-confirm-${language}-${width}.png`,fullPage:true});
  if(process.env.UPDATE_MANUAL==='1'&&width===1280)await page.screenshot({path:`public/manual/${language==='en'?'en/':''}22-pen.jpg`,type:'jpeg',quality:86});
  await chat.getByRole('button',{name:label('この箇所を修正する'),exact:true}).click();
  await expect(preview).toBeVisible();await expect(canvas).toHaveCount(0);await expect(chat).toBeVisible();
  await expect(preview.getByText('Moon One',{exact:true}).first()).toBeVisible();
  await input.fill(language==='ja'?'店名は「Moon Two」にします。':'Use Moon Two instead.');await input.press('Control+Enter');
  await expect(chat.locator('.chat-message-user')).toHaveCount(3);await expect(chat.locator('.chat-message-assistant')).toHaveCount(4);
  assert.doesNotMatch(identified.at(-1),/Moon One|Keep the current colors/,'completed requests are not repeated in the next edit');
  await chat.getByRole('button',{name:label('この箇所を修正する'),exact:true}).click();
  await expect(preview.getByText('Moon Two',{exact:true}).first()).toBeVisible();await expect(chat.locator('.chat-message-assistant')).toHaveCount(5);
  assert.equal((await store.shop(shop.id)).published.name,shop.published.name,'chat edits stay unpublished');
  assert.ok(await page.evaluate(()=>Object.values(localStorage).some(value=>{try{return JSON.parse(value).config?.name==='Moon Two';}catch{return false;}})));
  await page.screenshot({path:`tmp/side-chat/normal-updated-${language}-${width}.png`,fullPage:true});
  await chat.getByRole('button',{name:label('閉じる'),exact:true}).click();await expect(chat).toHaveCount(0);assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('visual-chat-open')),false);
  assert.deepEqual(errors,[]);await context.close();console.log(`${language} ${width}px: red-pen capture replaces the source, chat retains follow-ups and confirmation, local edits update the screen without publishing.`);
 }
}catch(error){if(active&&!active.isClosed())await active.screenshot({path:'tmp/side-chat/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
