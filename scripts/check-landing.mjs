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
    assert.equal(await page.locator('#operations .lp-feature-layout').count(),5);
    assert.equal(await page.locator('#features [data-creation]').count(),4);
    assert.match(await page.locator('.lp-hero-copy').innerText(), /AI/);
    assert.ok(await page.locator('#features').evaluate(element => !!(element.compareDocumentPosition(document.querySelector('#operations')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    assert.equal(await page.locator('.lp-feature-tabs, [aria-controls="lp-feature-panel"]').count(),0);
    assert.equal(await page.locator('[data-feature="analytics"] .lp-feature-copy a').getAttribute('href'),`/manual?lang=${locale}#guide-staff-sales`);
    assert.match(await page.locator('.lp-hero .lp-cta-note').innerText(), locale === 'ja' ? /招待制.*招待パスワード/ : /invitation-only.*invitation password/);
    assert.match(await page.locator('.lp-final .lp-cta-note').innerText(), locale === 'ja' ? /招待制/ : /invitation-only/);
    const refund = page.locator('.lp-payments');
    assert.equal(await refund.locator('.lp-resale-steps li').count(), 3);
    assert.match(await refund.innerText(), /7,000/);
    assert.match(await refund.innerText(), /9,000/);
    assert.match(await refund.innerText(), locale === 'ja' ? /再予約は保証されません/ : /not guaranteed/);
    assert.match(await page.locator('.lp-data').innerText(), locale === 'ja' ? /公開ページはサービス側から配信/ : /Published pages are served by the service/);
    const faq=page.locator('.lp-faq summary').first();await faq.focus();await faq.press('Enter');
    assert.equal(await page.locator('.lp-faq details').first().getAttribute('open'),'');
    await faq.press('Enter');
    assert.equal(await page.locator('a[href="#features"]').count(),2);
    for(const width of [1440,768,390,320]) {
      await page.setViewportSize({width,height:width<800?844:1000});
      await page.evaluate(async()=>{await document.fonts.ready;});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${locale}: horizontal overflow at ${width}px`);
      let previousBottom=0;
      let previousRowTop=-1;
      for(const feature of ['create','red-circle','review','consult','booking','customers','analytics','posts','phone']) {
        const creation=['create','red-circle','review','consult'].includes(feature);
        const section=page.locator(`article[${creation?'data-creation':'data-feature'}="${feature}"]`);
        await section.scrollIntoViewIfNeeded();
        if(await section.locator('img').count()) await section.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
        assert.ok(await section.isVisible(),`${locale}/${feature}: visible without switching controls`);
        const bounds=await section.evaluate(element=>{const rect=element.getBoundingClientRect();return {top:rect.top+scrollY,bottom:rect.bottom+scrollY};});
        assert.ok(bounds.top>=previousBottom || bounds.top===previousRowTop,`${locale}/${feature}: follows or shares a row with the previous feature`);
        previousRowTop=bounds.top;
        previousBottom=bounds.bottom;
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${locale}/${feature}: overflow at ${width}px`);
        if([1440,390].includes(width)) {
          await section.screenshot({path:`tmp/lp/${locale}-${width}-${feature}.png`});
        }
      }
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
    console.log(`${locale}: AI creation and red-circle editing lead the page; all features, FAQ, images, 1440/768/390/320px layouts and onboarding link passed.`);
  }
  const context=await browser.newContext({javaScriptEnabled:false});
  const page=await context.newPage();
  await page.goto(origin+'/lp?lang=en');
  assert.ok((await page.getByRole('heading',{level:1}).innerText()).includes('Your shop’s website.'));
  for(const feature of ['booking','customers','analytics','posts','phone']) {
    assert.ok(await page.locator(`article[data-feature="${feature}"]`).isVisible(),`${feature}: visible with JavaScript disabled`);
  }
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
