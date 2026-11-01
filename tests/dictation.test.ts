import { test } from "node:test";
import assert from "node:assert/strict";
import { createDictation, speechDraft, type Recognition, type SpeechResults } from "../src/dictation.ts";

class Recognizer implements Recognition {
  lang="";continuous=false;interimResults=false;stops=0;aborts=0;
  onstart:Recognition["onstart"]=null;onresult:Recognition["onresult"]=null;onend:Recognition["onend"]=null;onerror:Recognition["onerror"]=null;
  start(){this.onstart?.();}stop(){this.stops++;}abort(){this.aborts++;}
  emit(...segments:[string,boolean][]){this.onresult?.({results:segments.map(([text,isFinal])=>({isFinal,0:{transcript:text}})) as unknown as SpeechResults});}
}
function fixture(base=""){
  let text=base;const sent:string[]=[];const engines:Recognizer[]=[];let state={listening:false,error:""};
  const dictation=createDictation({createRecognition:()=>{const engine=new Recognizer();engines.push(engine);return engine;},getText:()=>text,onInput:value=>{text=value;},onSend:value=>sent.push(value),onState:value=>{state=value;}});
  return {dictation,sent,engines,get text(){return text;},set text(value:string){text=value;},get state(){return state;}};
}

test("only a final trailing end keyword sends; keywords are stripped and configurable",()=>{
  assert.deepEqual(speechDraft("", "予約にしたいです。以上。",true),{text:"予約にしたいです。",send:true});
  assert.equal(speechDraft("", "予約にしたいです。以上。",false).send,false);
  assert.equal(speechDraft("", "以上のことを確認したいです。",true).send,false);
  assert.equal(speechDraft("", "a leftover",true,"over").send,false);
  assert.deepEqual(speechDraft("", "a new page OVER!",true,"over"),{text:"a new page",send:true});
  assert.equal(speechDraft("", "以上",true,"").send,false);
  assert.deepEqual(speechDraft("下書き", "おわり(完)。",true,"おわり(完)"),{text:"下書き",send:true});
});

test("cumulative interim and final results update one draft, send once and ignore late callbacks",()=>{
  const f=fixture("既存の下書き");f.dictation.start();const engine=f.engines[0];
  assert.equal(engine.interimResults,true);assert.equal(f.state.listening,true);
  engine.emit(["予約",false]);assert.equal(f.text,"既存の下書き 予約");
  engine.emit(["予約方法を",false]);assert.equal(f.text,"既存の下書き 予約方法を");
  engine.emit(["予約方法を",true],["変えたいです。以上",false]);assert.equal(f.sent.length,0);
  const late=engine.onresult!;
  engine.emit(["予約方法を",true],["変えたいです。以上。",true]);
  assert.deepEqual(f.sent,["既存の下書き 予約方法を変えたいです。"]);
  assert.equal(f.state.listening,false);assert.ok(engine.stops>0&&engine.aborts>0);
  late({results:[{isFinal:true,0:{transcript:"二重送信。以上。"}}] as unknown as SpeechResults});
  assert.equal(f.sent.length,1);assert.equal(engine.onresult,null);
});

test("editing while listening owns existing results; later revisions cannot overwrite edits",()=>{
  const f=fixture();f.dictation.start();const engine=f.engines[0];
  engine.emit(["聞き取り中",false]);f.text="手で直した文章";
  engine.emit(["古い結果の確定",true]);assert.equal(f.text,"手で直した文章");
  engine.emit(["古い結果の確定",true],["新しい内容",true]);assert.equal(f.text,"手で直した文章 新しい内容");
  engine.emit(["古い結果の確定",true],["新しい内容",true],["以上。",true]);
  assert.deepEqual(f.sent,["手で直した文章 新しい内容"]);
});

test("manual stop, silence and permission errors preserve drafts without sending; restart starts fresh",()=>{
  const f=fixture();f.dictation.start();f.engines[0].emit(["まだ下書きです",false]);f.dictation.stop();
  assert.equal(f.text,"まだ下書きです");assert.equal(f.sent.length,0);
  f.dictation.start();f.engines[1].emit(["追加の内容",true]);f.engines[1].onend?.();
  assert.equal(f.text,"まだ下書きです 追加の内容");assert.equal(f.sent.length,0);
  f.dictation.start();f.engines[2].onerror?.({error:"not-allowed"});
  assert.equal(f.state.listening,false);assert.match(f.state.error,/許可/);assert.equal(f.sent.length,0);
  f.dictation.start();f.engines[3].emit(["以上",true]);assert.deepEqual(f.sent,["まだ下書きです 追加の内容"]);
});

test("an empty command never submits an empty message and disabled command remains ordinary text",()=>{
  const f=fixture();f.dictation.start();f.engines[0].emit(["以上",true]);assert.equal(f.sent.length,0);
  f.dictation.start("");f.engines[1].emit(["以上",true]);assert.equal(f.text,"以上");assert.equal(f.state.listening,true);assert.equal(f.sent.length,0);
});

test("unavailable recognizers and start failures leave text input usable",()=>{
  for(const problem of ["unsupported","start"]){
    let state={listening:false,error:""};const text="残しておく下書き";
    const dictation=createDictation({createRecognition:()=>{if(problem==="unsupported")throw new Error();const rec=new Recognizer();rec.start=()=>{throw new Error();};return rec;},getText:()=>text,onInput:()=>assert.fail("draft changed"),onSend:()=>assert.fail("unexpected send"),onState:next=>{state=next;}});
    dictation.start();assert.equal(dictation.listening(),false);assert.equal(state.listening,false);assert.ok(state.error.length>0);
  }
});
