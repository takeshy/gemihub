import React, { useRef, useState } from "react";
import { getLocale, intlLocale, tr } from "../shared/i18n";
import { useApi } from "./api";
import { paid } from "./money";
import type { Workspace } from "./App";
import type { PayPalAlertItem, PayPalAlertState, PayPalProposal, PayPalProposalOperation, PayPalSeverity, PayPalAlertKind } from "../server/paypal-ops";
import "./Assistant.css";

export function PayPalAttention({ shop, reload, onAsk }: { shop: Workspace; reload: () => Promise<unknown>; onAsk: (question: string) => Promise<void> }) {
  const api = useApi();
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [checkResult, setCheckResult] = useState<PayPalAlertState>();
  const [notify, setNotify] = useState(shop.paypalSettings?.enabled !== false);
  const [digestHour, setDigestHour] = useState(shop.paypalSettings?.digestHour ?? 9);
  const working = useRef(false);
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { working.current = false; setBusy(false); }
  }
  async function execute(proposal: PayPalProposal) {
    try {
      const result = await api<{ok:boolean;error?:string}>(`/api/shops/${shop.id}/paypal/proposals/execute`, {proposalId:proposal.id,alertId:proposal.alertId,fingerprint:proposal.fingerprint});
      if (!result.ok) throw new Error(result.error || tr("状態が変わっています。最新の状態を確認してください。"));
    } catch (error) { await reload().catch(() => {}); throw error; }
    setNotice(tr("実行しました：{0}。最新の状態を表示しています。", proposalOpText(proposal.operation)));
    await reload();
  }
  return <div className="dashboard-attention">
    {error && <p className="alert" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <AlertPanel alerts={shop.paypalAlerts} checkResult={checkResult} checking={checking} busy={busy} notify={notify} digestHour={digestHour} onNotify={setNotify} onDigestHour={setDigestHour} onAsk={question => void run(() => onAsk(question))} onExecute={proposal => void run(() => execute(proposal))}
      onCheck={() => void run(async () => { setChecking(true); try { setCheckResult(await api<PayPalAlertState>(`/api/shops/${shop.id}/paypal/alerts/check`, {})); await reload(); } finally { setChecking(false); } })}
      onSaveSettings={() => void run(async () => { await api(`/api/shops/${shop.id}/paypal/alerts/settings`, {notify,digestHour}); await reload(); })} />
  </div>;
}

const severityText = (value: PayPalSeverity) => ({ high: tr("緊急"), medium: tr("注意"), low: tr("確認") } satisfies Record<PayPalSeverity, string>)[value];
const kindText = (value: PayPalAlertKind) => ({
  refund_stalled: tr("返金の停滞"), awaiting_funds: tr("返金用残高の不足"), manual_review: tr("手動確認が必要"),
  capture_stalled: tr("決済が未確定"), state_mismatch: tr("台帳とPayPalの状態不一致"), unsold_slot: tr("割引枠の売れ残り"),
} satisfies Record<PayPalAlertKind, string>)[value];
export const proposalOpText = (value: PayPalProposalOperation) => ({
  retry_refund: tr("返金の再試行"), resync: tr("状態の再同期"), complete_manual_review: tr("手動確認を完了にする"), close_transfer: tr("割引枠の再販を終了"),
} satisfies Record<PayPalProposalOperation, string>)[value];

export function ProposalCard({ proposal, busy, owner, onExecute }: { proposal: PayPalProposal; busy: boolean; owner: boolean; onExecute: () => void }) {
  return <div className="paypal-proposal">
    <div><b>{proposalOpText(proposal.operation)}</b> <span>{proposal.target}</span></div>
    {proposal.amount !== undefined && proposal.currency && <p className="small">{tr("サーバーが計算した金額：{0}", paid(proposal.amount, proposal.currency))}</p>}
    <p className="small muted">{proposal.expected}</p>
    {owner && <button type="button" className="primary" disabled={busy} onClick={onExecute}>{tr("承認して実行")}</button>}
  </div>;
}

function AlertPanel({ alerts, checkResult, checking, busy, notify, digestHour, onNotify, onDigestHour, onSaveSettings, onCheck, onAsk, onExecute }: {
  alerts?: PayPalAlertState; checkResult?: PayPalAlertState; checking: boolean; busy: boolean; notify: boolean; digestHour: number;
  onNotify: (value: boolean) => void; onDigestHour: (value: number) => void; onSaveSettings: () => void;
  onCheck: () => void; onAsk: (question: string) => void; onExecute: (proposal: PayPalProposal) => void;
}) {
  const items: PayPalAlertItem[] = alerts?.items || [];
  const summary = !items.length ? tr("対応が必要な項目はありません。") : alerts?.locale === getLocale() && alerts.summary ? alerts.summary : tr("対応が必要な項目が{0}件あります。緊急{1}件、注意{2}件、確認{3}件です。", items.length, items.filter(item => item.severity === "high").length, items.filter(item => item.severity === "medium").length, items.filter(item => item.severity === "low").length);
  return <section className="paypal-alerts" aria-label={tr("PayPalの要対応")}>
    <div className="paypal-alerts-head">
      <div className="paypal-alert-status">
        <span className={`paypal-alert-icon${items.length ? " needs-attention" : ""}`}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d={items.length ? "M12 8v4m0 4h.01" : "m8 12 2.5 2.5L16 9"} />
          </svg>
        </span>
        <div>
          <h2>{tr("要対応")}{!!items.length && <span className="alert-badge">{items.length}</span>}</h2>
          <p className="small muted">{summary}</p>
        </div>
      </div>
      <button className="paypal-alert-check" type="button" disabled={checking || busy} onClick={onCheck}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 4v5h-5M4 20v-5h5m10.6-6A8 8 0 0 0 6 6.5L4 9m.4 6A8 8 0 0 0 18 17.5l2-2.5" />
        </svg>
        {checking ? tr("確認しています…") : tr("今すぐチェック")}
      </button>
    </div>
    {checkResult && <p className="small paypal-check-result" role="status">
      <span>{tr("確認が完了しました。要対応：{0}件。", checkResult.items.length)}</span>{" "}
      <time className="muted" dateTime={checkResult.checkedAt}>{new Date(checkResult.checkedAt).toLocaleString(intlLocale())}</time>
    </p>}
    {!!items.length && <ul className="paypal-alert-list">{items.map(item => <li key={item.id}>
      <div className="paypal-alert-row"><span className={`status ${item.severity}`}>{severityText(item.severity)}</span><b>{kindText(item.kind)}</b><span>{item.target}</span></div>
      <p className="small muted">{[item.bookingLabel, item.amount !== undefined && item.currency ? paid(item.amount, item.currency) : "", item.paypalId ? tr("PayPal ID: {0}", item.paypalId) : "", item.elapsedHours !== undefined ? tr("{0}時間経過", Math.round(item.elapsedHours * 10) / 10) : ""].filter(Boolean).join(" ・ ")}</p>
      <div className="actions"><button type="button" onClick={() => onAsk(tr("この記録について説明してください。予約ID: {0}、PayPal ID: {1}、種類: {2}", item.bookingId || tr("なし"), item.paypalId || tr("なし"), kindText(item.kind)))}>{tr("相談する")}</button></div>
      {item.proposal && <ProposalCard proposal={item.proposal} busy={busy} owner onExecute={() => onExecute(item.proposal!)} />}
    </li>)}</ul>}
    <details className="paypal-alert-settings">
      <summary>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" />
        </svg>
        {tr("通知の設定")}
      </summary>
      <div className="paypal-alert-settings-fields">
        <label>
          <input type="checkbox" checked={notify} onChange={event => onNotify(event.target.checked)} />
          {tr("メールで通知する")}
        </label>
        <label>
          {tr("ダイジェストの時刻")}
          <select value={digestHour} onChange={event => onDigestHour(Number(event.target.value))}>
            {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{tr("{0}時", hour)}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={onSaveSettings}>{tr("通知設定を保存")}</button>
      </div>
    </details>
  </section>;
}
