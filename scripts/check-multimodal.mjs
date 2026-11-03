import {chromium} from "playwright";
import {mkdir, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import assert from "node:assert/strict";
const origin = process.env.STORYBOOK_URL || process.argv[2] || "http://localhost:6005";
const output = resolve(process.env.MANUAL_OUTPUT || "public/manual");
await mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true, ...((process.env.CHROMIUM || process.argv[3]) ? {executablePath: process.env.CHROMIUM || process.argv[3]} : {}), args: ["--no-sandbox"]});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 900}, locale: "ja-JP"});
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", req => {if (new URL(req.url()).pathname.startsWith("/api/")) errors.push(`Live API request in Storybook: ${req.url()}`);});
  const index = await (await fetch(`${origin}/index.json`)).json();
  assert.ok(!Object.values(index.entries).some(e => /--(approved|pen-preview|pen-live)$/.test(e.id)), "intermediate approval and standalone pen stories have been removed");
  async function open(suffix, heading) {
    console.log(`Checking ${suffix}`);
    const entry = Object.values(index.entries).find(e => e.id.endsWith(`--${suffix}`)); assert.ok(entry, suffix);
    await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story`);
    await page.getByRole("heading", {name: heading, exact: true}).waitFor();
    if (await page.locator(".steps").count()) assert.equal(await page.locator('.steps [aria-current="step"]').count(), 1, "exactly one current step is shown");
  }
  const captures = [];
  async function capture(name, selector) {
    if (selector) await page.locator(selector).first().evaluate(el => el.scrollIntoView({block: "start"}));
    captures.push({ name, bytes: await page.screenshot({type: "jpeg", quality: 86, animations: "disabled"}) });
  }
  await open("shop-specification", "現在のお店の設定");
  await page.getByRole("region", {name: "お店の変更履歴"}).waitFor();
  assert.equal(await page.locator("aside").getByRole("button", {name: /お店の仕組み図/}).count(), 0);
  assert.equal(await page.getByRole("button", {name: "リアルタイム書き起こし", exact: true}).count(), 0);
  assert.equal(await page.getByLabel("AIに伝えたいこと", {exact:true}).count(), 0);
  assert.equal(await page.getByRole("button",{name:"history.md をダウンロード",exact:true}).count(), 0);
  assert.equal(await page.getByRole("button",{name:"最新に更新",exact:true}).count(), 0);
  assert.equal(await page.getByRole("button",{name:"spec.md をダウンロード",exact:true}).count(), 0);
  assert.equal(await page.locator(".shop-history details").getAttribute("open"), null);
  await page.locator(".shop-history summary").click();
  assert.notEqual(await page.locator(".shop-history details").getAttribute("open"), null);
  await page.locator(".shop-history summary").click();
  await capture("21-system.jpg", ".shop-build-layout");
  await page.getByRole("button",{name:"はじめる",exact:true}).click();
  await page.getByRole("textbox",{name:"AIに伝えたいこと",exact:true}).fill("指名なしのとき、どうやって空きを判断する？");
  await page.getByRole("button",{name:"送信",exact:true}).click();
  await page.getByRole("log",{name:"AIとのチャット",exact:true}).getByText("お客様が指名・指名なしを選べます。",{exact:false}).last().waitFor();
  assert.equal(await page.getByRole("button",{name:"変更案を確認する",exact:true}).count(),0);
  await page.getByRole("button",{name:"修正",exact:true}).click();
  await page.getByRole("button",{name:"はじめる",exact:true}).click();
  await page.getByRole("textbox",{name:"AIに伝えたいこと",exact:true}).fill("水曜日もお休みに変更したい");
  await page.getByRole("button",{name:"送信",exact:true}).click();
  await page.getByRole("button",{name:"変更案を確認する",exact:true}).last().click();
  const review=page.locator(".shop-request .request-review");
  await review.getByRole("heading",{name:"このように変更してよいですか？",exact:true}).waitFor();
  await capture("24-voice.jpg", ".request-review");
  await capture("12-changes.jpg", ".request-review");
  await review.getByRole("button",{name:"変更内容を反映する",exact:true}).click();
  await page.locator(".shop-history summary").click();
  await page.getByRole("region",{name:"お店の変更履歴"}).getByText("営業時間・休業日を更新",{exact:false}).waitFor();

  await open("onboarding", "AIとお店をつくる");
  assert.equal(await page.locator(".dashboard > aside,.local-preview,.shop-switch").count(),0,"first login shows only shop creation");
  assert.equal(await page.getByRole("region", {name:"データと権限の仕組み",exact:true}).count(),0);
  await page.getByRole("heading", {name:"こんな風にすすみます",exact:true}).waitFor();
  assert.equal(await page.getByRole("textbox",{name:"AIに伝えたいこと",exact:true}).count(),0);
  await page.getByRole("button",{name:"はじめる",exact:true}).click();
  await page.getByRole("log",{name:"AIとのチャット",exact:true}).getByText("お店の名前を教えてください。",{exact:true}).waitFor();
    await page.getByRole("textbox",{name:"AIに伝えたいこと",exact:true}).fill("月のアトリエ");await page.getByRole("button",{name:"送信",exact:true}).click();
    await page.getByRole("log",{name:"AIとのチャット",exact:true}).getByText(/使いたいロゴはありますか/).waitFor();
    await page.getByRole("textbox",{name:"AIに伝えたいこと",exact:true}).fill("なし");await page.getByRole("button",{name:"送信",exact:true}).click();
    await page.getByRole("log",{name:"AIとのチャット",exact:true}).getByText("どういう業種のお店ですか？",{exact:true}).waitFor();
  await page.getByRole("textbox",{name:"AIに伝えたいこと",exact:true}).fill("ネイルサロンです。");
  await page.getByRole("button",{name:"送信",exact:true}).click();
  await page.getByRole("log",{name:"AIとのチャット",exact:true}).getByText(/ほしい機能を次から選んでください。/).waitFor();
  await page.getByRole("textbox",{name:"AIに伝えたいこと",exact:true}).fill("1、2、3、4、5、6、7");
  await capture("02-interview.jpg", ".panel.interview");
  await page.getByRole("button",{name:"送信",exact:true}).click();
  await page.getByRole("log",{name:"AIとのチャット",exact:true}).getByText("それ以外に欲しいページはありますか？",{exact:true}).waitFor();
  await page.getByRole("textbox",{name:"AIに伝えたいこと",exact:true}).fill("ありません。");
  await page.getByRole("button",{name:"送信",exact:true}).click();
  await page.getByRole("log",{name:"AIとのチャット",exact:true}).getByText("ほかに伝えたいことはありますか？",{exact:true}).waitFor();
  assert.equal(await review.getByRole("heading",{name:"下記の画面でいいですか？",exact:true}).count(),0);
  await page.getByRole("textbox",{name:"AIに伝えたいこと",exact:true}).fill("ありません。この内容でお願いします。");
  await page.getByRole("button",{name:"送信",exact:true}).click();
  await review.getByRole("heading",{name:"下記の画面でいいですか？",exact:true}).waitFor();
  assert.equal(await review.locator(".screen-name-list li").count(),10);
  await page.waitForFunction(()=>document.querySelectorAll(".theme-preview .public-shop").length===3);
  await capture("04-plan.jpg", ".request-review");
  await review.getByRole("button",{name:"聞き取りに戻る",exact:true}).click();
  await page.getByRole("textbox",{name:"AIに伝えたいこと",exact:true}).fill("ブログと問い合わせも使えるようにしたい");
  await page.getByRole("button",{name:"送信",exact:true}).click();
  await page.getByRole("log",{name:"AIとのチャット",exact:true}).getByText("ほかに伝えたいことはありますか？",{exact:true}).last().waitFor();
  await page.getByRole("textbox",{name:"AIに伝えたいこと",exact:true}).fill("ほかにはありません。");
  await page.getByRole("button",{name:"送信",exact:true}).click();
  await review.getByRole("button",{name:"仮公開する",exact:true}).click();
  const publication = page.getByRole("region", {name:"公開状態",exact:true});
  await publication.getByRole("heading", {name:"仮公開中",exact:true}).waitFor();
  assert.equal(await page.getByRole("heading", {name:"次は、お店の詳しい内容を決めましょう",exact:true}).count(),0);
  assert.equal(await page.getByRole("link",{name:"仮公開中のページを見る ↗",exact:true}).count(), 0);
  await capture("05-provisional.jpg", ".publication-status");
  await page.locator("aside nav").getByRole("button", {name:/スタッフ・勤務$/}).click();
  await page.locator(".staff-editor").getByLabel("名前",{exact:true}).first().fill("実際に働くスタッフ");
  await capture("04-settings.jpg", ".panel:has(.editor)");
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await page.getByText("保存して仮公開に反映しました。",{exact:true}).waitFor();
  await publication.getByRole("link",{name:"画面を確認して本番公開へ",exact:true}).click();
  await page.getByRole("heading",{name:"画面の確認・本番公開",exact:true}).waitFor();
  assert.equal(await page.getByLabel("確認する画面",{exact:true}).count(), 0);
  await page.locator(".publication-preview .public-nav").getByRole("button",{name:"ご予約",exact:true}).click();
  await page.getByRole("textbox",{name:"ご希望の日付（日本時間）",exact:true}).waitFor();
  await page.locator(".publication-preview .public-nav").getByRole("button",{name:"お店のこと",exact:true}).click();
  await page.locator(".publication-preview .preview-surface").getByText("実際に働くスタッフ",{exact:false}).waitFor();
  await capture("06-publish.jpg", ".publication-preview");
  await page.getByRole("button",{name:"本番公開する",exact:true}).click();
  await page.getByText("本番公開しました。ログインしていない方もページを表示できます。",{exact:true}).waitFor();
  for (const story of ["provisional-page", "customer"]) {
    await open(story, "自分のための、ひとときを。");
    assert.equal(await page.getByRole("button", {name: "修正する", exact: true}).count(), 0);
    if (story === "provisional-page") {
      await page.getByText("仮公開中 ·", {exact:false}).waitFor();
      await capture("05-provisional-page.jpg", ".public-shop");
    }
  }
  // Pen edits stay in the screen editor until the owner explicitly applies them.
  for (const story of ["local-editor", "local-editor-new"]) {
    // Each story has a fresh remote shop; discard drafts from earlier fixtures.
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith("gemihub:local-preview:")) localStorage.removeItem(key);
    });
    await open(story, "自分のための、ひとときを。");
    await page.locator(".editor-toolbar summary").click();
    await page.getByLabel("ヘッダーを表示", {exact: true}).check();
    await page.locator(".editor-toolbar strong").click();
    assert.equal(await page.locator(".preview-display-menu").getAttribute("open"), null);
    await page.locator(".editor-toolbar summary").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".preview-display-menu").getAttribute("open"), null);
    await page.getByRole("button", {name: "修正する", exact: true}).click();
    const canvas = page.getByLabel("変更したい箇所を囲む画面");
    await canvas.waitFor();
    await page.waitForFunction(() => document.querySelector("canvas")?.width > 300);
    assert.equal(await page.locator(".visual-request").getByRole("button", {name: "送信", exact: true}).isEnabled(), false);
    await canvas.evaluate(el => el.scrollIntoView({block: "start"}));
    const box = await canvas.boundingBox(); assert.ok(box);
    const x = box.x + box.width * .20, y = box.y + 150;
    await page.mouse.move(x + 120, y); await page.mouse.down();
    for (let i = 1; i <= 32; i++) {const angle = i / 32 * Math.PI * 2; await page.mouse.move(x + 120 * Math.cos(angle), y + 40 * Math.sin(angle));}
    await page.mouse.up();
    assert.ok(await canvas.evaluate(el => {
      const pixels = el.getContext("2d").getImageData(0, 0, el.width, el.height).data;
      let red = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 180 && pixels[i + 1] < 90 && pixels[i + 2] < 110) red++;
      return red > 100;
    }), "pointer events draw visible red strokes into captured pixels");
    await page.getByLabel("ここをどう変えたいですか").fill("ここを『季節のアトリエ』に変えて");
    await capture("22-pen.jpg", ".annotation-canvas");
    await page.locator(".visual-request").getByRole("button", {name: "送信", exact: true}).click();
    await page.getByLabel("変更する対象を確認").waitFor();
    assert.equal(await page.getByRole("button", {name: "この対象をローカルに変更"}).isEnabled(), false);
    await page.getByLabel("変更する対象を確認").selectOption("name");
    await page.getByRole("button", {name: "この対象をローカルに変更"}).click();
    await page.getByText("ペンの変更をローカルに保存しました。本番に反映する前に画面を確認してください。", {exact: false}).waitFor();
    await page.locator(".local-preview-screen").getByText("季節のアトリエ", {exact: true}).waitFor();
    assert.equal(await page.getByRole("heading", {name: "差分プランを作成しました"}).count(), 0);
    assert.ok(await page.evaluate(() => Object.values(localStorage).some(value => {
      try { const draft = JSON.parse(value); return draft.config?.name === "季節のアトリエ" && draft.source?.name !== "季節のアトリエ" && !draft.pending; }
      catch { return false; }
    })), "pen changes are saved locally before publication");
    await page.getByRole("button", {name: "反映する", exact: true}).click();
    await capture("23-pen-plan.jpg", '.local-preview [role="dialog"][aria-label="本番への反映内容"]');
    await page.getByRole("button", {name: "この内容を本番に反映", exact: true}).click();
    await page.getByText("本番に反映しました。サンプルの予約・問い合わせ・記事は本番には保存していません。", {exact: false}).waitFor();
  }
  await page.setViewportSize({width: 390, height: 844});
  await open("onboarding", "AIとお店をつくる");
  await page.getByRole("heading", {name:"こんな風にすすみます",exact:true}).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "onboarding fits mobile viewport");
  await open("plan-review", "下記の画面でいいですか？");
  await review.getByRole("button", {name:"仮公開する",exact:true}).waitFor();
  assert.equal(await page.getByRole("region", {name:"データと権限の仕組み",exact:true}).count(), 0);
  assert.equal(await review.locator("pre").count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "review fits mobile viewport");
  await page.screenshot({path:resolve("tmp/review-mobile.png"),fullPage:true});
  await open("production-preview", "画面の確認・本番公開");
  await page.getByRole("button", {name:"本番公開する",exact:true}).waitFor();
  assert.equal(await page.getByRole("button", {name:"最新の内容を読み直す",exact:true}).count(), 0);
  await page.getByRole("button", {name:"修正依頼する",exact:true}).click();
  await page.getByRole("dialog",{name:"どこを修正しますか？",exact:true}).getByRole("link",{name:"動作・機能を直す",exact:true}).click();
  const consultation = page.getByRole("region", {name:"AIへの相談",exact:true});
  await consultation.getByRole("button",{name:"はじめる",exact:true}).click();
  await consultation.getByRole("textbox",{name:"AIに伝えたいこと",exact:true}).waitFor();
  await open("production-preview", "画面の確認・本番公開");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "publication confirmation fits mobile viewport");
  await page.screenshot({path:resolve("tmp/approved-mobile.png"),fullPage:true});
  await open("shop-specification", "現在のお店の設定");
  await page.getByRole("region", {name:"お店の変更履歴"}).waitFor();
  await page.screenshot({path:resolve("tmp/spec-mobile.png"),fullPage:true});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile layout should not overflow");
  assert.deepEqual(errors, []);
  // Write only after interaction checks so Vite static-file reloads cannot reset the sample state.
  for (const capture of captures) await writeFile(resolve(output, capture.name), capture.bytes);
  console.log("Verified current specification/history, text and voice choices, result confirmation/revision/approval, publication, dictation input, pen edits through the local screen editor, owner-only provisional publication, explicit full publication, infographic review and pages without editing controls and mobile layout (Storybook fixtures).");
} finally {await browser.close();}
