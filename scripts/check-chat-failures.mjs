import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";

const origin = process.env.STORYBOOK_URL || "http://localhost:6005";
const entries = Object.values((await (await fetch(`${origin}/index.json`)).json()).entries);
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox"] });
try {
  for (const width of [1280, 390]) {
    for (const input of ["text", "voice"]) {
      for (const failure of ["proposal", "question"]) {
        const story = entries.find(entry => entry.id.endsWith(`--${failure}-failure`));
        assert.ok(story);
        const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "ja-JP" });
        await context.addInitScript(() => {
          window.__recognitions = [];
          window.SpeechRecognition = class {
            start() { window.__recognitions.push(this); this.active = true; this.onstart?.(); }
            stop() { this.active = false; }
            abort() { this.active = false; }
          };
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`);
        await page.getByRole("button", { name: "はじめる", exact: true }).click();
        const composer = page.getByRole("textbox", { name: "AIに伝えたいこと", exact: true });
        const form = page.getByRole("form", { name: "メッセージの入力", exact: true });
        const log = page.getByRole("log", { name: "AIとのチャット", exact: true });
        const text = "水曜日もお休みに変更したいです。";
        if (input === "voice") {
          await form.getByRole("button", { name: "音声入力", exact: true }).click();
          await page.evaluate(text => {
            window.__recognitions.at(-1).onresult({ results: [{ isFinal: true, 0: { transcript: text + "以上。" } }] });
          }, text);
          await expect(page.getByRole("dialog", { name: "音声入力", exact: true })).toHaveCount(0);
        } else {
          await composer.fill(text);
          await form.getByRole("button", { name: "送信", exact: true }).click();
        }
        await expect(page.getByRole("alert").filter({ hasText: "操作できませんでした" })).toBeVisible();
        await expect(composer).toBeEnabled();
        if (failure === "proposal") {
          await expect(composer).toHaveValue("");
          await expect(log.locator(".chat-message-user")).toHaveCount(1);
          // Retrying the proposal must use the saved turn and preserve a new draft.
          await composer.fill("次に相談する内容の下書き");
          await log.getByRole("button", { name: "変更案を作る", exact: true }).click();
          await expect(log.getByRole("button", { name: "変更案を確認する", exact: true })).toBeVisible();
          await expect(composer).toHaveValue("次に相談する内容の下書き");
          await expect(log.locator(".chat-message-user")).toHaveCount(1);
        } else {
          await expect(composer).toHaveValue(text);
          await form.getByRole("button", { name: "送信", exact: true }).click();
          await expect(log.getByRole("button", { name: "変更案を確認する", exact: true })).toBeVisible();
          await expect(composer).toHaveValue("");
          await expect(log.locator(".chat-message-user")).toHaveCount(1);
        }
        await expect(log.getByText(text, { exact: true })).toHaveCount(1);
        assert.equal(await page.evaluate(() => window.__recognitions.every(rec => !rec.active)), true);
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`${width}px ${input} ${failure} failure: draft and retry behavior passed.`);
      }
    }
  }
} finally {
  await browser.close();
}
