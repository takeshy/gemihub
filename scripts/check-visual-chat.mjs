import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, planSummary, shopSchema } from '../server/domain.ts';
import * as intelligence from '../server/ai.ts';
import { digest } from '../server/auth.ts';
import { requestLocale } from '../server/i18n.ts';

process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:');const identified=[];let annotated;
const server=createApp(store,{...intelligence,visualReview:async()=>({approved:true,issues:[]}),
  async identifyVisual(media,targets,instruction,_screen,messages){
    annotated=media;identified.push({instruction,messages});
    assert.ok(targets.some(target=>target.id==='description'));
    if(instruction.endsWith('unclear'))return{ids:[],explanation:'How would you like this area to look?'};
    return{ids:['description'],explanation:'I’ll change the introduction and keep the rest of the page.'};
  },
  async propose(text,current,_email,_demo,_images,_region,_themeContext,media){
    assert.deepEqual(media,annotated);
    const description=text.includes('Calm, beautiful nails')?'Calm, beautiful nails':text.includes('落ち着いた美しいネイル')?'落ち着いた美しいネイル':text.includes('Your next favorite nails')?'Your next favorite nails':text.includes('次のお気に入りネイル')?'次のお気に入りネイル':text.includes('Nails for every season')?'Nails for every season':'季節を楽しむネイル';
    const config={...structuredClone(current),description};return{config,summary:planSummary(current,config)};
  }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
await mkdir('tmp/side-chat',{recursive:true});let active;
try{
 for(const width of [1280,390])for(const language of ['ja','en']){
  const label=text=>language==='en'?(catalog[text]||text):text;
  const shop=await store.createShop(`visual-${width}-${language}@example.com`);
  // Seed saved copy in the capture language. A real theme puts the editable
  // introduction slot above the title, so the circled tagline is an actual target.
  shop.published=requestLocale.run(language,()=>structuredClone(sample));
  const introduction=shop.published.description;
  shop.published.description=language==='en'?'A little moment, just for you.':'日常に、小さなときめきを。';
  shop.published.appearance={accent:'sage',layout:'standard',imageUrl:'',...shop.published.appearance,theme:{
    headerHtml:`<header class="site-header capture-header"><section class="salon-hero"><div class="capture-tagline"><slot name="subtitle"></slot></div><slot name="title"></slot><p>${introduction}</p><slot name="details"></slot><slot name="image"></slot></section><slot name="navigation"></slot></header>`,
    bodyHtml:'<main class="capture-body"><slot name="content"></slot></main>',
    footerHtml:'<footer class="site-footer"><slot name="content"></slot></footer>',
    css:'.capture-header{display:block;height:auto;padding:35px 30px 0}.capture-tagline{position:relative;z-index:2}.capture-tagline p{display:inline-block;margin:0;font-size:11px;letter-spacing:.12em;text-transform:uppercase}.capture-body{padding:0 30px 40px}@media(max-width:600px){.capture-header{padding:20px 15px 0}.capture-body{padding:0 15px 24px}}',
  }};
  shop.published=shopSchema.parse(shop.published);await store.saveShop(shop);
  const firstTagline=language==='en'?'Nails for every season':'季節を楽しむネイル',secondTagline=language==='en'?'Your next favorite nails':'次のお気に入りネイル';
  const user={email:shop.owner,name:'Owner',role:'owner',shopId:shop.id};await store.put('user',user.email,user);
  const session=randomUUID();await store.put('session',digest(session),{user,expires:Date.now()+3600000});
  const context=await browser.newContext({viewport:{width,height:950},locale:language==='en'?'en-US':'ja-JP'});await context.addCookies([{name:'gemihub_session',value:session,url:origin}]);
  const page=await context.newPage();active=page;page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/?lang=${language}`);
  if(width<=760)await page.locator('.mobile-menu-toggle').click();
  await page.locator('aside nav').getByRole('button',{name:new RegExp(label('AIとお店をつくる')+'$')}).click();
  if(width<=760)await page.locator('.mobile-menu-toggle').click();
  await page.getByRole('treeitem',{name:label('予約'),exact:true}).click();
  const preview=page.locator('.local-preview-screen');await expect(preview).toBeVisible();
  await expect(page.getByRole('button',{name:label('修正する'),exact:true})).toBeVisible();
  await page.locator('.editor-toolbar').screenshot({path:`tmp/side-chat/toolbar-${language}-${width}.png`});
  if(width<=760)await page.setViewportSize({width:320,height:950});
  await page.locator('.preview-display-menu summary').click();
  const menuBounds=await page.locator('.preview-display-menu > div').boundingBox();
  assert.ok(menuBounds.x>=0&&menuBounds.x+menuBounds.width<=page.viewportSize().width,'display options fit the viewport');
  await page.screenshot({path:`tmp/side-chat/display-${language}-${width<=760?320:width}.png`,fullPage:false});
  await page.getByLabel(label('ヘッダーを表示'),{exact:true}).check();await page.keyboard.press('Escape');
  if(width<=760)await page.setViewportSize({width,height:950});
  if(language==='en')assert.doesNotMatch(await preview.innerText(),/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,'English captures use English saved shop content');
  const chat=page.locator('.visual-chat-panel'),canvas=page.locator('.annotation-canvas');
  const shape=()=>preview.evaluate(element=>({width:element.getBoundingClientRect().width,height:element.scrollHeight}));
  if(width>760){
    // The phone preview is captured as the phone layout, then PC is restored for the main flow.
    const device=page.getByRole('group',{name:label('プレビューの幅'),exact:true});
    await device.getByRole('button',{name:label('スマートフォン'),exact:true}).click();
    const phone=await shape();assert.equal(Math.round(phone.width),390);
    await page.getByRole('button',{name:label('修正する'),exact:true}).click();await expect(canvas).toBeVisible();
    await expect.poll(()=>canvas.evaluate(element=>element.height)).toBeGreaterThan(100);
    const ratio=await canvas.evaluate(element=>element.width/element.height);
    assert.ok(Math.abs(ratio-phone.width/phone.height)<0.05*phone.width/phone.height,`phone capture keeps the 390px layout (${ratio} vs ${phone.width/phone.height})`);
    await expect(device.getByRole('button',{name:label('PC'),exact:true})).toBeDisabled();
    await chat.getByRole('button',{name:label('閉じる'),exact:true}).click();await expect(canvas).toHaveCount(0);
    await device.getByRole('button',{name:label('PC'),exact:true}).click();
  }
  const layout=await shape();
  await page.getByRole('button',{name:label('修正する'),exact:true}).click();
  await expect(chat).toBeVisible();await expect(canvas).toBeVisible();
  await expect.poll(()=>canvas.evaluate(element=>element.height)).toBeGreaterThan(100);
  // The side chat must not turn a PC capture into the narrower phone layout.
  const captured=await canvas.evaluate(element=>element.width/element.height);
  assert.ok(Math.abs(captured-layout.width/layout.height)<0.05*layout.width/layout.height,`capture keeps the ${width}px preview layout (${captured} vs ${layout.width/layout.height})`);
  assert.equal(await preview.evaluate(element=>element.style.width),'','the temporary capture width is restored');
  const rect=await canvas.boundingBox();await page.mouse.move(rect.x+20,rect.y+30);await page.mouse.down();await page.mouse.move(rect.x+130,rect.y+60);await page.mouse.up();
  const input=chat.getByRole('textbox',{name:label('ここをどう変えたいですか'),exact:true});
  const review=page.getByRole('dialog',{name:label('修正案を比較'),exact:true});
  const send=async text=>{await input.fill(text);await input.press('Control+Enter');await expect(review).toBeVisible();};
  const accept=async()=>{await review.getByRole('button',{name:'OK',exact:true}).click();await expect(review).toHaveCount(0);};
  await send(language==='ja'?'囲んだ紹介文を「季節を楽しむネイル」に変えてください。':'Change the circled tagline to “Nails for every season”.');
  assert.equal(await page.locator('.visual-chat-confirmation').count(),0,'no target selector or confirmation step');
  await expect(review).toContainText(label('修正後のPC・スマートフォンの画面をAIで確認しました。'));
  await review.getByRole('button',{name:label('さらに変更'),exact:true}).click();
  await review.getByRole('textbox',{name:label('さらに変更したいこと'),exact:true}).fill(language==='ja'?'今の色は変えないでください。':'Keep the current colors.');
  await review.getByRole('button',{name:label('修正案を更新'),exact:true}).click();
  await expect(review.getByRole('textbox',{name:label('さらに変更したいこと'),exact:true})).toHaveValue('');await accept();
  await expect(preview.locator('.capture-tagline p')).toHaveText(firstTagline);
  await expect(canvas).toHaveCount(0);
  const back=page.getByRole('button',{name:label('前の状態に戻る'),exact:true}),forward=page.getByRole('button',{name:label('次の状態に進む'),exact:true});
  await send(language==='ja'?'紹介文は「次のお気に入りネイル」にします。':'Use “Your next favorite nails” as the tagline instead.');
  assert.match(JSON.stringify(identified.at(-1).messages),/Keep the current colors|今の色/,'completed corrections and refinements remain in context');
  await accept();await expect(preview.locator('.capture-tagline p')).toHaveText(secondTagline);
  const calls=identified.length;await back.click();await expect(preview.locator('.capture-tagline p')).toHaveText(firstTagline);await forward.click();assert.equal(identified.length,calls);
  await back.click();const thirdTagline=language==='en'?'Calm, beautiful nails':'落ち着いた美しいネイル';
  await send(language==='ja'?'紹介文を「落ち着いた美しいネイル」にしてください。':'Use “Calm, beautiful nails” as the tagline.');await accept();
  await expect(preview.locator('.capture-tagline p')).toHaveText(thirdTagline);await expect(forward).toBeDisabled();
  assert.deepEqual((await store.shop(shop.id)).published,shop.published);
  await page.screenshot({path:`tmp/side-chat/normal-updated-${language}-${width}.png`,fullPage:true});
  await chat.getByRole('button',{name:label('閉じる'),exact:true}).click();
  await page.getByRole('button',{name:label('修正する'),exact:true}).click();
  await input.fill('unclear');await input.press('Control+Enter');
  await expect(chat.locator('.chat-message-assistant').last()).toContainText('How would you like');await expect(review).toHaveCount(0);
  assert.match(JSON.stringify(identified.at(-1).messages),/Keep the current colors|今の色/,'reopening the same thread retains context');
  await send(language==='ja'?'紹介文を「落ち着いた美しいネイル」にしてください。':'Use “Calm, beautiful nails” as the tagline.');
  await review.getByRole('button',{name:label('キャンセル'),exact:true}).click();
  await expect(preview.locator('.capture-tagline p')).toHaveText(thirdTagline);
  await chat.getByRole('button',{name:label('閉じる'),exact:true}).click();
  assert.deepEqual(errors,[]);await context.close();console.log(`${language} ${width}px: red-pen chat, undo/redo, branching and closed-chat navigation passed; edits stay local until explicit publication.`);
 }
}catch(error){if(active&&!active.isClosed())await active.screenshot({path:'tmp/side-chat/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
