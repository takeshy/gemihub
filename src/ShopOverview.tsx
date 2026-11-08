import { tr } from "../shared/i18n";
import { useShopDisplay } from "./money";
import type { ChatReference } from "../server/shop-chat";
import type { RequestIntent } from "../server/request-intent";
import React, { useEffect, useRef, useState } from "react";
import type { ShopConfig } from "../server/domain";
import { useApi } from "./api";
import { ShopRequest } from "./ShopRequest";
import { ScreenList } from "./ScreenGallery";
import { EditingChatPanel } from "./EditingChatPanel";
import type { Plan } from "./App";
export type BuildContext = { config: ShopConfig | null; published: boolean; revision: number; hash: string; history: { at: string; summary: string }[] };
export function ShopOverview({ shopId, isOwner, onPlan, onAccept, plan, focusRequest = false, initialIntent }: {
  initialIntent?: RequestIntent; focusRequest?: boolean; shopId: string; isOwner: boolean;
  onPlan: (text: string, context: Pick<BuildContext, "revision" | "hash">, imageIds?: string[], intent?: RequestIntent, chat?: ChatReference) => Promise<Plan>;
  onAccept: (plan: Plan) => Promise<void>; plan?: Plan;
}) {
  const api = useApi();
  const { shopTime } = useShopDisplay();
  const [data, setData] = useState<BuildContext>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [chatOpen, setChatOpen] = useState(focusRequest);
  const [reopenSignal, setReopenSignal] = useState(0);
  const editButton = useRef<HTMLButtonElement>(null);
  const [reviewHost, setReviewHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => { if (focusRequest) setChatOpen(true); }, [focusRequest]);
  async function refresh() {
    setLoading(true); setError("");
    try { setData(await api<BuildContext>(`/api/shops/${shopId}/build-context`)); setGeneration(v => v + 1); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  async function retryPublication() {
    if (!plan?.approved) return;
    setLoading(true); setError("");
    try { await onAccept(plan); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [shopId]);
  const config = data?.config;
  return <div className="shop-build-layout shop-changes">
    {error && <div className="alert" role="alert"><p>{error}</p><button disabled={loading || planning} onClick={() => void refresh()}>{tr("もう一度読み込む")}</button></div>}
    {/* Recovery remains available even when an interrupted publish blocks build-context. */}
    {!data && isOwner && plan?.approved && <section className="panel request-review" data-publication-recovery aria-label={tr("中断した公開")}>
      <h3>{tr("中断した公開")}</h3><p>{tr("承認済みの変更を使って、保存・反映を再試行します。")}</p>
      <ul>{plan.summary.map((summary, index) => <li key={index}>{summary}</li>)}</ul>
      <button className="primary" disabled={loading || planning} onClick={() => void retryPublication()}>{tr("反映を再試行")}</button>
    </section>}
    <section className="page-change-inventory" aria-label={tr("ページ追加・機能変更")}>
      <div className="editor-toolbar"><strong>{tr("ページ追加・機能変更")}</strong>{isOwner && <div className="editor-tools"><button ref={editButton} type="button" className={`editor-pen-button${chatOpen ? " selected" : ""}`} disabled={loading || !config} aria-pressed={chatOpen} onClick={() => { setChatOpen(true); setReopenSignal(value => value + 1); }}><svg className="editor-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg>{tr("修正する")}</button></div>}</div>
    <details className="panel design-version-history shop-change-history" aria-label={tr("お店の変更履歴")}>
      <summary>{tr("変更履歴")} <span className="small muted">{data ? tr("{0}件", data.history.length) : tr("読み込み中…")}</span></summary>
      {data && !data.history.length && <p className="muted">{tr("まだ変更履歴はありません。")}</p>}
      <ol>{[...(data?.history || [])].reverse().map((entry, i) => <li key={`${entry.at}-${i}`}><time dateTime={entry.at}>{shopTime(entry.at)}</time><p>{entry.summary}</p></li>)}</ol>
    </details>
      <section className="panel page-change-screens">
      <p>{tr("新しいページの追加や、お店の機能の変更を依頼できます。画面の見た目は、左のメニューで「ページ全体」または各画面を選んで修正してください。")}</p>
      <h2>{tr("現在の画面一覧")}</h2>
      {config ? <ScreenList config={config} /> : <p role="status">{loading ? tr("読み込み中…") : tr("設定を読み込めませんでした。もう一度読み込んでください。")}</p>}
      </section>
    </section>
    <div ref={setReviewHost} className="shop-change-review" />
    {data && config && isOwner && <EditingChatPanel reopenSignal={reopenSignal} open={chatOpen} title={tr("ページ追加・機能変更")} onClose={() => { setChatOpen(false); editButton.current?.focus({ preventScroll: true }); }}>
      <ShopRequest key={`${data.hash}-${generation}`} shopId={shopId} autoStart={chatOpen} reviewHost={reviewHost} onReturnToChat={() => { setChatOpen(true); setReopenSignal(value => value + 1); }} onBusyChange={setPlanning} initialIntent={initialIntent} published={data.published} isOwner={isOwner} context={{ revision: data.revision, hash: data.hash }} currentConfig={config} plan={plan} onAccept={onAccept} onPlan={(text, imageIds, intent, chat) => onPlan(text, { revision: data.revision, hash: data.hash }, imageIds, intent, chat)} />
    </EditingChatPanel>}

  </div>;
}
