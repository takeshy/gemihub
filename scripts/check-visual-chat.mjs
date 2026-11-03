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
const store=new Store(':memory:');const identified=[];
const server=createApp(store,{...intelligence,
  async identifyVisual(media,targets,instruction){
    assert.equal(media.mimeType,'image/png');assert.ok(targets.some(target=>target.id==='description'));identified.push(instruction);
    const japanese=/ください|します/.test(instruction),followUp=/Keep the current colors|今の色/.test(instruction);
    const tagline=japanese?(instruction.includes('次のお気に入りネイル')?'次のお気に入りネイル':'季節を楽しむネイル'):(instruction.includes('Your next favorite nails')?'Your next favorite nails':'Nails for every season');
    const explanation=japanese
      ? followUp?`色はそのまま、紹介文だけ「${tagline}」に変えます。`:`囲んだ紹介文を「${tagline}」に変える案です。対象を確認してください。`
      : followUp?`I’ll keep the colors and change only the tagline to “${tagline}”.`:`Change only the circled tagline to “${tagline}”. Confirm below.`;
    return{ids:['description'],explanation};
  },
  async propose(text,current){
    const description=text.includes('Your next favorite nails')?'Your next favorite nails':text.includes('次のお気に入りネイル')?'次のお気に入りネイル':text.includes('Nails for every season')?'Nails for every season':'季節を楽しむネイル';
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
  await page.locator('aside nav').getByRole('button',{name:new RegExp(label('画面を試す・編集')+'$')}).click();
  const preview=page.locator('.local-preview-screen');await expect(preview).toBeVisible();
  await page.locator('.preview-display-menu summary').click();await page.getByLabel(label('ヘッダーを表示'),{exact:true}).check();await page.keyboard.press('Escape');
  if(language==='en')assert.doesNotMatch(await preview.innerText(),/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,'English captures use English saved shop content');
  await page.getByRole('button',{name:label('修正する'),exact:true}).click();
  const chat=page.getByRole('complementary',{name:label('画面の修正チャット'),exact:true}),canvas=page.locator('.annotation-canvas');
  await expect(chat).toBeVisible();await expect(canvas).toBeVisible();await expect(preview).toBeHidden();
  if(width>=1000){const left=await canvas.boundingBox(),right=await chat.boundingBox();assert.ok(left.x+left.width<=right.x+1);}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const input=chat.getByRole('textbox',{name:label('ここをどう変えたいですか'),exact:true});
  // Measure the rendered text at the chat layout's width, then map its bounds to
  // the captured canvas. Draw through pointer events, as an owner would.
  await chat.getByRole('button',{name:label('画面を操作する'),exact:true}).click();await expect(preview).toBeVisible();
  const bounds=await preview.boundingBox(),tagline=await preview.locator('.capture-tagline p').boundingBox();
  await chat.getByRole('button',{name:label('赤ペンで囲む'),exact:true}).click();await expect(canvas).toBeVisible();
  await expect.poll(()=>canvas.evaluate(element=>element.height)).toBeGreaterThan(150);
  await expect(page.getByRole('button',{name:label('印を消して描き直す'),exact:true})).toBeDisabled();
  if(width<1000)await canvas.evaluate(element=>window.scrollTo(0,element.getBoundingClientRect().top+scrollY-16));
  const rectangle=await canvas.boundingBox();
  const scale=(rectangle.width-4)/bounds.width,cx=rectangle.x+2+(tagline.x-bounds.x+tagline.width/2)*scale,cy=rectangle.y+2+(tagline.y-bounds.y+tagline.height/2)*scale;
  const rx=(tagline.width/2+12)*scale,ry=(tagline.height/2+10)*scale;
  await page.mouse.move(cx+rx,cy);await page.mouse.down();
  for(let step=1;step<=64;step++){const angle=step/64*Math.PI*2;await page.mouse.move(cx+rx*Math.cos(angle),cy+ry*Math.sin(angle));}
  await page.mouse.up();
  await expect(page.getByRole('button',{name:label('印を消して描き直す'),exact:true})).toBeEnabled();
  await input.fill(language==='ja'?'囲んだ紹介文を「季節を楽しむネイル」に変えてください。':'Change the circled tagline to “Nails for every season”.');await input.press('Control+Enter');
  await expect(chat.getByLabel(label('変更する対象を確認'))).toHaveValue('description');
  await expect(chat.getByLabel(label('変更する対象を確認')).locator('option:checked')).toContainText(shop.published.description);
  await expect(chat.locator('.chat-message-assistant')).toHaveCount(1);
  assert.equal((await store.shop(shop.id)).published.name,shop.published.name);
  await input.fill(language==='ja'?'今の色は変えないでください。':'Keep the current colors.');await chat.getByRole('button',{name:label('送信'),exact:true}).click();
  await expect(chat.locator('.chat-message-assistant')).toHaveCount(2);assert.match(identified.at(-1),/(?:Nails for every season|季節を楽しむネイル)[\s\S]*(?:Keep the current colors|今の色)/);
  const replies=await chat.locator('.chat-message-assistant').allTextContents();assert.notEqual(replies[0],replies[1],'the follow-up acknowledges the color constraint');
  await page.screenshot({path:`tmp/side-chat/normal-confirm-${language}-${width}.png`,fullPage:true});
  if(process.env.UPDATE_MANUAL==='1'&&width===1280)await page.screenshot({path:`public/manual/${language==='en'?'en/':''}22-pen.jpg`,type:'jpeg',quality:86});
  await chat.getByRole('button',{name:label('この箇所を修正する'),exact:true}).click();
  await expect(preview).toBeVisible();await expect(canvas).toHaveCount(0);await expect(chat).toBeVisible();
  await expect(preview.locator('.capture-tagline p')).toHaveText(firstTagline);
  await input.fill(language==='ja'?'紹介文は「次のお気に入りネイル」にします。':'Use “Your next favorite nails” as the tagline instead.');await input.press('Control+Enter');
  await expect(chat.locator('.chat-message-user')).toHaveCount(3);await expect(chat.locator('.chat-message-assistant')).toHaveCount(4);
  assert.doesNotMatch(identified.at(-1),/Nails for every season|季節を楽しむネイル|Keep the current colors|今の色/,'completed requests are not repeated in the next edit');
  await chat.getByRole('button',{name:label('この箇所を修正する'),exact:true}).click();
  await expect(preview.locator('.capture-tagline p')).toHaveText(secondTagline);await expect(chat.locator('.chat-message-assistant')).toHaveCount(5);
  assert.deepEqual((await store.shop(shop.id)).published,shop.published,'chat edits stay unpublished');
  assert.ok(await page.evaluate(expected=>Object.values(localStorage).some(value=>{try{return JSON.parse(value).config?.description===expected;}catch{return false;}}),secondTagline));
  await page.screenshot({path:`tmp/side-chat/normal-updated-${language}-${width}.png`,fullPage:true});
  await chat.getByRole('button',{name:label('閉じる'),exact:true}).click();await expect(chat).toHaveCount(0);assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('visual-chat-open')),false);
  assert.deepEqual(errors,[]);await context.close();console.log(`${language} ${width}px: red-pen capture replaces the source, chat retains follow-ups and confirmation, local edits update the screen without publishing.`);
 }
}catch(error){if(active&&!active.isClosed())await active.screenshot({path:'tmp/side-chat/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
