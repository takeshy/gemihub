import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { sample, slots } from '../server/domain.ts';
import { requestLocale } from '../server/i18n.ts';
import { artifacts } from '../server/artifacts.ts';
import { dateIn, regionOf } from '../shared/region.ts';

process.env.DEMO_MODE='true';
const store=new Store(':memory:');const server=createApp(store);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-US',timezoneId:'Asia/Tokyo'});
const page=await context.newPage();page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  const firstLogin=await browser.newContext({locale:'ja-JP'});
  try{
    const response=await firstLogin.request.post(origin+'/api/demo-login',{headers:{Origin:origin},data:{role:'owner',email:'first-login@example.com'}});
    assert.equal(response.status(),200);
    const initial=await firstLogin.newPage();
    initial.on('pageerror',error=>errors.push(error.message));
    const editorRequests=[];
    initial.on('request',request=>{if(request.url().includes('/local-editor'))editorRequests.push(request.url());});
    for(const width of [1280,390]){
      await initial.setViewportSize({width,height:900});
      for(const path of ['/?lang=ja','/?lang=ja&tab=settings','/?lang=ja&tab=try']){
        await initial.goto(origin+path);
        await initial.getByRole('heading',{name:'AIとお店をつくる',exact:true}).waitFor();
        assert.equal(await initial.locator('.dashboard > aside,.local-preview,.shop-switch').count(),0);
        assert.equal(await initial.getByText('nail atelier 凪',{exact:true}).count(),0);
        assert.ok(await initial.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      }
      await initial.reload();
      await initial.getByRole('button',{name:'はじめる',exact:true}).waitFor();
      assert.equal(await initial.locator('.dashboard > aside,.local-preview').count(),0);
      await mkdir('tmp',{recursive:true});
      await initial.screenshot({path:`tmp/first-login-${width}.png`,fullPage:true});
    }
    assert.deepEqual(editorRequests,[],'creation must not fetch sample editor data');
  }finally{await firstLogin.close();}
  await page.goto(origin+'/?lang=en');
  await page.getByRole('heading',{name:/Tell us about your shop/}).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.getByRole('button',{name:'日本語',exact:true}).click();
  await page.getByRole('heading',{name:/お店のことを話す/}).waitFor();
  await page.getByRole('button',{name:'English',exact:true}).click();
  await page.getByRole('heading',{name:/Tell us about your shop/}).waitFor();
  await page.goto(origin+'/');
  await page.getByRole('heading',{name:/Tell us about your shop/}).waitFor();
  assert.ok((await context.cookies()).some(cookie=>cookie.name==='gemihub_locale'&&cookie.value==='en'));
  const editorRequests=[];
  page.on('request',request=>{if(request.url().includes('/local-editor'))editorRequests.push(request.url());});
  await page.getByRole('button',{name:'Try the salon demo →',exact:true}).click();
  await page.getByRole('heading',{name:'Build your shop with AI',exact:true}).waitFor();
  assert.equal(await page.locator('.dashboard > aside,.local-preview').count(),0);
  await page.goto(origin+'/?tab=settings');
  await page.getByRole('heading',{name:'Build your shop with AI',exact:true}).waitFor();
  assert.equal(await page.locator('.dashboard > aside,.local-preview').count(),0);
  assert.deepEqual(editorRequests,[]);
  await page.getByRole('button',{name:'Get started',exact:true}).click();
  const chat=page.getByRole('log',{name:'Chat with AI',exact:true});
  await chat.getByText('What kind of business do you run?',{exact:true}).waitFor();
  for(const [answer,expected] of [['A nail salon',/Choose the features/],['1,2,3,4',/other pages/],['No other pages',/Anything else/]]){
    await page.getByLabel('Your message to AI',{exact:true}).fill(answer);
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await chat.getByText(expected).last().waitFor();
  }
  assert.equal(await page.getByRole('heading',{name:'Are these screens right for your shop?',exact:true}).count(),0);
  await page.getByLabel('Your message to AI',{exact:true}).fill('Nothing else, please proceed');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByRole('heading',{name:'Are these screens right for your shop?',exact:true}).waitFor();
  await page.getByRole('button',{name:'Publish private preview',exact:true}).click();
  await page.locator('aside nav').getByRole('button',{name:/Try and edit screens$/}).waitFor();
  await page.locator('.local-preview-screen').waitFor();
  await page.getByRole('link',{name:'Review screens and publish',exact:true}).click();
  await page.getByRole('heading',{name:'Review screens and publish',exact:true}).waitFor();
  await page.getByRole('button',{name:'Publish publicly',exact:true}).click();
  await page.getByText('Published publicly. People can now view the page without logging in.',{exact:true}).waitFor();
  let response=await context.request.get(origin+'/api/workspace',{headers:{'X-Gemihub-Language':'en'}});
  const shop=(await response.json()).shops[0];
  await page.goto(origin+'/s/'+shop.slug+'?pane=reserve');
  await page.getByRole('button',{name:'Log in as a demo customer',exact:true}).click();
  await page.getByRole('button',{name:'Book now',exact:true}).click();
  await page.getByRole('heading',{name:'A little time for yourself.',exact:true}).waitFor();
  const config=(await (await context.request.get(origin+'/api/public/'+shop.slug)).json()).config;
  let date,slot;
  for(let offset=2;offset<=config.rules.advanceDays;offset++){date=dateIn(Date.now()+offset*86400000,regionOf(config).timeZone);slot=slots(config,[],date,config.menus[0].id)[0];if(slot)break;}
  assert.ok(slot);
  await page.getByLabel(`Preferred date (${regionOf(config).country==='JP'?'Japan time':regionOf(config).timeZone})`,{exact:true}).fill(date);
  const time=new Date(slot.start).toLocaleTimeString('en-US',{timeZone:regionOf(config).timeZone,hour:'2-digit',minute:'2-digit'});
  await page.getByRole('button',{name:time,exact:true}).click();
  await page.getByLabel('Message to the shop (optional)',{exact:true}).fill('Please use the same color as last time.');
  await page.getByRole('button',{name:'Confirm booking →',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Your booking is confirmed'}).waitFor();
  await page.getByRole('button',{name:'My page',exact:true}).click();
  await page.getByText('Confirmed',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByText('Cancelled',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Inquiries',exact:true}).click();
  await page.getByLabel('Your message',{exact:true}).fill('Could you tell me about the parking area?');
  await page.getByRole('button',{name:'Send inquiry →',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Your inquiry has been received'}).waitFor();
  assert.equal(((await store.list("inquiry")).filter(item=>item.shopId===shop.id)).length,1);
  await page.goto(origin+'/manual');
  await page.getByRole('heading',{name:'Build your shop, one step at a time.',exact:true}).waitFor();
  const manual=await page.locator('.manual').innerText();
  assert.ok(manual.includes('Choose “Start your shop with Google”'));
  assert.ok(!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(manual),'English manual text must be translated');
  const images=await page.locator('.manual img').evaluateAll(imgs=>imgs.map(img=>img.getAttribute('src')));
  assert.ok(images.length>30);
  for(const path of images){assert.ok(path.startsWith('/manual/en/'));const r=await context.request.get(origin+path);assert.equal(r.status(),200,path);}
  await page.setViewportSize({width:390,height:844});
  await page.goto(origin+'/s/'+shop.slug+'?pane=reserve');
  await page.getByRole('heading',{name:'A little time for yourself.',exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'English mobile page must not overflow');
  console.log('English LP, language persistence, onboarding, private/public publication, booking/cancellation, inquiry, manual assets, and mobile layout passed.');

  const shell=await readFile('dist/index.html','utf8');
  const output=requestLocale.run('en',()=>artifacts(structuredClone(sample),shell));
  const directory=await mkdtemp(join(tmpdir(),'gemihub-en-'));
  for(const [name,contents]of Object.entries(output)){const file=join(directory,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,contents);}
  const offline=await browser.newContext();const filePage=await offline.newPage();const external=[];
  filePage.on('pageerror',error=>errors.push(error.message));filePage.on('request',request=>{if(/^https?:/.test(request.url()))external.push(request.url());});
  await filePage.goto(pathToFileURL(join(directory,'web/index.html')).href);
  await filePage.getByRole('heading',{name:'Your bookings',exact:true}).waitFor();
  assert.equal(await filePage.locator('html').getAttribute('lang'),'en');
  await filePage.getByRole('button',{name:'Book now',exact:true}).click();
  await filePage.getByRole('heading',{name:'A little time for yourself.',exact:true}).waitFor();
  await mkdir(join(directory,'missing'));
  await copyFile(join(directory,'web/index.html'),join(directory,'missing/index.html'));
  await filePage.goto(pathToFileURL(join(directory,'missing/index.html')).href);
  await filePage.getByRole('heading',{name:'nail atelier Nagi',exact:true}).waitFor();
  assert.equal(await filePage.getByRole('button',{name:'Confirm booking →',exact:true}).count(),0);
  assert.deepEqual(external,[]);
  await offline.close();
  assert.deepEqual(errors,[]);
  console.log('English file:// export and missing-data fallback passed without server requests.');
}catch(error){await mkdir('tmp',{recursive:true});await page.screenshot({path:'tmp/i18n-browser-failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-5000));throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
