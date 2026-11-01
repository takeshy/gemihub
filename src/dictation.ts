import { tr } from "../shared/i18n";
// Adapted from kakeratta's browser_speech.js: preserve edits, consume cumulative
// results once, and send only on a final trailing command.
export const defaultEndKeyword = "以上";
export const endKeywordStorageKey = "omaiweb:dictation:end-keyword";
export type SpeechResult = { isFinal:boolean; [index:number]:{transcript:string} };
export type SpeechResults = {length:number;[index:number]:SpeechResult};
export type Recognition = {
  lang:string; continuous:boolean; interimResults:boolean;
  start():void; stop():void; abort():void;
  onstart:(()=>void)|null;
  onresult:((event:{results:SpeechResults})=>void)|null;
  onerror:((event:{error?:string})=>void)|null;
  onend:(()=>void)|null;
};
export type SpeechConstructor = new()=>Recognition;
export function speechDraft(base:string,transcript:string,final:boolean,keywords=defaultEndKeyword) {
  const phrases=keywords.split(/[,、\n]/).map(value=>value.trim()).filter(Boolean).sort((a,b)=>b.length-a.length);
  const pattern=phrases.map(phrase=>{
    const escaped=phrase.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const unspaced=/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u.test(phrase);
    return (!unspaced&&/^[\p{L}\p{N}_]/u.test(phrase)?"(?<![\\p{L}\\p{N}\\p{M}_])":"")+escaped;
  }).join("|");
  const command=pattern?new RegExp(`(?:${pattern})[\\s。．.!！?？、,،؛؟।॥]*$`,"iu"):null;
  const send=final&&!!command&&command.test(transcript);
  const spoken=send&&command?transcript.replace(command,"").trimEnd():transcript;
  return {text:base+(base&&spoken&&!/\s$/.test(base)&&!/^[\s,.?!、。？！]/.test(spoken)?" ":"")+spoken,send};
}
export function createDictation({createRecognition,getText,onInput,onSend,onState,maxLength=4000,language="ja-JP"}:{
  createRecognition:()=>Recognition;getText:()=>string;onInput:(text:string)=>void;
  onSend?:(text:string)=>void;onState:(state:{listening:boolean;error:string})=>void;maxLength?:number;language?:string;
}) {
  let recognition:Recognition|null=null;
  function stop(error="") {
    const current=recognition;recognition=null;
    if(current){current.onresult=current.onerror=current.onend=current.onstart=null;try{current.stop();}catch{}try{current.abort();}catch{}}
    onState({listening:false,error});
  }
  function start(keywords=defaultEndKeyword) {
    stop();
    let current:Recognition;
    try{current=createRecognition();}catch{onState({listening:false,error:tr("このブラウザでは音声入力を利用できません。文字で入力してください。")});return;}
    recognition=current;
    current.lang=language;current.continuous=true;current.interimResults=true;
    let base=getText(),lastRendered=base,results:SpeechResult[]=[],consumed=0;
    function preserveEdits(){const edited=getText();if(edited===lastRendered)return;base=edited;lastRendered=edited;consumed=Math.max(consumed,results.length);}
    current.onresult=event=>{
      if(recognition!==current)return;
      preserveEdits();results=Array.from({length:event.results.length},(_,index)=>event.results[index]);
      const pending=results.slice(consumed);
      const draft=speechDraft(base,pending.map(result=>result[0].transcript).join(""),pending.length>0&&pending.every(result=>result.isFinal),keywords);
      const text=draft.text.slice(0,maxLength);
      if(text!==lastRendered){lastRendered=text;onInput(text);}
      if(draft.send){stop();if(text.trim())onSend?.(text);}
    };
    current.onstart=()=>{if(recognition===current)onState({listening:true,error:""});};
    current.onend=()=>{if(recognition===current)stop();};
    current.onerror=event=>{
      if(recognition!==current)return;
      const message=event.error==="not-allowed"?tr("マイクの使用が許可されていません。"):event.error==="network"?tr("音声認識に接続できませんでした。"):event.error==="audio-capture"?tr("マイクを利用できませんでした。"):tr("音声を聞き取れませんでした。");
      stop(message+tr("入力済みの文章を確認し、文字入力か音声入力で続けてください。"));
    };
    onState({listening:true,error:""});
    try{current.start();}catch{stop(tr("音声入力を開始できませんでした。もう一度お試しください。"));}
  }
  return {start,stop,listening:()=>!!recognition};
}
