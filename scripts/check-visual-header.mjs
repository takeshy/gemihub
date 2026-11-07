import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import sharp from 'sharp';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import * as intelligence from '../server/ai.ts';
import { proposeVisualAppearance } from '../server/visual.ts';
import { standardTheme } from '../shared/theme-editing.ts';
import { sampleFixtures, draftKey } from '../src/local-preview.ts';
import { digest } from '../server/auth.ts';
import {requestLocale} from '../server/i18n.ts';
import {tr} from '../shared/i18n.ts';

process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:');let annotated,failNext=false,rejectNext=true,generations=0,reviews=0;
const server=createApp(store,{...intelligence,
 async identifyVisual(media,targets){
  assert.deepEqual(targets.map(target=>target.id),['theme'],'the whole-page frame is selected automatically');
  annotated=media;const {data,info}=await sharp(Buffer.from(media.data,'base64')).raw().toBuffer({resolveWithObject:true});let red=0;
  for(let i=0;i<data.length;i+=info.channels)if(data[i]>180&&data[i+1]<80&&data[i+2]<100)red++;
  assert.ok(red>100);return{ids:['theme'],explanation:tr('ページ全体の見た目をまとめて修正します。')};
 },
 async visualAppearance(current,instruction,images,options){
  assert.equal(options.target,'theme');assert.deepEqual(options.media,annotated);
  if(failNext){failNext=false;throw Object.assign(new Error('Retry this proposal'),{status:400});}
  generations++;
  const refined=instruction.includes('24 pixels');
  return proposeVisualAppearance(current,instruction,images,{...options,generate:async()=>JSON.stringify({header:{title:'A welcoming shop'},footer:{text:'See you soon.'},appearance:{theme:{headerCss:`.public-nav{gap:${refined?24:12}px}`,footerCss:'.site-footer{padding:32px}',bodyHtml:'<main class="whole-frame"><slot name="content"></slot></main>'}}})});
 },
 async visualReview(input){reviews++;assert.equal(input.screen,'theme');assert.equal(input.after.footer.text,'See you soon.');if(rejectNext){rejectNext=false;return{approved:false,issues:['Keep the menu readable on phones.']};}return{approved:true,issues:[]};}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
await mkdir('tmp/visual-header',{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});let active;
try{
 for(const [language,width] of (process.env.UPDATE_MANUAL==='1'?[['ja',1280],['en',1280]]:[['ja',1280],['en',390]])){
  const label=text=>language==='en'?catalog[text]||text:text;
  const shop=await store.createShop(`whole-${language}@example.com`);
  shop.published={...requestLocale.run(language,()=>structuredClone(sample)),appearance:{accent:'sage',layout:'standard',imageUrl:'',theme:standardTheme},pages:[{id:'faq',slug:'faq',title:'FAQ',navigationLabel:'FAQ',body:'<p>Published page</p>',layout:'standard',imageUrl:''}]};await store.saveShop(shop);
  const cookie=randomUUID();await store.put('session',digest(cookie),{user:{email:shop.owner,name:'Owner',role:'owner',shopId:shop.id},expires:Date.now()+3600000});
  const context=await browser.newContext({viewport:{width,height:950}});await context.addCookies([{name:'gemihub_session',value:cookie,url:origin}]);
  const config=structuredClone(shop.published);config.pages[0].body='<p>Unsaved page draft</p>';
  const local={config,source:shop.published,base:shop.revision,fixtures:sampleFixtures(config),downloaded:['faq']};
  const key=draftKey(shop.owner,shop.id);await context.addInitScript(({key,local})=>localStorage.setItem(key,JSON.stringify(local)),{key,local});
  const page=await context.newPage();active=page;page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/?lang=${language}`);
  if(width<760)await page.locator('.mobile-menu-toggle').click();
  await page.locator('aside nav').getByRole('button',{name:new RegExp(label('画面を試す・編集')+'$')}).click();
  if(width<760)await page.locator('.mobile-menu-toggle').click();
  await page.getByRole('treeitem',{name:new RegExp('^'+label('ページ全体'))}).click();
  assert.equal(await page.getByRole('treeitem',{name:label('ヘッダー'),exact:true}).count(),0);
  assert.equal(await page.getByRole('treeitem',{name:label('フッター'),exact:true}).count(),0);
  const preview=page.locator('.local-preview-screen');await expect(preview).toContainText(label('Dummy（仮の内容）'));
  assert.equal(await preview.locator('form,input,select').count(),0,'the center is dummy content, not a booking form');
  await expect(preview.locator('.public-nav')).toBeVisible();await expect(preview.locator('.site-footer')).toBeVisible();
  const draft=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  const begin=async()=>{
   await page.getByRole('button',{name:label('修正する'),exact:true}).click();const canvas=page.locator('.annotation-canvas');
   await expect.poll(()=>canvas.evaluate(element=>element.height)).toBeGreaterThan(100);const bounds=await canvas.boundingBox();
   await page.mouse.move(bounds.x+20,bounds.y+30);await page.mouse.down();await page.mouse.move(bounds.x+180,bounds.y+40);await page.mouse.up();
   const chat=page.locator('.visual-chat-panel');await chat.getByRole('textbox').fill(language==='ja'?'上のメニューの間隔を広げて、下のあいさつも変えてください。':'Make the top menu more spacious and change the footer greeting.');
   if(process.env.UPDATE_MANUAL==='1'&&await chat.locator('.chat-message').count()===0)await page.screenshot({path:`public/manual/${language==='en'?'en/':''}22-pen.jpg`,type:'jpeg',quality:86,fullPage:true});
   await chat.getByRole('button',{name:label('送信'),exact:true}).click();
   const review=page.getByRole('dialog',{name:label('修正案を比較'),exact:true});await expect(review).toBeVisible();
   assert.equal(await page.locator('.visual-chat-confirmation').count(),0);
   await expect(review).toContainText(label('修正後のPC・スマートフォンの画面をAIで確認しました。'));
   await expect(review.getByRole('region',{name:label('修正案'),exact:true})).toContainText('A welcoming shop');
   await expect(review.getByRole('region',{name:label('修正案'),exact:true})).toContainText('See you soon.');return review;
  };
  const original=(await draft()).config;let review=await begin();
  assert.deepEqual((await draft()).config,original);await review.getByRole('button',{name:label('キャンセル'),exact:true}).click();
  assert.deepEqual((await draft()).config,original);
  await page.locator('.visual-chat-panel').getByRole('button',{name:label('閉じる'),exact:true}).click();
  review=await begin();await review.getByRole('button',{name:label('さらに変更'),exact:true}).click();
  const refinement=review.getByRole('textbox',{name:label('さらに変更したいこと'),exact:true});await refinement.fill('Make the menu gap 24 pixels.');failNext=true;
  await review.getByRole('button',{name:label('修正案を更新'),exact:true}).click();await expect(review.getByRole('alert')).toHaveText('Retry this proposal');await expect(refinement).toHaveValue('Make the menu gap 24 pixels.');
  await review.getByRole('button',{name:label('修正案を更新'),exact:true}).click();await expect(refinement).toHaveValue('');
  await page.screenshot({path:`tmp/visual-header/review-${language}-${width}.png`,fullPage:true});
  await review.getByRole('button',{name:'OK',exact:true}).click();await expect(review).toHaveCount(0);
  assert.equal((await draft()).config.header.title,'A welcoming shop');assert.equal((await draft()).config.footer.text,'See you soon.');assert.deepEqual((await store.shop(shop.id)).published,shop.published);
  const back=page.getByRole('button',{name:label('前の状態に戻る'),exact:true}),forward=page.getByRole('button',{name:label('次の状態に進む'),exact:true});
  await back.click();assert.equal((await draft()).config.header.title,shop.published.header.title);await forward.click();assert.equal((await draft()).config.footer.text,'See you soon.');
  await page.locator('.visual-chat-panel').getByRole('button',{name:label('閉じる'),exact:true}).click();
  await page.getByRole('button',{name:label('反映する'),exact:true}).click();await page.getByRole('button',{name:label('この内容を本番に反映'),exact:true}).click();
  await expect.poll(async()=>(await store.shop(shop.id)).published.header.title).toBe('A welcoming shop');
  const published=(await store.shop(shop.id)).published;assert.equal(published.footer.text,'See you soon.');assert.equal(published.pages[0].body,'<p>Published page</p>');assert.deepEqual(published.rules,shop.published.rules);
  assert.equal((await draft()).config.pages[0].body,'<p>Unsaved page draft</p>','publishing the complete frame preserves other page drafts');
  assert.deepEqual(errors,[]);await context.close();console.log(`${language} ${width}px: unified frame, explicit dummy content, automatic target, review/repair, cancel, refine retry, undo/redo and scoped publication passed.`);
 }
 assert.ok(reviews>generations-2);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
