import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdir } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { chromium,expect } from 'playwright/test';
const root=resolve('storybook-static');
let server,origin=process.env.STORYBOOK_URL;
if(!origin){
 server=createServer(async(req,res)=>{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);try{assert.ok(path.startsWith(root+'/'));res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
}
const entries=Object.values((await(await fetch(origin+'/index.json')).json()).entries).filter(entry=>entry.title==='運営/相談・質問');
const expected=['history','new','plain-text','markdown','charts','booking-flow','invalid-diagram'];
assert.deepEqual(entries.map(entry=>entry.id.split('--')[1]).sort(),[...expected].sort());
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
await mkdir('tmp/consultations/patterns',{recursive:true});let active;
try{
 for(const lang of ['ja','en'])for(const width of [1280,390])for(const suffix of expected){
  const entry=entries.find(entry=>entry.id.endsWith('--'+suffix));
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();active=page;page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))errors.push('unexpected live API');});
  const label=text=>lang==='en'?catalog[text]||text:text;
  await page.goto(`${origin}/iframe.html?id=${entry.id}&viewMode=story&lang=${lang}`);
  const input=page.locator('.assistant .chat-composer textarea'),answer=page.locator('.assistant .chat-message-assistant');
  await expect(input).toBeEditable();await expect(page.locator('.dashboard > aside')).toBeAttached();
  await expect(answer).toHaveCount(suffix==='new'?0:1);
  if(suffix==='history')await expect(input).toHaveValue(lang==='en'?'And on holidays?':'祝日の場合は？');
  if(suffix==='plain-text')await expect(answer).toContainText(lang==='en'?'6 p.m.':'午後6時');
  if(suffix==='markdown'){await expect(answer.locator('table')).toBeVisible();await expect(answer.locator('pre code')).toBeVisible();}
  if(suffix==='charts'||suffix==='booking-flow'){
   const diagrams=answer.locator('.pele-diagram');await expect(diagrams).toHaveCount(suffix==='charts'?2:1);
   for(const diagram of await diagrams.all())await expect(diagram.locator('svg').first()).toBeVisible();
  }
  if(suffix==='invalid-diagram'){
   await expect(answer.getByRole('status')).toHaveText(label('図を表示できません。元のデータを確認してください。'));
   await answer.locator('.diagram-source summary').click();await expect(answer.locator('.diagram-source code')).toContainText('a[Incomplete');
  }
  const pane=page.locator('.consultation-history'),toggle=pane.locator('.consultation-history-toggle'),body=pane.locator('.consultation-history-body');
  await expect(page.locator('.workspace .consultation-history')).toHaveCount(1);await expect(page.locator('.dashboard > aside .consultation-history')).toHaveCount(0);
  const openHistory=async()=>{if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();};
  await openHistory();await expect(pane.locator('li').first()).toBeVisible();
  const expanded=await page.locator('.consultation-conversation').boundingBox(),historyBounds=await pane.boundingBox();
  if(width>900)assert.ok(historyBounds.x+historyBounds.width<=expanded.x,'history is beside the conversation in the main workspace');
  await page.screenshot({path:`tmp/consultations/patterns/${suffix}-${lang}-${width}.png`});
  await input.fill('Keep this unfinished question');
  const previousUrl=page.url();
  await toggle.focus();await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(body).toBeHidden();await expect(toggle).toBeFocused();
  await expect(input).toHaveValue('Keep this unfinished question');assert.equal(page.url(),previousUrl);
  const collapsed=await page.locator('.consultation-conversation').boundingBox();
  if(width>900)assert.ok(collapsed.width>expanded.width+100,'folding releases history space for the conversation');
  await page.screenshot({path:`tmp/consultations/patterns/${suffix}-collapsed-${lang}-${width}.png`});
  await page.reload();await expect(input).toHaveValue('Keep this unfinished question');
  await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(body).toBeHidden();
  await openHistory();await expect(pane.locator('li').first()).toBeVisible();
  await page.locator('.consultation-new').click();await expect(input).toHaveValue('');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  await page.screenshot({path:`tmp/consultations/patterns/${suffix}-tree-${lang}-${width}.png`});await context.close();console.log(`${suffix}: ${lang} ${width}px full-screen content and main-view history pane passed`);
 }
}catch(error){await active?.screenshot({path:'tmp/consultations/patterns/failure.png'});throw error;}
finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
