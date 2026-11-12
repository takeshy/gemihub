import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium,expect} from 'playwright/test';
import {registerHooks} from 'node:module';
import {sample} from '../server/domain.ts';
import {standardTheme} from '../shared/theme-editing.ts';
import {Store} from '../server/store.ts';
import {createApp} from '../server/app.ts';
import {digest} from '../server/auth.ts';
import {simulatePayment,simulateCancellation} from '../src/payment-mock.ts';
import {defaultRefundTiers} from '../server/payment-domain.ts';
import {ThemeBody} from '../src/SiteChrome.tsx';
import {StaticStorefront} from '../src/StaticStorefront.tsx';
import {PaymentDetails} from '../src/PaymentDetails.tsx';

// The browser receives the real stylesheet below; SSR only needs component markup.
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {}',shortCircuit:true}:next(url,context);}});
const {ThemePreview}=await import('../src/ScreenGallery.tsx');
const css=await readFile('src/style.css','utf8');
process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const store=new Store(':memory:');
const shop=await store.createShop('palette@example.com');
const customer='palette-customer@example.com';
await store.put('session',digest('palette-session'),{user:{email:customer,name:'Customer',role:'customer',shopId:shop.id},expires:Date.now()+3600000});
await store.put('customer',`${shop.id}:${customer}`,{shopId:shop.id,email:customer,name:'Customer',birthDate:'1990-01-01',gender:'not_specified',updatedAt:new Date().toISOString(),updatedBy:customer});
const bookings=[];
for(const state of ['active','completed','pending','manual_review']){
 const start=new Date(Date.now()+3*86400000).toISOString();
 const booking={id:`palette-${state}`,shopId:shop.id,customer,name:'Customer',menuId:sample.menus[0].id,staffId:sample.staff[0].id,start,end:new Date(Date.parse(start)+3600000).toISOString(),price:sample.menus[0].price,status:'active',message:'',createdAt:new Date().toISOString()};
 simulatePayment(booking,{...sample,rules:{...sample.rules,payment:{enabled:true,refundTiers:defaultRefundTiers}}});
 if(state!=='active')simulateCancellation(booking,'customer',state);
 bookings.push(booking);await store.put('booking',booking.id,booking);
}
const content={category:'announcements',date:'2026-11-12',slug:'palette',title:'Palette news',excerpt:'',body:'Palette news'};
await store.put('post','palette-news',{id:'palette-news',shopId:shop.id,draft:content,published:content,version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),updatedBy:shop.owner,publishedAt:new Date().toISOString()});
const server=createApp(store);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
await mkdir('tmp/theme-palette',{recursive:true});
try{
 for(const width of [390,1280])for(const [name,ink,surface] of [['warm','#70435c','#faf6f0'],['blue','#006d77','#f0f7fa'],['dark','#e9d8b8','#18212c']]){
  const page=await browser.newPage({viewport:{width,height:1100}});
  await page.context().addCookies([{name:'gemihub_session',value:'palette-session',url:origin}]);
  for(const explicit of [false,true]){
   const theme={...standardTheme,frame:true,styles:[{id:'base',component:'base',css:`.design-root{color:${ink};background:${surface};${explicit?'--selected-bg:#ddcbea;--selected-border:#70435c;--selected-ink:#392048;':''}}.panel{color:inherit;background:transparent}button{color:inherit;background:transparent}.booking-summary .line-flower{${explicit?'color:#b67a62':''}}`}]};
   const config={...structuredClone(sample),appearance:{accent:'rose',layout:'standard',imageUrl:'',theme}};
   await store.saveShop({...shop,published:config,publication:'public'});
   await page.goto(`${origin}/s/${shop.slug}?pane=reserve`);
   await expect(page.locator('.menu-options button.selected').first()).toBeVisible();
   const actual=page.locator('.public-shop').first();
   await actual.evaluate(el=>el.id='palette-actual');
   const html=renderToStaticMarkup(React.createElement('div',{id:'palette-sample'},React.createElement(ThemePreview,{config,shopId:'palette'})));
   await page.evaluate(({html,css})=>{document.body.insertAdjacentHTML('beforeend',`<style>${css}</style>${html}<button id="operator">Operator</button>`);},{html,css});
   const expected=await page.evaluate(value=>{const el=document.createElement('span');el.style.color=value;document.body.append(el);const color=getComputedStyle(el).color;el.remove();return color;},ink);
   for(const id of ['actual','sample']){
    const root=page.locator(`#palette-${id}`);
    const selected=root.locator('.menu-options button.selected').first();await expect(selected).toHaveCount(1);
    await expect(selected).toHaveCSS('color',explicit?'rgb(57, 32, 72)':expected);
    await expect(selected.locator('small')).toHaveCSS('color',explicit?'rgb(57, 32, 72)':expected);
    await expect(root.locator('.booking-summary .line-flower')).toHaveCSS('color',explicit?'rgb(182, 122, 98)':expected);
    if(id==='sample')await expect(root.locator('.booking-summary .line-flower')).toBeVisible();
    const notice=root.locator('.waitlist-request');await expect(notice).toHaveCount(1);
    await expect(notice).toHaveCSS('color',expected);
    const bg=await notice.evaluate(el=>getComputedStyle(el).backgroundColor);
    assert.notEqual(bg,'rgb(246, 247, 241)','waitlist must not retain the sage background');
    if(explicit){await expect(selected).toHaveCSS('background-color','rgb(221, 203, 234)');await expect(selected).toHaveCSS('border-top-color','rgb(112, 67, 92)');}
   }
   await expect(page.locator('#operator')).toHaveCSS('color','rgb(40, 79, 67)');
   if(!explicit)await actual.screenshot({path:`tmp/theme-palette/${name}-${width}.png`});
  }
  await page.close();console.log(`${name} ${width}: actual booking and theme samples inherit palette; explicit colours override; operator unchanged`);
 }
 const palettes=[
  ['warm',{primary:'#70435c','on-primary':'#ffffff',secondary:'#80532d','on-secondary':'#ffffff',background:'#faf6f0',surface:'#fffdfb',text:'#2a1839','muted-text':'#715b75',border:'#d8cbbf',success:'#34613e',warning:'#805400',danger:'#a52928'}],
  ['blue',{primary:'#006d77','on-primary':'#ffffff',secondary:'#48458a','on-secondary':'#ffffff',background:'#f0f7fa',surface:'#ffffff',text:'#102c40','muted-text':'#476575',border:'#acc7cd',success:'#286739',warning:'#805400',danger:'#a52928'}],
  ['dark',{primary:'#e3b1cd','on-primary':'#312031',secondary:'#d8c18d','on-secondary':'#302918',background:'#18212c',surface:'#202b38',text:'#f0e9df','muted-text':'#bdc8d3',border:'#607184',success:'#98d7aa',warning:'#edc97b',danger:'#ffb4ab'}],
 ];
 for(const width of [390,1280])for(const [name,palette] of palettes){
  const page=await browser.newPage({viewport:{width,height:1100}});
  await page.context().addCookies([{name:'gemihub_session',value:'palette-session',url:origin}]);
  // Colour declarations exist only in the base module; no per-component colour CSS.
  const theme={...standardTheme,frame:true,styles:[{id:'palette',component:'base',css:'.design-root{'+Object.entries(palette).map(([k,v])=>`--${k}:${v}`).join(';')+'}'}]};
  const config={...structuredClone(sample),appearance:{accent:'sage',layout:'standard',imageUrl:'',theme,articles:{blogs:false,announcements:true}}};
  await store.saveShop({...shop,published:config,publication:'public'});
  const rgb=async color=>page.evaluate(color=>{const el=document.createElement('span');el.style.color=color;document.body.append(el);const value=getComputedStyle(el).color;el.remove();return value;},color);
  await page.goto(`${origin}/s/${shop.slug}?pane=reserve`);
  await expect(page.locator('.menu-options button.selected').first()).toBeVisible();
  const sampleHtml=renderToStaticMarkup(React.createElement('div',{id:'semantic-sample'},React.createElement(ThemePreview,{config,shopId:'palette'})));
  await page.evaluate(html=>document.body.insertAdjacentHTML('beforeend',html+'<button id="operator">Operator</button>'),sampleHtml);
  const sampleRoot=page.locator('#semantic-sample');
  await expect(sampleRoot.locator('button.primary')).toHaveCSS('background-color',await rgb(palette.primary));
  await expect(sampleRoot.locator('button.primary')).toHaveCSS('color',await rgb(palette['on-primary']));
  await expect(sampleRoot.locator('button.secondary')).toHaveCSS('background-color',await rgb(palette.secondary));
  await expect(sampleRoot.locator('button.secondary')).toHaveCSS('color',await rgb(palette['on-secondary']));
  await expect(sampleRoot.locator('input').first()).toHaveCSS('background-color',await rgb(palette.surface));
  await expect(sampleRoot.locator('input').first()).toHaveCSS('color',await rgb(palette.text));
  await expect(sampleRoot.locator('.status.active')).toHaveCSS('color',await rgb(palette.success));
  await expect(sampleRoot.locator('.recent-post-list > a')).toHaveCSS('background-color',await rgb(palette.surface));
  await expect(sampleRoot.locator('.payment-refund-status')).toHaveCSS('color',await rgb(palette.success));
  await expect(page.locator('.menu-options button.selected').first()).toHaveCSS('border-top-color',await rgb(palette.primary));
  await expect(page.locator('#operator')).toHaveCSS('color','rgb(40, 79, 67)');
  await sampleRoot.screenshot({path:`tmp/theme-palette/semantic-samples-${name}-${width}.png`});
  const primary=sampleRoot.locator('button.primary');await primary.evaluate(el=>{const root=el.closest('[inert]');root.removeAttribute('inert');root.style.pointerEvents='auto';});await primary.hover();
  assert.notEqual(await primary.evaluate(el=>getComputedStyle(el).backgroundColor),await rgb(palette.primary),'primary has a themed hover state');
  await primary.focus();await expect(primary).toHaveCSS('outline-color',await rgb(palette.primary));
  await primary.evaluate(el=>el.disabled=true);await expect(primary).toHaveCSS('opacity','0.45');

  await page.goto(`${origin}/s/${shop.slug}?pane=mine`);
  await expect(page.locator('.booking-card')).toHaveCount(4);
  await expect(page.locator('.status.active')).toHaveCSS('color',await rgb(palette.success));
  await expect(page.locator('.recent-post-list > a')).toHaveCSS('background-color',await rgb(palette.surface));
  await expect(page.locator('.payment-details').first()).toHaveCSS('background-color',await rgb(palette.surface));
  for(const [state,role] of [['completed','success'],['pending','warning'],['manual_review','danger']])await expect(page.locator(`.payment-refund-status[data-state=${state}]`)).toHaveCSS('color',await rgb(palette[role]));
  await page.locator('.public-shop').screenshot({path:`tmp/theme-palette/semantic-mine-${name}-${width}.png`});
  // Change only primary; component layouts and the other role colours stay intact.
  const marker=page.locator('.public-shop .design-root');
  await marker.evaluateAll(els=>els.forEach(el=>el.style.setProperty('--primary','#8a2846')));
  await expect(page.locator('.payment-details summary').first()).toHaveCSS('color','rgb(138, 40, 70)');
  await expect(page.locator('.pill').first()).toHaveCSS('color',await rgb(palette.secondary));
  await expect(page.locator('.status.active')).toHaveCSS('color',await rgb(palette.success));
  await expect(page.locator('.payment-details').first()).toHaveCSS('background-color',await rgb(palette.surface));

  // The same scoped palette applies to standalone HTML without running the app.
  const staticHtml=renderToStaticMarkup(React.createElement(StaticStorefront,{config,view:{kind:'archive',category:'announcements',posts:[{...content,id:'palette-news',publishedAt:new Date().toISOString()}]},base:'/s/palette'}));
  const offlineHtml=renderToStaticMarkup(React.createElement('div',{className:'public-shop custom-theme'},React.createElement(ThemeBody,{config},React.createElement(PaymentDetails,{booking:bookings[1]}))));
  await page.setContent(`<!doctype html><style>${css}</style><div id="static">${staticHtml}</div><div id="offline">${offlineHtml}</div><button id="operator">Operator</button>`);
  await expect(page.locator('#static .primary')).toHaveCSS('background-color',await rgb(palette.primary));
  await expect(page.locator('#static .panel')).toHaveCSS('background-color',await rgb(palette.surface));
  await expect(page.locator('#offline .payment-refund-status')).toHaveCSS('color',await rgb(palette.success));
  await expect(page.locator('#operator')).toHaveCSS('color','rgb(40, 79, 67)');
  const overridden={...config,appearance:{...config.appearance,theme:{...theme,styles:[...theme.styles,{id:'exception',component:'cards',css:'.payment-details{background:#123456}'}]}}};
  const exception=renderToStaticMarkup(React.createElement('div',{className:'public-shop custom-theme'},React.createElement(ThemeBody,{config:overridden},React.createElement(PaymentDetails,{booking:bookings[1]}))));
  await page.setContent(`<!doctype html><style>${css}</style>${exception}`);
  await expect(page.locator('.payment-details')).toHaveCSS('background-color','rgb(18, 52, 86)');
  await expect(page.locator('.payment-refund-status')).toHaveCSS('color',await rgb(palette.success));
  await page.close();console.log(`${name} ${width}: semantic buttons, fields, booking, news, refund states, standalone HTML and operator isolation passed`);
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await store.close();}
