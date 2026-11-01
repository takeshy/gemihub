import React, { useEffect, useState } from "react";
import { ConfigSummary, type Plan } from "./App";
import { useApi } from "./api";
import { VoiceInput } from "./VoiceInput";
import { RequestImagePicker } from "./RequestImagePicker";
type Message = { role: "user" | "assistant"; text: string };
export function ShopRequest({ shopId, published, isOwner, context, plan, onPlan, onAccept }: { shopId: string; published: boolean; isOwner: boolean; context?: { revision: number; hash: string }; plan?: Plan; onPlan: (text: string, imageIds?: string[]) => Promise<Plan>; onAccept: (plan: Plan) => Promise<void> }) {
  const api = useApi();
  const [mode, setMode] = useState<"text" | "voice">();
  const [stage, setStage] = useState<"request" | "review" | "done">(plan && !plan.approved ? "review" : "request");
  const [result, setResult] = useState<{ answer: string; plan?: Plan }>(plan && !plan.approved ? { answer: "ご依頼の内容をもとにプランを作成しました。", plan } : { answer: "" });
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (plan && !plan.approved) { setResult({ answer: "ご依頼の内容をもとにプランを作成しました。", plan }); setStage("review"); } }, [plan?.id]);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function propose(request: string, answer = "ご依頼の内容をもとにプランを作成しました。") {
    const input = [...messages, { role: "user" as const, text: request }].slice(-16);
    const prompt = ("会話で依頼された変更だけを提案する。質問への回答だけの事項は変更しない。\n" + input.map(m => `${m.role === "user" ? "店主" : "AI"}: ${m.text}`).join("\n")).slice(-10000);
    const next = await onPlan(prompt, imageIds);
    setMessages([...input, { role: "assistant", text: answer }]);
    setResult({ answer, plan: next }); setStage("review");
  }
  async function request() {
    if (!published || !context) { await propose(text); return; }
    const response = await api<{ answer: string; changeRequest: boolean; ready?: boolean }>(`/api/shops/${shopId}/system/question`, { question: text, imageIds, ...context, messages: messages.slice(-24) });
    if (response.changeRequest && response.ready !== false && isOwner) await propose(text, response.answer);
    else { setMessages([...messages, { role: "user", text }, { role: "assistant", text: response.answer }]); setResult({ answer: response.answer }); setStage("review"); }
  }
  return <div className="shop-request">
    {error && <p className="alert" role="alert">{error}</p>}
    {stage === "request" && <>
      <div className="request-methods" role="group" aria-label="依頼方法">
        <button className={mode === "text" ? "selected" : ""} aria-pressed={mode === "text"} disabled={busy} onClick={() => setMode("text")}><span aria-hidden="true">✎</span><b>文章で依頼</b><small>質問や要望を書く</small></button>
        {isOwner && <button className={mode === "voice" ? "selected" : ""} aria-pressed={mode === "voice"} disabled={busy} onClick={() => setMode("voice")}><span aria-hidden="true">◉</span><b>音声で依頼</b><small>AIと話して伝える</small></button>}
      </div>
      {mode && isOwner && <RequestImagePicker shopId={shopId} value={imageIds} onChange={setImageIds} disabled={busy} />}
      {mode === "text" && <form onSubmit={e => { e.preventDefault(); void run(request); }}><label>質問・変更したいこと<textarea rows={5} required maxLength={4000} value={text} disabled={busy} onChange={e => setText(e.target.value)} placeholder={published ? "指名なしの予約はどう決まる？／水曜日もお休みにしたい" : "お店の名前、メニューや料金、スタッフ、営業時間などを教えてください。"} /></label><button className="primary" disabled={busy || !text.trim()}>{busy ? "結果を準備しています…" : "依頼して結果を確認"}</button></form>}
      {mode === "voice" && <VoiceInput shopId={shopId} imageIds={imageIds} published={published} voiceOnly consultation={context ? { ...context, allowChanges: isOwner } : undefined} messages={messages.slice(-24)} disabled={busy} onText={() => {}} onPlan={request => run(async () => propose(request))} onAnswer={response => { setMessages([...messages, { role: "user", text: response.text || "音声での相談" }, { role: "assistant", text: response.answer }]); setResult({ answer: response.answer }); setStage("review"); }} />}
    </>}
    {stage === "review" && <section className="request-review" aria-label="依頼の結果を確認">
      <span className="pill">確認</span><h3>依頼の結果を確認</h3><p className="pre-wrap">{result.answer}</p>
      {result.plan && <><ul className="check-list">{result.plan.summary.map((summary, i) => <li key={i}>✓ {summary}</li>)}</ul><details><summary>変更案の詳しい内容</summary><ConfigSummary config={result.plan.config} /><details><summary>すべての設定を確認</summary><pre>{JSON.stringify(result.plan.config, null, 2)}</pre></details></details><p className="small muted">これでOKを選ぶと変更案を承認します。続いてプレビューで確認して公開できます。</p></>}
      <div className="actions"><button disabled={busy} onClick={() => { setStage("request"); setMode(undefined); setText(""); setError(""); }}>さらに依頼する</button><button className="primary" disabled={busy} onClick={() => void run(async () => { if (result.plan) await onAccept(result.plan); setStage("done"); })}>これでOK</button></div>
    </section>}
    {stage === "done" && <div className="notice" role="status"><p>{result.plan ? "変更案を承認しました。プレビューで確かめてから公開してください。" : "回答を確認しました。"}</p><button onClick={() => { setStage("request"); setMode(undefined); setText(""); setImageIds([]); setMessages([]); }}>新しい依頼をする</button></div>}
  </div>;
}
