import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { chromium, expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample, shopSchema } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:'),shop=await store.createShop('image-browser@example.com');shop.published=shopSchema.parse(structuredClone(sample));shop.publication='public';
const original=await sharp(randomBytes(2100*1400*3),{raw:{width:2100,height:1400,channels:3}}).jpeg({quality:90}).toBuffer();
const upload=await sharp({create:{width:900,height:600,channels:3,background:'#d7e5cb'}}).png().toBuffer();
const ids=['a','b','c'].map(letter=>letter.repeat(64)),data=new Map(ids.map(id=>[id,original]));
for(const id of ids)await store.put('menuImageUpload',id,{shopId:shop.id,fileId:id,hash:id,mimeType:'image/jpeg',size:original.length,complete:true,name:`Photo ${id[0]}.jpg`,source:'upload',createdAt:new Date().toISOString()});
shop.published.header.imageId=ids[0];shop.published.menus[0].imageId=ids[1];shop.published.menus[1].imageId=ids[2];shop.published.staff[0].imageId=ids[0];await store.saveShop(shop);
await store.put('session',digest('owner'),{user:{email:shop.owner,name:'Owner',role:'owner',shopId:shop.id},expires:Date.now()+3600000});
let reads=0;
const server=createApp(store,undefined,undefined,{async reserve(count){return Array.from({length:count},()=>randomUUID());},async upload(_shop,_token,id,file){data.set(id,Buffer.from(file.data,'base64'));},async rename(){},async read(_shop,_token,id){reads++;await new Promise(resolve=>setTimeout(resolve,150));assert.ok(data.has(id));return data.get(id);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});await mkdir('tmp/image-delivery',{recursive:true});
 for(const language of ['ja','en'])for(const width of [1280,390]){
  const label=text=>language==='en'?catalog[text]||text:text;
  const context=await browser.newContext({viewport:{width,height:950},locale:language==='ja'?'ja-JP':'en-US'});await context.addCookies([{name:'gemihub_session',value:'owner',url:origin}]);
  const page=await context.newPage(),errors=[],requests=[],headers=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/\/(images|menu-images)\/[a-f0-9]{64}$/.test(new URL(r.url()).pathname)){requests.push(r.url());headers.push(r.allHeaders());}});
  const scroll=async()=>{for(let y=0;y<await page.evaluate(()=>document.body.scrollHeight);y+=600){await page.evaluate(y=>window.scrollTo(0,y),y);await page.waitForTimeout(100);}await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(300);};
  const decoded=async locator=>{await expect.poll(()=>locator.evaluateAll(nodes=>nodes.length>0&&nodes.every(image=>image.complete&&image.naturalWidth>0)),{timeout:15000}).toBe(true);};
  await page.goto(`${origin}/s/${shop.slug}?pane=about&lang=${language}`);await scroll();await expect(page.getByText(label('画像を読み込み中…'),{exact:true})).toHaveCount(0,{timeout:15000});await decoded(page.locator('img[src^="blob:"]'));assert.ok(requests.some(url=>new URL(url).searchParams.get('view')==='display'));
  // Each visible image remains loaded when scrolled out of view and back.
  const count=requests.length;await scroll();assert.equal(requests.length,count,'scrolling must not download loaded images again');assert.equal(reads,3,'all pages and variants reuse the three original downloads');
  await page.goto(`${origin}/?tab=menus&shop=${shop.id}&lang=${language}`);await expect(page.locator('.live-settings-menus')).toBeVisible();await scroll();const thumbnails=page.locator('.menu-image-editor img');await decoded(thumbnails);assert.ok(await thumbnails.evaluateAll(images=>images.every(image=>image.naturalWidth<=480)));
  const item=name=>page.locator('aside nav').getByRole('button',{name:new RegExp(label(name)+'$')});
  await item('画面を試す・編集').click();await page.locator('aside nav').getByRole('treeitem',{name:new RegExp('^'+label('お店のこと'))}).click();await expect(page.locator('.local-preview-screen')).toBeVisible();await scroll();const previewImages=page.locator('.local-preview-screen img[src^=\"blob:\"]');await decoded(previewImages);assert.ok(await previewImages.evaluateAll(images=>images.every(image=>image.naturalWidth<=1600)));assert.ok(requests.some(url=>new URL(url).pathname.startsWith('/api/shops/')&&new URL(url).searchParams.get('view')==='display'));await item('画像管理').click();await expect(page.locator('.image-library-grid')).toBeVisible();await scroll();await decoded(page.locator('.image-library-grid img'));assert.ok(await page.locator('.image-library-grid img').evaluateAll(images=>images.every(image=>image.naturalWidth<=480)));
  // Full-size viewing retains the original resolution, with no new Drive request.
  await page.locator('.image-library-grid figure').filter({has:page.getByText('Photo a.jpg',{exact:true})}).locator('.image-preview-button').click();const dialog=page.getByRole('dialog',{name:label('画像の拡大表示'),exact:true});await decoded(dialog.locator('img'));assert.equal(await dialog.locator('img').evaluate(image=>image.naturalWidth),2100);await dialog.getByRole('button',{name:label('閉じる'),exact:true}).click();
  await item('公開の設定').click();await item('画像管理').click();await scroll();await decoded(page.locator('.image-library-grid img'));
  assert.ok((await Promise.all(headers)).some(header=>header['if-none-match']),'browser revalidates cached responses with ETag');
  const name=`Uploaded ${language} ${width}.png`;await page.locator('.image-library-tools input[type=file]').setInputFiles({name,mimeType:'image/png',buffer:upload});
  await expect(page.locator('.image-library').getByText(name,{exact:true})).toBeVisible();await decoded(page.locator('.image-library-grid img'));assert.equal(reads,3,'just-uploaded bytes are immediately reusable without a Drive round trip');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await page.screenshot({path:`tmp/image-delivery/${language}-${width}.png`,fullPage:true});await context.close();console.log(`${language} ${width}px: display/thumbnail/original, ETag, scroll reuse, new upload and responsive images passed (Drive reads: ${reads}).`);
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await store.close();}
