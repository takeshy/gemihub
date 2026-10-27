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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      errors.push(`Unexpected live API request: ${request.url()}`);
  });
  async function open(suffix, ready) {
    const entry = entries.find((entry) => entry.id.endsWith(`--${suffix}`));
    assert.ok(entry, `Missing story: ${suffix}`);
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
    await page.screenshot({
      path: resolve(output, name),
      type: "jpeg",
      quality: 86,
      animations: "disabled",
    });
    captures.push(name);
  }
  await open("landing", /お店のことを話す/);
  await capture("01-start.jpg");
  await open("onboarding", "まずは、お店のお話から。");
  await page
    .getByRole("textbox", { name: "お店のことや変更したいこと" })
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
  await open("plan-review", "こんな予約システムをつくります。");
  await capture("04-plan.jpg", ".panel.plan");
  await open("preview", "自分のための、ひとときを。");
  await capture("05-preview.jpg");
  const previewDate = new Date(Date.now() + 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  await page.getByLabel("ご希望の日付（日本時間）").fill(previewDate);
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
  const tomorrow = new Date(Date.now() + 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  await page.getByLabel("ご希望の日付（日本時間）").fill(tomorrow);
  await page.getByRole("button", { name: "10:00", exact: true }).click();
  await capture("07-reservation.jpg", ".reservation-layout");
  await page.getByRole("button", { name: "この内容で予約する →" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "ご予約を承りました" })
    .waitFor();
  await capture("07-reservation-complete.jpg", ".reservation-layout .wide");
  await open("my-page", "あなたのご予約");
  await page.getByText("予約確定", { exact: true }).waitFor();
  await capture("08-mypage.jpg");
  await open("reservations", "今日も、お客様を迎える準備を。");
  await page.getByRole("heading", { name: /山田 花子 様/ }).waitFor();
  await capture("09-bookings.jpg");
  await open("inquiries", "お客様からのお便り。");
  await page
    .getByRole("textbox", { name: "返信内容" })
    .fill(
      "もちろんです。当日、お好みやお仕事に合わせて一緒にお色を選びましょう。ご来店をお待ちしております。",
    );
  await capture("10-inquiries.jpg");
  await open("team", "お店を、一緒に。");
  await page
    .getByLabel("招待する Google アカウントのメールアドレス")
    .fill("new-staff@example.com");
  await capture("11-team.jpg");
  await open("changes", "お店の「こうしたい」を、かたちに。");
  await page
    .getByRole("textbox", { name: "お店のことや変更したいこと" })
    .fill(
      "水曜日も定休日にして、90分8,500円の「ご褒美ケアコース」を追加してください。",
    );
  await page.getByRole("button", { name: "プランを見直す →" }).click();
  await page
    .getByRole("heading", { name: "こんな予約システムをつくります。" })
    .waitFor();
  await capture("12-changes.jpg", ".panel.plan");
  await open("data", "お店の中身は、いつでも手元に。");
  await page.locator(".document").first().waitFor();
  await capture("13-data.jpg");
  await open("settings", "お店の入り口を整える。");
  await capture("14-domain.jpg");
  await open("sync-error", "今日も、お客様を迎える準備を。");
  await page.getByRole("button", { name: "再送する", exact: true }).waitFor();
  await capture("15-retry.jpg");
  await open("blog-editor", "お店の想いを、お客様へ。");
  await page.getByRole("button", { name: /秋色ネイルで/ }).click();
  await capture("16-blog-edit.jpg", ".post-editor");
  await page
    .getByRole("button", { name: "公開前のプレビュー", exact: true })
    .click();
  await page.locator(".post-preview").waitFor();
  await capture("17-blog-preview.jpg", ".post-preview");
  await open("blog-archive", "ブログ");
  await page.locator(".post-archive-card").first().waitFor();
  await capture("18-blog-archive.jpg", ".post-archive");
  await open("blog-article", "秋色ネイルで、季節を指先に。");
  await capture("19-blog-article.jpg", ".article-page");
  await open("blog-editor", "お店の想いを、お客様へ。");
  await page.getByRole("button", { name: /秋色ネイルで/ }).click();
  await page
    .getByLabel("タイトル", { exact: true })
    .fill("秋色ネイルで、季節を指先に。（お手入れのご案内を追加）");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "下書きを保存しました" })
    .waitFor();
  await capture("20-blog-update.jpg", ".post-editor");
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
