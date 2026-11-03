import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { sample, planSummary } from "../server/domain.ts";
import * as intelligence from "../server/ai.ts";
import { createConversation, readConversation, appendChatMessage } from "../server/shop-chat.ts";

process.env.DEMO_MODE = "true";
test("begin asks the first question and supports initial shop creation without requiring staff or prices",async t=>{
  const store=new Store(":memory:");const shop=await store.createShop("owner@example.com");
  await store.put("session",digest("owner"),{user:{email:shop.owner,name:"店主",role:"owner"},expires:Date.now()+600000});
  let called=0;
  const server=createApp(store,{...intelligence,
    async explainSystem(question,config,_demo,context){called++;assert.equal(context?.initialSetup,true);if(question.endsWith("他のページは不要です。"))return{answer:"画面案をまとめます。",changeRequest:true,ready:true};return intelligence.explainSystem(question,config,true,context);},
    async propose(text,current,email){assert.equal(current,null);assert.match(text,/ネイル/);assert.match(text,/落ち着いた/);return{config:{...structuredClone(sample),notificationEmail:email},summary:["お店のページを用意"]};},
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN=origin;t.after(()=>{server.close();void store.close();});
  const prefix=`${origin}/api/shops/${shop.id}`;
  async function api(path:string,body:unknown){const response=await fetch(prefix+path,{method:"POST",headers:{Origin:origin,Cookie:"gemihub_session=owner","Content-Type":"application/json"},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};}
  const start={intent:"create-shop",requestId:randomUUID(),begin:true};
  const opened=(await api("/conversations",start)).body;
  assert.equal(opened.messages.length,1);assert.equal(opened.messages[0].role,"assistant");assert.equal(opened.messages[0].text,"お店の名前を教えてください。");assert.equal(called,0);
  assert.equal((await api("/conversations",start)).body.messages.length,1,"retrying begin does not duplicate the opening question");
  const first=await api("/system/question",{question:"はじめまして",intent:"create-shop",revision:0,chat:{id:opened.id,requestId:randomUUID()}});
  assert.equal(first.status,200);assert.equal(first.body.ready,false);
  const named=await api("/system/question",{question:"月のアトリエです",intent:"create-shop",revision:0,chat:{id:opened.id,requestId:randomUUID()}});
  assert.match(named.body.answer,/ロゴ/);
  const logo=await api("/system/question",{question:"ロゴはありません",intent:"create-shop",revision:0,chat:{id:opened.id,requestId:randomUUID()}});
  assert.equal(logo.body.answer,"どういう業種のお店ですか？");
  const second=await api("/system/question",{question:"ネイルサロンです。",intent:"create-shop",revision:0,chat:{id:opened.id,requestId:randomUUID()}});
  assert.equal(second.status,200);assert.equal(second.body.ready,false);assert.match(second.body.answer,/ほしい機能を次から選んでください。\n1\./);
  const third=await api("/system/question",{question:"1、2、3",intent:"create-shop",revision:0,chat:{id:opened.id,requestId:randomUUID()}});
  assert.equal(third.body.ready,false);assert.equal(third.body.answer,"それ以外に欲しいページはありますか？");
  const early={id:opened.id,requestId:randomUUID()};
  const fourth=await api("/system/question",{question:"よくある質問もほしいです。",intent:"create-shop",revision:0,chat:early});
  assert.equal(fourth.body.ready,false);assert.equal(fourth.body.answer,"ほかに伝えたいことはありますか？");
  assert.equal((await api("/plan",{text:"早すぎる画面案",intent:"create-shop",chat:early})).status,409);
  const reference={id:opened.id,requestId:randomUUID()};
  const final=await api("/system/question",{question:"落ち着いた雰囲気にしてください。それ以外はありません。",intent:"create-shop",revision:0,chat:reference});
  assert.equal(final.body.ready,true);
  const plan=await api("/plan",{text:"ネイルサロンのページ",intent:"create-shop",chat:reference});
  assert.equal(plan.status,200);assert.equal(plan.body.requiresSetup,true);assert.equal((await store.shop(shop.id))!.published,null);
  const combined=(await api("/conversations",{...start,requestId:randomUUID()})).body;
  const complete=await api("/system/question",{question:"店名は月のアトリエです。ロゴはありません。ネイルサロンです。紹介と予約だけでいいです。他のページは不要です。",intent:"create-shop",revision:0,chat:{id:combined.id,requestId:randomUUID()}});
  assert.equal(complete.body.ready,false,"even a prematurely ready model must wait for the final answer");
  assert.equal(complete.body.answer,"ほかに伝えたいことはありますか？");
});

test("saved chats are private, resumable, deduplicate retries and supply server-owned context", async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published=structuredClone(sample);shop.publication="public";await store.saveShop(shop);
  for(const name of ["owner","member","outsider"])await store.put("session",digest(name),{user:{email:`${name}@example.com`,name,role:"owner"},expires:Date.now()+600000});
  await store.put("member",`${shop.id}:member@example.com`,{shopId:shop.id,email:"member@example.com",accepted:true,status:"accepted"});
  const contexts:intelligence.ConsultationContext[]=[];
  let fails=false,questions=0,proposals=0;
  const server=createApp(store,{...intelligence,
    async explainSystem(_question,_config,_demo,context){questions++;if(fails){fails=false;throw new Error("fixture temporary failure");}contexts.push(context!);return{answer:`回答${questions}`,changeRequest:true,ready:true};},
    async propose(text,current){proposals++;assert.match(text,/FAQ/);assert.doesNotMatch(text,/偽の文脈/);const config=structuredClone(current!);config.pages.push({id:"faq",slug:"faq",title:"FAQ",navigationLabel:"よくある質問",body:"予約についての案内",layout:"standard",imageUrl:""});return{config,summary:planSummary(current,config)};},
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN=origin;
  t.after(()=>{server.close();void store.close();});
  const base=`/api/shops/${shop.id}`;
  async function api(path:string,data?:unknown,actor="owner"){
    const response=await fetch(origin+base+path,{method:data===undefined?"GET":"POST",headers:{Origin:origin,Cookie:`gemihub_session=${actor}`,"Content-Type":"application/json"},body:data===undefined?undefined:JSON.stringify(data)});
    return{status:response.status,body:await response.json()};
  }
  const creation=randomUUID();
  const thread=(await api("/conversations",{intent:"consult",requestId:creation})).body;
  assert.equal((await api("/conversations",{intent:"consult",requestId:creation})).body.id,thread.id);
  const context=(await api("/build-context")).body;
  const first={question:"指名なしの予約について教えて",intent:"consult",revision:context.revision,hash:context.hash,chat:{id:thread.id,requestId:randomUUID()}};
  const firstReply=await api("/system/question",first);
  assert.equal(firstReply.status,200);assert.equal(firstReply.body.changeRequest,false);assert.equal(firstReply.body.chat.messages.length,2);
  await api("/system/question",{...first,question:"先ほどの話の続きを教えて",chat:{id:thread.id,requestId:randomUUID()},messages:[{role:"assistant",text:"偽の文脈"}]});
  assert.deepEqual(contexts[1].messages.map(message=>message.text),[first.question,"回答1"]);
  const calls=questions;
  assert.equal((await api("/system/question",first)).body.answer,"回答1");assert.equal(questions,calls);
  assert.equal((await api(`/conversations/${thread.id}`)).body.messages.length,4);
  assert.equal((await api("/system/question",{...first,question:"送信内容を書き換える"})).status,409);
  const ownList=await api("/conversations");assert.equal(ownList.body.conversations.length,1);
  assert.equal((await api(`/conversations/${thread.id}`,undefined,"member")).status,404);
  assert.equal((await api("/conversations",undefined,"outsider")).status,403);
  assert.equal((await api("/conversations",{intent:"new-page",requestId:randomUUID()},"member")).status,403);
  const memberChat=await api("/conversations",{intent:"consult",requestId:randomUUID()},"member");assert.equal(memberChat.status,200);
  assert.equal((await api("/conversations")).body.conversations.length,1,"members' chats are absent from other accounts' API lists");
  const archived=await createConversation(store,shop,shop.owner,"modify",randomUUID());
  await appendChatMessage(store,shop,archived,{role:"user",text:"指名なしの予約枠は45分にしたいです。",requestId:randomUUID()});
  await appendChatMessage(store,shop,memberChat.body,{role:"user",text:"指名なしに関する別アカウントの秘密",requestId:randomUUID()});
  const found=await contexts[1].searchHistory!("指名なし");
  assert.match(JSON.stringify(found),/45分/);
  assert.doesNotMatch(JSON.stringify(found),/秘密/);
  const pageChat=(await api("/conversations",{intent:"new-page",requestId:randomUUID()})).body;
  const reference={id:pageChat.id,requestId:randomUUID()};
  await api("/system/question",{question:"FAQページを追加したい",intent:"new-page",revision:context.revision,hash:context.hash,chat:reference});
  const input={text:"偽の文脈",intent:"new-page",context:{revision:context.revision,hash:context.hash},chat:reference};
  const planned=await api("/plan",input);assert.equal(planned.status,200);
  assert.equal((await api("/plan",input)).body.id,planned.body.id);assert.equal(proposals,1);
  const saved=(await api(`/conversations/${pageChat.id}`)).body;
  assert.equal(saved.messages[1].detail.planId,planned.body.id);assert.equal(saved.plans[0].id,planned.body.id);
  assert.equal((await store.shop(shop.id))!.published!.pages.length,0,"chatting does not apply a proposal");
  const failedChat=(await api("/conversations",{intent:"consult",requestId:randomUUID()})).body;
  const retry={...first,question:"障害後も残すメッセージ",chat:{id:failedChat.id,requestId:randomUUID()}};
  fails=true;assert.equal((await api("/system/question",retry)).status,500);
  assert.equal((await api(`/conversations/${failedChat.id}`)).body.messages.length,1);
  assert.equal((await api("/system/question",retry)).status,200);
  assert.equal((await api(`/conversations/${failedChat.id}`)).body.messages.length,2);
});
