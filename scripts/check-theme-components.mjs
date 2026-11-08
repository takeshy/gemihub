import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import React from 'react';
import sharp from 'sharp';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, expect } from 'playwright/test';
import { SiteHeader, ThemeBody, SiteFooter } from '../src/SiteChrome.tsx';
import { sample } from '../server/domain.ts';
import { splitThemeStyles } from '../shared/theme-styles.ts';
import { standardTheme, hasThemeFrame } from '../shared/theme-editing.ts';
import { exampleTheme } from '../src/stories/themes.ts';
import { setLocaleResolver } from '../shared/i18n.ts';
const root=resolve('storybook-static');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);assert.ok(path.startsWith(root+'/'));res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const css=await readFile('src/style.css','utf8');await mkdir('tmp/theme-components',{recursive:true});
const en=JSON.parse(await readFile('shared/en.json','utf8'));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
let active;
try{
 // Adding shared styles to the standard design must not switch its frame or spacing.
 for(const width of[390,1280]){
  const page=await browser.newPage({viewport:{width,height:1000}});active=page;const measurements=[];
  for(const phase of['before','after']){
   const theme={...standardTheme,styles:[{id:'base',component:'base',css:'.design-root{--icon-color:green}'},{id:'icons',component:'icons',css:'.hero-flower{color:var(--icon-color)}'}]};
   const config={...structuredClone(sample),...(phase==='after'?{appearance:{accent:'sage',layout:'standard',imageUrl:'',theme}}:{})};
   const content=React.createElement('main',null,React.createElement('section',{className:'panel'},React.createElement('h2',null,'Heading'),React.createElement('button',{className:'primary'},'Book')));
   const html=renderToStaticMarkup(React.createElement('div',{className:`public-shop accent-sage${hasThemeFrame(config.appearance?.theme)?' custom-theme':''}`},React.createElement(SiteHeader,{config}),React.createElement(ThemeBody,{config},content),React.createElement(SiteFooter,{config})));
   await page.setContent(`<!doctype html><style>${css}</style>${html}`);await page.evaluate(()=>document.fonts.ready);
   measurements.push(await page.evaluate(()=>['.site-header','.salon-hero','h1','main','.panel','button.primary','.site-footer'].map(selector=>{const node=document.querySelector(selector),style=getComputedStyle(node),rect=node.getBoundingClientRect();return{selector,box:[rect.x,rect.y,rect.width,rect.height],padding:style.padding,background:style.backgroundColor,font:style.fontSize,border:style.borderRadius};})));
   if(phase==='after')await expect(page.locator('.hero-flower')).toHaveCSS('color','rgb(0, 128, 0)');
  }
  assert.deepEqual(measurements[1],measurements[0],`standard ${width}: an icon style must preserve the frame`);await page.close();
 }
 // Same accepted CSS split into modules must retain its rendered result, including interleaved rules/media.
 const legacy={...exampleTheme,styles:undefined,css:'.panel{border-radius:4px;color:#123456}button{color:#234567}.panel{border-radius:16px}input,select{border-color:#345678}.icon{color:#456789}@media(max-width:600px){button{padding:15px}.panel{border-radius:20px}}@supports(display:grid){.panel{display:grid}}'};
 const themes=[['fixture',legacy]];
 if(process.env.THEME_CONFIG){const data=JSON.parse(await readFile(process.env.THEME_CONFIG,'utf8'));themes.push(['current',(Array.isArray(data)?data[0].config:data).appearance.theme]);}
 for(const [name,theme]of themes)for(const width of[390,768,1280]){
  setLocaleResolver(()=> 'ja');const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});active=page;const captures=[];
  for(const [phase,value]of[['before',theme],['after',splitThemeStyles(theme)]]){
   const config={...structuredClone(sample),appearance:{accent:'sage',layout:'standard',imageUrl:'',theme:value}};
   const content=React.createElement('section',{className:'panel'},React.createElement('h2',null,'Heading'),React.createElement('label',null,'Name',React.createElement('input',{defaultValue:'Sample'})),React.createElement('select',null,React.createElement('option',null,'Sample')),React.createElement('button',{className:'primary'},'Book'),React.createElement('p',{className:'notice'},'Notice'),React.createElement('svg',{className:'icon',width:24,height:24},React.createElement('circle',{cx:12,cy:12,r:8})));
   const html=renderToStaticMarkup(React.createElement('div',{className:'public-shop theme-preview'},React.createElement(SiteHeader,{config},React.createElement('nav',{className:'public-nav'},React.createElement('a',null,'Book'))),React.createElement(ThemeBody,{config},content),React.createElement(SiteFooter,{config})));
   await page.setContent(`<!doctype html><style>${css}</style>${html}`);await page.evaluate(()=>document.fonts.ready);
   captures.push(await page.screenshot({path:`tmp/theme-components/${name}-${phase}-${width}.png`,fullPage:true,animations:'disabled'}));
  }
  const a=await sharp(captures[0]).raw().toBuffer(),b=await sharp(captures[1]).raw().toBuffer();
  assert.equal(a.length,b.length,`${name} ${width}: dimensions`);
  let changed=0,delta=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i]){changed++;delta=Math.max(delta,Math.abs(a[i]-b[i]));}
  assert.ok(delta<=1&&changed/a.length<0.0001,`${name} ${width}: CSS splitting changed pixels beyond raster rounding (${changed} channels, max ${delta})`);await page.close();
 }
 const index=JSON.parse(await readFile(root+'/index.json','utf8'));
 const stories=Object.values(index.entries).filter(entry=>entry.type==='story'&&['SharedComponents','SharedComponentsContrast'].includes(entry.exportName));
 assert.equal(stories.length,2);
 for(const lang of['ja','en'])for(const width of[390,1280])for(const story of stories){
  const text=s=>lang==='en'?en[s]||s:s;const context=await browser.newContext({viewport:{width,height:1100}});const page=await context.newPage();active=page;const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=locale:${lang}`);
  const preview=page.locator('.local-preview-screen .theme-preview');await expect(preview).toBeVisible();
  const icon=preview.locator('.icon');const original=await icon.evaluate(node=>getComputedStyle(node).color);
  const button=preview.locator('button.primary');const originalButton=await button.evaluate(node=>getComputedStyle(node).backgroundColor);
  await page.screenshot({path:`tmp/theme-components/story-${story.exportName}-${lang}-${width}.png`,fullPage:true});
  await preview.evaluate(node=>{node.removeAttribute('inert');node.style.pointerEvents='auto';});
  await button.hover();await expect(button).toHaveCSS('filter','brightness(0.95)');
  await button.focus();await expect(button).toHaveCSS('outline-width','3px');
  await button.evaluate(node=>{node.disabled=true;});await expect(button).toHaveCSS('opacity','0.5');
  await button.evaluate(node=>{node.disabled=false;node.blur();});await preview.evaluate(node=>{node.setAttribute('inert','');node.style.removeProperty('pointer-events');});await page.mouse.move(0,0);

  // Actual operator flow: pen/chat -> comparison -> local adoption. No live publication.
  await page.getByRole('button',{name:text('修正する'),exact:true}).click();const chat=page.locator('.visual-chat-panel');const input=chat.getByRole('textbox',{name:text('ここをどう変えたいですか'),exact:true});await input.fill('Make the icon green');await input.press('Control+Enter');
  const dialog=page.locator('.visual-change-review');await expect(dialog).toBeVisible();
  const before=dialog.getByRole('region',{name:text('変更前'),exact:true}),after=dialog.getByRole('region',{name:text('修正案'),exact:true});
  assert.equal(await before.locator('.icon').evaluate(node=>getComputedStyle(node).color),original);
  assert.equal(await after.locator('.icon').evaluate(node=>getComputedStyle(node).color),'rgb(35, 124, 69)');
  assert.equal(await after.locator('button.primary').evaluate(node=>getComputedStyle(node).backgroundColor),originalButton);
  await dialog.getByRole('button',{name:'OK',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(icon).toHaveCSS('color','rgb(35, 124, 69)');await expect(button).toHaveCSS('background-color',originalButton);
  await chat.getByRole('button',{name:text('閉じる'),exact:true}).click();
  // The full-page code editor exposes grouped component styles and separate frame/header/footer CSS.
  const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:text('ページ全体の HTML を編集')})});await details.locator('summary').first().click();
  const buttons=page.locator('.theme-component-editors details').filter({has:page.locator('summary').filter({hasText:text('ボタン')})});await buttons.locator('summary').click();await expect(buttons.locator('textarea')).toHaveValue(/button\.primary/);
  assert.deepEqual(errors,[]);await context.close();console.log(`${lang} ${width} ${story.exportName}: full page, hover/focus/disabled states, icon-only edit, comparison/adoption and component editor passed`);
 }
 console.log('All split styles preserved pixels at mobile, tablet and desktop widths.');
}catch(error){await active?.screenshot({path:'tmp/theme-components/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
