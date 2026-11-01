import type { RequestIntent } from "./request-intent.ts";
export type HistoryMessage = {id:string;conversationId:string;requestId:string;role:"user"|"assistant";text:string;createdAt:string;sequence:number;detail:{partial?:boolean}};
export type HistoricalContext = { conversationId:string; requestId:string; intent:RequestIntent; at:string; messages:{role:"user"|"assistant";text:string}[] };
const ignored = new Set(["です","ます","ください","について","お願い","したい","する","した","して","こと","内容","以前","今回","教え","教えて"]);
function terms(query:string) {
  return [...new Set([...new Intl.Segmenter("ja",{granularity:"word"}).segment(query.normalize("NFKC").toLowerCase())].filter(part=>part.isWordLike).map(part=>part.segment).filter(word=>word.length>1&&!ignored.has(word)))].slice(0,40);
}
function excerpt(text:string,words:string[]) {
  if(text.length<=1600)return text;
  const normalized=text.normalize("NFKC").toLowerCase();
  const positions=words.map(word=>normalized.indexOf(word)).filter(index=>index>=0);
  const start=Math.max(0,(positions.length?Math.min(...positions):0)-300);
  return `${start?"…":""}${text.slice(start,start+1600)}${start+1600<text.length?"…":""}`;
}
/** Input records must already be restricted to the authenticated shop and account. */
export function findRelevantHistory(messages:HistoryMessage[],intents:Map<string,RequestIntent>,query:string,excludedIds:ReadonlySet<string>=new Set(),limit=6):HistoricalContext[] {
  const words=terms(query);
  const groups=new Map<string,{score:number;messages:HistoryMessage[]}>();
  for(const message of messages) {
    if(excludedIds.has(message.id)||!intents.has(message.conversationId))continue;
    const normalized=message.text.normalize("NFKC").toLowerCase();
    const score=words.reduce((total,word)=>total+(normalized.includes(word)?word.length:0),0);
    const key=`${message.conversationId}:${message.requestId}`;
    const group=groups.get(key)||{score:0,messages:[]};group.score+=score;group.messages.push(message);groups.set(key,group);
  }
  return [...groups.values()].filter(group=>!words.length||group.score>0).sort((a,b)=>b.score-a.score||b.messages.at(-1)!.createdAt.localeCompare(a.messages.at(-1)!.createdAt)).slice(0,Math.min(10,Math.max(1,limit))).map(group=>{
    const sorted=group.messages.sort((a,b)=>a.sequence-b.sequence);
    const first=sorted[0];
    return {conversationId:first.conversationId,requestId:first.requestId,intent:intents.get(first.conversationId)!,at:first.createdAt,messages:sorted.map(message=>({role:message.role,text:`${message.detail.partial?"（途中で終了した発言）":""}${excerpt(message.text,words)}`}))};
  });
}
