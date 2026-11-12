import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium} from 'playwright';
import {compilePresentation} from '../shared/presentation.ts';
import {sample} from '../server/domain.ts';
import {standardTheme} from '../shared/theme-editing.ts';
import {requestLocale} from '../server/i18n.ts';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {}',shortCircuit:true}:next(url,context);}});
const {ChromePreview}=await import('../src/SiteChrome.tsx');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 const compiled=compilePresentation({html:'<div class="label">Label</div>',css:'.label::before{content:"["}.label::after{content:"]"}input::placeholder{color:rgb(12,34,56)}.legacy:after{content:"legacy"}'});
 await page.setContent(`<style>${compiled.css}</style><div class="${compiled.id}"><span class="label">Label</span><input placeholder="Sample"><span class="legacy">Old syntax</span></div><span class="label outside">Outside</span>`);
 const content=(selector,pseudo)=>page.locator(selector).evaluate((node,pseudo)=>getComputedStyle(node,pseudo).content,pseudo);
 assert.equal(await content(`.${compiled.id} .label`,'::before'),'"["');
 assert.equal(await content(`.${compiled.id} .label`,'::after'),'"\]"');
 assert.equal(await content('.legacy','::after'),'"legacy"');
 assert.equal(await content('.outside','::after'),'none');
 assert.equal(await page.locator('input').evaluate(node=>getComputedStyle(node,'::placeholder').color),'rgb(12, 34, 56)');
 const hidden='.public-nav:has(>:nth-child(5):last-child)>:nth-child(1),.public-nav:has(>:nth-child(5):last-child)>:nth-child(4){display:none}.public-nav:has(>:nth-child(5):last-child)>:nth-child(3){order:1;font-size:0}.public-nav:has(>:nth-child(5):last-child)>:nth-child(2){order:2;font-size:0}.public-nav:has(>:nth-child(5):last-child)>:nth-child(5){order:3}.public-nav:has(>:nth-child(5):last-child)>:nth-child(3)::after{content:"About";font-size:12px}.public-nav:has(>:nth-child(5):last-child)>:nth-child(2)::after{content:"Booking";font-size:12px}';
 const config=process.env.SHOP_FIXTURE?JSON.parse(await readFile(process.env.SHOP_FIXTURE,'utf8')).config:{...structuredClone(sample),appearance:{accent:'sage',layout:'standard',imageUrl:'',articles:{blogs:false,announcements:true},theme:{...standardTheme,css:hidden}}};
 const markup=requestLocale.run('en',()=>renderToStaticMarkup(React.createElement(ChromePreview,{config,part:'header'})));
 const css=await readFile('src/style.css','utf8');await mkdir('tmp/theme-pseudo-elements',{recursive:true});
 for(const width of [1920,1280,390]){
  await page.setViewportSize({width,height:1000});await page.setContent(`<style>${css}</style>${markup}`);
  const visible=await page.locator('.public-nav > *').evaluateAll(nodes=>nodes.filter(node=>getComputedStyle(node).display!=='none').map(node=>{
   const s=getComputedStyle(node),after=getComputedStyle(node,'::after'),b=node.getBoundingClientRect();return{text:parseFloat(s.fontSize)>0?node.textContent:after.content.replace(/^"|"$/g,''),x:b.x,y:b.y,width:b.width};
  }).sort((a,b)=>Math.round(a.y-b.y)||a.x-b.x));
  assert.deepEqual(visible.map(item=>item.text),['About','Booking','Announcements']);assert.ok(visible.every(item=>item.width>0));
  await page.screenshot({path:`tmp/theme-pseudo-elements/${width}.png`});
 }
 console.log('Scoped ::before/::after/::placeholder, legacy :after and outside isolation passed; intentional About/Booking/Announcements navigation preserved at 1920/1280/390px.');
}finally{await browser.close();}
