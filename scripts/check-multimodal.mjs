import {chromium} from "playwright";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import assert from "node:assert/strict";
const origin = process.env.STORYBOOK_URL || process.argv[2] || "http://localhost:6005";
const output = resolve("public/manual");
await mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true, ...((process.env.CHROMIUM || process.argv[3]) ? {executablePath: process.env.CHROMIUM || process.argv[3]} : {}), args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 900}, locale: "ja-JP"});
  await page.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream=await get(constraints);window.__voiceTracks=stream.getTracks();return stream;
    };
  });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", req => {if (new URL(req.url()).pathname.startsWith("/api/")) errors.push(`Live API request in Storybook: ${req.url()}`);});
  const index = await (await fetch(`${origin}/index.json`)).json();
  async function open(suffix, heading) {
    const entry = Object.values(index.entries).find(e => e.id.endsWith(`--${suffix}`)); assert.ok(entry, suffix);
    await page.goto(`${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story`);
    await page.getByRole("heading", {name: heading, exact: true}).waitFor();
  }
  async function capture(name, selector) {
    if (selector) await page.locator(selector).first().evaluate(el => el.scrollIntoView({block: "start"}));
    await page.screenshot({path: resolve(output, name), type: "jpeg", quality: 86, animations: "disabled"});
  }
  let audioFrames = 0;
  let voiceResult = null;
  await page.context().routeWebSocket(/\/api\/shops\/[^/]+\/live(?:\?.*)?$/, socket => {
    let replied = false;
    socket.send(JSON.stringify({type: "state", state: {fields: {}, version: 1}}));
    socket.send(JSON.stringify({type: "ready"}));
    socket.onMessage(raw => {
      const input = JSON.parse(String(raw));
      if (input.type === "context") return;
      assert.equal(input.type, "audio"); assert.ok(input.data); audioFrames++;
      if (!replied && voiceResult) { replied = true; socket.send(JSON.stringify(voiceResult)); }
    });
  });
  await open("shop-specification", "現在の仕様");
  await page.getByRole("region", {name: "お店の変更履歴"}).waitFor();
  assert.equal(await page.locator("aside").getByRole("button", {name: /お店の仕組み図/}).count(), 0);
  assert.equal(await page.getByRole("button", {name: "リアルタイム書き起こし", exact: true}).count(), 0);
  assert.equal(await page.getByLabel("質問・変更したいこと", {exact:true}).count(), 0);
  await capture("21-system.jpg", ".shop-build-layout");
  await page.getByRole("button", {name: /文章で依頼/}).click();
  await page.getByLabel("質問・変更したいこと", {exact:true}).fill("指名なしのとき、どうやって空きを判断する？");
  await page.getByRole("button", {name: "依頼して結果を確認", exact:true}).click();
  const review = page.getByRole("region", {name: "依頼の結果を確認"});
  await review.waitFor();
  await review.getByText("お客様が指名・指名なしを選べます。", {exact:false}).waitFor();
  assert.equal(await page.getByRole("link", {name:"プレビュー ↗",exact:true}).count(), 0);
  await review.getByRole("button", {name:"さらに依頼する",exact:true}).click();
  assert.equal(await page.getByLabel("質問・変更したいこと",{exact:true}).count(), 0);
  await page.getByRole("button", {name:/音声で依頼/}).click();
  await page.getByRole("button", {name:"🎙 AI と音声で話す",exact:true}).click();
  await page.getByRole("button", {name:"会話を止める",exact:true}).waitFor();
  await page.waitForFunction(() => window.__voiceTracks?.some(track => track.readyState === "live"));
  await page.waitForTimeout(200);
  assert.ok(audioFrames > 0, "microphone streams PCM chunks");
  await page.getByRole("button", {name:"会話を止める",exact:true}).click();
  assert.ok(await page.evaluate(() => window.__voiceTracks.every(track => track.readyState === "ended")), "stopping releases microphone");
  voiceResult = {type:"answer",text:"これまでの履歴は？",answer:"予約ページを公開した履歴があります。"};
  await page.getByRole("button", {name:"🎙 AI と音声で話す",exact:true}).click();
  await review.getByText("予約ページを公開した履歴があります。",{exact:true}).waitFor();
  assert.ok(await page.evaluate(() => window.__voiceTracks.every(track => track.readyState === "ended")), "result confirmation releases microphone");
  await review.getByRole("button", {name:"これでOK",exact:true}).click();
  await page.getByText("回答を確認しました。",{exact:true}).waitFor();
  await page.getByRole("button", {name:"新しい依頼をする",exact:true}).click();
  await page.getByRole("button", {name:/文章で依頼/}).click();
  await page.getByLabel("質問・変更したいこと",{exact:true}).fill("水曜日もお休みに変更したい");
  await page.getByRole("button", {name:"依頼して結果を確認",exact:true}).click();
  await review.getByText("営業時間・休業日を更新",{exact:false}).waitFor();
  await capture("24-voice.jpg", ".request-review");
  await capture("12-changes.jpg", ".request-review");
  await review.getByRole("button", {name:"さらに依頼する",exact:true}).click();
  await page.getByRole("button", {name:/音声で依頼/}).click();
  voiceResult = {type:"plan",text:"水曜日も定休日に変更し、新しいコースを追加したい"};
  await page.getByRole("button", {name:"🎙 AI と音声で話す",exact:true}).click();
  await review.getByRole("button", {name:"これでOK",exact:true}).waitFor();
  assert.equal(await page.getByRole("link", {name:"プレビュー ↗",exact:true}).count(), 0);
  await review.getByRole("button", {name:"これでOK",exact:true}).click();
  await page.getByRole("link", {name:"プレビュー ↗",exact:true}).waitFor();
  await page.getByRole("button", {name:"お店のページを公開 →",exact:true}).click();
  await page.getByRole("region", {name:"お店の変更履歴"}).getByText("営業時間・休業日を更新",{exact:false}).waitFor();

  await open("onboarding", "どんなお店をつくりますか？");
  assert.equal(await page.getByLabel("質問・変更したいこと", {exact:true}).count(), 0);
  await page.getByRole("button", {name:/文章で依頼/}).click();
  await page.getByLabel("質問・変更したいこと", {exact:true}).fill("夫婦で営むネイルサロンを作りたい。メニューと営業時間を設定して。");
  await capture("02-interview.jpg", ".panel.interview");
  await page.getByRole("button", {name:"依頼して結果を確認",exact:true}).click();
  await review.waitFor();
  await capture("04-plan.jpg", ".request-review");
  await review.getByRole("button", {name:"さらに依頼する",exact:true}).click();
  assert.equal(await page.getByLabel("質問・変更したいこと", {exact:true}).count(), 0);
  await page.getByRole("button", {name:/文章で依頼/}).click();
  await page.getByLabel("質問・変更したいこと", {exact:true}).fill("営業時間は10時から18時にして");
  await page.getByRole("button", {name:"依頼して結果を確認",exact:true}).click();
  await review.getByRole("button", {name:"これでOK",exact:true}).click();
  await page.getByRole("link", {name:"プレビュー ↗",exact:true}).waitFor();
  // Capture real rendered pixels, draw a circle, resolve ambiguity and create an unapproved plan.
  for (const story of ["pen-preview", "pen-live"]) {
    await open(story, "自分のための、ひとときを。");
    await page.getByRole("button", {name: "✎ この画面にペンで変更を依頼", exact: true}).click();
    const canvas = page.getByLabel("変更したい箇所を囲む画面");
    await canvas.waitFor();
    await page.waitForFunction(() => document.querySelector("canvas")?.width > 300);
    assert.equal(await page.getByRole("button", {name: "Gemini に印の対象を確認してもらう"}).isEnabled(), false);
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
    await page.getByRole("button", {name: "Gemini に印の対象を確認してもらう"}).click();
    await page.getByLabel("変更する対象を確認").waitFor();
    assert.equal(await page.getByRole("button", {name: "この対象の差分プランを作る"}).isEnabled(), false);
    await page.getByLabel("変更する対象を確認").selectOption("name");
    await page.getByRole("button", {name: "この対象の差分プランを作る"}).click();
    await page.getByRole("heading", {name: "差分プランを作成しました"}).waitFor();
    await page.getByText("まだ公開内容は変更されていません。", {exact: true}).waitFor();
    await capture("23-pen-plan.jpg", ".visual-request .notice:last-of-type");
  }
  await page.setViewportSize({width: 390, height: 844});
  await open("shop-specification", "現在の仕様");
  await page.getByRole("region", {name:"お店の変更履歴"}).waitFor();
  await page.screenshot({path:resolve("tmp/spec-mobile.png"),fullPage:true});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile layout should not overflow");
  assert.deepEqual(errors, []);
  console.log("Verified current specification/history, text and voice choices, result confirmation/revision/approval, publication, microphone cleanup, pen editing and mobile layout (Storybook fixtures).");
} finally {await browser.close();}
