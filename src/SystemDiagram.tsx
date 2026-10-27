import React, {useEffect, useState} from "react";
import {useApi} from "./api";
import type {shopSystem} from "../server/shop-system";
export function SystemDiagram({shopId, published, isOwner, onChange}: {shopId: string; published: boolean; isOwner: boolean; onChange: (text: string) => void}) {
  const api = useApi();
  const [data, setData] = useState<{diagram: ReturnType<typeof shopSystem>; svg: string; overview: string; revision: number}>();
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<{answer: string; changeRequest: boolean}>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setError(""); setResponse(undefined); setData(undefined);
    try { setData(await api(`/api/shops/${shopId}/system`)); }
    catch(e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { if (published) void load(); }, [shopId, published]);
  if (!published) return <div className="panel">お店を公開すると、予約の流れとデータの保存先を図で確認できます。</div>;
  return <div className="panel system-panel">
    <div className="section-top"><h2>お店の仕組み図</h2><button onClick={load}>図を更新</button></div>
    <p className="muted">最後に公開した設定の図です。シートで直接編集した未公開の変更は含みません。Google 未接続のデモではサーバー内だけに保存します。</p>
    {error && <p className="alert" role="alert">{error}</p>}
    {data && <>
      <a className="button" download="system.svg" href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg)}`}>仕組み図を保存</a>
      <img className="system-overview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.overview)}`} alt={`${data.diagram.name}：予約の流れ、${data.diagram.sections[1].lines[0]}、店主のシート・ドライブとメールへの流れ`} />
      <details className="system-details"><summary>設定と保存先の詳しい説明</summary>
      <div className="system-flow" aria-label={`${data.diagram.name}の予約とデータの流れ`}>
        {data.diagram.sections.map(s => <React.Fragment key={s.title}><section className="system-card"><h3>{s.title}</h3><ul>{s.lines.map((line, i) => <li key={i}>{line}</li>)}</ul></section><div className="system-arrow" aria-hidden="true">↓</div></React.Fragment>)}
      </div>
      </details>
      <form onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError(""); setResponse(undefined);
        try { setResponse(await api(`/api/shops/${shopId}/system/question`, {question, revision: data.revision})); }
        catch(e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
      }}>
        <label>仕組み図について質問<textarea required maxLength={4000} value={question} onChange={e => { setQuestion(e.target.value); setResponse(undefined); }} placeholder="指名なしのとき、誰に予約が入るの？"/></label>
        <button disabled={busy || !question.trim()}>{busy ? "確認しています…" : "このお店の仕組みを聞く"}</button>
      </form>
      {response && <div className="notice"><p className="pre-wrap">{response.answer}</p><p className="small">回答は説明のみです。設定の変更は、プランの確認・承認・公開が必要です。</p>{isOwner && <button onClick={() => onChange(question)}>この内容から変更プランを相談する →</button>}</div>}
    </>}
  </div>;
}
