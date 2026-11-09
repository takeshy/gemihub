import React, { useEffect, useRef, useState } from "react";
import { tr, intlLocale } from "../shared/i18n";
import { useApi } from "./api";
import { createRequestId } from "./request-id";
import type { DesignPublication } from "../server/design-versions";

type VersionList = {
  /** `same`: the whole design already equals this version, so restoring it would change nothing. */
  versions: (DesignPublication & { same?: boolean })[];
  current: DesignPublication | null;
  revision: number;
  publishing: boolean;
  /** `target` is the restore's target key ("all" for the whole design). */
  pendingRestore: { requestId: string; number: number; target: string } | null;
};
/**
 * Without `target`, versions restore the whole design. With a target key ("screen:about",
 * "page:<id>", "part:header"), only versions whose state of that screen differs from now are
 * listed, and restoring replaces just that screen.
 */
export function DesignVersionHistory({ shopId, revision, timeZone, disabled = false, onRestored, target, targetLabel }: { shopId: string; revision?: number; timeZone?: string; disabled?: boolean; onRestored: () => Promise<unknown>; target?: string; targetLabel?: string }) {
  const api = useApi();
  const [list, setList] = useState<VersionList>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const key = target || "all";
  const label = targetLabel || tr("この画面");
  // Retain the ID if a response is lost, including after the server has committed.
  const attempt = useRef<{ number: number; requestId: string; revision: number; target: string } | undefined>(undefined);
  const path = `/api/shops/${shopId}/design-versions${target ? `?target=${encodeURIComponent(target)}` : ""}`;
  async function load() {
    const next = await api<VersionList>(path);
    setList(next);
    return next;
  }
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError("");
    void api<VersionList>(path).then(next => { if (active) setList(next); }).catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [path, revision, api, open]);
  const pendingHere = !!list?.pendingRestore && list.pendingRestore.target === key;
  // An unconfirmed attempt is only reusable while production is still at the revision it was made against.
  const reusable = (number: number) => !!list && attempt.current?.number === number && attempt.current.target === key && (pendingHere || attempt.current.revision === list.revision);
  async function restore(number: number, interrupted?: VersionList["pendingRestore"]) {
    if (!list || busy) return;
    setBusy(true); setError(""); setNotice("");
    const restoreKey = interrupted?.target || key;
    const pending = interrupted || (pendingHere ? list.pendingRestore : null);
    const requestId = pending?.number === number ? pending.requestId : reusable(number) ? attempt.current!.requestId : createRequestId();
    const request = { number, requestId, revision: list.revision, target: restoreKey };
    attempt.current = request;
    try {
      await api(`/api/shops/${shopId}/design-versions/${number}/restore`, { requestId: request.requestId, revision: request.revision, ...(restoreKey !== "all" ? { target: restoreKey } : {}) });
      attempt.current = undefined;
      setNotice(restoreKey !== key ? tr("中断した復元を完了しました。復元前の状態も版履歴に保存しました。") : target ? tr("「{0}」を版 {1} のデザインに戻しました。復元前の状態も版履歴に保存しました。", label, number) : tr("版 {0} のデザインに戻しました。復元前の状態も版履歴に保存しました。", number));
      await load();
      await onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      const next = await load().catch(() => undefined);
      if (next && !next.pendingRestore && next.revision !== request.revision) attempt.current = undefined;
    } finally { setBusy(false); }
  }
  async function cancelPending() {
    if (!list?.pendingRestore || busy) return;
    if (!window.confirm(tr("中断した復元を取り消し、今の公開状態のまま予約受付を再開します。よろしいですか？"))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/shops/${shopId}/design-versions/restore/cancel`, { requestId: list.pendingRestore.requestId });
      attempt.current = undefined;
      setNotice(tr("中断した復元を取り消しました。デザインは復元前のままです。"));
      await load();
      await onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load().catch(() => undefined);
    } finally { setBusy(false); }
  }
  return <details className="panel design-version-history" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{target ? tr("「{0}」の版履歴", label) : tr("版履歴")}{list ? ` (${list.versions.length})` : ""}</summary>
    <p className="small muted">{target
      ? tr("「{0}」のデザインだけを過去の版に戻せます。今と違う状態の版だけを表示します。復元前の状態も版履歴に保存するので、続けて戻せます。料金・営業時間・予約などの運用データと下書きは変わりません。", label)
      : tr("公開前のデザインを直近10版まで保存します。復元前の状態も自動保存するので、続けて戻すことができます。料金・営業時間・予約などの運用データと下書きは変わりません。")}</p>
    {error && <p className="alert" role="alert">{error} <button disabled={busy} onClick={() => { setError(""); void load().catch(e => setError(e instanceof Error ? e.message : String(e))); }}>{tr("更新確認")}</button></p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!list && !error && <p role="status">{tr("版履歴を読み込んでいます…")}</p>}
    {list && !list.versions.length && <p className="design-version-empty">{target ? tr("「{0}」の今と違うデザインは、まだ版履歴にありません。", label) : tr("保存された版はまだありません。次にデザインを公開すると、現在の公開状態がここに保存されます。")}</p>}
    {list?.pendingRestore && <div className="notice"><p>{pendingHere ? tr("復元が未完了です。同じ版の復元を再試行してください。") : tr("ほかの画面の復元が未完了です。この画面から再試行できます。")}</p>
      {!pendingHere && <button disabled={disabled || busy} onClick={() => void restore(list.pendingRestore!.number, list.pendingRestore)}>{tr("中断した復元を再試行")}</button>}
      {" "}<button disabled={busy} onClick={() => void cancelPending()}>{tr("復元を取り消す")}</button>
    </div>}
    {list?.publishing && !list.pendingRestore && <p className="notice">{tr("公開処理が終わってから復元できます。")}</p>}
    {!!list?.versions.length && <ol className="design-version-list">{list.versions.map(version => {
      const current = !target && !list.pendingRestore && (list.current?.restoredFrom === version.number || !!version.same);
      const retry = pendingHere && list.pendingRestore!.number === version.number || reusable(version.number);
      return <li key={version.number} data-design-version={version.number}>
        <div><strong>{tr("版 {0}", version.number)}</strong> <time dateTime={version.at}>{new Date(version.at).toLocaleString(intlLocale(), { timeZone, timeZoneName: "short" })}</time><p>{version.summary}</p></div>
        {current ? <span className="pill">{tr("現在の版")}</span> : <button disabled={disabled || busy || !!list.pendingRestore && !retry || list.publishing && !list.pendingRestore} onClick={() => void restore(version.number)}>{busy && retry ? tr("復元しています…") : retry ? tr("復元を再試行") : target ? tr("この画面をこの版に戻す") : tr("この版に戻す")}</button>}
      </li>;
    })}</ol>}
  </details>;
}
