import React from "react";
import { tr, listSeparator } from "../shared/i18n";
import { hoursText, specialDaysText, type ShopConfig } from "../server/domain";
import { shopInfographic } from "../shared/shop-infographic";
import { diagramLabel } from "../shared/diagrams";
import { useShopDisplay } from "./money";
import { PeleDiagram } from "./PeleDiagram";
import { DataOverview } from "./DataOverview";
import type { Workspace } from "./App";
const days = () => [tr("日"), tr("月"), tr("火"), tr("水"), tr("木"), tr("金"), tr("土")];

export function ShopSettingsOverview({ config, published = true, isOwner, publiclyPublished, google, open }: {
  config: ShopConfig; published?: boolean; isOwner: boolean; publiclyPublished: boolean;
  google?: Workspace["google"]; open: (screen: string) => void;
}) {
  const { money } = useShopDisplay();
  const infographic = shopInfographic(config);
  return (
    <div className="shop-spec-column">
      <section className="panel shop-spec" aria-label={tr("現在のお店の設定")}>
        <div className="section-top"><h2>{tr("現在のお店の設定")}</h2></div>
        {<>
          <div className="shop-spec-intro"><h3>{config.name}</h3><p>{config.description}</p><span className="pill">{published ? tr("現在の設定") : tr("公開前の設定")}</span></div>
          <div className="spec-stats"><div><strong>{config.menus.filter(m => m.active).length}</strong><span>{tr("メニュー")}</span></div><div><strong>{infographic.staff.length}</strong><span>{tr("スタッフ")}</span></div><div><strong>{infographic.pageCount}</strong><span>{tr("お客様向け画面")}</span></div></div>
          <PeleDiagram label={tr("予約の流れ")} source={["flowchart LR", ...infographic.bookingFlow.map((step, i) => `step${i}[${diagramLabel(`${step.label}: ${step.detail}`)}]`), ...infographic.bookingFlow.slice(1).map((_, i) => `step${i} --> step${i + 1}`)].join("\n")} />
          <details><summary>{tr("予約の流れの説明")}</summary><ol className="spec-booking-flow" aria-label={tr("予約の流れ")} style={{ "--flow-steps": infographic.bookingFlow.length } as React.CSSProperties}>{infographic.bookingFlow.map((step, i) => <li key={i}><b>{String(i + 1).padStart(2, "0")}</b><span>{step.label}</span><small>{step.detail}</small></li>)}</ol></details>
          <div className="spec-card-grid">
            <section className="spec-card"><h3><span aria-hidden="true">◷</span> {tr(" 営業時間と受付")}</h3><p className="spec-highlight">{hoursText(config)}</p><p>{tr("定休日：")}{config.hours.closedWeekdays.map(d => tr("{0}曜", days()[d])).join(listSeparator()) || tr("なし")}</p><p>{tr("臨時休業：")}{config.hours.holidays.join(listSeparator()) || tr("なし")}</p>{!!config.hours.specialDays?.length && <p>{tr("特別営業日：")}{specialDaysText(config)}</p>}<p>{config.rules.advanceDays}{tr("日前から・開始")}{config.rules.leadMinutes}{tr("分前まで受付")}</p><p>{tr("当日予約")}{config.rules.sameDay ? tr("可") : tr("不可")}／{config.rules.interval}{tr("分刻み")}</p></section>
            <section className="spec-card"><h3><span aria-hidden="true">◇</span> {tr(" メニューと料金")}</h3>{config.menus.map(menu => <div className="spec-menu" key={menu.id}><span>{menu.name}{menu.imageId && <small>{tr("画像あり")}</small>}{!menu.active && <small>{tr("（受付停止）")}</small>}</span><b>{money(menu.price)}<small>{menu.duration}{tr("分")}</small></b></div>)}</section>
            <section className="spec-card spec-wide spec-payment"><h3>{tr("お支払いとキャンセル")}</h3><p>{infographic.payment.summary}</p>{infographic.payment.policy && <p>{tr("返金条件（お支払い額に対して）：{0}", infographic.payment.policy)}</p>}<p>{infographic.payment.cancellation}</p></section>
            <section className="spec-card spec-wide"><h3><span aria-hidden="true">♧</span> {tr(" スタッフと予約の割り当て")}</h3><p>{tr("お客様が指名・指名なしを選択。指名なしは、対応するスタッフのうち空いている1人に割り当てます。")}</p><div className="spec-staff-list">{infographic.staff.map(staff => <div key={staff.id}><b>{staff.name}</b><p>{staff.weekdays.map(d => days()[d]).join(listSeparator())} {staff.start} – {staff.end}</p><p>{staff.menuIds.map(id => config.menus.find(m => m.id === id)?.name).join(listSeparator())}</p></div>)}</div><p className="spec-note">{tr("営業時間・勤務・施術時間・予約済みの時間・連携済みのGoogle Calendarを確認して、予約可能な時間を表示します。")}</p></section>
            <section className="spec-card spec-wide"><h3>{tr("お客様管理")}</h3><p>{tr("予約・問い合わせをメールアドレスでまとめ、来店回数・最終来店日・合計金額を自動集計します。")}</p><p>{tr("期間指定、メモ・予約・問い合わせの絞り込み、非公開のメモと添付、画像一覧に対応。来店実績は終了した有効な予約だけで、キャンセル・無断キャンセルを除きます。")}</p><p>{tr("予約時のメッセージは予約情報に記録します。")}</p></section>
            <section className="spec-card spec-wide"><h3><span aria-hidden="true">▣</span> {tr(" お店のページ")}</h3><div className="spec-page-tags">{infographic.pages.map((page, i) => <span key={i}>{page.title}</span>)}</div><p className="spec-note">{tr("ヘッダー・フッターや共通部品の見た目は「AIとお店をつくる」の「ページ全体」で編集できます。")}</p><p>{tr("アクセス：")}{config.address}</p><p>{tr("お店への通知：")}{config.notificationEmail}</p></section>
          </div>
        </>}
      </section>
      <DataOverview isOwner={isOwner} publiclyPublished={publiclyPublished} google={google} open={open} />
    </div>
  );
}
