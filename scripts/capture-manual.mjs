import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

// Run against Storybook only: all records are isolated sample data.
const origin = process.env.STORYBOOK_URL || "http://localhost:6005";
const output = resolve(process.env.MANUAL_OUTPUT || "public/manual");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox"],
});
const captures = [];
try {
  const response = await fetch(`${origin}/index.json`);
  assert.ok(response.ok, "Start Storybook before generating screenshots");
  const index = await response.json();
  const entries = Object.values(index.entries).filter(
    (entry) => entry.type === "story",
  );
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      errors.push(`Unexpected live API request: ${request.url()}`);
  });
  async function open(suffix, ready, title) {
    const matches = entries.filter(entry => entry.id.endsWith(`--${suffix}`) && (!title || entry.title === title));
    assert.equal(matches.length, 1, `Expected one story: ${title || ""}/${suffix}`);
    const entry = matches[0];
    await page.goto(
      `${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story`,
    );
    await page.getByRole("heading", { name: ready, exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
  }
  const screenshotBytes = [];
  async function capture(name, focus) {
    if (focus)
      await page
        .locator(focus)
        .first()
        .evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all([...document.images].filter(img => img.getBoundingClientRect().top < innerHeight && img.getBoundingClientRect().bottom > 0).map(img => img.decode().catch(() => {})));
    });
    screenshotBytes.push({ name, bytes: await page.screenshot({
      type: "jpeg",
      quality: 86,
      animations: "disabled",
    }) });
    captures.push(name);
  }
  // The sample shop is closed on Tuesdays; keep captures rerunnable on any day.
  const bookingDay = new Date(Date.now() + 2 * 86400000 + 9 * 3600000);
  if (bookingDay.getUTCDay() === 2) bookingDay.setUTCDate(bookingDay.getUTCDate() + 1);
  const bookingDate = bookingDay.toISOString().slice(0, 10);
  await open("landing", /お店のことを話す/);
  await capture("01-start.jpg");
  await open("onboarding", "AIとお店をつくる");
  await capture("02-start-guide.jpg", ".interview");
  await page.getByRole("button", {name:"はじめる",exact:true}).click();
  await page
    .getByRole("textbox", { name: "AIに伝えたいこと" })
    .fill(
      "ネイルサロンです。",
    );
  await page.getByRole("button", {name:"送信",exact:true}).click();
  await page.getByRole("log",{name:"AIとのチャット",exact:true}).getByText(/ほしい機能を次から選んでください。/).waitFor();
  await capture("02-interview.jpg", ".interview");
  await open("staff", "スタッフ・勤務", "運営/スタッフ・勤務");
  await capture("03-edit.jpg", ".panel:has(.editor)");
  await capture("04-settings.jpg", ".panel:has(.editor)");
  await open("rules", "予約ルール", "運営/お店の基本情報");
  await capture("03-rules.jpg", ".live-settings-rules");
  await open("plan-review", "下記の画面でいいですか？");
  await capture("04-plan.jpg", ".request-review");
  await open("provisional-page", "自分のための、ひとときを。");
  await capture("05-provisional-page.jpg");
  await open("provisional", "現在のお店の設定");
  await capture("05-provisional.jpg", ".publication-status");
  await open("production-preview", "画面の確認・本番公開");
  await capture("06-publish.jpg", ".publication-preview");
  await page.getByRole("button",{name:"修正依頼する",exact:true}).click();
  await capture("06-correction-choice.jpg", ".publication-request-dialog");
  await page.getByRole("button",{name:"プレビューに戻る",exact:true}).click();
  await open("registration", "会員情報を登録する", "お客様の会員登録");
  await page.getByRole("textbox", {name:"お名前",exact:true}).fill("山田 花子");
  await page.getByRole("textbox", {name:"生年月日",exact:true}).fill("1995/02/28");
  await page.getByLabel("性別", {exact:true}).selectOption("not_specified");
  await capture("07-registration.jpg", ".customer-registration");
  await open("anonymous", "メニュー", "お客様の会員登録");
  await capture("07-login-entry.jpg");
  await open("customer", "自分のための、ひとときを。");
  assert.equal(await page.getByRole("heading", { name: "お店からのお便り", exact: true }).count(), 0);
  await page.getByLabel("ご希望の日付（日本時間）").fill(bookingDate);
  await page.getByRole("button", { name: "10:00", exact: true }).click();
  await page.getByLabel("お店へのメッセージ（任意）").fill("落ち着いたピンクを希望しています。");
  await capture("07-reservation.jpg", ".reservation-layout");
  await page.getByRole("button", { name: "この内容で予約する →" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "ご予約を承りました" })
    .waitFor();
  await capture("07-reservation-complete.jpg", ".reservation-layout .wide");
  await open("my-page", "あなたのご予約");
  assert.equal(await page.locator(".public-nav button").first().textContent(), "マイページ");
  await page.getByRole("heading", { name: "お店からのお便り", exact: true }).waitFor();
  await page.getByText("予約確定", { exact: true }).waitFor();
  await capture("08-mypage.jpg");
  await capture("08-mypage-booking.jpg", ".public-shop .panel:not(.recent-posts)");
  await open("reservations", /予約一覧/);
  await page.getByRole("heading", { name: /山田 花子 様/ }).waitFor();
  await capture("09-bookings.jpg");
  await open("contact", "お問い合わせ", "お客様の予約");
  await capture("10-contact-form.jpg", ".contact-form");
  await open("inquiries", "お問い合わせ");
  await page
    .getByRole("textbox", { name: "返信内容" })
    .fill(
      "もちろんです。当日、お好みやお仕事に合わせて一緒にお色を選びましょう。ご来店をお待ちしております。",
    );
  await capture("10-inquiries.jpg");
  await open("team", "家族・スタッフの招待");
  await page
    .getByLabel("招待する Google アカウントのメールアドレス")
    .fill("new-staff@example.com");
  await capture("11-team.jpg");
  await open("changes", "現在のお店の設定");
  await page.getByRole("button",{name:"修正",exact:true}).click();
  await page.getByRole("button", {name:"はじめる",exact:true}).click();
  await page
    .getByRole("textbox", { name: "AIに伝えたいこと" })
    .fill(
      "水曜日も定休日にして、90分8,500円の「ご褒美ケアコース」を追加してください。",
    );
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await page.getByRole("button", {name:"変更案を確認する",exact:true}).last().click();
  await page
    .getByRole("heading", { name: "このように変更してよいですか？" })
    .waitFor();
  await capture("12-changes.jpg", ".request-review");
  await open("shop-specification", "現在のお店の設定");
  await page.getByRole("heading", { name: "変更履歴", exact: true }).waitFor();
  assert.equal(await page.locator(".shop-build-layout > :first-child").getAttribute("aria-label"), "お店の変更履歴");
  assert.equal(await page.getByRole("heading", { name: "データとファイル", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "項目ごとに入力・修正", exact: true }).count(), 0);
  await capture("13-data.jpg", ".shop-history");
  await capture("13-storage.jpg", ".data-overview");
  await capture("21-ai-options.jpg", ".shop-consultation");
  await page.getByRole("button",{name:"修正",exact:true}).click();
  await page.getByRole("button",{name:"はじめる",exact:true}).click();
  await page.evaluate(()=>{window.SpeechRecognition=class {
    start(){this.onstart?.();this.onresult?.({results:[{isFinal:false,0:{transcript:"水曜日も定休日に変更したいです。"}}]});}
    stop(){}abort(){}
  };});
  await page.getByRole("button",{name:"音声入力",exact:true}).click();
  await capture("24-voice.jpg", ".dictation-dialog");
  await page.getByRole("dialog",{name:"音声入力",exact:true}).getByRole("button",{name:"下書きに戻る",exact:true}).click();
  await page.getByRole("button", {name:"新ページ作成",exact:true}).click();
  await page.getByRole("button", {name:"はじめる",exact:true}).click();
  await page.getByLabel("AIに伝えたいこと", {exact:true}).fill("初めてのお客様向けのFAQページを追加したいです。メニューには「よくある質問」と表示してください。");
  await page.getByRole("button", {name:"送信",exact:true}).click();
  await page.getByRole("button", {name:"変更案を確認する",exact:true}).last().click();
  await page.getByRole("heading", {name:"このページを追加してよいですか？",exact:true}).waitFor();
  await capture("21-new-page.jpg", ".new-page-review");
  await open("settings", "予約ページのアドレス");
  await capture("14-domain.jpg");
  await open("sync-error", /予約一覧/);
  await page.getByRole("button", { name: "再送する", exact: true }).waitFor();
  await capture("15-retry.jpg");
  await open("blog-editor", "お店のお便り");
  await page.getByRole("button", { name: /秋色ネイルで/ }).click();
  await page.locator('.post-writing-help summary').click();
  assert.equal(await page.getByText("Google ドライブのメモのリンク",{exact:true}).count(),0);
  await page.getByLabel("元になるメモ",{exact:true}).waitFor();
  await page.locator('.post-writing-help summary').click();
  await capture("16-blog-edit.jpg", ".post-editor");
  await page
    .getByRole("button", { name: "プレビュー", exact: true })
    .click();
  await page.locator(".post-preview").waitFor();
  await capture("17-blog-preview.jpg", ".post-preview");
  await open("blog-archive", "ブログ");
  await page.locator(".post-archive-card").first().waitFor();
  await capture("18-blog-archive.jpg", ".post-archive");
  await open("blog-article", "秋色ネイルで、季節を指先に。");
  await capture("19-blog-article.jpg", ".article-page");
  await open("blog-editor", "お店のお便り");
  await page.getByRole("button", { name: /秋色ネイルで/ }).click();
  await page
    .getByLabel("タイトル", { exact: true })
    .fill("秋色ネイルで、季節を指先に。（お手入れのご案内を追加）");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "保存して本番に反映しました" })
    .waitFor();
  await capture("20-blog-update.jpg", ".post-editor");
  const sampleImage = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#dfcbd0"; ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = "#73555d"; ctx.font = "32px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Sample image", 320, 240);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  const file = { name: "施術の記録.png", mimeType: "image/png", buffer: sampleImage };
  await open("editor", "メニュー・料金", "運営/メニュー画像");
  await page.getByLabel("メニュー画像（任意）").first().setInputFiles(file);
  await page.getByRole("button", { name: "保存", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".menu-image-editor input").disabled);
  await page.locator(".menu-image-editor img").first().waitFor();
  await capture("25-menu-images.jpg", ".menu-edit-block");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "保存して本番に反映しました" }).waitFor();
  await open("reservation", "自分のための、ひとときを。", "運営/メニュー画像");
  await page.locator(".menu-image img").first().waitFor();
  await capture("25-menu-public.jpg", ".reservation-layout");
  await open("list", /^お客様一覧/, "運営/お客様");
  await page.getByRole("button", { name: "山田 花子", exact: true }).waitFor();
  await page.getByLabel("集計期間").selectOption("month");
  await page.getByRole("button", { name: "山田 花子", exact: true }).waitFor();
  await page.getByLabel("氏名・メールで検索").fill("山田");
  await capture("26-customers.jpg", ".customers");
  await open("detail", "山田 花子", "運営/お客様");
  await page.getByLabel("お客様メモ", { exact: true }).fill("落ち着いたピンクがお好み。次回は短めに整えます。");
  await page.getByLabel("画像・ファイルを添付").setInputFiles(file);
  await page.getByLabel("ファイル名（1）", { exact: true }).fill("ピンクの仕上がり.png");
  await capture("27-customer-notes.jpg", ".customer-note-composer");
  await page.getByRole("button", { name: "メモを投稿", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "メモを投稿しました" }).waitFor();
  await page.getByRole("checkbox", { name: "予約", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "お問い合わせ", exact: true }).uncheck();
  await page.locator(".customer-note-card img").first().waitFor();
  await capture("27-customer-timeline.jpg", ".customer-history-filter");
  await open("images", /様の画像一覧/, "運営/お客様");
  await page.locator(".customer-image-thumb img").first().waitFor();
  await page.getByRole("button", { name: /のファイル名を変更$/ }).first().click();
  await page.getByLabel("ファイル名", { exact: true }).fill("ショートボブ（前回）.png");
  await page.getByRole("button", { name: "名前を保存", exact: true }).click();
  await page.getByRole("button", { name: "ショートボブ（前回）.png を拡大表示", exact: true }).waitFor();
  await capture("28-customer-images.jpg", ".customer-image-gallery");
  await page.getByRole("button", { name: "ショートボブ（前回）.png を拡大表示", exact: true }).click();
  await page.locator(".customer-image-dialog img").waitFor();
  await capture("28-customer-image-zoom.jpg");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await open("data", "データ管理", "運営/データ管理");
  await page.getByRole("button", { name: "編集", exact: true }).first().waitFor();
  await capture("29-data-management.jpg", ".data-management");
  await page.getByRole("button", { name: "編集", exact: true }).first().click();
  await page.getByRole("heading", { name: "1件目を編集", exact: true }).waitFor();
  await capture("29-data-edit.jpg", ".data-management");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "データを保存しました" }).waitFor();
  await open("library", "画像管理", "運営/画像管理");
  await page.locator(".image-library-grid figure").nth(1).waitFor();
  await page.locator(".image-library-grid img").first().waitFor();
  await capture("30-image-library.jpg", ".image-library");
  await page.getByRole("button", { name: "AIで生成", exact: true }).click();
  const generationMethods = page.getByRole("group", { name: "画像生成の依頼方法" });
  await generationMethods.getByRole("button", { name: /音声で依頼/ }).click();
  await capture("34-image-generation-voice.jpg", ".image-generation");
  await generationMethods.getByRole("button", { name: /文章で依頼/ }).click();
  await page.getByLabel("画像の名前", { exact: true }).fill("季節の花の紹介画像.png");
  await page.getByLabel("生成したい画像", { exact: true }).fill("明るい窓辺に季節の花を飾った、お店の紹介ページ向けの写真。やわらかな自然光で落ち着いた雰囲気にしてください。");
  await page.getByRole("button", { name: "参考画像を選ぶ", exact: true }).click();
  await page.getByRole("dialog", { name: "依頼の画像を選ぶ", exact: true }).getByRole("button", { name: "お店の紹介.pngを選択", exact: true }).click();
  await page.getByRole("button", { name: "選択した画像を使う", exact: true }).click();
  await page.getByLabel("画像の比率").selectOption("16:9");
  await capture("31-image-generation.jpg", ".image-generation");
  await page.getByRole("button", { name: "生成して結果を確認", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "AIで生成した画像を画像管理に保存しました" }).waitFor();
  await page.locator(".image-generation-result .library-image").scrollIntoViewIfNeeded();
  await page.locator(".image-generation-result img").waitFor();
  await capture("35-image-generation-result.jpg", ".image-generation-result");
  await page.getByRole("region", { name: "生成した画像を確認", exact: true }).getByRole("button", { name: "これでOK", exact: true }).click();
  await page.locator("aside nav").getByRole("button", { name: /AIとお店をつくる$/ }).click();
  await page.getByRole("button",{name:"修正",exact:true}).click();
  await page.getByRole("button", {name:"はじめる",exact:true}).click();
  await page.getByLabel("AIに伝えたいこと").fill("選んだ画像をよくある質問のページに使ってください。");
  await page.getByRole("button", { name: "画像を添付", exact: true }).click();
  const requestPicker = page.getByRole("dialog", { name: "依頼の画像を選ぶ", exact: true });
  await requestPicker.getByRole("button", { name: "お店の紹介.pngを選択", exact: true }).click();
  await requestPicker.locator("img").first().waitFor();
  await capture("32-page-image.jpg");
  assert.deepEqual(errors, []);
  // Save after all interactions; writing public assets triggers a Vite reload.
  for (const capture of screenshotBytes) await writeFile(resolve(output, capture.name), capture.bytes);
  console.log(
    JSON.stringify(
      { screenshots: captures.length, output, files: captures },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
