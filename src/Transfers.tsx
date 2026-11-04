import React, { useState } from "react";
import { tr } from "../shared/i18n";
import type { Currency } from "../shared/region";
import { policyText, type RefundTiers } from "../server/payment-domain";
import { useApi } from "./api";
import { paid, useShopDisplay } from "./money";
import { createRequestId } from "./request-id";

type Run = (fn: () => Promise<void>) => Promise<void> | void;
export type TransferListing = {
  id: string; bookingId: string; start: string; end: string; menu: string; staff: string;
  amount: number; currency: Currency; discountPercent: number; deadline: string; policy: RefundTiers;
  available?: boolean; mine?: boolean;
};
export type SellingTransfer = TransferListing & {
  phase: "listed" | "withdrawn" | "sold" | "expired"; buying: boolean;
  unsold: { percent: number; amount: number }; refund?: { amount: number; status: string };
};
export type BuyingTransfer = TransferListing & { phase: string; expires: number; approvalUrl?: string; review: boolean };
export type MyTransfers = { selling: SellingTransfer[]; buying: BuyingTransfer[] };
export type TransferCheckout = { id: string; phase: string; approvalUrl?: string };
export type CancellationQuote = { amount: number; percent: number; transfer?: { id?: string; price: number; deadline: string } };

const refundLabel = (status: string) => ({ completed: tr("返金完了"), pending: tr("PayPalで返金を確認中"), awaiting_funds: tr("お店で返金手続きの確認中"), retrying: tr("返金処理中・自動で再確認します"), manual_review: tr("返金の確認が必要です。お店にお問い合わせください。") } as Record<string, string>)[status] || status;

/** Listings on the shop's booking page: the transfer price is fixed, and the booking is taken over as is. */
export function TransferOffers({ base, listings, name, busy, run, simulation, onStarted }: {
  base: string; listings: TransferListing[]; name: string; busy: boolean; run: Run; simulation?: boolean;
  onStarted: (checkout: TransferCheckout) => Promise<void>;
}) {
  const api = useApi();
  const { when, shopTime } = useShopDisplay();
  const [open, setOpen] = useState("");
  const [consent, setConsent] = useState(false);
  const [requestId, setRequestId] = useState(() => createRequestId());
  const visible = listings.filter(listing => !listing.mine);
  if (!visible.length) return null;
  return <section className="panel transfer-offers" aria-labelledby="transfer-offers-heading">
    <span className="eyebrow">{tr("空き枠")}</span>
    <h2 id="transfer-offers-heading">{tr("お得に予約できる空き枠")}</h2>
    <p className="small muted">{tr("キャンセルされた方に代わって、表示の価格で予約できます。メニュー・担当・日時は表示の内容で確定します。")}</p>
    <div className="booking-list">{visible.map(listing => <div className="booking-card" key={listing.id}>
      <div>
        <span className="status transfer">{tr("お得な空き枠")}</span>
        <h3>{when(listing.start)}</h3>
        <p>{listing.menu} / {listing.staff}</p>
        <p><b className="price">{paid(listing.amount, listing.currency)}</b> {tr("（{0}%引き）", listing.discountPercent)}</p>
        <p className="small muted">{tr("受付期限：{0}", shopTime(listing.deadline, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</p>
        {open === listing.id && <div className="payment-policy">
          <h4>{tr("お支払いと返金条件")}</h4>
          <p>{tr("PayPalで{0}をお支払い後、予約が確定します。", paid(listing.amount, listing.currency))}</p>
          <p>{tr("返金条件（お支払い額に対して）：{0}", policyText(listing.policy))}</p>
          <p className="small">{tr("キャンセル時は表示の条件で返金します。店都合のキャンセルは全額返金。")}</p>
          {simulation && <p className="notice">{tr("プレビューの練習です。実際の支払い・返金は行いません。")}</p>}
          <label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> {tr("支払額と返金条件を確認しました")}</label>
        </div>}
      </div>
      <div className="actions">
        {listing.available === false ? <p className="small muted">{tr("ほかの方がお支払い手続き中です")}</p>
          : open !== listing.id ? <button disabled={busy} onClick={() => { setOpen(listing.id); setConsent(false); setRequestId(createRequestId()); }}>{tr("この枠を予約する")}</button>
          : <button className="primary" disabled={busy || !consent || !name.trim()} onClick={() => run(async () => {
            const result = await api<{ checkout: TransferCheckout }>(`${base}/transfers/${listing.id}/checkout`, { name, requestId, consent: { amount: listing.amount, policy: listing.policy } });
            await onStarted(result.checkout);
          })}>{simulation ? tr("支払い・予約を練習する") : tr("PayPalで支払いへ進む")} →</button>}
      </div>
    </div>)}</div>
  </section>;
}

/** On a paid booking in My page: offer it, see the listing, or withdraw it before a transferee starts paying. */
export function BookingTransferControl({ base, listing, busy, run, reload, notify }: {
  base: string; listing?: SellingTransfer; busy: boolean; run: Run;
  reload: () => Promise<void>; notify: (message: string) => void;
}) {
  const api = useApi();
  const { shopTime } = useShopDisplay();
  const at = (value: string) => shopTime(value, { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
  if (listing?.phase === "listed") return <div className="transfer-status" role="status">
    <p><b>{tr("キャンセルを受け付けました")}</b></p>
    <p>{tr("返金予定額：{0}", paid(listing.unsold.amount, listing.currency))}</p>
    <p>{tr("代わりに利用する方が見つかると、返金額が{0}に増えます。", paid(listing.amount, listing.currency))}</p>
    <p className="small">{tr("受付期限：{0}", at(listing.deadline))}</p>
    <p className="small muted">{tr("予約が入るか受付期限を過ぎると、返金額が確定します。期限前に始まった支払いの確認を待つ場合があります。")}</p>
    {listing.buying ? <p className="small muted">{tr("代わりに利用する方がお支払い手続き中のため、キャンセルは取り消せません。")}</p>
      : <button disabled={busy} onClick={() => run(async () => {
        if (!window.confirm(tr("キャンセルを取り消して、元の予約に戻しますか？"))) return;
        await api(`${base}/transfers/${listing.id}/withdraw`, {});
        await reload();
        notify(tr("キャンセルを取り消しました。元の予約でご来店いただけます。"));
      })}>{tr("キャンセルを取り消して、予約に戻す")}</button>}
  </div>;
  return null;
}

/** Listings that ended: sold (with the refund status) or settled at the deadline. */
export function TransferHistory({ selling }: { selling: SellingTransfer[] }) {
  const { when } = useShopDisplay();
  const closed = selling.filter(listing => listing.phase === "sold" || listing.phase === "expired");
  if (!closed.length) return null;
  return <div className="transfer-history">
    <h3>{tr("キャンセルしたご予約の返金")}</h3>
    {closed.map(listing => <div className="booking-card" key={listing.id}><div>
      <span className={`status ${listing.phase === "sold" ? "transfer" : "cancelled"}`}>{listing.phase === "sold" ? tr("代わりの予約が入りました") : tr("返金額が確定しました")}</span>
      <h3>{when(listing.start)}</h3>
      <p>{listing.menu}</p>
      {listing.phase === "sold" && listing.refund && <p role="status">{tr("{0}：{1}", refundLabel(listing.refund.status), paid(listing.refund.amount, listing.currency))}</p>}
      {listing.phase === "expired" && <p className="small muted">{tr("受付期限を過ぎたため、返金額は{0}で確定しました。", paid(listing.unsold.amount, listing.currency))}</p>}
    </div></div>)}
  </div>;
}

/** The transferee's own pending checkouts, resumable like normal payments. */
export function TransferBuying({ base, buying, busy, run, confirm, reload }: {
  base: string; buying: BuyingTransfer[]; busy: boolean; run: Run;
  confirm: (id: string, abandon?: boolean) => Promise<void>; reload: () => Promise<void>;
}) {
  const api = useApi();
  const { when } = useShopDisplay();
  return <>{buying.map(item => <div className="booking-card" key={item.id}>
    <div><span className="status transfer">{tr("お得な空き枠")}</span><h3>{when(item.start)}</h3><p>{item.menu}・{paid(item.amount, item.currency)}・{item.review ? tr("お店での支払い確認が必要です。お問い合わせください。") : tr("支払い手続き中・予約はまだ確定していません")}</p></div>
    <div className="actions">
      {item.phase === "awaiting_approval" && item.approvalUrl && item.expires > Date.now() && <button disabled={busy} onClick={() => window.location.assign(item.approvalUrl!)}>{tr("PayPalで支払いを続ける")}</button>}
      {item.phase === "creating" && <button disabled={busy} onClick={() => run(async () => { await api(`${base}/transfers/${item.id}/resume`, {}); await reload(); })}>{tr("支払い手続きを再開")}</button>}
      {item.phase !== "creating" && <button disabled={busy} onClick={() => run(async () => confirm(item.id))}>{tr("支払い状況を確認・予約を確定")}</button>}
      {["creating", "awaiting_approval"].includes(item.phase) && <button disabled={busy} onClick={() => run(async () => confirm(item.id, true))}>{tr("支払いを中止")}</button>}
    </div>
  </div>)}</>;
}
