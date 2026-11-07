import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const origin = process.env.STORYBOOK_URL || "http://localhost:6005";
const entries = Object.values(
  (await (await fetch(`${origin}/index.json`)).json()).entries,
);
const entry = entries.find((entry) => entry.id.endsWith("--inquiries"));
assert.ok(entry);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--no-sandbox"],
});
await mkdir("tmp", { recursive: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        errors.push(`Unexpected API: ${request.url()}`);
    });
    await page.goto(
      `${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story`,
    );
    const list = page.getByRole("region", {
      name: "お問い合わせ一覧",
      exact: true,
    });
    await list.waitFor();
    console.log(`${width}px: list ready`);
    const cards = list.locator(".inquiry-list-item");
    assert.equal(await cards.count(), 4);
    assert.equal(await list.getByRole("checkbox").isChecked(), true);
    assert.equal(await cards.filter({ hasText: "返信済み" }).count(), 2);
    await list.getByRole("checkbox").uncheck();
    assert.equal(await cards.count(), 2);
    await list.getByRole("checkbox").check();
    assert.equal(await cards.count(), 4);
    await list
      .getByLabel("返信状況", { exact: true })
      .selectOption("unreplied");
    assert.equal(await cards.count(), 2);
    assert.equal(await cards.filter({ hasText: "対応済み" }).count(), 1);
    await list.getByLabel("返信状況", { exact: true }).selectOption("replied");
    assert.equal(await cards.count(), 2);
    await list.getByRole("searchbox").fill("駐車場");
    assert.equal(await cards.count(), 1);
    await list.getByRole("searchbox").fill("ご希望の写真");
    assert.equal(await cards.count(), 1);
    await list.getByRole("searchbox").fill("GUEST@EXAMPLE.COM");
    assert.equal(await cards.count(), 2);
    await list.getByRole("searchbox").fill("");
    await list.getByLabel("返信状況", { exact: true }).selectOption("all");
    const day = new Date(Date.now() - 86400000 + 9 * 3600000)
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", "/");
    await list.getByLabel("受付日（開始）", { exact: true }).fill(day);
    await list.getByLabel("受付日（開始）", { exact: true }).blur();
    await list.getByLabel("受付日（終了）", { exact: true }).fill(day);
    await list.getByLabel("受付日（終了）", { exact: true }).blur();
    assert.equal(await cards.count(), 1);
    assert.ok((await cards.first().textContent()).includes("アートの相談"));
    await list.getByLabel("受付日（開始）", { exact: true }).fill("");
    await list.getByLabel("受付日（終了）", { exact: true }).fill("");
    await list.getByRole("checkbox").uncheck();
    assert.equal(await cards.count(), 2);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `tmp/inquiries-list-${width}.png`,
      fullPage: true,
    });
    console.log(`${width}px: filters verified`);
    await cards.filter({ hasText: "アートの相談" }).click();
    const inquiry = page.locator('[data-inquiry-id="guest-inquiry"]');
    await inquiry.waitFor();
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("data-inquiry-id") ===
        "guest-inquiry",
    );
    assert.ok(
      (await page.locator(".customer-basic-info").textContent()).includes(
        "1992/06/15",
      ),
    );
    assert.ok(
      (await page.locator(".customer-basic-info").textContent()).includes(
        "女性",
      ),
    );
    const bookings = page.getByRole("region", {
      name: "予約内容",
      exact: true,
    });
    await bookings.waitFor();
    assert.ok((await bookings.textContent()).includes("担当："));
    assert.ok((await bookings.textContent()).includes("¥"));
    const text = `ご来店時にお色をご相談しましょう。${width}`;
    await inquiry
      .getByRole("textbox", { name: "返信内容", exact: true })
      .fill(text);
    await inquiry
      .getByRole("button", { name: "メールで返信", exact: true })
      .click();
    await inquiry
      .getByRole("status")
      .filter({ hasText: "返信を受け付けました" })
      .waitFor();
    assert.equal(
      await inquiry
        .getByRole("combobox", { name: "対応状況", exact: true })
        .inputValue(),
      "in_progress",
    );
    assert.ok(
      (await inquiry.locator(".inquiry-history").textContent()).includes(text),
    );
    assert.equal(await inquiry.getByRole("textbox", { name: "返信内容", exact: true }).inputValue(), "");
    console.log(`${width}px: reply saved`);
    await page
      .getByRole("button", { name: "← お問い合わせ一覧へ", exact: true })
      .click();
    await list.waitFor();
    assert.equal(
      await cards
        .filter({ hasText: "アートの相談" })
        .filter({ hasText: "返信済み" })
        .count(),
      1,
    );
    await cards.filter({ hasText: "アートの相談" }).click();
    await inquiry.waitFor();
    assert.ok(
      (await inquiry.locator(".inquiry-history").textContent()).includes(text),
    );
    await inquiry
      .getByRole("combobox", { name: "対応状況", exact: true })
      .selectOption("completed");
    await inquiry
      .getByRole("status")
      .filter({ hasText: "対応状況を保存" })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `tmp/inquiry-customer-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "← お問い合わせ一覧へ", exact: true })
      .click();
    await list.waitFor();
    assert.equal(await cards.count(), 4);
    assert.equal(await list.getByRole("checkbox").isChecked(), true);
    await list.getByRole("checkbox").uncheck();
    assert.equal(await cards.count(), 1);
    await list.getByRole("checkbox").check();
    assert.equal(await cards.count(), 4);
    await cards.filter({ hasText: "アートの相談" }).click();
    await inquiry.waitFor();
    assert.equal(await inquiry.getByRole("combobox", { name: "対応状況", exact: true }).inputValue(), "completed");
    await inquiry.getByRole("combobox", { name: "対応状況", exact: true }).selectOption("in_progress");
    await inquiry
      .getByRole("status")
      .filter({ hasText: "対応状況を保存" })
      .waitFor();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `${width}px: filters, reply badges, inquiry deep link, basic information/bookings, saved reply and independent status verified (fixtures).`,
    );
  }
} finally {
  await browser.close();
}
