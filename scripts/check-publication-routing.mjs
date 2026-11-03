import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const origin=process.env.STORYBOOK_URL||"http://localhost:6005";
const entries=Object.values((await(await fetch(`${origin}/index.json`)).json()).entries);
const entry=entries.find(entry=>entry.id.endsWith("--production-preview"));assert.ok(entry);
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:["--no-sandbox"]});
await mkdir("tmp",{recursive:true});
try{
  for(const width of [1280,390]){
    const context=await browser.newContext({viewport:{width,height:900},locale:"ja-JP"});
    const page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
    const open=async()=>{await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story`);await page.locator('.preview-surface .public-nav').waitFor();};
    const request=async()=>{await page.getByRole("button",{name:"修正依頼する",exact:true}).click();const dialog=page.getByRole("dialog",{name:"どこを修正しますか？",exact:true});await dialog.waitFor();return dialog;};
    for(const [nav,screen,tree] of [["お店のこと","about","お店のこと"],["お問い合わせ","contact","お問い合わせ"],["ご予約","reserve","予約"],["マイページ","mine","マイページ"]]){
      await open();await page.locator('.preview-surface .public-nav').getByRole("button",{name:nav,exact:true}).click();
      if(screen==="contact")await page.locator('.preview-surface .contact-form textarea').fill("プレビューの入力を保持します");
      let dialog=await request();assert.equal(await dialog.getByRole("link").count(),3);
      assert.ok((await dialog.getByRole("link",{name:"いま開いている画面を直す",exact:true}).getAttribute("href")).includes(`screen=${screen}`));
      if(screen==="contact"){
        await page.keyboard.press("Escape");await dialog.waitFor({state:"detached"});
        await page.locator('.preview-surface .contact-form').waitFor();
        assert.equal(await page.locator('.preview-surface .contact-form textarea').inputValue(),"プレビューの入力を保持します");
        dialog=await request();
      }
      await dialog.getByRole("link",{name:"いま開いている画面を直す",exact:true}).click();
      await page.getByRole("treeitem",{name:tree,exact:true}).waitFor();
      await page.waitForFunction(label=>[...document.querySelectorAll('[role="treeitem"]')].some(item=>item.textContent.includes(label)&&item.getAttribute('aria-selected')==='true'),tree);
      await page.locator('.local-preview-screen .public-shop').waitFor();
    }
    await open();await page.locator('.preview-surface .public-nav').getByRole("button",{name:"ブログ",exact:true}).click();
    await page.locator('.preview-surface').getByRole("link",{name:/秋色ネイルで/}).first().click();
    await page.locator('.preview-surface .article-page').getByRole("heading",{name:"秋色ネイルで、季節を指先に。",exact:true}).waitFor();
    let dialog=await request();const articleHref=await dialog.getByRole("link",{name:"いま開いている画面を直す",exact:true}).getAttribute("href");
    assert.equal(new URL(articleHref,origin).searchParams.get("screen"),"blogs:article");assert.match(new URL(articleHref,origin).searchParams.get("article"),/autumn-design$/);
    await dialog.getByRole("link",{name:"いま開いている画面を直す",exact:true}).click();
    await page.locator('.local-preview-screen .article-page').getByRole("heading",{name:"秋色ネイルで、季節を指先に。",exact:true}).waitFor();
    await open();await page.locator('.preview-surface .public-nav').getByRole("button",{name:"よくある質問",exact:true}).click();
    dialog=await request();assert.equal(new URL(await dialog.getByRole("link",{name:"いま開いている画面を直す",exact:true}).getAttribute("href"),origin).searchParams.get("screen"),"page:faq");
    await dialog.getByRole("link",{name:"いま開いている画面を直す",exact:true}).click();
    await page.locator('.local-preview-screen').getByText(/初めてでも予約できますか？/).waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('[role="treeitem"]')].some(item=>item.textContent.includes('よくある質問')&&item.getAttribute('aria-selected')==='true'));
    await open();dialog=await request();await dialog.getByRole("link",{name:"動作・機能を直す",exact:true}).click();
    const consultation=page.getByRole("region",{name:"AIへの相談",exact:true});
    await consultation.getByText("直したいことや追加したいページを伝えてください。AIと話しながら内容をまとめられます。",{exact:true}).waitFor();
    await consultation.getByRole("button",{name:"はじめる",exact:true}).click();await consultation.getByRole("log").getByText(/どうしたいですか？直したいことや追加したいページ/).waitFor();
    await open();dialog=await request();await dialog.getByRole("link",{name:"お店の情報・登録データを直す",exact:true}).click();
    await page.getByRole("region",{name:"お店の基本情報と予約の設定",exact:true}).waitFor();
    assert.equal(await page.locator('.data-management').count(),0);
    assert.equal(await page.locator('aside nav').getByRole('button',{name:/予約を管理$|お客様$|データ管理$/}).count(),0);
    const basic=page.locator('.live-settings-basic'),hours=page.locator('.live-settings-hours'),rules=page.locator('.live-settings-rules');
    await basic.getByLabel('店名',{exact:true}).waitFor();await hours.getByLabel('開店',{exact:true}).waitFor();await rules.getByLabel('何日先まで予約できるか',{exact:true}).waitFor();
    assert.equal(await page.locator('aside nav').getByRole('button',{name:/営業時間・休業日|予約ルール/}).count(),0);
    await basic.getByLabel('店名',{exact:true}).fill('基本情報をまとめたお店');await basic.getByRole('button',{name:'保存',exact:true}).click();await basic.getByRole('status').filter({hasText:'保存して'}).waitFor();
    await hours.getByLabel('開店',{exact:true}).fill('09:00');await hours.getByRole('button',{name:'保存',exact:true}).click();await hours.getByRole('status').filter({hasText:'保存して'}).waitFor();
    await rules.getByLabel('何日先まで予約できるか',{exact:true}).fill('40');await rules.getByRole('button',{name:'保存',exact:true}).click();await rules.getByRole('status').filter({hasText:'保存して'}).waitFor();
    await basic.getByRole('button',{name:'最新の内容を読み直す',exact:true}).click();assert.equal(await basic.getByLabel('店名',{exact:true}).inputValue(),'基本情報をまとめたお店');assert.equal(await hours.getByLabel('開店',{exact:true}).inputValue(),'09:00');assert.equal(await rules.getByLabel('何日先まで予約できるか',{exact:true}).inputValue(),'40');
    await open();dialog=await request();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`tmp/publication-request-${width}.png`,fullPage:true});
    await page.getByRole("button",{name:"プレビューに戻る",exact:true}).click();await dialog.waitFor({state:"detached"});
    assert.deepEqual(errors,[]);await context.close();
    console.log(`${width}px: current standard screen, exact article and custom page reach the matching editor; behavior selects AI modification; registered data opens shop settings; closing preserves preview (fixtures).`);
  }
}finally{await browser.close();}
