import React, { useEffect, useState } from "react";
import { getLocale, tr } from "../shared/i18n";
import { managementSummary } from "../shared/management-dashboard";
import { bookingMenuName, bookingStaffName } from "../server/domain";
import { useShopDisplay } from "./money";
import { Pagination, usePagination } from "./Pagination";
import { PayPalAttention } from "./PayPalAttention";
import { ShopSettingsOverview } from "./ShopSettingsOverview";
import type { Workspace } from "./App";

export function ManagementDashboard({ shop, busy, refresh, open, reload, onAsk }: {
  shop: Workspace; busy: boolean; refresh: () => void; open: (screen: string) => void; reload: () => Promise<unknown>; onAsk: (question:string) => Promise<void>;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, [shop.id]);
  const { when, shopTime, timeZoneLabel } = useShopDisplay();
  const config = shop.published!;
  const summary = managementSummary(config, shop.bookings, shop.inquiries, now);
  const bookings = usePagination(summary.bookings, `${shop.id}:${summary.today}`);
  const inquiries = usePagination(summary.inquiries, shop.id);
  const publiclyPublished = shop.publication !== "provisional";
  const href = (tab: string) => `/?${new URLSearchParams({ tab, shop: shop.id, lang: getLocale() })}`;
  const follow = (event: React.MouseEvent<HTMLAnchorElement>, tab: string) => {
    if (event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); open(tab);
  };
  return <div className="management-dashboard">
    <div className="section-top"><div><h1>{tr("ダッシュボード")}</h1><p className="small muted">{summary.today} · {timeZoneLabel}</p></div><button type="button" disabled={busy} onClick={refresh}>{tr("更新")}</button></div>
    <div className="dashboard-summary-grid">
      <section className="panel dashboard-today" aria-label={tr("本日の予約")}>
        <div className="section-top"><h2>{tr("本日の予約")} <span className="count">{publiclyPublished ? summary.bookings.length : 0}</span></h2>{publiclyPublished && <a data-dashboard-link className="text-button" href={href("bookings")} onClick={event => follow(event, "bookings")}>{tr("予約一覧へ →")}</a>}</div>
        {!publiclyPublished ? <p className="muted">{tr("本番公開すると、当日の予約をここで確認できます。")}</p> : <>
          {!summary.bookings.length && <p className="muted">{tr("本日の予約はありません。")}</p>}
          <div {...bookings.listProps} className="dashboard-item-list">{bookings.items.map(booking => <article key={booking.id} className="dashboard-booking">
            <div><time dateTime={booking.start}>{shopTime(booking.start, { hour: "2-digit", minute: "2-digit" })}</time><strong>{booking.name}{tr(" 様 ")}</strong></div>
            <p>{bookingMenuName(config, booking)} · {bookingStaffName(config, booking.staffId)}</p>
            <span className={`status ${booking.status}`}>{shop.transferListings?.some(listing => listing.bookingId === booking.id) ? tr("キャンセル受付済み") : booking.status === "active" ? tr("予約確定") : booking.status === "no_show" ? tr("無断キャンセル") : tr("キャンセル済み")}</span>
          </article>)}</div><Pagination pagination={bookings} label={tr("本日の予約")} />
        </>}
      </section>
      <section className="panel dashboard-inquiries" aria-label={tr("未対応のお問い合わせ")}>
        <div className="section-top"><h2>{tr("未対応のお問い合わせ")} <span className="count">{summary.inquiries.length}</span></h2><a data-dashboard-link className="text-button" href={href("inquiries")} onClick={event => follow(event, "inquiries")}>{tr("お問い合わせ一覧へ →")}</a></div>
        {!summary.inquiries.length && <p className="muted">{tr("未対応のお問い合わせはありません。")}</p>}
        <div {...inquiries.listProps} className="dashboard-item-list">{inquiries.items.map(inquiry => <article key={inquiry.id} className="dashboard-inquiry"><div><strong>{inquiry.name}{tr(" 様 ")}</strong>{inquiry.at && Number.isFinite(Date.parse(inquiry.at)) && <time dateTime={inquiry.at}>{when(inquiry.at)}</time>}</div>{inquiry.subject && <h3>{inquiry.subject}</h3>}<p>{inquiry.message}</p></article>)}</div>
        <Pagination pagination={inquiries} label={tr("未対応のお問い合わせ")} />
      </section>
    </div>
    {shop.isOwner && <PayPalAttention shop={shop} reload={reload} onAsk={onAsk} />}
    <ShopSettingsOverview config={config} isOwner={shop.isOwner} publiclyPublished={publiclyPublished} google={shop.judge ? undefined : shop.google} open={open} />
  </div>;
}
