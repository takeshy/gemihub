import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,expect} from 'playwright/test';
const root=resolve('storybook-static'),catalog=JSON.parse(await readFile('shared/en.json','utf8')),entries=Object.values(JSON.parse(await readFile(resolve(root,'index.json'),'utf8')).entries);
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);assert.ok(path.startsWith(root+'/'));res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});await mkdir('tmp/refund-dates',{recursive:true});
 for(const language of ['ja','en'])for(const width of [1280,390]){
  const label=text=>language==='en'?catalog[text]||text:text;
  const context=await browser.newContext({viewport:{width,height:950},locale:language==='ja'?'ja-JP':'en-US',timezoneId:'Pacific/Honolulu'}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')||new URL(r.url()).hostname.endsWith('paypal.com'))requests.push(r.url());});
  const open=async(title,suffix)=>{const entry=entries.find(entry=>entry.title===title&&entry.id.endsWith('--'+suffix));assert.ok(entry,`${title}/${suffix}`);await page.goto(`http://127.0.0.1:${server.address().port}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story&globals=locale:${language}`);await expect(page.locator('.payment-details').first()).toBeVisible();};
  const format=(instant,zone)=>new Date(instant).toLocaleString(language==='ja'?'ja-JP':'en-US',{timeZone:zone,year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
  for(const [suffix,start,zone,policy] of [
   ['japan','2027-01-02T01:00:00Z','Asia/Tokyo',[[72,100],[24,50],[0,0]]],
   ['spring','2026-03-09T14:00:00Z','America/New_York',[[72,100],[24,50],[0,0]]],
   ['fall','2026-11-02T06:30:00Z','America/New_York',[[25,100],[24,50],[0,0]]],
   ['always','2027-01-02T01:00:00Z','Asia/Tokyo',[[0,100]]],
  ]){
   await open('お客様の画面/返金期限',suffix);const list=page.locator('.refund-deadlines li');await expect(list).toHaveCount(policy.length);
   const texts=await list.allTextContents();
   for(let i=0;i<policy.length;i++){
    const [hours,percent]=policy[i];assert.ok(texts[i].includes(`${percent}%`));
    if(hours)assert.ok(texts[i].includes(format(Date.parse(start)-hours*3600000,zone)),texts[i]);
    if(i)assert.ok(texts[i].includes(format(Date.parse(start)-policy[i-1][0]*3600000,zone)),texts[i]);
   }
   assert.ok(!texts.some(text=>/開始まで\d+時間|hours before/.test(text)));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(suffix==='japan'||suffix==='fall')await page.screenshot({path:`tmp/refund-dates/${suffix}-${language}-${width}.png`,fullPage:true});
  }
  await open('お客様の画面/お支払い・返金','paid');const card=page.locator('.booking-card').first();await card.locator('.payment-details summary').click();await expect(card.locator('.refund-deadlines li')).toHaveCount(4);assert.ok((await card.locator('.refund-deadlines').innerText()).includes('100%'));assert.ok((await card.locator('.refund-deadlines').innerText()).includes('70%'));assert.ok(!/開始まで\d+時間/.test(await card.locator('.refund-deadlines').innerText()));
  await expect(card.locator('.payment-details')).toContainText(label('店都合のキャンセルは全額返金。予約後の条件変更はこの予約に適用されません。'));
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await context.close();console.log(`${language} ${width}px: dated saved-policy ranges, year boundary, DST, repeated hour, no-deadline policy and actual My page passed.`);
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
