import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile,mkdir } from 'node:fs/promises';
import { chromium,expect } from 'playwright/test';
import { Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { sample } from '../server/domain.ts';
import { standardTheme } from '../shared/theme-editing.ts';
import { digest } from '../server/auth.ts';
process.env.DEMO_MODE='true';delete process.env.GOOGLE_CLOUD_PROJECT;
const catalog=JSON.parse(await readFile('shared/en.json','utf8'));
const store=new Store(':memory:'),server=createApp(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=origin;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
await mkdir('tmp/theme-editors',{recursive:true});
try{
 for(const [language,width] of [['ja',1280],['en',390]]){
  const label=text=>language==='en'?catalog[text]||text:text;
  const shop=await store.createShop(`frame-code-${language}@example.com`);shop.published={...structuredClone(sample),appearance:{accent:'sage',layout:'standard',imageUrl:'',theme:standardTheme}};await store.saveShop(shop);
  const cookie=randomUUID();await store.put('session',digest(cookie),{user:{email:shop.owner,name:'Owner',role:'owner',shopId:shop.id},expires:Date.now()+600000});
  const context=await browser.newContext({viewport:{width,height:950}});await context.addCookies([{name:'gemihub_session',value:cookie,url:origin}]);
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/?lang=${language}`);if(width<760)await page.locator('.mobile-menu-toggle').click();
  await page.locator('aside nav').getByRole('button',{name:new RegExp(label('画面を試す・編集')+'$')}).click();if(width<760)await page.locator('.mobile-menu-toggle').click();
  await page.getByRole('treeitem',{name:label('ページ全体'),exact:true}).click();
  await page.locator('summary').filter({hasText:label('ページ全体の HTML を編集')}).click();
  const area=text=>page.getByRole('textbox',{name:label(text),exact:true});
  await area('ヘッダーの HTML').fill('<header class="edited-header"><h1>EDITED HEADER</h1><slot name="navigation"></slot></header>');
  await area('フッターの HTML').fill('<footer><p>EDITED FOOTER</p><slot name="content"></slot></footer>');
  await area('全体の枠の HTML').fill('<main><h2>EDITED FRAME</h2><slot name="content"></slot></main>');
  await area('全体の CSS（ヘッダー・枠・フッター共通）').fill('.edited-header{padding:32px;background:#eef3eb}');
  await area('ヘッダー専用の CSS').fill('.public-nav{gap:20px}');
  await area('フッター専用の CSS').fill('footer{padding:24px}');
  await page.getByRole('button',{name:label('プレビューに反映'),exact:true}).click();
  const preview=page.locator('.local-preview-screen');for(const text of ['EDITED HEADER','EDITED FOOTER','EDITED FRAME'])await expect(preview).toContainText(text);
  await expect(preview).toContainText(label('Dummy（仮の内容）'));
  assert.deepEqual((await store.shop(shop.id)).published,shop.published);
  await page.getByRole('button',{name:label('変更を比較'),exact:true}).click();await expect(page.locator('.conflict-columns')).toContainText('EDITED HEADER');
  await page.getByRole('button',{name:label('変更を比較'),exact:true}).click();
  await page.getByRole('button',{name:label('反映する'),exact:true}).click();await page.getByRole('button',{name:label('この内容を本番に反映'),exact:true}).click();
  await expect.poll(async()=>(await store.shop(shop.id)).published.appearance.theme.headerHtml).toContain('EDITED HEADER');
  const theme=(await store.shop(shop.id)).published.appearance.theme;assert.match(theme.footerHtml,/EDITED FOOTER/);assert.match(theme.bodyHtml,/EDITED FRAME/);assert.match(theme.headerCss,/gap:20px/);assert.match(theme.footerCss,/padding:24px/);
  assert.deepEqual((await store.shop(shop.id)).published.rules,shop.published.rules);
  await page.screenshot({path:`tmp/theme-editors/whole-page-${language}-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[]);await context.close();console.log(`${language} ${width}px: one HTML/CSS draft applies and publishes the complete frame together, with dummy content and unchanged business rules.`);
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await store.close();}
