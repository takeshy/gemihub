import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { requestLocale } from "../server/i18n.ts";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { getLocale, translate, tr } from "../shared/i18n.ts";
import { localizeShell } from "../shared/html.ts";
import { artifacts } from "../server/artifacts.ts";
import { sample } from "../server/domain.ts";
import { answeredFinalDetails, initialSetupDemoReply, openingQuestions } from "../server/request-intent.ts";
import { createDictation, type Recognition } from "../src/dictation.ts";

test("language contexts isolate concurrent requests and preserve interpolation values", async () => {
  const source = "{0}を更新";
  await Promise.all(["en", "ja"].map(locale => requestLocale.run(locale as "en" | "ja", async () => {
    await new Promise(resolve => setTimeout(resolve, locale === "en" ? 8 : 1));
    assert.equal(getLocale(), locale);
    assert.equal(tr(source, "{1} 日本語 $&"), locale === "en" ? "Updated {1} 日本語 $&" : "{1} 日本語 $&を更新");
  })));
  assert.equal(getLocale(), "ja");
  assert.equal(translate("en", "not a catalog key"), "not a catalog key");
});

test("English demo onboarding waits for the final answer and accepts English feature choices", () => requestLocale.run("en", () => {
  const messages: {role:string;text:string}[] = [{role:"assistant",text:openingQuestions["create-shop"]}];
  for (const [text, expected] of [["Moon Atelier", /logo/], ["No logo", /shop|industry|business/i], ["A nail salon", /Choose any additional features/], ["Booking and blog", /other pages/], ["No other pages", /Anything else/], ["Nothing else, please proceed", /put together screens/]] as const) {
    const result=initialSetupDemoReply(text,messages);
    assert.match(result.answer,expected);
    messages.push({role:"user",text},{role:"assistant",text:result.answer});
    assert.equal(result.ready, text === "Nothing else, please proceed");
  }
  assert.equal(answeredFinalDetails([{role:"assistant",text:"Anything else you'd like to add?"},{role:"user",text:"No"}]),true);
}));

test("English exports translate interface copy while preserving owner content and offline boundaries", () => requestLocale.run("en", () => {
  const config=structuredClone(sample); config.name="店名 <script>alert(1)</script>"; config.description="お店が入力した本文";
  const shell='<html lang="ja"><head><title>gemihub</title></head><body><div id="root"></div></body></html>';
  const output=artifacts(config,shell);
  assert.match(output["web/index.html"],/lang="en"/);
  assert.match(output["web/index.html"],/Book a visit/);
  assert.match(output["web/index.html"],/Bookings require JavaScript and data.js/);
  assert.match(output["web/index.html"],/&lt;script&gt;/);
  assert.ok(output["web/index.html"].includes(config.description));
  assert.match(output["schema.md"],/# Data schema v1/);
  assert.match(output["admin/system.svg"],/Shop system diagram/);
  assert.ok(!output["admin/index.html"].includes('./data.js'));
  assert.equal(JSON.parse(output["web/shop.json"]).name,config.name);
  assert.equal(localizeShell(localizeShell(shell)).match(/gemihub-language/g)?.length,1);
}));

test("API language precedence is request-local and language does not weaken authorization", async t => {
  process.env.DEMO_MODE="true";
  const store=new Store(":memory:"); const server=createApp(store);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN=origin;
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve())); await store.close();});
  const requests: {headers:Record<string,string>;expected:string;lang:string;query?:string}[]=[{headers:{"X-Gemihub-Language":"en"},expected:"Log in with a Google account",lang:"en"},{headers:{Cookie:"gemihub_locale=en"},expected:"Log in with a Google account",lang:"en"},{headers:{Cookie:"gemihub_locale=en","X-Gemihub-Language":"ja"},expected:"Google アカウントでログインしてください",lang:"ja"},{headers:{"X-Gemihub-Language":"en"},query:"?lang=ja",expected:"Google アカウントでログインしてください",lang:"ja"},{headers:{"X-Gemihub-Language":"invalid"},expected:"Google アカウントでログインしてください",lang:"ja"}];
  await Promise.all(requests.map(async({headers,expected,lang,query=""})=>{
    const response=await fetch(`${origin}/api/workspace${query}`,{headers});
    assert.equal(response.status,401); assert.equal(response.headers.get("Content-Language"),lang);
    assert.equal((await response.json()).error,expected);
  }));
  const html=await fetch(origin+'/?lang=en'); assert.equal(html.status,200);
  assert.match(await html.text(),/<html[^>]*lang="en"/);
});

test("English voice input uses the supplied recognition language and trailing English command", () => {
  const recognition:Recognition={lang:"",continuous:false,interimResults:false,start(){},stop(){},abort(){},onstart:null,onresult:null,onerror:null,onend:null};
  let text="",sent="";
  const engine=createDictation({createRecognition:()=>recognition,getText:()=>text,onInput:value=>text=value,onSend:value=>sent=value,onState(){},language:"en-US"});
  engine.start("send"); assert.equal(recognition.lang,"en-US");
  recognition.onresult?.({results:{length:1,0:{isFinal:true,0:{transcript:"Please add a page send"}}}});
  assert.equal(sent,"Please add a page");
});

test("OAuth state restores the selected language after the callback loses locale cookies", async t => {
  process.env.DEMO_MODE="true"; process.env.GOOGLE_CLIENT_ID="test-client";
  const store=new Store(":memory:"); const shop=await store.createShop("owner@example.com"); shop.published=structuredClone(sample); await store.saveShop(shop);
  const server=createApp(store); await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN=origin;
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();});
  const start=await fetch(`${origin}/auth/google?staffShop=${shop.id}&lang=en`,{redirect:"manual"});
  assert.equal(start.status,302);
  const state=new URL(start.headers.get("location")!).searchParams.get("state"); assert.ok(state);
  const oauthCookie=start.headers.get("set-cookie")!.split(";")[0];
  const callback=await fetch(`${origin}/auth/google/callback?state=${state}&error=access_denied`,{headers:{Cookie:oauthCookie},redirect:"manual"});
  assert.equal(callback.status,400); assert.equal(callback.headers.get("Content-Language"),"en");
  assert.match((await callback.json()).error,/Complete Google login and calendar consent/);
  const plain=await fetch(`${origin}/api/workspace`); assert.equal(plain.headers.get("Content-Language"),"ja");
});

test("offline HTML substitutions never rewrite HTML-shaped translation strings in bundled JS", () => {
  const embedded="globalThis.translation = '<div id=\"root\"></div><noscript>Example</noscript>';";
  const shell='<html><head><title>old</title><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>';
  const result=artifacts(structuredClone(sample),shell,()=>embedded)["web/index.html"];
  assert.ok(result.includes(`<script type="module">${embedded}</script>`));
  assert.match(result,/<body><div id="root"><div class="public-shop"><h1>nail atelier 凪<\/h1>/);
});

test("queued replies retain the initiating language when delivery is deferred", async t => {
  const { digest } = await import("../server/auth.ts");
  const { randomUUID } = await import("node:crypto");
  process.env.DEMO_MODE="true";
  const store=new Store(":memory:"); const shop=await store.createShop("owner@example.com");
  shop.published=structuredClone(sample); shop.google={folderId:"folder",specId:"spec",historyId:"history"}; await store.saveShop(shop);
  await store.put("session",digest("owner"),{user:{email:shop.owner,name:"Owner",role:"owner"},expires:Date.now()+600000});
  await store.put("inquiry","question",{id:"question",shopId:shop.id,email:"guest@example.com",name:"Guest",message:"Hello",reply:"",status:"open",at:new Date().toISOString()});
  const server=createApp(store); await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN=origin;
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();});
  const response=await fetch(`${origin}/api/shops/${shop.id}/inquiries/question/reply`,{method:"POST",headers:{Origin:origin,Cookie:"gemihub_session=owner","Content-Type":"application/json","X-Gemihub-Language":"en"},body:JSON.stringify({text:"Thank you for your message",requestId:randomUUID(),previousReply:"",previousEmail:"guest@example.com"})});
  assert.equal(response.status,200);
  const jobs=await store.list<{locale:string;subject:string}>("job");
  assert.equal(jobs.length,1);assert.equal(jobs[0].locale,"en");assert.match(jobs[0].subject,/Reply from/);
});
