import { tr } from "../shared/i18n";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApi } from "./api";
import { createRequestId } from "./request-id";
import type { ShopChat as SavedChat, ShopConversation, ShopChatMessage, ChatReference, ChatGeneration } from "../server/shop-chat";
import type { RequestIntent } from "../server/request-intent";
import type { ShopRequestProps } from "./ShopRequest";
import { type Plan } from "./App";
import { ScreenGallery } from "./ScreenGallery";
import { CustomPage } from "./CustomPage";
import { RequestImagePicker } from "./RequestImagePicker";
import { MenuImage } from "./MenuImage";
import { InitialPlanReview } from "./InitialPlanReview";
import { OnboardingGuide } from "./OnboardingGuide";
import { DictationButton } from "./DictationButton";
import { submitOnShortcut } from "./submit-shortcut";
import { PlanProgress } from "./PlanProgress";

type ChatData = SavedChat & {plans?:Plan[];generation?:ChatGeneration|null};
export function ShopChat({shopId,published,isOwner,context,currentConfig,plan:legacyPlan,onPlan,onAccept,initialIntent,autoStart,reviewHost,onBusyChange,onReturnToChat}:ShopRequestProps) {
  const api = useApi();
  const prefix = `/api/shops/${shopId}`;
  // Questions moved to the main "Consult & ask" menu; this chat now only makes changes.
  // After publication one chat handles every change; the AI asks whether to edit or add a page.
  const [intent,setIntent] = useState<RequestIntent>(!published?"create-shop":"modify");
  const dictationStop=useRef<(()=>void)|null>(null);
  const [listening,setListening]=useState(false);
  const [chat,setChat] = useState<ChatData>();
  const current = useRef<ChatData|undefined>(undefined);
  const [text,setText] = useState("");
  const [imageIds,setImageIds] = useState<string[]>([]);
  const [busy,setBusy] = useState(false);
  const [restoring,setRestoring] = useState(true);
  const [restoreError,setRestoreError] = useState(false);
  const [restoreRetry,setRestoreRetry] = useState(0);
  const [draftKey,setDraftKey] = useState("");
  const [generation,setGeneration] = useState<ChatGeneration>();
  const [watch,setWatch] = useState(0);
  const [generationStale,setGenerationStale] = useState(false);
  const planning = useRef(false);
  const [error,setError] = useState("");
  // An approved plan at the current revision is a publication that did not finish: surface it so it can be retried.
  const interrupted=published&&legacyPlan?.approved?legacyPlan:undefined;
  const [viewPlan,setViewPlan] = useState<Plan|undefined>(!published?legacyPlan:interrupted);
  const [plans,setPlans] = useState<Plan[]>(legacyPlan ? [legacyPlan] : []);
  const alive = useRef(true);
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const creationId = useRef(createRequestId());
  const pending = useRef<{text:string;imageIds:string[];id:string}|undefined>(undefined);
  function acceptChat(value:ChatData) {
    current.current = value; setChat(value); setIntent(value.intent);
    if (value.plans) setPlans(value.plans);
  }
  const generationRunning = !!generation && !["complete", "failed"].includes(generation.stage);
  const working = busy || restoring || generationRunning && !generationStale;
  useEffect(() => { if (autoStart === false) dictationStop.current?.(); }, [autoStart]);
  useEffect(() => { onBusyChange?.(working); return () => onBusyChange?.(false); }, [working, onBusyChange]);
  useEffect(() => { if (autoStart && !restoring && !restoreError && !chat) void run(async () => { await ensureChat(); }); }, [autoStart, restoring, restoreError]);
  useEffect(() => {
    let cancelled = false;
    setRestoring(true); setRestoreError(false);
    void (async () => {
      const index = await api<{email:string;conversations:ShopConversation[]}>(`${prefix}/conversations`);
      // A publication starts a new change request; only resume chats for the current revision.
      const latest = index.conversations.find(item => published ? ["modify", "new-page"].includes(item.intent) && item.revision === context?.revision : item.intent === "create-shop");
      const saved = latest ? await api<ChatData>(`${prefix}/conversations/${latest.id}`) : undefined;
      if (cancelled) return;
      if (saved) { acceptChat(saved); setGeneration(saved.generation || undefined); }
      else {
        creationId.current = createRequestId();
        current.current = undefined; setChat(undefined); setIntent(published ? "modify" : "create-shop");
        setGeneration(undefined); setViewPlan(!published ? legacyPlan : interrupted); setPlans(legacyPlan ? [legacyPlan] : []);
        setText(""); setImageIds([]); pending.current = undefined;
      }
      const key = `gemihub:shop-chat-draft:${shopId}:${index.email}`;
      let restoredDraft = false;
      try {
        const draft = JSON.parse(localStorage.getItem(key) || "null");
        if (draft && (draft.chatId || "") === (saved?.id || "")) {
          if (typeof draft.text === "string") { setText(draft.text.slice(0,4000)); restoredDraft = true; }
          if (Array.isArray(draft.imageIds)) setImageIds(draft.imageIds.filter((id:unknown) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id)).slice(0,15));
          const sent = draft.pending;
          if (sent && saved?.messages.some(message => message.role === "assistant" && message.requestId === sent.id) && draft.text === sent.text) { setText(""); setImageIds([]); }
          if (sent && typeof sent.text === "string" && sent.text.length <= 4000 && typeof sent.id === "string" && /^[a-f0-9-]{36}$/.test(sent.id) && Array.isArray(sent.imageIds) && sent.imageIds.every((id:unknown) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id)) && !saved?.messages.some(message => message.role === "assistant" && message.requestId === sent.id)) {
            pending.current=sent; setText(sent.text); setImageIds(sent.imageIds);
          }
        }
      } catch { /* A missing or unavailable local draft does not affect the saved chat. */ }
      const last = saved?.messages.at(-1);
      if (last?.role === "user") { pending.current = {text:last.text,imageIds:last.detail.imageIds || [],id:last.requestId}; if(!restoredDraft) { setText(last.text); setImageIds(last.detail.imageIds || []); } }
      setDraftKey(key);
    })().catch(error => { if (!cancelled) { setRestoreError(true); setError(error instanceof Error ? error.message : String(error)); } }).finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, [shopId, published, context?.revision, restoreRetry]);
  useEffect(() => {
    if (!draftKey || restoring) return;
    try { localStorage.setItem(draftKey, JSON.stringify({chatId:chat?.id || "",text,imageIds,pending:pending.current})); } catch { /* Server conversation remains available. */ }
  }, [draftKey, restoring, chat?.id, chat?.messages.length, text, imageIds]);
  useEffect(() => {
    if (!chat) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const progress = await api<ChatGeneration|null>(`${prefix}/conversations/${chat.id}/progress`);
        if (cancelled) return;
        if (progress && (!planning.current || progress.chat.requestId === generation?.chat.requestId)) {
          setGeneration(progress);
          setGenerationStale(Date.now() - progress.updatedAt > 5 * 60000);
          if (progress.stage === "complete" && progress.base === context?.revision) {
            const saved = await reload(chat.id);
            if (!cancelled && !published) { const plan = saved?.plans?.find(plan => plan.id === progress.planId); if (plan) setViewPlan(plan); }
          }
        }
        if (planning.current || progress && !["complete", "failed"].includes(progress.stage)) timer = setTimeout(() => void poll(), 2000);
      } catch { if (!cancelled) { setGenerationStale(!!generation && Date.now()-generation.updatedAt > 5*60000); timer = setTimeout(() => void poll(), 4000); } }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [chat?.id, watch, restoring]);
  async function reload(id=current.current?.id) {
    if (!id) return;
    const saved = await api<ChatData>(`${prefix}/conversations/${id}`);
    if (alive.current && (!current.current || current.current.id===id)) acceptChat(saved);
    return saved;
  }
  useEffect(()=>{if(!published&&legacyPlan||interrupted)setViewPlan(legacyPlan);},[legacyPlan?.id,interrupted?.id]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[shopId]);
  useEffect(()=>{if(log.current)log.current.scrollTop=log.current.scrollHeight;},[chat?.messages.length,viewPlan?.id,error,busy]);
  useEffect(()=>{if(chat&&!viewPlan&&!busy)composer.current?.focus();},[chat?.id,viewPlan?.id,busy]);
  async function run(action:()=>Promise<void>) {setBusy(true);setError("");try{await action();}catch(error){if(alive.current)setError(error instanceof Error?error.message:String(error));}finally{if(alive.current)setBusy(false);}}
  async function ensureChat(begin=true) {
    if(current.current)return current.current;
    const saved=await api<ChatData>(`${prefix}/conversations`,{intent,requestId:creationId.current,begin});
    if(!alive.current)throw new Error(tr("画面を開き直してください"));
    acceptChat(saved);return saved;
  }
  async function returnToChat() {
    const reference=viewPlan?.chat;
    if(reference&&current.current?.id!==reference.id) {
      const saved=await api<ChatData>(`${prefix}/conversations/${reference.id}`);
      if(!alive.current)return;
      acceptChat(saved);
    } else if(!current.current) await ensureChat(false);
    // The chat is open now, so an earlier failed restoration no longer replaces it with the retry screen.
    if(alive.current){setRestoreError(false);setViewPlan(undefined);}
  }
  // The images are the ones sent with that message; the composer is cleared after sending.
  async function createPlan(requestText:string,reference:ChatReference,images:string[]=[]) {
    planning.current=true;
    setGenerationStale(false);
    setGeneration({shopId,email:current.current?.email || "",chat:reference,base:context?.revision || 0,stage:"preparing",attempts:0,startedAt:Date.now(),updatedAt:Date.now()});
    setWatch(value=>value+1);
    let next:Plan;
    try { next=await onPlan(requestText,images,intent,reference); }
    catch(error) { if(alive.current)setGeneration(value=>value?{...value,stage:"failed"}:undefined); throw error; }
    finally { planning.current=false; }
    if(!alive.current)return;
    setGeneration(undefined);
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
    try { if(draftKey)localStorage.setItem(draftKey,JSON.stringify({chatId:saved.id,text:"",imageIds:[],pending:pending.current})); } catch { /* Keep sending when local storage is unavailable. */ }
    const sentImages=[...imageIds];
    const optimistic:ShopChatMessage={id:`pending-${requestId}`,shopId,conversationId:saved.id,email:saved.email,role:"user",text:value,requestId,sequence:saved.messages.length+1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),detail:{imageIds:sentImages}};
    acceptChat({...saved,messages:[...saved.messages.filter(message=>message.requestId!==requestId),optimistic]});
    setText("");setImageIds([]);
    let reply:{answer:string;changeRequest:boolean;ready?:boolean;chat:SavedChat};
    try {
      reply=await api(`${prefix}/system/question`,{question:value,intent,imageIds:sentImages,...context,chat:{id:saved.id,requestId}});
    } catch(error) {if(alive.current){setText(value);setImageIds(sentImages);}await reload(saved.id).catch(()=>{});throw error;}
    if(!alive.current)return;
    // The message is saved. A later proposal failure must not restore it as a draft.
    pending.current=undefined;
    acceptChat({...reply.chat,plans:current.current?.plans});
    if(intent!=="consult"&&reply.changeRequest&&reply.ready!==false&&isOwner)await createPlan(value,{id:saved.id,requestId},sentImages);
  }
  async function start(next:RequestIntent) {dictationStop.current?.();creationId.current=createRequestId();const saved=await api<ChatData>(`${prefix}/conversations`,{intent:next,requestId:creationId.current,begin:true});if(!alive.current)return;acceptChat(saved);setGeneration(undefined);setIntent(next);setViewPlan(undefined);setPlans([]);setText("");setImageIds([]);setError("");pending.current=undefined;}
  const description=!published?(chat?tr("AIの質問に答えながら、直したいことや追加したいことを伝えられます。"):tr("「はじめる」を押して、AIの質問に答えながらお店のページをつくります。")):intent==="consult"?tr("質問や使い方について相談できます。お店の設定は変更しません。"):intent==="modify"?tr("直したいことや追加したいページを伝えてください。AIと話しながら内容をまとめられます。"):tr("作りたいページを教えてください。本文とメニュー名を、AIと話しながら決められます。");
  const messages=chat?.messages || [];
  const extraPages=viewPlan?.config.pages.filter(page=>!currentConfig?.pages.some(existing=>existing.id===page.id)) || [];
  const reviewContent=viewPlan&&<section className="request-review" aria-label={tr("変更案の確認")}><h3>{intent==="new-page"?tr("このページを追加してよいですか？"):tr("このように変更してよいですか？")}</h3><ul className="check-list">{viewPlan.summary.map((summary,index)=><li key={index}>{summary}</li>)}</ul><ScreenGallery key={viewPlan.id} config={viewPlan.config} previousConfig={currentConfig} shopId={shopId}/>{extraPages.length>0&&<section className="new-page-review" aria-label={tr("追加するページ")}><h4>{tr("追加するページとメニュー")}</h4>{extraPages.map(page=><div key={page.id}><h5>{page.title}</h5><p>{tr("お客様向けのメニューに「")}{page.navigationLabel}{tr("」を追加します。")}</p><details open><summary>{tr("ページの内容を見る")}</summary><CustomPage page={page} imageBase={`${prefix}/images`}/></details></div>)}</section>}<p>{viewPlan.base===context?.revision?tr("まだ反映していません。直したいことは、修正チャットで続けて伝えられます。"):tr("以前の変更案です。今の設定に合わせて直す場合は、チャットで続けて依頼してください。")}</p><div className="actions"><button type="button" onClick={()=>{setViewPlan(undefined);onReturnToChat?.();}}>{tr("チャットに戻る")}</button><button type="button" className="primary" disabled={working||viewPlan.base!==context?.revision} onClick={()=>void run(()=>onAccept(viewPlan))}>{viewPlan.approved?tr("反映を再試行"):tr("変更内容を反映する")}</button></div></section>;
  const review = reviewHost && reviewContent ? createPortal(reviewContent, reviewHost) : reviewContent;
  if(restoring&&!viewPlan)return <p role="status">{tr("保存した会話を読み込んでいます…")}</p>;
  if(restoreError&&!viewPlan)return <div className="alert" role="alert"><p>{error}</p><button onClick={()=>setRestoreRetry(value=>value+1)}>{tr("もう一度読み込む")}</button></div>;
  if(published&&!isOwner)return <p className="muted">{tr("変更は店主が行います。質問はメニューの「相談・質問」からどうぞ。")}</p>;
  if(!published&&viewPlan)return <div className="shop-request">{error&&<p className="alert" role="alert">{error}</p>}<InitialPlanReview shopId={shopId} plan={viewPlan} busy={working} onBack={()=>void run(returnToChat)} onAccept={()=>void run(()=>onAccept(viewPlan))}/></div>;
  return <div className="shop-request shop-chat">
    {published&&chat&&<div className="request-intents-reset"><button type="button" className="primary chat-new-conversation" aria-describedby="new-conversation-hint" disabled={working} onClick={()=>void run(()=>start("modify"))}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>{tr("新しい会話をはじめる")}</button><p id="new-conversation-hint" className="small muted">{tr("話題を変えるときは新しい会話をはじめると、AIが前の話題と混同しにくくなります。")}</p></div>}
    <p>{description}</p>
    {!chat&&error&&<p className="alert" role="alert">{error}</p>}
    {/* An unfinished publication is retried from here, even before a chat is opened. */}
    {!chat&&interrupted&&review}
    {!chat?<div className={!published?"onboarding-request":undefined}><div><button className="primary begin-consultation" type="button" disabled={working} onClick={()=>void run(async()=>{await ensureChat();})}>{working?tr("準備しています…"):tr("はじめる")}</button></div>{!published&&<OnboardingGuide/>}</div>:<>
    <div ref={log} className="chat-log" role="log" aria-label={tr("AIとのチャット")} aria-live="polite">
      {messages.length?messages.map(message=><article key={message.id} className={`chat-message chat-message-${message.role}`}><b>{message.role==="user"?tr("あなた"):"AI"}</b><div className="pre-wrap">{message.text}</div>{message.detail.partial&&<small>{tr("途中で終了した会話です")}</small>}{message.detail.imageIds?.length?<div className="chat-message-images" aria-label={tr("添付した画像")}>{message.detail.imageIds.map((id,index)=><MenuImage key={id} imageId={id} imageBase={`${prefix}/images`} name={tr("添付画像{0}",index+1)} className="chat-message-image"/>)}</div>:null}{message.detail.planId&&<button type="button" disabled={working} onClick={()=>{const target=plans.find(plan=>plan.id===message.detail.planId);if(target)setViewPlan(target);}}>{!published?tr("画面イメージを確認する"):tr("変更案を確認する")}</button>}{message.role==="assistant"&&!message.detail.planId&&message.detail.changeRequest&&message.detail.ready&&isOwner&&intent!=="consult"&&chat&&<button type="button" disabled={working} onClick={()=>{const sent=messages.find(item=>item.requestId===message.requestId&&item.role==="user");void run(()=>createPlan(sent?.text||message.text,{id:chat.id,requestId:message.requestId},sent?.detail.imageIds||[]));}}>{working?(!published?tr("画面イメージを作成しています…"):tr("変更プランを作成しています…")):(!published?tr("画面イメージを作成する"):tr("変更案を作る"))}</button>}</article>):<p className="chat-empty">{intent==="new-page"?tr("例：初めてのお客様向けに、よくある質問のページを追加したいです。"):intent==="modify"?tr("例：水曜日もお休みにしたいです。"):intent==="create-shop"?tr("作成した案の、直したいところを伝えてください。"):tr("例：指名なしの予約は、どのように決まりますか？")}</p>}
      {error&&<p className="alert" role="alert">{error}</p>}
      {busy&&!generationRunning&&<p role="status">{tr("AIが考えています…")}</p>}
    </div>
    {generation && generation.stage!=="complete" && <PlanProgress generation={generation} shopId={shopId}/>}
    {generationStale&&generationRunning&&<p className="notice">{tr("処理状況を確認しています。しばらく変わらない場合は、画面イメージの作成を再試行できます。")}</p>}
    {review}
    <form className="chat-composer" aria-label={tr("メッセージの入力")} onSubmit={event=>{event.preventDefault();dictationStop.current?.();void run(()=>send());}}>
      <textarea ref={composer} aria-label={tr("AIに伝えたいこと")} aria-keyshortcuts="Control+Enter Meta+Enter" onKeyDown={event=>submitOnShortcut(event)} rows={3} required maxLength={4000} disabled={working} value={text} onChange={event=>setText(event.target.value)} placeholder={tr("メッセージを入力…")}/>

      <div className="chat-composer-toolbar">
        {isOwner&&<RequestImagePicker shopId={shopId} value={imageIds} onChange={setImageIds} disabled={working||listening} label={tr("画像を添付")}/>}
        {isOwner&&<DictationButton value={text} onChange={setText} onSend={value=>void run(()=>send(value))} onListening={setListening} stopRef={dictationStop} disabled={working}/>}
        <button type="submit" className="primary chat-send" disabled={working||!text.trim()}>{tr("送信")}</button>
      </div>
    </form>
    </>}
  </div>;
}
