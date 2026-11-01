import React, { useEffect, useRef, useState } from "react";
import { useApi } from "./api";
import { createRequestId } from "./request-id";
import type { ShopChat as SavedChat, ShopChatMessage, ChatReference } from "../server/shop-chat";
import { chatLabels, type RequestIntent } from "../server/request-intent";
import type { ShopRequestProps } from "./ShopRequest";
import { ConfigSummary, type Plan } from "./App";
import { CustomPage } from "./CustomPage";
import { RequestImagePicker } from "./RequestImagePicker";
import { InitialPlanReview } from "./InitialPlanReview";
import { OnboardingGuide } from "./OnboardingGuide";
import { DictationButton } from "./DictationButton";

type ChatData = SavedChat & {plans?:Plan[]};
export function ShopChat({shopId,published,isOwner,context,currentConfig,plan:legacyPlan,onPlan,onAccept,initialIntent}:ShopRequestProps) {
  const api = useApi();
  const prefix = `/api/shops/${shopId}`;
  const [intent,setIntent] = useState<RequestIntent>(!published?"create-shop":isOwner&&initialIntent&&initialIntent!=="create-shop"?initialIntent:"consult");
  const dictationStop=useRef<(()=>void)|null>(null);
  const [listening,setListening]=useState(false);
  const [chat,setChat] = useState<ChatData>();
  const current = useRef<ChatData|undefined>(undefined);
  const [text,setText] = useState("");
  const [imageIds,setImageIds] = useState<string[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [viewPlan,setViewPlan] = useState<Plan|undefined>(!published?legacyPlan:undefined);
  const [plans,setPlans] = useState<Plan[]>(legacyPlan ? [legacyPlan] : []);
  const alive = useRef(true);
  const log = useRef<HTMLDivElement>(null);
  const creationId = useRef(createRequestId());
  const pending = useRef<{text:string;imageIds:string[];id:string}|undefined>(undefined);
  function acceptChat(value:ChatData) {
    current.current = value; setChat(value); setIntent(value.intent);
    if (value.plans) setPlans(value.plans);
  }
  async function reload(id=current.current?.id) {
    if (!id) return;
    const saved = await api<ChatData>(`${prefix}/conversations/${id}`);
    if (alive.current && (!current.current || current.current.id===id)) acceptChat(saved);
    return saved;
  }
  useEffect(()=>{if(!published&&legacyPlan)setViewPlan(legacyPlan);},[legacyPlan?.id]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[shopId]);
  useEffect(()=>{if(log.current)log.current.scrollTop=log.current.scrollHeight;},[chat?.messages.length]);
  async function run(action:()=>Promise<void>) {setBusy(true);setError("");try{await action();}catch(error){if(alive.current)setError(error instanceof Error?error.message:String(error));}finally{if(alive.current)setBusy(false);}}
  async function ensureChat() {
    if(current.current)return current.current;
    const saved=await api<ChatData>(`${prefix}/conversations`,{intent,requestId:creationId.current,begin:true});
    if(!alive.current)throw new Error("画面を開き直してください");
    acceptChat(saved);return saved;
  }
  async function createPlan(requestText:string,reference:ChatReference,saved?:SavedChat) {
    const next=await onPlan(requestText,imageIds,intent,reference);
    if(!alive.current)return;
    setPlans(items=>[next,...items.filter(item=>item.id!==next.id)]);
    await reload(reference.id);
    if(!published)setViewPlan(next);
  }
  async function send(input=text) {
    const value=input.trim();if(!value||!context)return;
    const saved=await ensureChat();setViewPlan(undefined);
    const previous=pending.current;
    const requestId=previous?.text===value&&JSON.stringify(previous.imageIds)===JSON.stringify(imageIds)?previous.id:createRequestId();
    pending.current={text:value,imageIds:[...imageIds],id:requestId};
    const optimistic:ShopChatMessage={id:`pending-${requestId}`,shopId,conversationId:saved.id,email:saved.email,role:"user",text:value,requestId,sequence:saved.messages.length+1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),detail:{imageIds}};
    acceptChat({...saved,messages:[...saved.messages.filter(message=>message.requestId!==requestId),optimistic]});
    setText("");
    try {
      const reply=await api<{answer:string;changeRequest:boolean;ready?:boolean;chat:SavedChat}>(`${prefix}/system/question`,{question:value,intent,imageIds,...context,chat:{id:saved.id,requestId}});
      if(!alive.current)return;
      acceptChat({...reply.chat,plans:current.current?.plans});
      if(intent!=="consult"&&reply.changeRequest&&reply.ready!==false&&isOwner)await createPlan(value,{id:saved.id,requestId},reply.chat);
      pending.current=undefined;
    } catch(error) {setText(value);await reload(saved.id).catch(()=>{});throw error;}
  }
  function start(next:RequestIntent) {dictationStop.current?.();current.current=undefined;setChat(undefined);setIntent(next);setViewPlan(undefined);setPlans([]);setText("");setImageIds([]);setError("");pending.current=undefined;creationId.current=createRequestId();}
  const description=!published?"「はじめる」を押して、AIの質問に答えながらお店のページをつくります。":intent==="consult"?"質問や使い方について相談できます。お店の設定は変更しません。":intent==="modify"?"直したいことを伝えてください。AIと話しながら内容をまとめられます。":"作りたいページを教えてください。本文とメニュー名を、AIと話しながら決められます。";
  const messages=chat?.messages || [];
  const extraPages=viewPlan?.config.pages.filter(page=>!currentConfig?.pages.some(existing=>existing.id===page.id)) || [];
  if(!published&&viewPlan)return <div className="shop-request">{error&&<p className="alert" role="alert">{error}</p>}<InitialPlanReview shopId={shopId} plan={viewPlan} busy={busy} onBack={()=>{setViewPlan(undefined);}} onAccept={()=>void run(()=>onAccept(viewPlan))}/></div>;
  return <div className="shop-request shop-chat">
    {published&&<div className="request-intents" role="group" aria-label="したいこと">{(["consult",...(isOwner?["modify","new-page"]:[])] as RequestIntent[]).map(item=><button type="button" key={item} aria-label={chatLabels[item]} aria-pressed={intent===item} className={intent===item?"selected":""} disabled={busy} onClick={()=>{if(item!==intent)start(item);}}><b>{chatLabels[item]}</b><small>{item==="consult"?"質問する・使い方を知る":item==="modify"?"今ある設定やページを直す":"ページとメニューを追加する"}</small></button>)}</div>}
    <p>{description}</p>
    {error&&<p className="alert" role="alert">{error}</p>}
    {!chat?<div className={!published?"onboarding-request":undefined}><div><button className="primary begin-consultation" type="button" disabled={busy} onClick={()=>void run(async()=>{await ensureChat();})}>{busy?"準備しています…":"はじめる"}</button></div>{!published&&<OnboardingGuide/>}</div>:<>
    <div ref={log} className="chat-log" role="log" aria-label="AIとのチャット" aria-live="polite">
      {messages.length?messages.map(message=><article key={message.id} className={`chat-message chat-message-${message.role}`}><b>{message.role==="user"?"あなた":"AI"}</b><div className="pre-wrap">{message.text}</div>{message.detail.partial&&<small>途中で終了した会話です</small>}{message.detail.imageIds?.length?<small>画像{message.detail.imageIds.length}枚を添付</small>:null}{message.detail.planId&&<button type="button" disabled={busy} onClick={()=>{const target=plans.find(plan=>plan.id===message.detail.planId);if(target)setViewPlan(target);}}>変更案を確認する</button>}{message.role==="assistant"&&!message.detail.planId&&message.detail.changeRequest&&message.detail.ready&&isOwner&&intent!=="consult"&&chat&&<button type="button" disabled={busy} onClick={()=>void run(()=>createPlan(messages.find(item=>item.requestId===message.requestId&&item.role==="user")?.text||message.text,{id:chat.id,requestId:message.requestId},chat))}>変更案を作る</button>}</article>):<p className="chat-empty">{intent==="new-page"?"例：初めてのお客様向けに、よくある質問のページを追加したいです。":intent==="modify"?"例：水曜日もお休みにしたいです。":"例：指名なしの予約は、どのように決まりますか？"}</p>}
      {busy&&<p role="status">AIが考えています…</p>}
    </div>
    {viewPlan&&<section className="request-review" aria-label="変更案の確認"><h3>{intent==="new-page"?"このページを追加してよいですか？":"このように変更してよいですか？"}</h3><ul className="check-list">{viewPlan.summary.map((summary,index)=><li key={index}>{summary}</li>)}</ul><ConfigSummary config={viewPlan.config}/>{extraPages.length>0&&<section className="new-page-review" aria-label="追加するページ"><h4>追加するページとメニュー</h4>{extraPages.map(page=><div key={page.id}><h5>{page.title}</h5><p>お客様向けのメニューに「{page.navigationLabel}」を追加します。</p><details><summary>ページの内容を見る</summary><CustomPage page={page} imageBase={`${prefix}/images`}/></details></div>)}</section>}<p>{viewPlan.base===context?.revision?"まだ反映していません。直したいことは、下のチャットで続けて伝えられます。":"以前の変更案です。今の設定に合わせて直す場合は、チャットで続けて依頼してください。"}</p><div className="actions"><button type="button" onClick={()=>setViewPlan(undefined)}>チャットに戻る</button><button type="button" className="primary" disabled={busy||viewPlan.base!==context?.revision} onClick={()=>void run(()=>onAccept(viewPlan))}>変更内容を反映する</button></div></section>}
    <form className="chat-composer" aria-label="メッセージの入力" onSubmit={event=>{event.preventDefault();dictationStop.current?.();void run(()=>send());}}>
      <textarea aria-label="AIに伝えたいこと" rows={3} required maxLength={4000} disabled={busy} value={text} onChange={event=>setText(event.target.value)} placeholder="メッセージを入力…"/>

      <div className="chat-composer-toolbar">
        {isOwner&&<RequestImagePicker shopId={shopId} value={imageIds} onChange={setImageIds} disabled={busy||listening} label="画像を添付"/>}
        {isOwner&&<DictationButton value={text} onChange={setText} onSend={value=>void run(()=>send(value))} onListening={setListening} stopRef={dictationStop} disabled={busy}/>}
        <button type="submit" className="primary chat-send" disabled={busy||!text.trim()}>送信</button>
      </div>
    </form>
    </>}
  </div>;
}
