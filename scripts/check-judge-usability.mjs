import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium, expect} from 'playwright/test';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {sample, shopSchema, planSummary} from '../server/domain.ts';
import {standardTheme} from '../shared/theme-editing.ts';
import {requestLocale} from '../server/i18n.ts';
import {defaultRefundTiers} from '../server/payment-domain.ts';
import {digest} from '../server/auth.ts';
import * as intelligence from '../server/ai.ts';

process.env.DEMO_MODE='true'; delete process.env.GOOGLE_CLOUD_PROJECT;
process.env.JUDGE_INVITE='usability-fixture-invitation-123456789'; process.env.JUDGE_UNTIL='2099-01-01';
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:');
const server=createApp(store,{...intelligence,
  explainSystem:async()=>({answer:'Review the FAQ proposal.',changeRequest:true,ready:true}),
  propose:async(_text,current)=>{
    const config=shopSchema.parse({...current,pages:[...current.pages,{id:'faq',slug:'faq',title:'FAQ',navigationLabel:'FAQ',body:'<h2>FAQ</h2>',layout:'standard',imageUrl:''}]});
    return {config,summary:planSummary(current,config)};
  },
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
let browser, page;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
  await mkdir('tmp/judge-usability',{recursive:true});
  for(const language of ['en','ja'])for(const width of [1280,1024,768,760,390]){
    const context=await browser.newContext({viewport:{width,height:950},locale:language==='ja'?'ja-JP':'en-US'});
    const label=text=>language==='en'?catalog[text]||text:text;
    assert.equal((await context.request.post(`${origin}/api/judge/start?lang=${language}`,{headers:{Origin:origin},data:{invite:process.env.JUDGE_INVITE}})).status(),200);
    const {user}=await(await context.request.get(`${origin}/api/session`)).json();
    const shop=await store.shop(user.shopId);
    shop.published=requestLocale.run(language,()=>shopSchema.parse(structuredClone(sample)));
    // A legacy theme with generic link styling and a compact header reproduces both reported problems.
    shop.published.appearance={accent:'sage',layout:'standard',imageUrl:'',...shop.published.appearance,theme:{...standardTheme,
      headerHtml:'<header class="compact-header"><slot name="title"></slot><slot name="navigation"></slot></header>',
      headerCss:'.compact-header{display:flex;align-items:center;height:80px;padding:16px;overflow:hidden}.compact-header h1{font-size:24px;white-space:nowrap;margin:0 24px 0 0}.public-nav{flex-wrap:nowrap}.public-nav button{white-space:nowrap}',
      css:'a{color:#284f43}.primary{background:#284f43}',
    }};
    shop.published.name='Moon Atelier';shop.publication='public';await store.saveShop(shop);
    page=await context.newPage();page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${origin}/?lang=${language}`);
    const nav=page.locator('.dashboard > aside > nav');
    if(width<=760){
      const toggle=page.getByRole('button',{name:new RegExp(label('管理メニュー'))});
      await expect(toggle).toBeVisible();await toggle.click();
    }
    await expect(nav).toBeVisible();
    for(const tab of ['決済・返金','キャンセル枠の再販売']){
      if(width<=760 && await page.locator('.mobile-menu-toggle').getAttribute('aria-expanded')!=='true')await page.locator('.mobile-menu-toggle').click();
      await nav.getByRole('button',{name:new RegExp(label(tab)+'$')}).click();
      await expect(page.locator('.payment-operations h1')).toHaveText(label(tab));
      if(tab==='決済・返金')await expect(page.locator('.payment-operations')).toContainText(label('決済・返金の履歴はありません。'));
      else await expect(page.locator('.payment-operations')).toContainText(label('再販売の受付・履歴はありません。'));
    }
    if(width===1280){
      const at=new Date().toISOString(),id=digest(shop.id);
      const booking={id,shopId:shop.id,customer:'customer@example.com',name:'Refund Customer',menuId:'simple',staffId:'aoi',price:5500,message:'',start:new Date(Date.now()+7*86400000).toISOString(),end:new Date(Date.now()+7*86400000+3600000).toISOString(),status:'cancelled',createdAt:at,locale:language,
        payment:{provider:'paypal',environment:'sandbox',orderId:'ORDER',captureId:'CAPTURE',amount:5500,currency:'JPY',policy:defaultRefundTiers,cancellation:{at,by:'customer@example.com',reason:'customer',percent:100,amount:5500,status:'completed',requestId:id,refundId:'REFUND'}}};
      await store.saveBooking(booking);
      for(const [i,phase]of ['listed','sold','expired','withdrawn'].entries()){
        const transfer={id:digest(`${shop.id}:${i}`),shopId:shop.id,bookingId:id,phase,price:4950,currency:'JPY',basis:5500,discountPercent:10,deadline:booking.start,createdAt:at,attempts:0,environment:'sandbox',policy:defaultRefundTiers,unsold:{amount:2750,percent:50},seller:booking.customer,sellerName:booking.name,sellerCaptureId:'CAPTURE'};
        await store.put('transfer',transfer.id,transfer);
      }
      await page.reload();
      for(const state of ['受付中','成約済み','受付終了','取り下げ済み'])await expect(page.locator('.payment-operations').getByText(label(state),{exact:true})).toBeVisible();
      const workspace=await(await context.request.get(`${origin}/api/workspace?lang=${language}`)).json();
      const own=workspace.shops.find(item=>item.id===shop.id);
      assert.equal(own.transferListings.length,1);assert.equal(own.transferHistory.length,4);
      assert.ok(own.transferHistory.every(item=>!('seller' in item)&&!('sellerCaptureId' in item)));
      await nav.getByRole('button',{name:new RegExp(label('決済・返金')+'$')}).click();
      await expect(page.locator('.payment-operations .payment-refund-status')).toBeVisible();
      await page.locator('.payment-operations').getByRole('button',{name:label('予約内容を確認'),exact:true}).click();
      await expect(page.locator('.dashboard-detail-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await page.screenshot({path:`tmp/judge-usability/payments-${language}.png`,fullPage:true});
    }
    if(width<=760)await page.locator('.mobile-menu-toggle').click();
    await nav.getByRole('treeitem',{name:label('ページ追加・機能変更'),exact:true}).click();
    await page.locator('.page-change-inventory .editor-pen-button').click();
    const chat=page.locator('.shop-change-chat');
    await chat.getByRole('textbox').fill('Add FAQ');
    await chat.getByRole('button',{name:label('送信'),exact:true}).click();
    await chat.getByRole('button',{name:label('変更案を確認する'),exact:true}).click();
    const review=page.getByRole('dialog',{name:label('変更案の確認'),exact:true});
    await expect(review).toBeVisible();await expect(chat).toBeVisible();
    await review.getByRole('button',{name:label('変更内容を反映する'),exact:true}).click({trial:true});
    assert.equal(await review.evaluate(el=>el.matches(':modal')),true);
    await page.screenshot({path:`tmp/judge-usability/review-${language}-${width}.png`});
    await page.keyboard.press('Escape');await expect(review).toHaveCount(0);
    await expect(chat.getByRole('textbox')).toBeFocused();
    await chat.getByRole('button',{name:label('変更案を確認する'),exact:true}).click();
    await review.getByRole('button',{name:label('変更内容を反映する'),exact:true}).click();
    await expect(review).toHaveCount(0);
    assert.equal((await store.shop(shop.id)).published.pages.length,1);

    await page.goto(`${origin}/s/${shop.slug}?pane=reserve&lang=${language}`);
    const signIn=page.locator('.booking-login-button');await expect(signIn).toBeVisible();
    const colors=await signIn.evaluate(el=>{const s=getComputedStyle(el);return [s.color,s.backgroundColor];});
    function luminance(color){const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
    const levels=colors.map(luminance).sort((a,b)=>b-a);assert.ok((levels[0]+.05)/(levels[1]+.05)>=4.5,`sign-in contrast: ${colors}`);
    const links=page.locator('.public-nav > *');assert.ok(await links.count()>=4);
    for(const link of await links.all()){
      await expect(link).toBeVisible();
      await link.scrollIntoViewIfNeeded();
      assert.equal(await link.evaluate(el=>{const b=el.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return b.x>=0&&b.right<=innerWidth+1&&!!hit&&(hit===el||el.contains(hit));}),true,`visible header link: ${await link.innerText()} at ${width}`);
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`tmp/judge-usability/header-${language}-${width}.png`,fullPage:true});
    assert.deepEqual(errors,[]);await context.close();
    console.log(`${language} ${width}px: judge management entry, expanded chat + apply/Escape, sign-in contrast and every header link passed.`);
  }
} catch(error){if(page&&!page.isClosed())await page.screenshot({path:'tmp/judge-usability/failure.png',fullPage:true});throw error;}
finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await store.close();}
