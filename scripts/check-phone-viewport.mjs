import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {chromium,expect} from 'playwright/test';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {sample,shopSchema} from '../server/domain.ts';
import {digest} from '../server/auth.ts';
import * as intelligence from '../server/ai.ts';
import {proposeVisualAppearance} from '../server/visual.ts';
import {standardTheme} from '../shared/theme-editing.ts';
import {uploadMenuImage} from '../server/menu-images.ts';
import {memoryCustomerFiles} from '../server/customer-files.ts';
process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const store=new Store(':memory:'),shop=await store.createShop('phone-viewport@example.com');
const photo=await uploadMenuImage(store,shop,{requestId:randomUUID(),name:'photo.png',mimeType:'image/png',data:(await sharp({create:{width:240,height:180,channels:3,background:'#a66b77'}}).png().toBuffer()).toString('base64')},memoryCustomerFiles(store),'');
shop.published=shopSchema.parse({...structuredClone(sample),appearance:{accent:'sage',layout:'standard',imageUrl:'',theme:{...standardTheme,bodyHtml:'<main class="responsive-frame"><slot name="content"></slot></main>',css:'.responsive-frame{padding:64px}@media(max-width:760px){.responsive-frame{padding:12px}}'}},pages:[{id:'staff-introduction',slug:'staff',title:'スタッフ紹介',navigationLabel:'スタッフ紹介',layout:'standard',imageUrl:'',body:`<section class="staff-card"><div class="staff-photo"><img data-image-id="${photo.imageId}" style="width:100%;height:100%;object-fit:cover" alt="スタッフ"></div><div class="staff-copy"><h2>店主の紹介</h2>${'<p>丁寧なケアと持ちの良さを大切にしています。</p>'.repeat(14)}</div></section>`,css:'.staff-card{display:grid;grid-template-columns:260px 1fr;gap:32px;padding:24px}.staff-copy{min-width:0;overflow-wrap:anywhere}.staff-photo{width:100%;aspect-ratio:3/4}.staff-photo>.theme-image{width:100%;height:100%}@media(max-width:760px){.staff-card{grid-template-columns:minmax(0,1fr);padding:12px}}'}]});
await store.saveShop(shop);
const user={email:shop.owner,name:'Owner',role:'owner',shopId:shop.id};await store.put('user',user.email,user);await store.put('session',digest('phone-owner'),{user,expires:Date.now()+3600000});
let captured;
const server=createApp(store,{...intelligence,
 async identifyVisual(media){captured=await sharp(Buffer.from(media.data,'base64')).metadata();return{ids:['page:staff-introduction:design'],explanation:'スマホの余白を調整します。'};},
 async visualAppearance(current,text,images,options){return proposeVisualAppearance(current,text,images,{...options,generate:async()=>JSON.stringify({cssEdits:[{selector:'.staff-card',media:'(max-width:760px)',declarations:[{property:'padding',value:'10px'}]}]})});},
 async visualReview(){return{approved:true,issues:[]};}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
await mkdir('tmp/phone-viewport',{recursive:true});let page;
try{
 const context=await browser.newContext({viewport:{width:1280,height:950}});await context.addCookies([{name:'gemihub_session',value:'phone-owner',url:origin}]);page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/?lang=ja');await page.locator('aside nav').getByRole('button',{name:/AIとお店をつくる$/}).click();await page.getByRole('treeitem',{name:'スタッフ紹介',exact:true}).click();
 await page.locator('.preview-device').getByRole('button',{name:'スマートフォン',exact:true}).click();
 const frame=page.frameLocator('.local-preview-screen iframe[data-preview-viewport]');
 await expect(frame.locator('.staff-photo img')).toBeVisible();
 const metrics=await frame.locator('.staff-card').evaluate(card=>{const bounds=card.getBoundingClientRect();return{viewport:window.innerWidth,width:bounds.width,right:bounds.right,columns:getComputedStyle(card).gridTemplateColumns.split(' ').length,padding:getComputedStyle(document.querySelector('.responsive-frame')).paddingLeft,bodyWidth:document.body.scrollWidth};});
 assert.ok(metrics.viewport<=390);assert.equal(metrics.columns,1);assert.equal(metrics.padding,'12px');assert.ok(metrics.width>200);assert.ok(metrics.right<=metrics.viewport);assert.ok(metrics.bodyWidth<=metrics.viewport);
 await page.locator('.local-preview-screen').screenshot({path:'tmp/phone-viewport/desktop-phone.png'});
 await page.locator('.editor-toolbar').getByRole('button',{name:'修正する',exact:true}).click();
 const canvas=page.locator('.annotation-canvas');await expect(canvas).toBeVisible();const pixels=await canvas.evaluate(c=>({width:c.width,height:c.height,data:c.toDataURL('image/png')}));assert.ok(pixels.width<=390&&pixels.width>300);assert.ok(pixels.height>900,'capture contains the full phone page, not a blank iframe or just its scroll viewport');await expect(page.locator('.visual-chat-panel')).toBeVisible();
 const input=page.locator('.visual-chat-panel').getByRole('textbox',{name:'ここをどう変えたいですか',exact:true});await input.fill('見切れてる。スマホだと。');await input.press('Control+Enter');
 const review=page.getByRole('dialog',{name:'修正案を比較',exact:true});await expect(review).toBeVisible();assert.ok(captured.width<=390&&captured.height>900);
 await expect(review.locator('iframe[data-preview-viewport]')).toHaveCount(2);
 for(const iframe of await review.locator('iframe[data-preview-viewport]').all()){const f=await iframe.contentFrame();await expect(f.locator('.staff-card')).toBeVisible();assert.equal(await f.locator('.staff-card').evaluate(c=>getComputedStyle(c).gridTemplateColumns.split(' ').length),1);}
 await review.getByRole('button',{name:'OK',exact:true}).click();await expect(review).toHaveCount(0);await page.locator('.visual-chat-panel').getByRole('button',{name:'閉じる',exact:true}).click();
 await expect(frame.locator('.staff-card')).toHaveCSS('padding','10px');
 await page.locator('.preview-display-menu summary').click();await page.getByLabel('ヘッダーを表示',{exact:true}).check();await page.keyboard.press('Escape');
 await frame.getByRole('button',{name:'お問い合わせ',exact:true}).click();await expect(page.getByRole('treeitem',{name:'お問い合わせ',exact:true})).toHaveAttribute('aria-selected','true');
 assert.deepEqual((await store.shop(shop.id)).published,shop.published);assert.equal((await store.list('booking')).length,0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({desktopPhoneUsesRealViewport:true,authoredMediaQueriesActive:true,noHorizontalClipping:true,fullPageRedPenCapture:true,comparisonUsesPhoneViewport:true,previewNavigationWorks:true,publicationUnchanged:true}));
}catch(error){if(page)await page.screenshot({path:'tmp/phone-viewport/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
