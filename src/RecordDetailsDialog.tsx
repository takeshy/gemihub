import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { getLocale, tr } from "../shared/i18n";
import { bookingMenuName, bookingStaffName, type Booking } from "../server/domain";
import { inquiryStatus, inquiryStatusLabel } from "../server/inquiries";
import type { Inquiry, Workspace } from "./App";
import { dashboardSearch } from "./dashboard-navigation";
import { InquiryAttachments } from "./InquiryFiles";
import { PaymentDetails } from "./PaymentDetails";
import { useShopDisplay } from "./money";

export const bookingStatusText = (shop: Workspace, booking: Booking) => shop.transferListings?.some(listing => listing.bookingId === booking.id) ? tr("キャンセル受付済み") : booking.status === "active" ? tr("予約確定") : booking.status === "no_show" ? tr("無断キャンセル") : tr("キャンセル済み");

export function RecordDetailsDialog({ shop, item, close, open }: {
  shop: Workspace; item: { kind: "booking"; value: Booking } | { kind: "inquiry"; value: Inquiry };
  close: () => void; open: (screen: string, recordId?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const { when, money } = useShopDisplay();
  useEffect(() => {
    const trigger = document.activeElement;
    dialog.current?.showModal(); heading.current?.focus();
    return () => { if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  const booking = item.kind === "booking" ? item.value : undefined;
  const inquiry = item.kind === "inquiry" ? item.value : undefined;
  const tab = booking ? "customers" : "inquiries";
  const recordId = booking ? booking.customer : item.value.id;
  const href = `/${dashboardSearch(`?lang=${getLocale()}`, tab, shop.id, undefined, undefined, undefined, recordId)}`;
  return createPortal(<dialog ref={dialog} className="editor-release-dialog dashboard-detail-dialog" aria-labelledby={headingId} onClose={close}>
    <div className="section-top"><h3 id={headingId} ref={heading} tabIndex={-1}>{booking ? tr("予約の詳細") : tr("お問い合わせの詳細")}</h3><button type="button" aria-label={tr("閉じる")} onClick={close}>×</button></div>
    <p><strong>{item.value.name}{tr(" 様 ")}</strong></p>
    {booking && <>
      <dl className="dashboard-detail-fields">
        <div><dt>{tr("日時")}</dt><dd>{when(booking.start)} 〜 {when(booking.end)}</dd></div>
        <div><dt>{tr("メニュー")}</dt><dd>{bookingMenuName(shop.published, booking)}</dd></div>
        <div><dt>{tr("スタッフ")}</dt><dd>{bookingStaffName(shop.published, booking.staffId)}</dd></div>
        <div><dt>{tr("料金")}</dt><dd>{money(booking.price)}</dd></div>
        <div><dt>{tr("状態")}</dt><dd>{bookingStatusText(shop, booking)}</dd></div>
        <div><dt>{booking.phone ? tr("電話番号") : tr("メールアドレス")}</dt><dd>{booking.phone || booking.customer}</dd></div>
      </dl>
      {booking.message && <p className="pre-wrap"><b>{tr("予約時のメッセージ")}</b><br />{booking.message}</p>}
      <PaymentDetails booking={booking} operator />
    </>}
    {inquiry && <>
      <dl className="dashboard-detail-fields">
        {inquiry.at && Number.isFinite(Date.parse(inquiry.at)) && <div><dt>{tr("受付日時")}</dt><dd>{when(inquiry.at)}</dd></div>}
        <div><dt>{tr("対応状況")}</dt><dd>{inquiryStatusLabel(inquiryStatus(inquiry))}</dd></div>
        {inquiry.email && <div><dt>{tr("メールアドレス")}</dt><dd>{inquiry.email}</dd></div>}
        {inquiry.phone && <div><dt>{tr("電話番号")}</dt><dd>{inquiry.phone}</dd></div>}
      </dl>
      {inquiry.subject && <h4>{inquiry.subject}</h4>}
      <p className="pre-wrap">{inquiry.message}</p>
      <InquiryAttachments files={inquiry.attachments} shopId={shop.id} inquiryId={inquiry.id} />
      {inquiry.reply && <p className="pre-wrap"><b>{tr("返信")}</b><br />{inquiry.reply}</p>}
    </>}
    <div className="actions editor-release-actions"><a data-dashboard-link className="button primary" href={href} onClick={event => {
      if (event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault(); open(tab, recordId);
    }}>{booking ? tr("お客様情報を開く →") : tr("お問い合わせを開く →")}</a></div>
  </dialog>, document.body);
}
