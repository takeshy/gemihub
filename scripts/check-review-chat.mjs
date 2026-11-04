import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { sample } from '../server/domain.ts';
import * as intelligence from '../server/ai.ts';
import { createConversation, appendChatMessage, attachChatPlan, readConversation } from '../server/shop-chat.ts';
import { requestLocale } from '../server/i18n.ts';

process.env.DEMO_MODE='true';
const store=new Store(':memory:');
const server=createApp(store,{...intelligence,async explainSystem(){return{answer:'What else would you like to change?',ready:false,changeRequest:true};}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
await mkdir('tmp/review-chat',{recursive:true});
let activePage;
try{
  for(const width of [1280,390])for(const language of ['ja','en']){
    const context=await browser.newContext({viewport:{width,height:900},locale:language==='ja'?'ja-JP':'en-US'});
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(8000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const shop=await store.createShop(`${language}-${width}@example.com`);
    const chat=await requestLocale.run(language,()=>createConversation(store,shop,shop.owner,'create-shop',randomUUID(),true));
    const requestId=randomUUID(), planId=randomUUID();
    const original='A quiet salon with bookings and a blog.';
    await appendChatMessage(store,shop,chat,{role:'user',requestId,text:original});
    await appendChatMessage(store,shop,chat,{role:'assistant',requestId,text:'Here are the proposed pages.',detail:{ready:true,changeRequest:true}});
    const proposed=requestLocale.run(language,()=>structuredClone(sample));proposed.pages.push({id:'faq',slug:'faq',title:'FAQ',navigationLabel:'FAQ',body:'## Questions',layout:'standard',imageUrl:''});
    const plan={id:planId,shopId:shop.id,base:0,config:proposed,source:null,approved:false,requiresSetup:true,createdAt:Date.now(),summary:['Proposed pages'],chat:{id:chat.id,requestId}};
    await store.put('plan',planId,plan);await attachChatPlan(store,shop,shop.owner,plan.chat,planId);
    const response=await context.request.post(origin+'/api/demo-login',{headers:{Origin:origin},data:{role:'owner',email:shop.owner}});assert.equal(response.status(),200);
    const back=page.getByRole('button',{name:language==='ja'?'聞き取りに戻る':'Return to questions',exact:true});
    const composer=page.getByRole('textbox',{name:language==='ja'?'AIに伝えたいこと':'Your message to AI',exact:true});
    const log=page.getByRole('log',{name:language==='ja'?'AIとのチャット':'Chat with AI',exact:true});
    const starts=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/conversations'))starts.push(request.url());});
    // The saved conversation is restored when the page opens; make that restoration fail first.
    await page.route(`**/conversations/${chat.id}`,route=>route.abort());
    await page.goto(`${origin}/?lang=${language}`);await back.waitFor();
    // Screens are listed by name; the theme sample shows the real header and footer around placeholder content.
    assert.equal(await page.locator('.screen-name-list li').count(),9);
    const theme=page.locator('.theme-preview');await theme.locator('.site-footer').waitFor();
    assert.equal(await theme.locator('.site-header').count(),1);
    assert.equal(await theme.locator('.site-footer').count(),1);
    assert.equal(await theme.locator('.theme-placeholder').count(),1);
    assert.equal(await page.locator('.screen-thumbnail').count(),0,'no screen captures in the review');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`tmp/review-chat/review-${language}-${width}.png`,fullPage:true});
    if(process.env.UPDATE_MANUAL==='1'&&width===1280)await writeFile(`public/manual/${language==='en'?'en/':''}04-plan.jpg`,await page.locator('.screen-gallery').screenshot({type:'jpeg',quality:86}));
    // A failed restoration must leave the review available for retry, not open a new chat.
    await back.click();await page.getByRole('alert').waitFor();assert.equal(await back.count(),1);
    await page.unroute(`**/conversations/${chat.id}`);
    await back.click();await composer.waitFor();
    assert.ok((await log.innerText()).includes(original));
    assert.equal(await composer.evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.getByRole('button',{name:language==='ja'?'はじめる':'Get started',exact:true}).count(),0);
    await composer.fill('Keep the existing layout.');
    // Opening and closing the same proposal must keep an unsent draft too.
    // Before publication the proposal opens as a screen preview.
    await page.getByRole('button',{name:language==='ja'?'画面イメージを確認する':'View screen preview',exact:true}).click();
    await back.click();assert.equal(await composer.inputValue(),'Keep the existing layout.');
    await page.reload();await back.click();await composer.waitFor();assert.ok((await log.innerText()).includes(original));
    await composer.fill('Please add a contact page.');
    const sent=page.waitForResponse(r=>r.url().endsWith('/system/question')&&r.request().method()==='POST');
    await page.getByRole('button',{name:language==='ja'?'送信':'Send',exact:true}).click();assert.equal((await sent).status(),200);
    const saved=await readConversation(store,shop,shop.owner,chat.id);
    assert.ok(saved.messages.some(m=>m.text==='Please add a contact page.'));
    assert.ok(saved.messages.some(m=>m.text===original));assert.deepEqual(starts,[]);
    assert.deepEqual(errors,[]);await page.screenshot({path:`tmp/review-chat/${language}-${width}.png`,fullPage:true});
    // Plans from before chat references existed still open an editable chat directly.
    const legacy=await store.createShop(`legacy-${language}-${width}@example.com`);
    const legacyPlan={...plan,id:randomUUID(),shopId:legacy.id};delete legacyPlan.chat;
    await store.put('plan',legacyPlan.id,legacyPlan);
    await context.request.post(origin+'/api/demo-login',{headers:{Origin:origin},data:{role:'owner',email:legacy.owner}});
    await page.goto(`${origin}/?lang=${language}`);await back.click();await composer.waitFor();
    assert.equal(await page.getByRole('button',{name:language==='ja'?'はじめる':'Get started',exact:true}).count(),0);
    assert.equal(starts.length,1,'only an old plan without a conversation creates a chat');
    assert.deepEqual(errors,[]);
    await context.close();console.log(`${language} ${width}px: review restores the same private chat after reload, preserves history/drafts, retries restoration and sends the follow-up in that conversation.`);
  }
} catch(error){if(activePage&&!activePage.isClosed()){console.error((await activePage.locator('body').innerText()).slice(-3500));await activePage.screenshot({path:'tmp/review-chat/failure.png',fullPage:true});}throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
