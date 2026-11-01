import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { Models } from "@google/genai";
import { findRelevantHistory, type HistoryMessage } from "../server/chat-context.ts";
import { explainSystem } from "../server/ai.ts";
import { sample } from "../server/domain.ts";

test("history retrieval finds older relevant exchanges and keeps excerpts around the match",()=>{
  const messages:HistoryMessage[]=[
    {id:"old",conversationId:"mine",requestId:"old-request",role:"user",text:"前置き".repeat(1000)+"予約方法は電話でも案内したいです。",sequence:1,createdAt:"2026-01-01T00:00:00Z",detail:{}},
    {id:"reply",conversationId:"mine",requestId:"old-request",role:"assistant",text:"予約方法を案内するページについての提案です。",sequence:2,createdAt:"2026-01-01T00:00:01Z",detail:{}},
    {id:"recent",conversationId:"mine",requestId:"other",role:"user",text:"お店の配色について",sequence:3,createdAt:"2026-11-01T00:00:00Z",detail:{}},
    {id:"foreign",conversationId:"not-allowed",requestId:"foreign",role:"user",text:"予約方法の秘密",sequence:1,createdAt:"2026-11-01T00:00:00Z",detail:{}},
  ];
  const result=findRelevantHistory(messages,new Map([["mine","modify"]]),"以前の予約方法について");
  assert.equal(result[0].requestId,"old-request");
  assert.equal(result[0].messages.length,2);
  assert.match(result[0].messages[0].text,/予約方法は電話/);
  assert.ok(result[0].messages[0].text.length<1700);
  assert.doesNotMatch(JSON.stringify(result),/秘密/);
  assert.deepEqual(findRelevantHistory(messages,new Map([["mine","modify"]]),"予約方法",new Set(["old","reply"])),[]);
});

test("the AI can request a private history search without asking the user to manage conversations",async t=>{
  const old={project:process.env.GOOGLE_CLOUD_PROJECT,model:process.env.VERTEX_MODEL};
  process.env.GOOGLE_CLOUD_PROJECT="fixture";process.env.VERTEX_MODEL="fixture";
  t.after(()=>{mock.restoreAll();for(const [key,value] of [["GOOGLE_CLOUD_PROJECT",old.project],["VERTEX_MODEL",old.model]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}});
  const calls:any[]=[];
  mock.method(Models.prototype as any,"generateContentInternal",async(input:any)=>{
    calls.push(input);
    return {text:JSON.stringify(calls.length===1?{answer:"過去の案内を確認します。",changeRequest:false,ready:false,historyQuery:"予約の電話案内"}:{answer:"以前は電話でも予約方法を案内したい、と相談されていました。",changeRequest:false,ready:false})};
  });
  const queries:string[]=[];
  const answer=await explainSystem("前に話した案内について教えて",sample,false,{messages:[],history:[],searchHistory:async query=>{
    queries.push(query);
    return [{conversationId:"saved",requestId:"request",intent:"modify",at:"2026-01-01T00:00:00Z",messages:[{role:"user",text:"電話でも予約方法を案内したい"}]}];
  }});
  assert.deepEqual(queries,["予約の電話案内"]);
  assert.equal(calls.length,2);
  assert.match(JSON.stringify(calls[1].contents),/電話でも予約方法/);
  assert.match(answer.answer,/以前は電話/);
  assert.equal("historyQuery" in answer,false);
});
