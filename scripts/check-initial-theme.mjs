import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import * as intelligence from '../server/ai.ts';
import { createInitialTheme } from '../server/initial-theme.ts';
import { exampleTheme } from '../src/stories/themes.ts';
import { digest } from '../server/auth.ts';

process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const store=new Store(':memory:');let reviews=0;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const withLogo=(theme,id)=>({...theme,headerHtml:theme.headerHtml.replace('<header class="theme-masthead">',`<header class="theme-masthead"><img data-image-id="${id}" alt="Shop logo" style="width:60px;height:60px">`)});
const server=createApp(store,{...intelligence,initialTheme:async(input,context)=>{
  let attempt=0;
  return createInitialTheme(input,context,async call=>{
    if(!call.purpose){attempt++;return JSON.stringify({...withLogo(exampleTheme,input.images[0].id),css:exampleTheme.css+' .theme-heading h1 {letter-spacing:.08em}'});}
    reviews++;return JSON.stringify({approved:attempt>1,issues:attempt>1?[]:['Make the heading spacing match the correction.'],imageUsage:input.images.map(image=>({id:image.id,purpose:'asset'}))});
  });
}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
await mkdir('tmp/initial-theme',{recursive:true});
let active;
try{
  for(const width of [1280,390])for(const language of ['ja','en']){
    const shop=await store.createShop(`theme-${width}-${language}@example.com`);
    const config={...structuredClone(sample),name:'Moon Atelier',appearance:{accent:'sage',layout:'standard',imageUrl:'',theme:exampleTheme,articles:{blogs:false,announcements:true}}};
    const plan={id:randomUUID(),shopId:shop.id,base:0,config,source:null,requiresSetup:true,approved:false,createdAt:Date.now(),summary:['Initial theme'],checklist:[]};await store.put('plan',plan.id,plan);
    const user={email:shop.owner,name:'Demo owner',role:'owner',shopId:shop.id};await store.put('user',user.email,user);
    const session=randomUUID();await store.put('session',digest(session),{user,expires:Date.now()+3600000});
    const context=await browser.newContext({viewport:{width,height:950},locale:language==='en'?'en-US':'ja-JP'});await context.addCookies([{name:'gemihub_session',value:session,url:origin}]);
    const upload=await context.request.post(`${origin}/api/shops/${shop.id}/images`,{headers:{Origin:origin},data:{requestId:randomUUID(),name:'logo.png',mimeType:'image/png',data:png}});assert.equal(upload.status(),200);
    const {imageId}=await upload.json();config.appearance.theme=withLogo(exampleTheme,imageId);await store.put('plan',plan.id,{...plan,config});
    const page=await context.newPage();active=page;page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${origin}/?lang=${language}`);
    const preview=page.locator('.theme-preview');await expect(preview.locator('.theme-masthead')).toBeVisible();
    await expect(preview.locator('.theme-image img')).toBeVisible();
    assert.equal(await preview.locator('.public-nav').count(),1);
    const labels=await preview.locator('.public-nav > *').allTextContents();assert.equal(labels.length,new Set(labels).size);
    assert.ok(labels.includes(language==='ja'?'お知らせ':'Announcements'));assert.ok(!labels.includes(language==='ja'?'ブログ':'Blog'));
    assert.equal(await page.getByRole('button',{name:language==='ja'?'自分のお店を初期化':'Reset my shop',exact:true}).count(),0);
    assert.equal(await page.locator('.app-header').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)','theme CSS stays out of the owner UI');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`tmp/initial-theme/before-${language}-${width}.png`,fullPage:true});
    if(process.env.UPDATE_MANUAL==='1'&&width===1280)await writeFile(`public/manual/${language==='en'?'en/':''}04-plan.jpg`,await page.locator('.screen-gallery').screenshot({type:'jpeg',quality:86}));
    await page.getByRole('button',{name:language==='ja'?'修正する':'Make changes',exact:true}).click();
    await expect(page.locator('.annotation-canvas')).toBeVisible();
    const chat=page.locator('.visual-chat-panel');await expect(chat).toBeVisible();await expect(preview).toBeHidden();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    if(width>=1000){const left=await page.locator('.annotation-canvas').boundingBox(),right=await chat.boundingBox();assert.ok(left.x+left.width<=right.x+1,'annotation and chat are side by side');}
    const publish=page.getByRole('button',{name:language==='ja'?'仮公開する':'Publish private preview',exact:true});await expect(publish).toBeDisabled();
    const rect=await page.locator('.annotation-canvas').boundingBox();await page.mouse.move(rect.x+40,rect.y+45);await page.mouse.down();await page.mouse.move(rect.x+180,rect.y+55);await page.mouse.up();
    await page.getByRole('textbox',{name:language==='ja'?'ここをどう変えたいですか':'How would you like to change this?'}).fill('Please increase the heading letter spacing. Keep the logo and the booking rules unchanged.');
    await page.screenshot({path:`tmp/initial-theme/side-chat-marked-${language}-${width}.png`,fullPage:true});
    if(language==='ja')await page.getByRole('form',{name:'ペンで囲んだ箇所への依頼'}).getByRole('button',{name:'送信',exact:true}).click();
    else await page.getByRole('textbox',{name:'How would you like to change this?'}).press('Control+Enter');
    await expect(page.locator('.annotation-canvas')).toHaveCount(0);await expect(publish).toBeEnabled();
    const workspace=await context.request.get(origin+'/api/workspace').then(r=>r.json());const next=workspace.shops[0].plans.at(-1);
    assert.equal(next.themeReview.approved,true);assert.equal(next.themeReview.attempts,2);assert.notEqual(next.id,plan.id);
    for(const key of ['menus','staff','rules','hours','region'])assert.deepEqual(next.config[key],config[key]);
    assert.equal(workspace.shops[0].published,null);
    await expect(chat).toBeVisible();await expect(preview).toBeVisible();
    await page.getByRole('textbox',{name:language==='ja'?'ここをどう変えたいですか':'How would you like to change this?'}).fill('Please also make the footer more spacious.');
    await page.getByRole('textbox',{name:language==='ja'?'ここをどう変えたいですか':'How would you like to change this?'}).press('Control+Enter');
    await expect(chat.locator('.chat-message-user')).toHaveCount(2);await expect(chat.locator('.chat-message-assistant')).toHaveCount(2);
    const latest=await context.request.get(origin+'/api/workspace').then(r=>r.json());assert.notEqual(latest.shops[0].plans.at(-1).id,next.id,'the same chat revises the replacement plan');

    await page.screenshot({path:`tmp/initial-theme/side-chat-updated-${language}-${width}.png`,fullPage:true});
    await page.reload();await expect(preview.locator('.theme-heading h1')).toBeVisible();await expect(preview.locator('.theme-image img')).toBeVisible();
    assert.match(await preview.locator('.theme-heading h1').getAttribute('style')||'',/^$/);
    const spacing=await preview.locator('.theme-heading h1').evaluate(el=>getComputedStyle(el).letterSpacing);assert.notEqual(spacing,'normal');
    await page.screenshot({path:`tmp/initial-theme/after-${language}-${width}.png`,fullPage:true});
    assert.deepEqual(errors,[]);await context.close();
    console.log(`${language} ${width}px: custom HTML/CSS, scoped styles, news-only navigation, red-pen capture, review/repair loop and saved revision passed.`);
  }
  assert.equal(reviews,16);
  const english=JSON.parse(await readFile('shared/en.json','utf8'));
  for(const language of ['ja','en']){
    const label=text=>language==='en'?(english[text]||text):text;
    const shop=await store.createShop(`interview-${language}@example.com`);
    const user={email:shop.owner,name:'Owner',role:'owner',shopId:shop.id};await store.put('user',user.email,user);
    const session=randomUUID();await store.put('session',digest(session),{user,expires:Date.now()+3600000});
    const context=await browser.newContext({viewport:{width:1280,height:950},locale:language==='en'?'en-US':'ja-JP'});
    await context.addInitScript(()=>{window.__shortcutSpeech=[];window.SpeechRecognition=class {start(){this.active=true;window.__shortcutSpeech.push(this);this.onstart?.();}stop(){this.active=false;}abort(){this.active=false;}};});
    await context.addCookies([{name:'gemihub_session',value:session,url:origin}]);const page=await context.newPage();active=page;
    let sent=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/system/question'))sent++;});
    await page.goto(`${origin}/?lang=${language}`);
    await page.getByRole('button',{name:label('はじめる'),exact:true}).click();
    const log=page.getByRole('log',{name:label('AIとのチャット'),exact:true});
    const composer=page.getByRole('textbox',{name:label('AIに伝えたいこと'),exact:true});
    const send=page.getByRole('button',{name:label('送信'),exact:true});
    await expect(log.getByText(label('お店の名前を教えてください。'),{exact:true})).toBeVisible();
    await composer.press('Control+Enter');assert.equal(sent,0,'empty shortcut is a no-op');
    await composer.fill('Moon Atelier');await composer.press('Enter');await expect(composer).toHaveValue('Moon Atelier\n');assert.equal(sent,0,'Enter inserts a newline');
    await composer.fill('Moon Atelier');
    for(const init of [{isComposing:true},{keyCode:229},{repeat:true}])await composer.dispatchEvent('keydown',{key:'Enter',code:'Enter',ctrlKey:true,...init});
    assert.equal(sent,0,'IME confirmation and key repeat never send');await expect(composer).toHaveValue('Moon Atelier');
    await composer.press('Control+Enter');
    await expect(log.getByText(label('使いたいロゴはありますか？あれば画像を添付してください。なければ「なし」、後で決める場合は「後で」と教えてください。'),{exact:true})).toBeVisible();
    await page.getByRole('button',{name:label('音声入力'),exact:true}).click();
    const dictation=page.getByRole('dialog',{name:label('音声入力'),exact:true});
    const transcript=dictation.getByRole('textbox',{name:label('書き起こした内容'),exact:true});
    await transcript.fill(language==='ja'?'ロゴはありません':'No logo');await transcript.press('Control+Enter');
    await expect(dictation).toHaveCount(0);assert.ok(await page.evaluate(()=>window.__shortcutSpeech.every(rec=>!rec.active)),'shortcut stops dictation before sending');
    await expect(log.getByText(label('どういう業種のお店ですか？'),{exact:true})).toBeVisible();
    await composer.fill(language==='ja'?'ネイルサロンです':'A nail salon');await send.click();
    await expect(log.getByText(/6\.[\s\S]*7\./)).toBeVisible();
    if(process.env.UPDATE_MANUAL==='1')await writeFile(`public/manual/${language==='en'?'en/':''}02-interview.jpg`,await page.locator('.panel.interview').screenshot({type:'jpeg',quality:86}));
    await composer.fill('1、4、6、7');await send.click();
    await expect(log.getByText(label('それ以外に欲しいページはありますか？'),{exact:true})).toBeVisible();
    await composer.fill(language==='ja'?'ありません':'No other pages');await send.click();
    await expect(log.getByText(label('ほかに伝えたいことはありますか？'),{exact:true})).toBeVisible();
    await composer.fill(language==='ja'?'ありません。この内容でお願いします':'Nothing else, please proceed');await send.click();
    await expect(page.locator('.screen-name-list li')).toHaveCount(8);
    const workspace=await context.request.get(origin+'/api/workspace').then(r=>r.json());const plan=workspace.shops[0].plans.at(-1);
    assert.equal(plan.config.name,'Moon Atelier');assert.deepEqual(plan.config.appearance.articles,{blogs:false,announcements:true});
    assert.deepEqual(plan.config.pages.map(p=>p.slug),['staff','products']);
    for(const name of [label('スタッフ紹介'),label('商品・サービス紹介')])await expect(page.locator('.screen-name-list').getByText(name,{exact:true})).toBeVisible();
    await context.close();console.log(`${language}: Ctrl+Enter sends chat and dictation; Enter, IME and repeat guards work; interview choices persist.`);
  }
}catch(error){if(active&&!active.isClosed())await active.screenshot({path:'tmp/initial-theme/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
