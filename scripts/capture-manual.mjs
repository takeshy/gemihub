import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

// Run against Storybook only: all records are isolated sample data.
const origin = process.env.STORYBOOK_URL || "http://localhost:6005";
const output = resolve("public/manual");
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
    await page.screenshot({
      path: resolve(output, name),
      type: "jpeg",
      quality: 86,
      animations: "disabled",
    });
    captures.push(name);
  }
  // The sample shop is closed on Tuesdays; keep captures rerunnable on any day.
  const bookingDay = new Date(Date.now() + 2 * 86400000 + 9 * 3600000);
  if (bookingDay.getUTCDay() === 2) bookingDay.setUTCDate(bookingDay.getUTCDate() + 1);
  const bookingDate = bookingDay.toISOString().slice(0, 10);
  await open("landing", /お店のことを話す/);
  await capture("01-start.jpg");
  await open("onboarding", "どんなお店をつくりますか？");
  await page.getByRole("button", {name:/文章で依頼/}).click();
  await page
    .getByRole("textbox", { name: "質問・変更したいこと" })
    .fill(
      "夫婦で営むネイルサロン「凪」です。\nシンプルネイルは60分5,500円、季節のデザインは90分7,800円です。\nスタッフはあおい・はるの二人。営業時間は10〜18時、火曜定休。\n予約は30日前から、開始1時間前まで受け付けたいです。",
    );
  await capture("02-interview.jpg", ".interview");
  await page
    .getByRole("button", { name: "項目ごとに入力・修正", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "お店の情報", exact: true })
    .waitFor();
  await capture("03-edit.jpg", ".panel:has(.editor)");
  await capture("03-rules.jpg", ".editor h3:last-of-type");
  await open("plan-review", "依頼の結果を確認");
  await capture("04-plan.jpg", ".request-review");
  await open("preview", "自分のための、ひとときを。");
  await capture("05-preview.jpg");
  await page.getByLabel("ご希望の日付（日本時間）").fill(bookingDate);
  await page.getByRole("button", { name: "10:00", exact: true }).click();
  await page.getByRole("button", { name: "プレビューで予約を試す →" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "プレビューで予約を確認しました" })
    .waitFor();
  await capture("05-preview-booking.jpg", ".reservation-layout .wide");
  await open("approved", "こんな予約システムをつくります。");
  await capture("06-publish.jpg", ".panel.plan");
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
  await open("changes", "現在の仕様");
  await page.getByRole("button", {name:/文章で依頼/}).click();
  await page
    .getByRole("textbox", { name: "質問・変更したいこと" })
    .fill(
      "水曜日も定休日にして、90分8,500円の「ご褒美ケアコース」を追加してください。",
    );
  await page.getByRole("button", { name: "依頼して結果を確認", exact: true }).click();
  await page
    .getByRole("heading", { name: "依頼の結果を確認" })
    .waitFor();
  await capture("12-changes.jpg", ".request-review");
  await open("shop-specification", "現在の仕様");
  await page.getByRole("heading", { name: "変更履歴", exact: true }).waitFor();
  assert.equal(await page.locator(".shop-build-layout > :first-child").getAttribute("aria-label"), "お店の変更履歴");
  assert.equal(await page.getByRole("heading", { name: "データとファイル", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "項目ごとに入力・修正", exact: true }).count(), 0);
  await capture("13-data.jpg", ".shop-history");
  await capture("13-storage.jpg", ".data-overview");
  await open("settings", "予約ページのアドレス");
  await capture("14-domain.jpg");
  await open("sync-error", /予約一覧/);
  await page.getByRole("button", { name: "再送する", exact: true }).waitFor();
  await capture("15-retry.jpg");
  await open("blog-editor", "お店のお便り");
  await page.getByRole("button", { name: /秋色ネイルで/ }).click();
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
  await open("data", "データ管理", "運営");
  await page.getByRole("button", { name: "編集", exact: true }).first().waitFor();
  await capture("29-data-management.jpg", ".data-management");
  await page.getByRole("button", { name: "編集", exact: true }).first().click();
  await page.getByRole("heading", { name: "1件目を編集", exact: true }).waitFor();
  await capture("29-data-edit.jpg", ".data-management");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "データを保存しました" }).waitFor();
  assert.deepEqual(errors, []);
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
