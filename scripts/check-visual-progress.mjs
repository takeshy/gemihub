import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile,mkdir } from 'node:fs/promises';
import { chromium,expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import * as intelligence from '../server/ai.ts';
process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return{promise,release};};
let identify,generate,review,repair,generated=0,reviewed=0;
const reset=()=>{identify=gate();generate=gate();review=gate();repair=gate();generated=reviewed=0;};reset();
const store=new Store(':memory:');const server=createApp(store,{...intelligence,
 identifyVisual:async()=>{await identify.promise;return{ids:['appearance'],explanation:'Changing the icon color.'};},
 visualAppearance:async current=>{generated++;await(generated===1?generate.promise:repair.promise);return{config:{...current,appearance:{accent:'navy',layout:'standard',imageUrl:''}}};},
 visualReview:async()=>{reviewed++;if(reviewed===1){await review.promise;return{approved:false,issues:['Adjust the icon color']};}return{approved:true,issues:[]};},
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium-browser',args:['--no-sandbox']});
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));await mkdir('tmp/visual-progress',{recursive:true});let active;
try{for(const lang of ['ja','en'])for(const width of [1280,390]){
 reset();const label=text=>lang==='en'?catalog[text]||text:text;
 const shop=await store.createShop(`progress-${lang}-${width}@example.com`);shop.published=structuredClone(sample);shop.publication='public';await store.saveShop(shop);
 const token=randomUUID();await store.put('session',digest(token),{user:{email:shop.owner,name:'Owner',role:'owner'},expires:Date.now()+600000});
 const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:'gemihub_session',value:token,url:origin}]);const page=await context.newPage();active=page;page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${origin}/?lang=${lang}&tab=try&screen=reserve&shop=${shop.id}`);await expect(page.locator('.local-preview-screen')).toBeVisible();
 await page.getByRole('button',{name:label('修正する'),exact:true}).click();
 const chat=page.locator('.visual-chat-panel'),input=chat.getByRole('textbox',{name:label('ここをどう変えたいですか'),exact:true});
 await input.fill('Change the icon color');await input.press('Control+Enter');
 const status=chat.locator('.visual-generation-status');await expect(status).toHaveAttribute('data-stage','identifying');await expect(status.getByRole('timer')).not.toHaveText(label('経過：{0}秒').replace('{0}','0'));
 identify.release();await expect(status).toHaveAttribute('data-stage','generating');await expect(status).toContainText(label('変更案を作成しています…'));
 generate.release();await expect(status).toHaveAttribute('data-stage','reviewing');await expect(status).toContainText(label('PC・スマートフォンの表示を確認しています…'));
 await page.screenshot({path:`tmp/visual-progress/review-${lang}-${width}.png`});
 review.release();await expect(status).toHaveAttribute('data-stage','repairing');await expect(status).toContainText(label('調整：{0}回目').replace('{0}','2'));repair.release();
 const dialog=page.locator('.visual-change-review');await expect(dialog).toBeVisible();await expect(status).toHaveCount(0);
 reset();identify.release();await dialog.getByRole('button',{name:label('さらに変更'),exact:true}).click();await dialog.getByRole('textbox',{name:label('さらに変更したいこと'),exact:true}).fill('Keep the icon blue');await dialog.getByRole('button',{name:label('修正案を更新'),exact:true}).click();
 await expect(dialog.locator('.visual-generation-status')).toHaveAttribute('data-stage','generating');generate.release();review.release();repair.release();await expect(dialog.locator('.visual-generation-status')).toHaveCount(0);
 await dialog.getByRole('button',{name:label('キャンセル'),exact:true}).click();
 await page.route('**/visual/propose',route=>route.fulfill({status:504,contentType:'text/plain',body:'upstream request timeout'}));
 identify.release();await input.fill('Keep this instruction after the timeout');await input.press('Control+Enter');await expect(chat.getByRole('alert')).toContainText(label('サーバーの応答がタイムアウトしました。処理結果を確認してから、もう一度お試しください。'));
 await expect(input).toHaveValue('Keep this instruction after the timeout');await expect(status).toHaveCount(0);assert.equal((await store.shop(shop.id)).published.appearance?.accent,shop.published.appearance?.accent);
 assert.deepEqual(errors,[]);await context.close();console.log(`${lang} ${width}px: identify/generate/review/repair phases, elapsed time, modal progress, upstream timeout and draft retention passed`);
}}catch(error){await active?.screenshot({path:'tmp/visual-progress/failure.png'});throw error;}
finally{identify.release();generate.release();review.release();repair.release();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await store.close();}
