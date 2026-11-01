import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';

process.env.DEMO_MODE='true';
const store=new Store(':memory:');
const server=createApp(store);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN=origin;
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
  await mkdir('tmp/lp',{recursive:true});
  for(const locale of ['ja','en']) {
    const context=await browser.newContext({viewport:{width:1440,height:1000},locale:locale==='ja'?'ja-JP':'en-US',reducedMotion:'reduce'});
    const page=await context.newPage();
    const errors=[],apiRequests=[],external=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()}: ${response.url()}`);});
    page.on('request',request=>{
      const url=new URL(request.url());
      if(url.pathname.startsWith('/api/'))apiRequests.push(url.pathname);
      if(url.origin!==origin)external.push(request.url());
    });
    await page.goto(`${origin}/lp?lang=${locale}`);
    await page.getByRole('heading',{level:1}).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),locale);
    assert.ok((await page.title()).startsWith('gemihub —'));
    // Wait for hydration, then use keyboard activation to test actual client interaction.
    const customerTab=page.locator('.lp-feature-tabs button').nth(1);
    await customerTab.focus();await customerTab.press('Enter');
    await page.locator('.lp-product-frame img[src$="27-customer-timeline.jpg"]').waitFor();
    assert.equal(await customerTab.getAttribute('aria-pressed'),'true');
    await page.locator('.lp-feature-tabs button').nth(2).click();
    await page.locator('.lp-product-frame img[src$="16-blog-edit.jpg"]').waitFor();
    await page.locator('.lp-feature-tabs button').first().click();
    const faq=page.locator('.lp-faq summary').first();await faq.focus();await faq.press('Enter');
    assert.equal(await page.locator('.lp-faq details').first().getAttribute('open'),'');
    await faq.press('Enter');
    assert.equal(await page.locator('a[href="#features"]').count(),2);
    for(const width of [1440,768,390,320]) {
      await page.setViewportSize({width,height:width<800?844:1000});
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${locale}: horizontal overflow at ${width}px`);
      if([1440,390].includes(width)){
        await page.evaluate(()=>scrollTo(0,0));
        await page.screenshot({path:`tmp/lp/${locale}-${width}.png`,fullPage:true});
        await page.screenshot({path:`tmp/lp/${locale}-${width}-hero.png`});
      }
    }
    assert.deepEqual(await page.locator('img').evaluateAll(images=>images.filter(image=>!image.complete||image.naturalWidth===0).map(image=>image.src)),[]);
    assert.deepEqual(apiRequests,[],'The marketing page must not call session/business APIs.');
    assert.deepEqual(external,[],'No external services should be contacted.');
    assert.deepEqual(errors,[]);
    await page.locator('.lp-hero a.lp-button').click();
    await page.waitForURL(url=>url.pathname==='/'&&url.searchParams.get('lang')===locale);
    await page.getByRole('heading',{level:1}).waitFor();
    await context.close();
    console.log(`${locale}: keyboard features, FAQ, images, 1440/768/390/320px layouts and onboarding link passed.`);
  }
  const context=await browser.newContext({javaScriptEnabled:false});
  const page=await context.newPage();
  await page.goto(origin+'/lp?lang=en');
  assert.ok((await page.getByRole('heading',{level:1}).innerText()).includes('Your words.'));
  await page.locator('.lp-faq summary').first().click();
  assert.equal(await page.locator('.lp-faq details').first().getAttribute('open'),'');
  await context.close();
  const switcher=await browser.newPage();
  await switcher.goto(origin+'/lp?lang=ja');
  await switcher.getByRole('button',{name:'English',exact:true}).click();
  await switcher.waitForURL(url=>url.searchParams.get('lang')==='en');
  assert.equal(await switcher.locator('html').getAttribute('lang'),'en');
  console.log('JavaScript-free content/FAQ and language switching passed. Screenshots: tmp/lp/.');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  await store.close();
}
