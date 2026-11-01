import { tr } from "../shared/i18n";
import React from "react";
import type { Booking } from "../server/domain";
import { policyText } from "../server/payment-domain";
export function PaymentDetails({ booking, operator = false }: { booking: Booking; operator?: boolean }) {
  const p = booking.payment;
  if (!p) return null;
  const r = p.cancellation;
  const label = r && { completed: tr("返金完了"), pending: tr("PayPalで返金を確認中"), awaiting_funds: operator ? tr("PayPalの返金用残高が不足しています。残高を補充して返金状況を再確認してください") : tr("お店で返金手続きの確認中"), retrying: tr("返金処理中・自動で再確認します"), not_required: tr("返金なし"), manual_review: tr("返金の確認が必要です。お店にお問い合わせください。") }[r.status];
  return <div className="payment-details">
    <p><b>{tr("PayPal 支払済み：{0}円", p.amount.toLocaleString("ja-JP"))}</b>{p.environment === "sandbox" && "（Sandbox）"}</p>
    {r && <p role="status">{tr("{0}：{1}円（{2}%）", label, r.amount.toLocaleString("ja-JP"), r.percent)}{r.reason === "shop" && tr("・店都合のキャンセル")}</p>}
    <details><summary>{tr("予約時の返金条件")}</summary><p>{policyText(p.policy)}</p><p>{tr("店都合のキャンセルは全額返金。予約後の条件変更はこの予約に適用されません。")}</p></details>
  </div>;
}
