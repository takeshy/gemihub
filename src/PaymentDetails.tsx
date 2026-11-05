import { tr } from "../shared/i18n";
import { paid, useShopDisplay } from "./money";
import React from "react";
import type { Booking } from "../server/domain";
import { policyText, refundWindows, type RefundWindow } from "../server/payment-domain";
export function PaymentDetails({ booking, operator = false }: { booking: Booking; operator?: boolean }) {
  const { shopTime, timeZoneLabel } = useShopDisplay();
  const p = booking.payment;
  if (!p) return null;
  const start = Date.parse(booking.start);
  const windows = Number.isFinite(start) ? refundWindows(booking.start, p.policy) : undefined;
  const date = (value: string) => shopTime(value, { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", ...(start % 60000 ? { second: "2-digit" as const } : {}), ...(start % 1000 ? { fractionalSecondDigits: 3 as const } : {}), timeZoneName: "short" });
  const condition = (window: RefundWindow) => window.until
    ? window.after ? tr("{0}より後、{1}まで：{2}%返金", date(window.after), date(window.until), window.percent) : tr("{0}まで：{1}%返金", date(window.until), window.percent)
    : window.after ? tr("{0}より後（予約開始後を含む）：{1}%返金", date(window.after), window.percent) : tr("{0}：{1}%返金", tr("いつでも"), window.percent);
  const r = p.cancellation;
  const label = r && { completed: tr("返金完了"), pending: tr("PayPalで返金を確認中"), awaiting_funds: operator ? tr("PayPalの返金用残高が不足しています。残高を補充して返金状況を再確認してください") : tr("お店で返金手続きの確認中"), retrying: tr("返金処理中・自動で再確認します"), not_required: tr("返金なし"), manual_review: tr("返金の確認が必要です。お店にお問い合わせください。") }[r.status];
  return <div className="payment-details">
    <p><b>{tr("PayPal 支払済み：{0}", paid(p.amount, p.currency))}</b>{p.environment === "sandbox" && tr("（Sandbox）")}</p>
    {operator && booking.transfers?.map(entry => <p className="small" key={entry.id}>{tr("キャンセル枠：{0} 様 → {1} 様・{2}（{3}%引き）・元の予約者へ{4}", entry.from.name, entry.to.name, paid(entry.price, entry.currency), entry.discountPercent, { completed: tr("返金完了"), pending: tr("PayPalで返金を確認中"), awaiting_funds: tr("PayPalの返金用残高が不足しています。残高を補充して返金状況を再確認してください"), retrying: tr("返金処理中・自動で再確認します"), manual_review: tr("返金の確認が必要です。PayPalの取引と照合してください") }[entry.refund.status])}</p>)}
    {r && <p role="status">{tr("{0}：{1}（{2}%）", label, paid(r.amount, p.currency), r.percent)}{r.reason === "shop" && tr("・店都合のキャンセル")}</p>}
    <details><summary>{tr("予約時の返金条件")}</summary>
      {windows ? <>{windows.some(window => window.after || window.until) && <p className="small muted">{tr("日時はお店の時間（{0}）です。", timeZoneLabel)}</p>}<ul className="refund-deadlines">{windows.map((window, index) => <li key={index}>{condition(window)}</li>)}</ul></> : <p>{policyText(p.policy)}</p>}
      <p>{tr("店都合のキャンセルは全額返金。予約後の条件変更はこの予約に適用されません。")}</p>
    </details>
  </div>;
}
