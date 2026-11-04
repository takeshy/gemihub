import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { sample } from '../server/domain.ts';
import { dateIn, regionOf } from '../shared/region.ts';
import { artifacts } from '../server/artifacts.ts';
import { requestLocale } from '../server/i18n.ts';

process.env.DEMO_MODE='true';
const store=new Store(':memory:');const server=createApp(store);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
const errors=[];let activePage;await mkdir('tmp/region',{recursive:true});
try {
  const fresh=await browser.newContext({locale:'en-US',timezoneId:'America/Los_Angeles'});
  const first=await fresh.newPage();first.on('pageerror',e=>errors.push(e.message));
  await first.goto(origin+'/');await first.getByRole('heading',{name:/Tell us about your shop/}).waitFor();
  assert.equal(await first.locator('html').getAttribute('lang'),'en');
  await first.getByRole('button',{name:'Try the salon demo →',exact:true}).click();
  await first.getByRole('heading',{name:'Build your shop with AI',exact:true}).waitFor();
  const initial=(await(await fresh.request.get(origin+'/api/workspace')).json()).shops[0];
  assert.deepEqual(initial.regionDefault,{country:'US',timeZone:'America/Los_Angeles'});
  assert.equal(await first.locator('.local-preview').count(),0);
  await fresh.close();

  let exported;
  for(const width of [1280,390]) {
    const shop=await store.createShop(`region-${width}@example.com`);
    const config=structuredClone(sample);config.name='Pacific Studio';config.menus[0].name='Consultation';config.menus[0].price=55;
    config.hours.closedWeekdays=[];config.rules.sameDay=true;
    shop.published=config;await store.saveShop(shop);
    const context=await browser.newContext({viewport:{width,height:950},locale:'en-US',timezoneId:'America/Los_Angeles'});
    const login=await context.request.post(origin+'/api/demo-login',{headers:{Origin:origin},data:{role:'owner',email:shop.owner}});assert.equal(login.status(),200);
    const page=await context.newPage();activePage=page;page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
    await page.goto(origin+'/');await page.locator('aside nav').getByRole('button',{name:/Shop information$/}).click();
    const settings=page.locator('.live-settings-basic');const country=settings.getByLabel('Country (currency)',{exact:true});
    await country.waitFor();assert.equal(await country.inputValue(),'JP','existing Japanese shops stay JP in an English browser');
    await country.selectOption('US');
    const zone=settings.getByLabel('Time zone',{exact:true});assert.equal(await zone.locator('option').count(),7);
    await zone.selectOption('America/Los_Angeles');await settings.getByRole('button',{name:'Save',exact:true}).click();
    await settings.getByText('Saved and applied to the live site.',{exact:true}).waitFor();
    assert.deepEqual((await store.shop(shop.id)).published.region,{country:'US',timeZone:'America/Los_Angeles'});
    await page.screenshot({path:`tmp/region/settings-us-${width}.png`,fullPage:true});
    await page.locator('aside nav').getByRole('button',{name:/Services and prices$/}).click();const menus=page.locator('.live-settings-menus');
    const price=menus.getByLabel('Price (USD)',{exact:true}).first();await price.waitFor();assert.equal(await price.getAttribute('step'),'0.01');
    await price.fill('55.25');await menus.getByRole('button',{name:'Save',exact:true}).click();
    await menus.getByText('Saved and applied to the live site.',{exact:true}).waitFor();
    const saved=(await store.shop(shop.id)).published;assert.equal(saved.menus[0].price,55.25);exported=saved;
    await page.goto(origin+'/?tab=try');await page.locator('.local-preview-screen').waitFor();
    await page.locator('.local-preview-screen').getByText('$55.25',{exact:false}).first().waitFor();
    const customer=await context.request.post(origin+'/api/demo-login',{headers:{Origin:origin},data:{role:'customer',shopId:shop.id,email:`guest-${width}@example.com`}});assert.equal(customer.status(),200);
    // A browser instant whose Japanese and US dates differ reveals wrong-zone initial date state.
    await page.clock.setFixedTime(new Date('2026-01-15T04:30:00Z'));
    // The initial date is the server's first available date in the shop's zone (tests/booking-initial-date.test.ts).
    const next=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/public/${shop.slug}/slots/next`);
    await page.goto(origin+`/s/${shop.slug}?pane=reserve`);
    const date=page.getByRole('textbox',{name:'Preferred date (America/Los_Angeles)',exact:true});await date.waitFor();
    const first=(await (await next).json()).date;assert.match(first,/^\d{4}-\d{2}-\d{2}$/);
    await page.waitForFunction(([selector,value])=>document.querySelector(selector)?.value===value,['.date-input input[type=text]',first.replaceAll('-','/')]);
    assert.equal(await date.locator('..').locator('input[type=date]').getAttribute('min'),'2026-01-14');
    await page.getByText('$55.25',{exact:false}).first().waitFor();
    // Back to the server's clock so the booking window (min/max) matches the slots the server offers.
    await page.clock.setFixedTime(new Date());
    const day=dateIn(Date.now()+4*86400000,regionOf(saved).timeZone);await date.fill(day);await date.blur();assert.equal(await date.inputValue(),day.replaceAll('-','/'),'a chosen date is kept');
    await page.locator('.time-grid button').first().waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    await page.screenshot({path:`tmp/region/booking-us-${width}.png`,fullPage:true});
    await context.close();console.log(`${width}px: JP compatibility, US settings save, USD cents, preview, local booking dates and available slots passed.`);
  }
  const shell=await readFile('dist/index.html','utf8');
  const files=requestLocale.run('en',()=>artifacts(exported,shell));
  const dir=await mkdtemp(resolve('tmp/region/offline-'));
  for(const [name,contents]of Object.entries(files)){const file=join(dir,name);await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,contents);}
  const offline=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo'});const page=await offline.newPage();
  page.on('pageerror',e=>errors.push(e.message));const external=[];page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
  await page.goto(pathToFileURL(join(dir,'web/index.html')).href);
  await page.getByRole('button',{name:'Book now',exact:true}).click();
  await page.getByText('$55.25',{exact:false}).first().waitFor();
  await page.getByRole('textbox',{name:'Preferred date (America/Los_Angeles)',exact:true}).waitFor();
  assert.deepEqual(external,[]);await offline.close();assert.deepEqual(errors,[]);
  console.log('English first visit and US defaults; US offline export in a Japanese browser passed without external requests.');
}catch(error){console.error(errors);if(activePage&&!activePage.isClosed()){console.error((await activePage.locator('body').innerText()).slice(0,6500));await activePage.screenshot({path:'tmp/region/failure.png',fullPage:true});}throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
