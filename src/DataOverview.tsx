import React from "react";
import { shopData } from "../server/shop-data";
import type { Workspace } from "./App";

export function DataOverview({ isOwner, google, open }: { isOwner: boolean; google?: Workspace["google"]; open: (screen: string) => void }) {
  return <section className="panel data-overview" aria-label="データと権限の仕組み">
    <h2>データと権限の仕組み</h2>
    {google && <div className="actions"><a className="button" href={`https://docs.google.com/spreadsheets/d/${google.sheetId}/edit`} target="_blank" rel="noreferrer">お店のスプレッドシート ↗</a><a className="button" href={`https://drive.google.com/drive/folders/${google.folderId}`} target="_blank" rel="noreferrer">お店のファイル ↗</a></div>}
    <ol className="data-flow" aria-label="データの流れ">
      <li><span aria-hidden="true">✎</span><strong>予約・問い合わせ・編集</strong><p>お客様と運営メンバーが画面から入力</p></li>
      <li><span aria-hidden="true">▤</span><strong>店主のスプレッドシート</strong><p>お店の台帳が正本。画像・添付は Drive に保存</p></li>
      <li><span aria-hidden="true">▣</span><strong>管理画面・公開ページ</strong><p>台帳を読み込み、権限に応じて表示</p></li>
    </ol>
    <div className="data-spec-grid">
      <section><h3>台帳と編集する画面</h3><div className="data-sheet-list">{shopData.filter(data => !("internal" in data && data.internal)).map(data => <div key={data.sheet}><span><strong>{data.label}</strong><small>{data.sheet}</small></span>{!data.ownerOnly || isOwner ? <button type="button" onClick={() => open(data.screen)}>{data.screenLabel} →</button> : <span className="small muted">店主が編集</span>}</div>)}</div>{isOwner && <button type="button" onClick={() => open("data")}>その他の追加データを管理 →</button>}<p className="small muted">営業時間・休業日・予約の受付条件は「お店の基本情報」、共通パーツは「画面を試す・編集」で管理します。</p></section>
      <div className="data-storage-cards">
        <section><h3>店主の Google Drive</h3><ul><li><b>公開用：</b>お客様向けページ・メニュー画像</li><li><b>お店の記録：</b>仕様書・変更履歴・記事の原稿</li><li><b>非公開：</b>お客様メモの画像・添付ファイル</li></ul></section>
        <section><h3>誰が見られる？</h3><ul><li><b>お客様：</b>公開ページと自分の予約</li><li><b>参加済みメンバー：</b>予約・お問い合わせ・お客様メモ</li><li><b>店主：</b>お店の設定・公開・メンバーの管理</li></ul></section>
        <section><h3>記録を残す</h3><p>予約のキャンセル・メンバーの解除・メモの削除は、行を消さず状態を変更して保持します。</p><p>専用画面のないデータは「データ管理」で扱います。</p></section>
      </div>
    </div>
  </section>;
}
