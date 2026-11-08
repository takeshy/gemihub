import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "../shared/i18n";
import type { ShopChat, ShopConversation } from "../server/shop-chat";
import { useApi } from "./api";
import { createRequestId } from "./request-id";
import { assistantStorageKey, migrateAssistantHistory } from "./assistant-storage";

export function ConsultationWorkspace({ children, ...props }: Omit<React.ComponentProps<typeof ConsultationHistory>, "collapsed" | "onToggle"> & { children: React.ReactNode }) {
  const preferenceKey = `gemihub:consultation-pane:${props.shopId}:${props.email}`;
  const [collapsed, setCollapsed] = useState(() => {
    try { const saved = localStorage.getItem(preferenceKey); if (saved) return saved === "collapsed"; } catch { /* Optional display preference. */ }
    return window.matchMedia("(max-width: 900px)").matches;
  });
  useEffect(() => { try { localStorage.setItem(preferenceKey, collapsed ? "collapsed" : "open"); } catch { /* Optional display preference. */ } }, [preferenceKey, collapsed]);
  return <div className={`consultation-workspace${collapsed ? " consultation-history-collapsed" : ""}`}>
    <ConsultationHistory {...props} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} />
    <div className="consultation-conversation">{children}</div>
  </div>;
}

/** Panel outline and double chevrons indicate which pane moves and in which direction. */
function HistoryPaneIcon({ collapsed }: { collapsed: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 28 24" width="28" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="3" width="25" height="18" rx="2.5" /><path d="M8 3v18" />
    <path d={collapsed ? "m12 8 4 4-4 4m6-8 4 4-4 4" : "m17 8-4 4 4 4m6-8-4 4 4 4"} />
  </svg>;
}

export function ConsultationHistory({ shopId, email, active, selected, revision, onSelect, collapsed = false, onToggle }: {
  shopId: string; email: string; active: boolean; selected?: string; revision: number;
  onSelect: (id?: string, replace?: boolean) => void;
  collapsed?: boolean; onToggle?: () => void;
}) {
  const api = useApi();
  const bodyId = useId();
  const [items, setItems] = useState<ShopConversation[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [remove, setRemove] = useState<ShopConversation>();
  const [deleteError, setDeleteError] = useState("");
  const creating = useRef(false), creationId = useRef<string | undefined>(undefined), suppressDefault = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (remove) dialog.current?.showModal(); }, [remove]);
  async function load() {
    const result = await api<{conversations:ShopConversation[]}>(`/api/shops/${shopId}/conversations`);
    return result.conversations.filter(chat => chat.intent === "consult");
  }
  useEffect(() => {
    let alive = true;
    void (async () => {
      setError("");
      await migrateAssistantHistory(api, shopId, email);
      const next = await load(); if (alive) setItems(next);
    })().catch(error => { if (alive) setError(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; };
  }, [shopId, email, revision, retry]);
  async function create(replace = false) {
    if (creating.current) return;
    creating.current = true; setBusy(true); setError("");
    creationId.current ||= createRequestId();
    try {
      const chat = await api<ShopChat>(`/api/shops/${shopId}/conversations`, {intent:"consult",requestId:creationId.current});
      if (!alive.current) return;
      creationId.current = undefined; suppressDefault.current = false;
      setItems(await load()); onSelect(chat.id, replace);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { creating.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!active || selected || !items || error || suppressDefault.current) return;
    if (items.length) onSelect(items[0].id, true); else void create(true);
  }, [active, selected, items, error]);
  async function destroy() {
    if (!remove || busy) return;
    setBusy(true); setDeleteError("");
    try {
      await api(`/api/shops/${shopId}/conversations/${remove.id}/delete`, {confirmed:true});
      try {
        localStorage.removeItem(assistantStorageKey(shopId,email,remove.id));
        const legacy = assistantStorageKey(shopId,email);
        if (localStorage.getItem(`${legacy}:migrated`) === remove.id) localStorage.removeItem(legacy);
      } catch { /* The server copy is deleted even if local storage is unavailable. */ }
      const next = await load(); if (!alive.current) return; setItems(next);
      if (selected === remove.id) { suppressDefault.current = !next.length; onSelect(next[0]?.id, true); }
      setRemove(undefined);
    } catch (error) { setDeleteError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const toggleLabel = collapsed ? tr("過去の相談を開く") : tr("過去の相談を折り畳む");
  return <section className="consultation-history" aria-label={tr("過去の相談")}>
    <div className="consultation-history-heading">
      {!collapsed && <h2>{tr("過去の相談")}{items && <span className="consultation-count" aria-hidden="true">{items.length}</span>}</h2>}
      <button type="button" className="consultation-history-toggle" aria-label={toggleLabel} title={toggleLabel} aria-expanded={!collapsed} aria-controls={bodyId} onClick={onToggle}>
        <HistoryPaneIcon collapsed={collapsed} />{collapsed && <span>{tr("履歴")}</span>}
      </button>
    </div>
    <div id={bodyId} className="consultation-history-body" hidden={collapsed}>
      <button type="button" className="consultation-new" disabled={busy} onClick={() => void create()}>{tr("＋新規の相談")}</button>
      {error && <div className="consultation-error" role="alert"><p>{error}</p><button disabled={busy} onClick={() => setRetry(value => value + 1)}>{tr("もう一度読み込む")}</button></div>}
      {!items && !error && <p className="small muted" role="status">{tr("読み込み中…")}</p>}
      {items?.length === 0 && <p className="small muted">{tr("過去の相談はありません。")}</p>}
      <nav aria-label={tr("過去の相談")}><ul>{items?.map(chat => <li key={chat.id}><button type="button" title={chat.title} className={active && selected === chat.id ? "active" : ""} aria-current={active && selected === chat.id ? "page" : undefined} onClick={() => onSelect(chat.id)}>{chat.title}</button><button type="button" className="consultation-delete" disabled={busy} aria-label={tr("「{0}」の相談を削除", chat.title)} onClick={() => { setDeleteError(""); setRemove(chat); }}>×</button></li>)}</ul></nav>
    </div>
    {remove && createPortal(<dialog ref={dialog} className="consultation-delete-dialog" aria-label={tr("相談を削除")} onCancel={event => { event.preventDefault(); if (!busy) setRemove(undefined); }}>
      <h2>{tr("この相談を削除しますか？")}</h2><p>{remove.title}</p><p>{tr("この相談の会話と書きかけを削除します。他の相談は残ります。")}</p>
      {deleteError && <p className="alert" role="alert">{deleteError}</p>}
      <div className="actions"><button type="button" autoFocus disabled={busy} onClick={() => setRemove(undefined)}>{tr("やめる")}</button><button type="button" className="danger" disabled={busy} onClick={() => void destroy()}>{tr("削除する")}</button></div>
    </dialog>, document.body)}
  </section>;
}
