import { tr } from "../shared/i18n";
import React from "react";
import { shopData } from "../server/shop-data";
import type { Workspace } from "./App";

export function DataOverview({ isOwner, publiclyPublished, google, open }: { isOwner: boolean; publiclyPublished: boolean; google?: Workspace["google"]; open: (screen: string) => void }) {
  return <section className="panel data-overview" aria-label={tr("データと権限の仕組み")}>
    <h2>{tr("データと権限の仕組み")}</h2>
    <div className="actions">{isOwner && <button type="button" onClick={() => open("settings")}>{tr("お店のデータを書き出す")}</button>}{google && <a className="button" href={`https://drive.google.com/drive/folders/${google.folderId}`} target="_blank" rel="noreferrer">{tr("お店のファイル ↗")}</a>}</div>
    <ol className="data-flow" aria-label={tr("データの流れ")}>
      <li><span aria-hidden="true">✎</span><strong>{tr("予約・問い合わせ・編集")}</strong><p>{tr("お客様と運営メンバーが画面から入力")}</p></li>
      <li><span aria-hidden="true">▤</span><strong>{tr("お店のデータ")}</strong><p>{tr("記録はFirestore、画像・添付はDriveに保存")}</p></li>
      <li><span aria-hidden="true">▣</span><strong>{tr("管理画面・公開ページ")}</strong><p>{tr("台帳を読み込み、権限に応じて表示")}</p></li>
    </ol>
    <div className="data-spec-grid">
      <section><h3>{tr("台帳と編集する画面")}</h3><div className="data-sheet-list">{shopData.filter(data => !("internal" in data && data.internal) && (publiclyPublished || !["bookings", "customers"].includes(data.screen))).map(data => <div key={data.sheet}><span><strong>{data.label}</strong><small>{data.sheet}</small></span>{!data.ownerOnly || isOwner ? <button type="button" onClick={() => open(data.screen)}>{data.screenLabel} →</button> : <span className="small muted">{tr("店主が編集")}</span>}</div>)}</div><p className="small muted">{tr("営業時間・休業日・予約の受付条件は「お店の基本情報」、ページ全体の見た目は「画面を試す・編集」で管理します。")}</p></section>
      <div className="data-storage-cards">
        <section><h3>{tr("店主の Google Drive")}</h3><ul><li><b>{tr("公開用：")}</b>{tr("お客様向けページ・メニュー画像")}</li><li><b>{tr("お店の記録：")}</b>{tr("仕様書・変更履歴・記事の原稿")}</li><li><b>{tr("非公開：")}</b>{tr("お客様メモの画像・添付ファイル")}</li></ul></section>
        <section><h3>{tr("誰が見られる？")}</h3><ul><li><b>{tr("お客様：")}</b>{tr("公開ページと自分の予約")}</li><li><b>{tr("参加済みメンバー：")}</b>{tr("予約・お問い合わせ・お客様メモ")}</li><li><b>{tr("店主：")}</b>{tr("お店の設定・公開・メンバーの管理")}</li></ul></section>
        <section><h3>{tr("記録を残す")}</h3><p>{tr("予約のキャンセル・メンバーの解除・メモの削除は、行を消さず状態を変更して保持します。")}</p></section>
      </div>
    </div>
  </section>;
}
