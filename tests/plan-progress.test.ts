import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import * as ai from "../server/ai.ts";
import { sample } from "../server/domain.ts";
import { createInitialTheme } from "../server/initial-theme.ts";
import { createConversation, appendChatMessage } from "../server/shop-chat.ts";
import { finalDetailsQuestion } from "../server/request-intent.ts";

process.env.DEMO_MODE="true";
function latch() { let resolve!:()=>void; const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve}; }
const theme={headerHtml:'<header><slot name="title"></slot><slot name="navigation"></slot></header>',bodyHtml:'<main><slot name="content"></slot></main>',footerHtml:'<footer><slot name="content"></slot></footer>',css:'header{background:#fff;color:#123}'};

test("progress and saved conversations remain readable during generation, reveal only safe previews, and recover completed/failed requests", {timeout:15000}, async t => {
  const store=new Store(":memory:");const shop=await store.createShop("owner@example.com");
  await store.put("session",digest("progress-owner"),{user:{email:shop.owner,name:"Owner",role:"owner"},expires:Date.now()+600000});
  await store.put("session",digest("progress-member"),{user:{email:"member@example.com",role:"owner"},expires:Date.now()+600000});
  await store.put("member",`${shop.id}:member@example.com`,{shopId:shop.id,email:"member@example.com",accepted:true,status:"accepted"});
  const chat=await createConversation(store,shop,shop.owner,"create-shop",randomUUID());
  const reference={id:chat.id,requestId:randomUUID()};
  await appendChatMessage(store,shop,chat,{role:"assistant",text:finalDetailsQuestion,requestId:randomUUID()});
  await appendChatMessage(store,shop,chat,{role:"user",text:"月のアトリエです。落ち着いた雰囲気で、ほかにはありません。",requestId:reference.requestId});
  await appendChatMessage(store,shop,chat,{role:"assistant",text:"画面イメージを作成します。",requestId:reference.requestId,detail:{ready:true,changeRequest:true}});
  const generating=latch(),generationGate=latch(),reviewing=latch(),reviewGate=latch(),repairing=latch(),repairGate=latch();
  let fail=false,calls=0,contrastChecks=0;
  const server=createApp(store,{...ai,async themeContrast(){contrastChecks++;return [];},async propose(text,current,email,_demo,images,_region,context){
    calls++;
    assert.equal(current,null);
    const result=await createInitialTheme({config:{...structuredClone(sample),notificationEmail:email},request:text,images:images||[]},context,async call=>{
      if(call.purpose !== "review"){
        if(fail)throw new Error("Temporary model failure");
        if(!generatingDone){generatingDone=true;generating.resolve();await generationGate.promise;}
        else {repairing.resolve();await repairGate.promise;}
        return JSON.stringify(theme);
      }
      if(!firstReviewed){firstReviewed=true;reviewing.resolve();await reviewGate.promise;return JSON.stringify({approved:false,issues:["Improve contrast"],imageUsage:[]});}
      return JSON.stringify({approved:true,issues:[],imageUsage:[]});
    });
    return {config:{...result.config,appearance:{accent:"sage",layout:"standard",imageUrl:"",theme:result.candidate}},summary:["Theme"],themeReview:{approved:true,attempts:result.attempts}};
  }});
  let generatingDone=false,firstReviewed=false;
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN=origin;
  t.after(async()=>{generationGate.resolve();reviewGate.resolve();repairGate.resolve();server.close();await store.close();});
  const prefix=`${origin}/api/shops/${shop.id}`;
  const request=(path:string,data?:unknown,actor="owner")=>fetch(prefix+path,{method:data===undefined?"GET":"POST",headers:{Origin:origin,Cookie:`gemihub_session=progress-${actor}`,"Content-Type":"application/json"},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(4000)});
  const input={text:"Create the shop",intent:"create-shop",chat:reference};
  const pending=request("/plan",input);
  await generating.promise;
  let progress=await (await request(`/conversations/${chat.id}/progress`)).json();
  assert.equal(progress.stage,"generating");assert.ok(progress.preview);assert.equal(progress.preview.appearance?.theme,undefined);
  assert.equal((await request("/conversations")).status,200,"reading history must not wait for the model lock");
  const resumed=await (await request(`/conversations/${chat.id}`)).json();
  assert.equal(resumed.messages.length,3);assert.equal(resumed.generation.stage,"generating");
  assert.equal((await request(`/conversations/${chat.id}/progress`,undefined,"member")).status,404);
  generationGate.resolve();await reviewing.promise;
  progress=await (await request(`/conversations/${chat.id}/progress`)).json();
  assert.equal(progress.stage,"reviewing");assert.ok(progress.preview.appearance.theme);assert.equal(progress.planId,undefined);
  assert.equal((await store.shop(shop.id))!.published,null);
  reviewGate.resolve();await repairing.promise;
  progress=await (await request(`/conversations/${chat.id}/progress`)).json();
  assert.equal(progress.stage,"repairing");assert.equal(progress.attempts,2);
  repairGate.resolve();const result=await pending;assert.equal(result.status,200);
  assert.equal(contrastChecks,2,"the application checks each initial theme candidate before model review");
  const plan=await result.json();
  progress=await (await request(`/conversations/${chat.id}/progress`)).json();
  assert.equal(progress.stage,"complete");assert.equal(progress.planId,plan.id);assert.equal(progress.preview,undefined);
  await store.put("shopChatGeneration",chat.id,{...progress,stage:"failed",planId:undefined});
  assert.equal((await (await request(`/conversations/${chat.id}/progress`)).json()).stage,"complete","a saved plan recovers an interrupted final progress write");
  assert.equal((await (await request(`/conversations/${chat.id}`)).json()).plans[0].id,plan.id);
  assert.equal((await request("/plan",input)).status,200);assert.equal(calls,1,"a retry returns the saved plan");
  const failedReference={id:chat.id,requestId:randomUUID()};
  await appendChatMessage(store,shop,chat,{role:"assistant",text:finalDetailsQuestion,requestId:randomUUID()});
  await appendChatMessage(store,shop,chat,{role:"user",text:"ほかにはありません。",requestId:failedReference.requestId});
  await appendChatMessage(store,shop,chat,{role:"assistant",text:"作り直します。",requestId:failedReference.requestId,detail:{ready:true,changeRequest:true}});
  fail=true;
  assert.equal((await request("/plan",{...input,chat:failedReference})).status,500);
  progress=await (await request(`/conversations/${chat.id}/progress`)).json();
  assert.equal(progress.stage,"failed");assert.deepEqual(progress.chat,failedReference);
  fail=false;
  assert.equal((await request("/plan",{...input,chat:failedReference})).status,200);
});
