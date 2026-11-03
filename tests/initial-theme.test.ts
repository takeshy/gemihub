import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { themeSchema, compilePresentation, themeImageIds } from "../shared/presentation.ts";
import { Presentation } from "../src/Presentation.tsx";
import { sample, shopSchema } from "../server/domain.ts";
import { initialThemeConfig, createInitialTheme, type ThemeRun } from "../server/initial-theme.ts";
import { initialIntroductionPages } from "../shared/initial-pages.ts";
import { managedImageIds, withInlineImages } from "../server/image-references.ts";
import { validateProposedImages } from "../server/request-images.ts";
import { initialInterviewFacts, openingQuestions, logoQuestion, logoUploadQuestion, initialFeatureQuestion } from "../server/request-intent.ts";

export const theme = { headerHtml: '<header class="brand"><slot name="title"></slot><slot name="navigation"></slot></header>', bodyHtml: '<main class="canvas"><slot name="content"></slot></main>', footerHtml: '<footer class="credits"><slot name="content"></slot></footer>', css: ':root { color:#f5eee9; background:#241432 } .brand { padding:clamp(16px,4vw,64px); } h1 { font-family:serif; font-size:clamp(36px,8vw,100px); } .canvas { max-width:72rem; margin:auto; padding:24px; } .public-nav { display:flex; flex-wrap:wrap; gap:12px; } .credits { padding:24px; } @media(max-width:600px){ .canvas { padding:12px } }' };
const photo = (id: string) => ({ id: id.repeat(64), name: `${id}.png`, mimeType: "image/png", data: "aGVsbG8=" });

test("theme HTML is free to change structure while CSS, slots and unsafe content remain contained", () => {
  assert.ok(themeSchema.safeParse(theme).success);
  const html = renderToStaticMarkup(React.createElement(Presentation, { design: { html: theme.bodyHtml, css: theme.css }, slots: { content: React.createElement("button", { type: "submit" }, "Trusted booking action") }, fallback: null }));
  assert.match(html, /Trusted booking action/); assert.match(html, /class="canvas"/); assert.match(html, /design-[a-f0-9]+ :is\(/);
  for (const headerHtml of ['<script>alert(1)</script>', '<div onclick="alert(1)"></div>', '<form action="/api/pay"><input></form>', '<iframe src="/admin"></iframe>', '<a href="javascript:alert(1)">bad</a>', '<svg><a xlink:href="javascript:alert(1)">bad</a></svg>', '<slot name="navigation"></slot><slot name="navigation"></slot>'])
    assert.equal(themeSchema.safeParse({ ...theme, headerHtml }).success, false, headerHtml);
  for (const css of ['@import "https://evil.invalid/x.css";', 'div{background:u\\72l(https://evil.invalid)}', 'div{background:image-set("https://evil.invalid")}','/*</style><script>alert(1)</script>*/', '.x), body, :is(.y { color:red }'])
    assert.equal(themeSchema.safeParse({ ...theme, css }).success, false, css);
  assert.equal(themeSchema.safeParse({ ...theme, bodyHtml: "<main>No booking widget</main>" }).success, false);
  const compiled = compilePresentation({ html: '<div class="a"></div>', css: '@keyframes fade {from {opacity:0} to {opacity:1}} .a { animation:fade 1s }' });
  assert.match(compiled.css, new RegExp(`@keyframes ${compiled.id}-fade`));
  assert.match(compiled.css, new RegExp(`animation:${compiled.id}-fade`));
});

test("reviewer distinguishes a page reference from a logo asset and repairs an incorrect use", async () => {
  const reference = photo("a"), logo = photo("b"); const original = structuredClone(sample);
  let calls = 0; const purposes: unknown[] = []; const persisted: ThemeRun[] = [];
  const state = await createInitialTheme({ config: original, request: "Use a as the style reference. Use b as my logo.", images: [reference, logo] }, { save: async s => { persisted.push(structuredClone(s)); } }, async input => {
    purposes.push(input.purpose); calls++;
    if (!input.purpose) return JSON.stringify({ ...theme, headerHtml: `<header><img data-image-id="${calls===1?reference.id:logo.id}" alt="Logo"><slot name="navigation"></slot></header>` });
    return JSON.stringify({ approved: true, issues: [], imageUsage: [{ id: reference.id, purpose: "reference" }, { id: logo.id, purpose: "asset" }] });
  });
  assert.equal(state.attempts, 2); assert.equal(calls, 4); assert.deepEqual(purposes, [undefined, "review", undefined, "review"]);
  assert.deepEqual(themeImageIds(state.candidate), [logo.id]); assert.deepEqual(original, sample, "backend settings were not rewritten by the theme loop");
  assert.ok(persisted.some(s => s.feedback.length));
  assert.equal((await createInitialTheme({config:original,request:state.request,images:[reference,logo]},{state},async()=>{throw new Error("must reuse passed review");})).review?.approved,true);
  const config=shopSchema.parse({...original,appearance:{accent:"sage",layout:"standard",imageUrl:"",theme:state.candidate}});
  assert.ok(managedImageIds(config).includes(logo.id));
  assert.throws(()=>validateProposedImages(config,null,[]));validateProposedImages(config,null,[logo]);
  const inline=withInlineImages(config,{[logo.id]:{mimeType:logo.mimeType,data:logo.data}});
  assert.match(inline.appearance!.theme!.headerHtml,/src="data:image\/png;base64,/);assert.doesNotMatch(inline.appearance!.theme!.headerHtml,/data-image-id/);
});

test("review loop stops at three attempts and resumes review after a temporary failure without regenerating", async () => {
  let generations=0, reviews=0; let saved:ThemeRun|undefined;
  const input={config:structuredClone(sample),request:"A different layout",images:[]};
  const model=async (call: {purpose?:"review"}) => { if(!call.purpose){generations++;return JSON.stringify(theme);}reviews++;if(reviews===1)throw new Error("review network failed");return JSON.stringify({approved:true,issues:[],imageUsage:[]}); };
  await assert.rejects(createInitialTheme(input,{save:async state=>{saved=state;}},model),/review network failed/);
  const result=await createInitialTheme(input,{state:saved},model);assert.equal(result.review?.approved,true);assert.equal(generations,1);assert.equal(reviews,2);
  let rejected=0;
  await assert.rejects(createInitialTheme(input,{},async call=>{if(!call.purpose)return JSON.stringify(theme);rejected++;return JSON.stringify({approved:false,issues:["Duplicate navigation"],imageUsage:[]});}),{status:422});
  assert.equal(rejected,3);
});

test("initial setup asks for a real name and logo, separates blog/news, and removes duplicate built-in pages", () => {
  const messages=[{role:"assistant",text:openingQuestions["create-shop"]},{role:"user",text:"月のアトリエです"}];
  let facts=initialInterviewFacts(messages);assert.equal(facts.name,"月のアトリエ");assert.equal(facts.question,logoQuestion);
  messages.push({role:"assistant",text:logoQuestion},{role:"user",text:"あります"});assert.equal(initialInterviewFacts(messages).question,logoUploadQuestion);
  messages.push({role:"assistant",text:logoUploadQuestion},{role:"user",text:"後で"},{role:"assistant",text:initialFeatureQuestion},{role:"user",text:"1、2、4、5"});
  facts=initialInterviewFacts(messages);assert.equal(facts.question,undefined);assert.deepEqual(facts.articles,{blogs:false,announcements:true});
  const config=structuredClone(sample);config.pages=[{id:"contact-copy",slug:"contact-copy",title:"お問い合わせ",navigationLabel:"お問い合わせ",body:"",layout:"standard",imageUrl:""},{id:"faq",slug:"faq",title:"FAQ",navigationLabel:"FAQ",body:"",layout:"standard",imageUrl:""}];
  const cleaned=initialThemeConfig(config,[]);assert.deepEqual(cleaned.pages.map(p=>p.id),["faq"]);assert.deepEqual(cleaned.rules,config.rules);assert.deepEqual(cleaned.menus,config.menus);
});

test("staff and product introductions are independent choices and never fabricate booking master data", () => {
  const messages=[{role:"assistant",text:initialFeatureQuestion},{role:"user",text:"1、4、6、7"}];
  const facts=initialInterviewFacts(messages);
  assert.deepEqual(facts.articles,{blogs:false,announcements:true});
  assert.deepEqual(facts.introductions,{staff:true,products:true});
  const original=structuredClone(sample);
  const config=initialIntroductionPages(original,facts.introductions);
  assert.deepEqual(config.pages.map(p=>p.slug),["staff","products"]);
  assert.deepEqual(config.staff,original.staff);assert.deepEqual(config.menus,original.menus);
  assert.equal(initialIntroductionPages(config,facts.introductions).pages.length,2,"retries preserve unique pages");
  assert.deepEqual(initialIntroductionPages(config,{staff:false,products:true}).pages.map(p=>p.slug),["products"]);
  assert.deepEqual(initialInterviewFacts([{role:"user",text:"スタッフ紹介だけでいい"}]).articles,{blogs:false,announcements:false});
  assert.deepEqual(initialInterviewFacts([{role:"assistant",text:initialFeatureQuestion},{role:"user",text:"お知らせと商品紹介"}]).introductions,{staff:false,products:true});
});
