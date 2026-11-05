import React, {useEffect,useRef} from "react";
import {tr} from "../shared/i18n";
import {regionOf} from "../shared/region";
import {bookingMenuName,bookingStaffName,type Booking,type ShopConfig} from "../server/domain";
import {useShopDisplay} from "./money";
import {PaymentDetails} from "./PaymentDetails";
import {bookingReminderDue,bookingReminderHours} from "../shared/booking-reminders";

export function BookingComplete({booking,config,simulation,onMine,onNew}: {booking:Booking;config:ShopConfig;simulation?:boolean;onMine:()=>void;onNew:()=>void}) {
  const heading=useRef<HTMLHeadingElement>(null);
  const {when,money}=useShopDisplay(regionOf(config));
  useEffect(()=>{heading.current?.focus();heading.current?.scrollIntoView({block:"start"});},[booking.id]);
  return <section className="panel booking-complete" aria-labelledby="booking-complete-title">
    <span className="booking-complete-mark" aria-hidden="true">✓</span>
    <h2 id="booking-complete-title" ref={heading} tabIndex={-1}>{tr("予約が完了しました")}</h2>
    <p role="status">{tr("ご予約を承りました。マイページからご確認いただけます。")}</p>
    {simulation && <p className="notice">{tr("プレビューの練習です。実際の予約・支払いは行われません。")}</p>}
    {!simulation && Date.parse(booking.createdAt) <= bookingReminderDue(config,booking) && <p className="notice">{tr("開始{0}時間前を目安に、予約日時と確認・キャンセル用リンクをメールでお知らせします。ご来店が難しい場合は、早めにマイページからキャンセルをお願いします。",bookingReminderHours(config,booking))}</p>}
    <dl className="booking-complete-details">
      <div><dt>{tr("日時")}</dt><dd>{when(booking.start)} – {when(booking.end)}</dd></div>
      <div><dt>{tr("お名前")}</dt><dd>{booking.name}{tr(" 様")}</dd></div>
      <div><dt>{tr("メニュー")}</dt><dd>{bookingMenuName(config,booking)}</dd></div>
      <div><dt>{tr("担当者")}</dt><dd>{bookingStaffName(config,booking.staffId)}</dd></div>
      <div><dt>{tr("所要時間")}</dt><dd>{tr("合計 {0}分",Math.round((Date.parse(booking.end)-Date.parse(booking.start))/60000))}</dd></div>
      <div><dt>{tr("合計金額")}</dt><dd className="price">{money(booking.price,booking.payment?.currency)}</dd></div>
      {booking.coupon && <div><dt>{tr("クーポン")}</dt><dd>{booking.coupon.title} · {tr("クーポン割引：{0}",money(booking.coupon.discountAmount,booking.coupon.currency))}</dd></div>}
      {!!config.address && <div><dt>{tr("アクセス")}</dt><dd>{config.address}</dd></div>}
      {!!booking.message && <div><dt>{tr("予約時のメッセージ")}</dt><dd className="pre-wrap">{booking.message}</dd></div>}
    </dl>
    <PaymentDetails booking={booking}/>
    <div className="actions"><button type="button" className="primary" onClick={onMine}>{tr("マイページで予約を確認")}</button><button type="button" onClick={onNew}>{tr("続けて予約する")}</button></div>
  </section>;
}
