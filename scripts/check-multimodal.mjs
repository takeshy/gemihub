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
  await page.context().routeWebSocket(/\/api\/shops\/[^/]+\/live$/, socket => {
    socket.send(JSON.stringify({type: "state", state: {fields: {changes: "（Live サンプル）店名を季節のアトリエに変更"}, version: 1}}));
    socket.send(JSON.stringify({type: "ready"}));
    socket.onMessage(raw => {const input = JSON.parse(String(raw)); assert.equal(input.type, "audio"); assert.ok(input.data); audioFrames++;});
  });
  await open("shop-system", "お店の仕組み図");
  await page.locator(".system-overview").waitFor();
  await capture("21-system.jpg", ".system-overview");
  await page.getByLabel("仕組み図について質問").fill("指名なしのとき、どうやって空きを判断する？");
  await page.getByRole("button", {name: "このお店の仕組みを聞く", exact: true}).click();
  await page.getByText("このお店は指名型です。", {exact: false}).waitFor();
  await page.getByRole("button", {name: "この内容から変更プランを相談する →"}).click();
  assert.equal(await page.getByLabel("お店のことや変更したいこと").inputValue(), "指名なしのとき、どうやって空きを判断する？");
  // Streaming microphone transport and incremental fields use an explicit Live fixture.
  await page.getByLabel("お店のことや変更したいこと").fill("最初のメモ");
  await page.getByRole("button", {name: "🎙 AI と音声で話す", exact: true}).click();
  await page.getByRole("button", {name: "会話を止める", exact: true}).waitFor({timeout:10000}).catch(async e=>{console.error(await page.locator(".voice-input").innerText());throw e;});
  await page.getByLabel("確認：変更したいこと").filter({visible: true}).waitFor();
  await page.waitForTimeout(350);
  assert.ok(audioFrames > 0, "microphone streams PCM chunks");
  await page.getByRole("button", {name: "会話を止める", exact: true}).click();
  assert.ok(await page.evaluate(() => window.__voiceTracks.every(track => track.readyState === "ended")), "stopping releases microphone");
  assert.equal(await page.getByLabel("お店のことや変更したいこと").inputValue(), "最初のメモ");
  assert.equal(await page.locator('input[type=file][accept*=audio]').count(), 0);
  await page.getByLabel("会話への返答").fill("サンプル：店名を季節のアトリエに変更");
  await page.getByRole("button", {name: "会話に送る", exact: true}).click();
  await page.getByText("（Storybook のサンプル）内容を確認しました。", {exact:false}).waitFor();
  assert.ok((await page.getByLabel("お店のことや変更したいこと").inputValue()).startsWith("最初のメモ\n"));
  await capture("24-voice.jpg", ".voice-input");
  await page.evaluate(()=>{
    window.SpeechRecognition=class {
      start(){window.__recognition=this;setTimeout(()=>this.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:"サンプルの書き起こし"}}]}),0);}
      abort(){window.__recognitionAborted=true;}
      stop(){this.abort();}
    };
  });
  await page.getByRole("button", {name:"リアルタイム書き起こし",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('textarea[aria-label="お店のことや変更したいこと"]').value.includes("サンプルの書き起こし"));
  await page.getByRole("button", {name:"会話を止める",exact:true}).click();
  assert.ok(await page.evaluate(()=>window.__recognitionAborted),"stopping releases recognition");
  await page.getByLabel("確認：変更したいこと").fill("画面で確認・修正した変更内容");
  await page.getByRole("button",{name:"この内容でプランを確認 →",exact:true}).click();
  await page.getByRole("button",{name:"このプランでつくる →",exact:true}).waitFor();

  await page.getByRole("button", {name: "🎙 AI と音声で話す", exact: true}).click();
  await page.getByRole("button", {name: "会話を止める", exact: true}).waitFor();
  await page.getByRole("button", {name: "◎ お店の仕組み図", exact: false}).click();
  await page.getByRole("heading", {name: "お店の仕組み図", exact: true}).waitFor();
  assert.ok(await page.evaluate(() => window.__voiceTracks.every(track => track.readyState === "ended")), "leaving input releases microphone");
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
  await open("shop-system", "お店の仕組み図");
  await page.locator(".system-overview").waitFor();
  await page.getByText("設定と保存先の詳しい説明", {exact: true}).click();
  await page.getByRole("heading", {name: "③ データの行き先"}).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile layout should not overflow");
  assert.deepEqual(errors, []);
  console.log("Verified diagram Q&A, voice/text composition, screenshot capture, pen strokes, ambiguous targets, draft plans and mobile layout (Storybook fixtures).");
} finally {await browser.close();}
