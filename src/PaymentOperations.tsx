import React, { useState } from "react";
import { tr } from "../shared/i18n";
import { bookingMenuName } from "../server/domain";
import type { Workspace } from "./App";
import { PaymentDetails } from "./PaymentDetails";
import { PayPalAttention } from "./PayPalAttention";
import { Pagination, usePagination } from "./Pagination";
import { RecordDetailsDialog } from "./RecordDetailsDialog";
import { useShopDisplay } from "./money";

export function PaymentOperations({ mode, shop, reload, onAsk, open }: {
  mode: "payments" | "transfers"; shop: Workspace; reload: () => Promise<unknown>;
  onAsk: (question: string) => Promise<void>; open: (screen: string, recordId?: string) => void;
}) {
  const { when, money } = useShopDisplay();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bookings = usePagination(shop.bookings.filter(booking => booking.payment).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), shop.id);
  const pending = usePagination(shop.paymentCheckouts || [], shop.id);
  const listings = usePagination([...(shop.transferHistory || [])].sort((a, b) => b.deadline.localeCompare(a.deadline)), shop.id);
  const booking = shop.bookings.find(booking => booking.id === selected);
  async function refresh() {
    setBusy(true); setError("");
    try { await reload(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const title = mode === "payments" ? tr("決済・返金") : tr("キャンセル枠の再販売");
  return <div className="payment-operations">
    <div className="section-top"><h1>{title}</h1><button type="button" disabled={busy} onClick={() => void refresh()}>{tr("更新")}</button></div>
    {error && <p className="alert" role="alert">{error}</p>}
    <p>{mode === "payments" ? tr("支払い手続き中の予約、確定した決済、キャンセル時の返金状況を確認できます。") : tr("お客様がキャンセル枠を再販売した受付と、その結果を確認できます。再販売はお客様のマイページから申し込みます。")}</p>
    {mode === "payments" ? <>
      <PayPalAttention shop={shop} reload={reload} onAsk={onAsk} />
      <section className="panel" aria-label={tr("お支払い手続き中")}>
        <h2>{tr("お支払い手続き中")} <span className="count">{(shop.paymentCheckouts || []).length}</span></h2>
        {!pending.items.length && <p className="muted">{tr("支払い手続き中の予約はありません。")}</p>}
        <div {...pending.listProps}>{pending.items.map(item => <article className="booking-card" key={item.id}><div><h3>{item.name} · {when(item.start)}</h3><p>{money(item.amount, item.currency)} · {item.review ? tr("お店での支払い確認が必要です。お問い合わせください。") : tr("お支払い手続き中・予約未確定")}</p></div></article>)}</div>
        <Pagination pagination={pending} label={tr("お支払い手続き中")} />
      </section>
      <section className="panel" aria-label={tr("決済・返金の履歴")}>
        <h2>{tr("決済・返金の履歴")} <span className="count">{shop.bookings.filter(booking => booking.payment).length}</span></h2>
        {!bookings.items.length && <p className="muted">{tr("決済・返金の履歴はありません。")}</p>}
        <div {...bookings.listProps}>{bookings.items.map(item => <article className="booking-card" key={item.id}><div><h3>{item.name} · {when(item.start)}</h3><p>{bookingMenuName(shop.published, item)}</p><PaymentDetails booking={item} operator /><button type="button" onClick={() => setSelected(item.id)}>{tr("予約内容を確認")}</button></div></article>)}</div>
        <Pagination pagination={bookings} label={tr("決済・返金の履歴")} />
      </section>
    </> : <section className="panel" aria-label={title}>
      <h2>{tr("再販売の受付・履歴")} <span className="count">{(shop.transferHistory || []).length}</span></h2>
      {!listings.items.length && <p className="muted">{tr("再販売の受付・履歴はありません。")}</p>}
      <div {...listings.listProps}>{listings.items.map(item => {
        const booking = shop.bookings.find(booking => booking.id === item.bookingId);
        return <article className="booking-card" key={item.id}><div><h3>{booking ? when(booking.start) : when(item.deadline)}</h3><span className="status transfer">{{listed: tr("受付中"), sold: tr("成約済み"), expired: tr("受付終了"), withdrawn: tr("取り下げ済み")}[item.phase]}</span><p>{money(item.price, item.currency)} · {tr("{0}%引き", item.discountPercent)}</p><p>{tr("受付期限：{0}", when(item.deadline))}</p>{item.buying && <p>{tr("代わりの方が支払い手続き中")}</p>}{item.review && <p className="notice">{tr("PayPalの決済結果を照合してください")}</p>}{booking && <button type="button" onClick={() => setSelected(booking.id)}>{tr("予約内容を確認")}</button>}</div></article>;
      })}</div>
      <Pagination pagination={listings} label={tr("再販売の受付・履歴")} />
    </section>}
    {booking && <RecordDetailsDialog shop={shop} item={{kind: "booking", value: booking}} close={() => setSelected("")} open={open} />}
  </div>;
}
