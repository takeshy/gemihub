import { tr } from "../shared/i18n";
import React from "react";

const paths = {
  shop: "M3 10h18M5 10v10h14V10M3 10l2-6h14l2 6M9 20v-6h6v6",
  calendar: "M7 3v4m10-4v4M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1m3 8h2m4 0h2m-8 4h2m4 0h2",
  check: "M8 12l3 3 5-6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  mail: "M3 6h18v13H3V6m0 0 9 7 9-7",
  people: "M16 21v-3a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v3m13-13a3 3 0 0 1 0 6m5 7v-3a4 4 0 0 0-3-4M13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  news: "M5 3h14v18H5V3m4 5h6m-6 4h6m-6 4h4",
};
function Icon({ kind }: { kind: keyof typeof paths }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

export function FunctionalOverview({ pages = [], articles }: { pages?: string[]; articles?: { blogs: boolean; announcements: boolean } }) {
  return <div className="functional-overview" aria-label={tr("用意するページと機能")}>
    <section className="feature-customer">
      <div className="feature-audience"><span>{tr("お客様")}</span><h4>{tr("お客様が使うページ")}</h4></div>
      <ol className="feature-flow">
        <li><div className="feature-icon"><Icon kind="shop" /></div><span className="feature-number">01</span><h5>{tr("お店を知る")}</h5><p>{tr("お店の紹介や")}<br />{tr("メニューを見る")}</p></li>
        <li><div className="feature-icon"><Icon kind="calendar" /></div><span className="feature-number">02</span><h5>{tr("予約する")}</h5><p>{tr("メニュー・担当者・")}<br />{tr("日時を選ぶ")}</p></li>
        <li><div className="feature-icon"><Icon kind="check" /></div><span className="feature-number">03</span><h5>{tr("予約を確かめる")}</h5><p>{tr("自分の予約を確認")}<br />{tr("必要ならキャンセル")}</p></li>
      </ol>
      <div className="feature-connection"><Icon kind="mail" /><p><strong>{tr("お問い合わせ")}</strong><span>{tr("分からないことは、お店にメッセージを送れます。")}</span></p></div>
    </section>
    <section className="feature-operations">
      <div className="feature-audience"><span>{tr("お店")}</span><h4>{tr("お店で使う機能")}</h4></div>
      <div className="feature-cards">
        <div><Icon kind="calendar" /><h5>{tr("予約を管理")}</h5><p>{tr("いつ・誰の予約があるか")}<br />{tr("一覧で確認できます。")}</p></div>
        <div><Icon kind="people" /><h5>{tr("お客様を覚える")}</h5><p>{tr("来店の記録やメモを")}<br />{tr("まとめて残せます。")}</p></div>
        {(!articles || articles.blogs || articles.announcements)&&<div><Icon kind="news" /><h5>{tr("お知らせを届ける")}</h5><p>{!articles||articles.blogs&&articles.announcements?tr("ブログやお知らせをページに載せられます。"):articles.blogs?tr("ブログをページに載せられます。"):tr("お知らせをページに載せられます。")}</p></div>}
        <div><Icon kind="mail" /><h5>{tr("メールでお知らせ")}</h5><p>{tr("予約の受付やキャンセルを")}<br />{tr("メールでお知らせします。")}</p></div>
      </div>
    </section>
    {pages.length > 0 && <section className="feature-extra"><h4>{tr("追加で用意するページ")}</h4><ul>{pages.map((title, index) => <li key={index}>{title}</li>)}</ul></section>}
  </div>;
}
