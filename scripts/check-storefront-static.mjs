import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, shopSchema } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import { exampleTheme } from '../src/stories/themes.ts';
process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:'),shop=await store.createShop('static-owner@example.com');
const config=shopSchema.parse(structuredClone(sample));
config.name='Static Atelier';config.description='STATIC_ABOUT_BODY';config.hours.closedWeekdays=[];
config.notificationEmail='PRIVATE_OWNER_INBOX@example.com';
config.appearance={...config.appearance,accent:'sage',layout:'standard',imageUrl:'',theme:exampleTheme};
config.pages=[{id:'story',slug:'story',title:'Store story',navigationLabel:'Story',body:'<p>STATIC_STORY_BODY</p>',layout:'standard',imageUrl:''}];
shop.published=config;shop.publication='public';await store.saveShop(shop);
const article={category:'blogs',title:'Winter article',date:'2030-01-02',slug:'winter',excerpt:'Winter excerpt',body:'STATIC_ARTICLE_BODY'};
await store.put('post','static-article',{id:'static-article',shopId:shop.id,draft:article,published:article,version:1,createdAt:'2030-01-02T00:00:00Z',updatedAt:'2030-01-02T00:00:00Z',updatedBy:shop.owner,publishedAt:'2030-01-02T00:00:00Z'});
await store.put('session',digest('member'),{user:{email:'member@example.com',role:'customer',shopId:shop.id,name:'Member'},expires:Date.now()+3600000});
await store.put('customer',`${shop.id}:member@example.com`,{shopId:shop.id,email:'member@example.com',name:'Member',birthDate:'1990-01-01',gender:'not_specified'});
const server=createApp(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const top=`${origin}/s/${shop.slug}`;
await mkdir('tmp/storefront-static',{recursive:true});
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
 for(const language of ['ja','en'])for(const width of [390,1280]){
  const label=text=>language==='en'?catalog[text]||text:text;
  for(const javaScriptEnabled of [false,true]){
   const context=await browser.newContext({viewport:{width,height:950},locale:language==='ja'?'ja-JP':'en-US',javaScriptEnabled}),blocked=[];
   await context.route('**/api/**',async route=>{blocked.push(route.request().url());await route.abort();});
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   for(const [path,text] of [['','STATIC_ABOUT_BODY'],['/blogs','Winter article'],['/blogs/2030-01-02-winter','STATIC_ARTICLE_BODY'],['/pages/story','STATIC_STORY_BODY']]){
    const response=await page.goto(`${top}${path}?lang=${language}`);assert.equal(response.status(),200);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-page="static-storefront"]')).toContainText(text);
    assert.equal(await page.locator('script[type="module"]').count(),0,'public pages never start the app');
    // Each release refers to its own content-addressed CSS file, cached by the browser across pages.
    const stylesheets=await page.locator('link[rel="stylesheet"]').evaluateAll(links=>links.map(link=>link.getAttribute('href')));
    assert.equal(stylesheets.length,1);assert.match(stylesheets[0],new RegExp(`^/s/${shop.slug}/_assets/[a-f0-9]{64}\\.css$`));
    assert.ok(await page.evaluate(()=>[...document.styleSheets].some(sheet=>sheet.href?.includes('/_assets/')&&sheet.cssRules.length>0)),'the release stylesheet is loaded');
    assert.equal(await page.locator('.public-nav').getByRole('link',{name:label('ご予約'),exact:true}).getAttribute('href'),`/s/${shop.slug}?pane=reserve&lang=${language}`);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.ok(!(await response.text()).includes('PRIVATE_OWNER_INBOX'));
   }
   assert.deepEqual(blocked,[],'public content makes no API requests, even with JavaScript enabled');
   assert.deepEqual(errors,[]);
   if(javaScriptEnabled)await page.screenshot({path:`tmp/storefront-static/story-${language}-${width}.png`,fullPage:true});
   await context.close();
  }
  const context=await browser.newContext({viewport:{width,height:950},locale:language==='ja'?'ja-JP':'en-US'});
  const page=await context.newPage();
  await page.goto(`${top}?lang=${language}`);
  await page.locator('.public-nav').getByRole('link',{name:label('ご予約'),exact:true}).click();
  await expect(page.getByRole('region',{name:label('ご予約にはログインが必要です。'),exact:true})).toBeVisible();
  await context.addCookies([{name:'gemihub_session',value:'member',url:origin}]);
  await page.reload();await expect(page.locator('.time-grid button').first()).toBeVisible();
  await page.locator('.time-grid button').first().click();
  await page.getByRole('textbox',{name:label('お店へのメッセージ（任意）'),exact:true}).fill('Keep my booking message');
  await page.getByRole('button',{name:new RegExp(label('この内容で予約する'))}).click();
  await expect(page.locator('.booking-complete')).toBeVisible();
  assert.equal((await store.bookings(shop.id)).at(-1).message,'Keep my booking message');
  await page.screenshot({path:`tmp/storefront-static/booking-${language}-${width}.png`,fullPage:true});
  await page.locator('.public-nav').getByRole('button',{name:label('お店のこと'),exact:true}).click();
  await expect(page.locator('[data-page="static-storefront"]')).toContainText('STATIC_ABOUT_BODY');
  await context.close();
  console.log(`${language} ${width}px: public pages work with JS on/off and every API blocked; booking uses the existing authenticated API and returns to static HTML.`);
 }
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await store.close();}
