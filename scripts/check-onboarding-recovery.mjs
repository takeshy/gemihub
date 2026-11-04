import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium,expect} from 'playwright/test';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {sample,bookingDates,ownerStaffId} from '../server/domain.ts';
import {zonedDate,weekdayOf} from '../shared/region.ts';
import {digest} from '../server/auth.ts';
import * as intelligence from '../server/ai.ts';
import {createInitialTheme} from '../server/initial-theme.ts';
import {appendChatMessage} from '../server/shop-chat.ts';
import {finalDetailsQuestion} from '../server/request-intent.ts';
import {exampleTheme} from '../src/stories/themes.ts';

process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const english=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:');
const runs=new Map();let proposalCalls=0;
function latch(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
const server=createApp(store,{...intelligence,
  async assistant(){return{answer:'Saved assistant answer',sources:[]};},
  async propose(text,current,email,_demo,images,_region,context){
    proposalCalls++;const gates=runs.get(email);assert.ok(gates);assert.equal(current,null);
    let generations=0,reviews=0;
    const run=await createInitialTheme({config:{...structuredClone(sample),name:'Moon Atelier',notificationEmail:email},request:text,images},context,async call=>{
      if(!call.purpose){generations++;await(generations===1?gates.generate.promise:gates.repair.promise);return JSON.stringify(exampleTheme);}
      reviews++;if(reviews===1){await gates.review.promise;return JSON.stringify({approved:false,issues:['Improve heading spacing'],imageUsage:[]});}
      return JSON.stringify({approved:true,issues:[],imageUsage:[]});
    });
    return{config:{...run.config,appearance:{accent:'sage',layout:'standard',imageUrl:'',theme:run.candidate}},summary:['Shop preview'],themeReview:{approved:true,attempts:run.attempts}};
  },
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
await mkdir('tmp/onboarding-recovery',{recursive:true});let active;
async function session(context,user){const id=randomUUID();await store.put('session',digest(id),{user,expires:Date.now()+600000});await context.addCookies([{name:'gemihub_session',value:id,url:origin}]);}
try{
  for(const width of [1280,390])for(const language of ['ja','en']){
    const label=(text,...args)=>(language==='en'?english[text]||text:text).replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]));
    const shop=await store.createShop(`recovery-${width}-${language}@example.com`);
    const context=await browser.newContext({viewport:{width,height:950},locale:language==='ja'?'ja-JP':'en-US'});
    await session(context,{email:shop.owner,name:'Owner',role:'owner',shopId:shop.id});
    const page=await context.newPage();active=page;page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${origin}/?lang=${language}`);
    await page.getByRole('button',{name:label('はじめる'),exact:true}).click();
    const composer=page.getByRole('textbox',{name:label('AIに伝えたいこと'),exact:true});
    await composer.fill('Moon Atelier');await composer.press('Control+Enter');
    await expect(page.getByRole('log').getByText('Moon Atelier',{exact:true})).toBeVisible();
    await expect(composer).toBeEnabled();await composer.fill('Keep this unsent draft');await page.reload();
    await expect(composer).toHaveValue('Keep this unsent draft');
    await expect(page.getByRole('log').getByText('Moon Atelier',{exact:true})).toBeVisible();
    const chats=await context.request.get(`${origin}/api/shops/${shop.id}/conversations`).then(r=>r.json());assert.equal(chats.conversations.length,1);
    const chat=chats.conversations[0],requestId=randomUUID();
    await appendChatMessage(store,shop,chat,{role:'assistant',text:finalDetailsQuestion,requestId:randomUUID()});
    await appendChatMessage(store,shop,chat,{role:'user',text:'No more requests',requestId});
    await appendChatMessage(store,shop,chat,{role:'assistant',text:'Ready to create',requestId,detail:{ready:true,changeRequest:true}});
    await page.reload();
    const gates={generate:latch(),review:latch(),repair:latch()};runs.set(shop.owner,gates);
    const before=proposalCalls;
    await page.getByRole('button',{name:label('画面イメージを作成する'),exact:true}).click();
    const progress=page.getByRole('region',{name:label('プレビューの作成状況'),exact:true});
    await expect(progress.getByText(label('ページのデザインを作成しています…'),{exact:true})).toBeVisible();
    await expect(progress.locator('.preview-surface h1')).toHaveText('Moon Atelier');
    assert.equal(await page.getByRole('button',{name:label('仮公開する'),exact:true}).count(),0);
    gates.generate.resolve();
    await expect(progress.getByText(label('デザインと表示を確認しています…'),{exact:true})).toBeVisible();
    await expect(progress.locator('.theme-masthead')).toBeVisible();
    await page.screenshot({path:`tmp/onboarding-recovery/review-${language}-${width}.png`,fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.reload();
    await expect(progress.getByText(label('デザインと表示を確認しています…'),{exact:true})).toBeVisible();
    await expect(progress.locator('.theme-masthead')).toBeVisible();
    await expect(composer).toBeDisabled();assert.equal(proposalCalls,before+1,'reload must not generate again');
    gates.review.resolve();
    await expect(progress.getByText(label('確認で見つかった箇所を自動で修正しています…'),{exact:true})).toBeVisible();
    gates.repair.resolve();
    await expect(page.getByRole('button',{name:label('仮公開する'),exact:true})).toBeEnabled();
    assert.equal(proposalCalls,before+1);assert.equal((await store.shop(shop.id)).published,null);
    await page.getByRole('button',{name:label('聞き取りに戻る'),exact:true}).click();
    await expect(composer).toBeEnabled();await composer.fill('Draft after review');await page.reload();
    await page.getByRole('button',{name:label('聞き取りに戻る'),exact:true}).click();await expect(composer).toHaveValue('Draft after review');
    assert.deepEqual(errors,[]);await context.close();

    // Customer initial date: tomorrow is closed, the next date is a holiday,
    // and the following date is fully booked. The fourth date is available.
    const publicShop=await store.createShop(`booking-${width}-${language}@example.com`);
    const c=structuredClone(sample);c.ownerBooking=true;c.staff=[];c.rules={...c.rules,sameDay:false,leadMinutes:0,advanceDays:7};
    const dates=bookingDates(c);c.hours.closedWeekdays=[weekdayOf(dates[0])];c.hours.holidays=[dates[1]];
    publicShop.published=c;publicShop.publication='public';await store.saveShop(publicShop);
    await store.put('booking',randomUUID(),{id:randomUUID(),shopId:publicShop.id,customer:'full@example.com',name:'Full',menuId:c.menus[0].id,staffId:ownerStaffId,start:zonedDate(dates[2],'00:00','Asia/Tokyo').toISOString(),end:zonedDate(dates[3],'00:00','Asia/Tokyo').toISOString(),price:0,status:'active',message:'',createdAt:new Date().toISOString()});
    const customer='customer@example.com';await store.put('customer',`${publicShop.id}:${customer}`,{shopId:publicShop.id,email:customer,name:'Customer',birthDate:'1990-01-01',gender:'not_specified',updatedAt:new Date().toISOString(),updatedBy:customer});
    const customerContext=await browser.newContext({viewport:{width,height:950},locale:language==='ja'?'ja-JP':'en-US'});
    await session(customerContext,{email:customer,name:'Customer',role:'customer',shopId:publicShop.id});
    const booking=await customerContext.newPage();active=booking;booking.setDefaultTimeout(12000);const bookingErrors=[];booking.on('pageerror',error=>bookingErrors.push(error.message));
    await booking.goto(`${origin}/s/${publicShop.slug}?pane=reserve&lang=${language}`);
    const date=booking.getByRole('textbox',{name:label('ご希望の日付（{0}）',label('日本時間')),exact:true});
    await expect(date).toHaveValue(dates[3].replaceAll('-','/'));
    await expect(booking.locator('.time-grid button').first()).toBeVisible();
    await date.fill(dates[0].replaceAll('-','/'));await date.blur();
    const find=booking.getByRole('button',{name:label('予約できる最初の日を探す'),exact:true});await expect(find).toBeVisible();
    await expect(date).toHaveValue(dates[0].replaceAll('-','/'));await find.click();await expect(date).toHaveValue(dates[3].replaceAll('-','/'));
    await date.fill(dates[4].replaceAll('-','/'));await date.blur();
    await booking.getByText(c.menus[1].name,{exact:true}).first().click();
    await expect(booking.locator('.time-grid button').first()).toBeVisible();await expect(date).toHaveValue(dates[4].replaceAll('-','/'));
    await booking.screenshot({path:`tmp/onboarding-recovery/booking-${language}-${width}.png`,fullPage:true});
    c.hours.closedWeekdays=[0,1,2,3,4,5,6];await store.saveShop({...publicShop,published:c});await booking.reload();
    await expect(booking.getByText(label('予約受付期間内にご案内できる時間がありません。お店にお問い合わせください。'),{exact:true})).toBeVisible();
    await expect(date).toHaveValue('');await expect(booking.locator('.time-grid button')).toHaveCount(0);
    assert.ok(await booking.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(bookingErrors,[]);await customerContext.close();

    const ownerContext=await browser.newContext({viewport:{width,height:950}});await session(ownerContext,{email:publicShop.owner,name:'Owner',role:'owner',shopId:publicShop.id});
    const assistant=await ownerContext.newPage();active=assistant;
    await assistant.goto(`${origin}/?shop=${publicShop.id}&tab=assistant&lang=${language}`);
    const question=assistant.getByRole('textbox',{name:label('アシスタントへの質問'),exact:true});
    await question.fill('Explain my shop');await question.press('Control+Enter');
    await expect(assistant.getByText('Saved assistant answer',{exact:true})).toBeVisible();
    await question.fill('Unsent assistant draft');await assistant.reload();
    await expect(question).toHaveValue('Unsent assistant draft');await expect(assistant.getByText('Saved assistant answer',{exact:true})).toBeVisible();
    const member=`member-${width}-${language}@example.com`;
    await store.put('member',`${publicShop.id}:${member}`,{shopId:publicShop.id,email:member,accepted:true,status:'accepted'});
    await session(ownerContext,{email:member,name:'Member',role:'owner'});await assistant.reload();
    await expect(question).toHaveValue('');await expect(assistant.getByText('Saved assistant answer',{exact:true})).toHaveCount(0);
    await ownerContext.close();
    console.log(`${language} ${width}px: saved chat/draft, progressive preview across reload, automatic repair, first available booking date and assistant history verified.`);
  }
}catch(error){if(active&&!active.isClosed())await active.screenshot({path:'tmp/onboarding-recovery/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{for(const gates of runs.values())for(const gate of Object.values(gates))gate.resolve();await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
