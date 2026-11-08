import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { themeSchema, compilePresentation, themeImageIds } from "../shared/presentation.ts";
import { Presentation } from "../src/Presentation.tsx";
import { sample, shopSchema } from "../server/domain.ts";
import { initialThemeConfig, createInitialTheme, normalizeInitialNavigation, initialThemePreview, type ThemeRun } from "../server/initial-theme.ts";
import { initialIntroductionPages } from "../shared/initial-pages.ts";
import { managedImageIds, withInlineImages } from "../server/image-references.ts";
import { validateProposedImages } from "../server/request-images.ts";
import { initialInterviewFacts, openingQuestions, logoQuestion, logoUploadQuestion, initialFeatureQuestion, initialSetupDemoReply, additionalPagesQuestion } from "../server/request-intent.ts";

export const theme = { headerHtml: '<header class="brand"><slot name="title"></slot><slot name="navigation"></slot></header>', bodyHtml: '<main class="canvas"><slot name="content"></slot></main>', footerHtml: '<footer class="credits"><slot name="content"></slot></footer>', css: ':root { color:#f5eee9; background:#241432 } .brand { padding:clamp(16px,4vw,64px); } h1 { font-family:serif; font-size:clamp(36px,8vw,100px); } .canvas { max-width:72rem; margin:auto; padding:24px; } .public-nav { display:flex; flex-wrap:wrap; gap:12px; } .credits { padding:24px; } @media(max-width:600px){ .canvas { padding:12px } }' };
const photo = (id: string) => ({ id: id.repeat(64), name: `${id}.png`, mimeType: "image/png", data: "aGVsbG8=" });

test("initial themes compact generated formatting before validation and review", async () => {
  let generations = 0;
  const result = await createInitialTheme({ config: sample, request: "Keep the design", images: [] }, {}, async call => {
    if (call.purpose) return JSON.stringify({ approved: true, issues: [], imageUsage: [] });
    generations++;
    const schema = call.schema as { required: string[]; properties: { css: { maxLength?: number; const?: string } } };
    for (const field of ["styles", "headerCss", "bodyCss", "footerCss"]) assert.ok(schema.required.includes(field));
    // maxLength 0 is accepted by every provider schema subset; `const` is not.
    assert.equal(schema.properties.css.maxLength, 0); assert.equal(schema.properties.css.const, undefined);
    return JSON.stringify({ ...theme, css: '/* ' + "formatting".repeat(1600) + ' */ ' + theme.css });
  });
  assert.equal(generations, 1);
  assert.equal(result.candidate!.css, "");
  assert.ok(result.candidate!.styles!.length > 0);
  assert.equal(result.review?.approved, true);
});

test("generation and review see the actual shop text and enabled navigation slot contents", async () => {
  const config = structuredClone(sample);
  config.header.title = "A long shop name with room for all navigation";
  config.pages = [{ id: "services", slug: "services", title: "Services", navigationLabel: "Staff and services", body: "", layout: "standard", imageUrl: "" }];
  config.appearance = { accent: "sage", layout: "standard", imageUrl: "", articles: { blogs: false, announcements: true } };
  const calls: ("review" | undefined)[] = [];
  await createInitialTheme({ config, request: "An airy salon theme", images: [] }, {}, async call => {
    calls.push(call.purpose);
    const input = JSON.parse(call.contents[0].parts![0].text!);
    const example = input.layoutContext.headerSlotExample;
    assert.equal(input.layoutContext.navigation.count, 6);
    assert.deepEqual(input.layoutContext.navigation.items.map((item: {label:string}) => item.label), ["マイページ", "ご予約", "お店のこと", "お問い合わせ", "お知らせ", "Staff and services"]);
    assert.match(example, /A long shop name with room for all navigation/);
    assert.match(example, /data-design-slot="navigation"/);
    assert.match(example, /class="public-nav"/);
    assert.match(example, /Staff and services/);
    assert.match(example, /お知らせ/);
    assert.doesNotMatch(example, />ブログ</);
    assert.match(call.system, /spans.*buttons.*anchors/);
    assert.match(call.system, /narrow preview/);
    if (call.purpose) {
      assert.match(input.renderedHeader, /height:auto/);
      return JSON.stringify({ approved: true, issues: [], imageUsage: [] });
    }
    return JSON.stringify(theme);
  });
  assert.deepEqual(calls, [undefined, "review"]);
});

test("duplicate theme menus are repaired before review without hiding unsafe markup or changing the requested pages", async () => {
  const config = structuredClone(sample);
  const candidate = { ...theme, headerHtml: '<header><nav><a href="/?pane=reserve">ご予約</a><span>お問い合わせ</span></nav><slot name="title"></slot><slot name="navigation"></slot></header>', footerHtml: '<footer><a href="/?pane=reserve">ご予約</a><a href="https://example.com/social">Social</a><slot name="content"></slot></footer>' };
  const result = await createInitialTheme({config,request:"Make the shop",images:[]},{},async call=>{
    if(!call.purpose)return JSON.stringify(candidate);
    const input=JSON.parse(call.contents[0].parts![0].text!);
    assert.doesNotMatch(input.theme.headerHtml, /<nav>|ご予約|お問い合わせ/);
    assert.doesNotMatch(input.theme.footerHtml, /ご予約/);
    assert.match(input.theme.footerHtml, /Social/);
    return JSON.stringify({approved:true,issues:[],imageUsage:[]});
  });
  assert.equal(result.attempts,1);
  assert.deepEqual(result.config,config);
  const unsafe={...candidate,headerHtml:candidate.headerHtml.replace('ご予約</a>', 'ご予約<script>alert(1)</script></a>')};
  assert.deepEqual(normalizeInitialNavigation(unsafe,config),unsafe,"normalization must not hide a validation error");
  assert.equal(themeSchema.safeParse(normalizeInitialNavigation(unsafe,config)).success,false);
});

test("preview rejects unmanaged images, and a deliberate retry repairs an exhausted run using its saved feedback", async () => {
  const input={config:structuredClone(sample),request:"A calm shop",images:[]};
  let saved:ThemeRun|undefined;
  await assert.rejects(createInitialTheme(input,{save:async state=>{saved=state;}},async call=>JSON.stringify(call.purpose?{approved:false,issues:["Increase contrast"],imageUsage:[]}:theme)),{status:422});
  let generations=0;
  const result=await createInitialTheme(input,{state:saved},async call=>{
    if(call.purpose)return JSON.stringify({approved:true,issues:[],imageUsage:[]});
    generations++;
    const data=JSON.parse(call.contents[0].parts![0].text!);
    assert.deepEqual(data.feedback,["Increase contrast"]);
    assert.ok(data.previousTheme);
    return JSON.stringify({...theme,css:theme.css+" p{color:white}"});
  });
  assert.equal(generations,1);assert.equal(result.review?.approved,true);
  const unsafe={...theme,headerHtml:`<header><img data-image-id="${"f".repeat(64)}" alt="Unknown"><slot name="navigation"></slot></header>`};
  assert.equal(initialThemePreview({...result,candidate:unsafe}),result.config);
  assert.equal(initialThemePreview({...result,candidate:{...theme,headerHtml:'<header><img src="https://unknown.example/photo.png" alt="Unknown"><slot name="navigation"></slot></header>'}}),result.config);
  assert.deepEqual(initialThemePreview(result).appearance?.theme,result.candidate);
});

test("theme HTML is free to change structure while CSS, slots and unsafe content remain contained", () => {
  assert.ok(themeSchema.safeParse(theme).success);
  assert.ok(themeSchema.safeParse({ ...theme, headerHtml: theme.headerHtml.replace('<header class="brand">', '<header class="brand"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"></circle></svg>') }).success);
  const malformed = themeSchema.safeParse({ ...theme, bodyHtml: '<main><slot name="content"/><p>Following sibling</p></main>' });
  assert.equal(malformed.success, false);
  if (!malformed.success) assert.match(malformed.error.issues[0].message, /closing tag/);
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
  assert.ok(persisted.some(s => s.feedback.length && s.previousCandidate), "repair receives the rejected HTML/CSS as well as the review");
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

test("image review sees resolved photo markup and retries an exhausted legacy review without regeneration", async () => {
  const image=photo("c");
  const candidate={...theme,headerHtml:`<header><img class="interior-photo" data-image-id="${image.id}" alt="Interior" style="width:100%;object-fit:contain"><slot name="navigation"></slot></header>`,footerHtml:`<footer><img data-image-id="${image.id}" alt="Interior"><slot name="content"></slot></footer>`};
  const config=structuredClone(sample);
  const state:ThemeRun={config,request:"Use the interior photo large, preserving the mirrors and chairs.",imageIds:[image.id],attempts:3,previousCandidate:candidate,feedback:["renderedHeader has a span, not a photo"],review:{approved:false,issues:["Photo missing"],imageUsage:[{id:image.id,purpose:"asset"}]}};
  let calls=0;
  const result=await createInitialTheme({config,request:state.request,images:[image]},{state},async call=>{
    calls++;assert.equal(call.purpose,"review","retry reviews the saved photo theme without generating again");
    const text=call.contents[0].parts?.[0].text;assert.ok(text);
    const input=JSON.parse(text);
    for(const markup of [input.renderedHeader,input.renderedFooter]){
      assert.match(markup,new RegExp(`<img[^>]+src="attachment:${image.id}"`));
      assert.doesNotMatch(markup,/data-design-image|data:image\//);
    }
    assert.match(input.renderedHeader,/class="theme-image interior-photo"/);
    assert.match(input.renderedHeader,/object-fit:contain/);
    assert.equal(input.imageSources[0].id,image.id);assert.match(input.renderingNote,/actual pixels/);
    assert.ok(call.contents[0].parts?.some(part=>part.inlineData?.data===image.data));
    return JSON.stringify({approved:true,issues:[],imageUsage:[{id:image.id,purpose:"asset"}]});
  });
  assert.equal(calls,1);assert.equal(result.review?.approved,true);assert.equal(result.attempts,3);
  assert.equal(state.candidate,undefined,"the stored state is updated only through persistence");
  assert.equal(result.candidate?.headerHtml,candidate.headerHtml,"review aliases never enter the saved theme");
});

test("initial setup asks for a real name and logo, separates blog/news, and removes duplicate built-in pages", () => {
  const messages=[{role:"assistant",text:openingQuestions["create-shop"]},{role:"user",text:"月のアトリエです"}];
  let facts=initialInterviewFacts(messages);assert.equal(facts.name,"月のアトリエ");assert.equal(facts.question,logoQuestion);
  messages.push({role:"assistant",text:logoQuestion},{role:"user",text:"あります"});assert.equal(initialInterviewFacts(messages).question,logoUploadQuestion);
  messages.push({role:"assistant",text:logoUploadQuestion},{role:"user",text:"後で"},{role:"assistant",text:initialFeatureQuestion},{role:"user",text:"2"});
  facts=initialInterviewFacts(messages);assert.equal(facts.question,undefined);assert.deepEqual(facts.articles,{blogs:false,announcements:true});
  const config=structuredClone(sample);config.pages=[{id:"contact-copy",slug:"contact-copy",title:"お問い合わせ",navigationLabel:"お問い合わせ",body:"",layout:"standard",imageUrl:""},{id:"faq",slug:"faq",title:"FAQ",navigationLabel:"FAQ",body:"",layout:"standard",imageUrl:""}];
  const cleaned=initialThemeConfig(config,[]);assert.deepEqual(cleaned.pages.map(p=>p.id),["faq"]);assert.deepEqual(cleaned.rules,config.rules);assert.deepEqual(cleaned.menus,config.menus);
});

test("staff and product introductions are independent choices and never fabricate booking master data", () => {
  const messages=[{role:"assistant",text:initialFeatureQuestion},{role:"user",text:"2、3、4"}];
  const facts=initialInterviewFacts(messages);
  assert.deepEqual(facts.articles,{blogs:false,announcements:true});
  assert.deepEqual(facts.introductions,{staff:true,products:true});
  const original=structuredClone(sample);
  const config=initialIntroductionPages(original,facts.introductions);
  assert.deepEqual(config.pages.map(p=>p.slug),["staff","products"]);
  assert.deepEqual(config.staff,original.staff);assert.deepEqual(config.menus,original.menus);
  assert.equal(initialIntroductionPages(config,facts.introductions).pages.length,2,"retries preserve unique pages");
  assert.deepEqual(initialIntroductionPages(config,{staff:false,products:true}).pages.map(p=>p.slug),["products"]);
  const empty = { ...original, pages: [{ ...config.pages[0], body: "" }] };
  const prepared = initialIntroductionPages(empty, { staff: true, products: false });
  assert.match(prepared.pages[0].body, /準備中/);assert.equal(empty.pages[0].body, "", "placeholder does not mutate the proposed facts");
  assert.deepEqual(initialInterviewFacts([{role:"user",text:"スタッフ紹介だけでいい"}]).articles,{blogs:false,announcements:false});
  assert.deepEqual(initialInterviewFacts([{role:"assistant",text:initialFeatureQuestion},{role:"user",text:"お知らせと商品紹介"}]).introductions,{staff:false,products:true});
});

test("feature choices follow the actual question despite a preface, changed labels or numbering", () => {
  const question="店名と業種を確認しました。必要な機能を選んでください。\n1. お店の紹介\n2. 予約\n3. ブログ\n4. お知らせ\n5. お問い合わせ\n6. スタッフ紹介\n7. メニュー・サービス紹介";
  const facts=initialInterviewFacts([{role:"assistant",text:question},{role:"user",text:"1、2、4、5、7"}]);
  assert.deepEqual(facts.articles,{blogs:false,announcements:true});assert.deepEqual(facts.introductions,{staff:false,products:true});
  const english="Choose features for your shop:\n1. Booking\n2. Announcements\n3. Staff introduction\n4. Blog";
  assert.deepEqual(initialInterviewFacts([{role:"assistant",text:english},{role:"user",text:"1, 2, 3"}]).articles,{blogs:false,announcements:true});
  assert.deepEqual(initialInterviewFacts([{role:"assistant",text:english},{role:"user",text:"All, no blog"}]).articles,{blogs:false,announcements:true});
  assert.deepEqual(initialInterviewFacts([{role:"assistant",text:"Choose features:\n1. Booking (choose staff)\n2. Staff introduction\n3. Blog"},{role:"user",text:"1"}]).introductions,{staff:false,products:false});
  assert.deepEqual(initialInterviewFacts([{role:"assistant",text:question},{role:"user",text:"全部。ただしブログは不要"}]).articles,{blogs:false,announcements:true});
  const config={...structuredClone(sample),pages:[{id:"menu",slug:"menu",title:"メニュー・サービス紹介",navigationLabel:"メニュー・サービス紹介",body:"",layout:"standard" as const,imageUrl:""}]};
  assert.equal(initialIntroductionPages(config,facts.introductions).pages.length,1);
});


test("mandatory features are explained and optional features may all be declined", () => {
  assert.match(initialFeatureQuestion, /お店の紹介・予約・お問い合わせは必須/);
  assert.doesNotMatch(initialFeatureQuestion, /\n\d+\. (?:予約|お問い合わせ|お店の紹介)/);
  const messages = [{role:"assistant",text:openingQuestions["create-shop"]},{role:"user",text:"店名は月のアトリエ。ネイルサロンです"},{role:"assistant",text:logoQuestion},{role:"user",text:"ロゴはなし"},{role:"assistant",text:initialFeatureQuestion}];
  const facts = initialInterviewFacts([...messages,{role:"user",text:"なし"}]);
  assert.deepEqual(facts.articles,{blogs:false,announcements:false});
  assert.deepEqual(facts.introductions,{staff:false,products:false});
  assert.equal(initialSetupDemoReply("なし",messages).answer,additionalPagesQuestion);
});
