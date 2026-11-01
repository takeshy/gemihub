import type { ChatReference } from "../server/shop-chat";
import type { RequestIntent } from "../server/request-intent";
import React, { useEffect, useRef, useState } from "react";
import type { ShopConfig } from "../server/domain";
import { useApi } from "./api";
import { DataOverview } from "./DataOverview";
import { ShopRequest } from "./ShopRequest";
import type { Plan, Workspace } from "./App";
export type BuildContext = { config: ShopConfig | null; published: boolean; revision: number; hash: string; history: { at: string; summary: string }[] };
const days = ["日", "月", "火", "水", "木", "金", "土"];
const money = (price: number) => `¥${price.toLocaleString("ja-JP")}`;
export function ShopOverview({ shopId, google, isOwner, onPlan, onAccept, plan, open, focusRequest = false, initialIntent }: { initialIntent?: RequestIntent; focusRequest?: boolean; google?: Workspace["google"]; open: (screen: string) => void; shopId: string; isOwner: boolean; onPlan: (text: string, context: Pick<BuildContext, "revision" | "hash">, imageIds?: string[], intent?: RequestIntent, chat?: ChatReference) => Promise<Plan>; onAccept: (plan: Plan) => Promise<void>; plan?: Plan }) {
  const api = useApi();
  const [data, setData] = useState<BuildContext>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [generation, setGeneration] = useState(0);
  const requestSection = useRef<HTMLElement>(null);
  useEffect(() => { if (data && focusRequest) requestSection.current?.scrollIntoView({ block: "start" }); }, [!!data, focusRequest]);
  async function refresh() {
    setLoading(true); setError("");
    try { setData(await api<BuildContext>(`/api/shops/${shopId}/build-context`)); setGeneration(v => v + 1); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [shopId]);
  const config = data?.config;
  return <div className="shop-build-layout">
    <section className="panel shop-history" aria-label="お店の変更履歴">
      {error && <div className="alert" role="alert"><p>{error}</p><button disabled={loading || planning} onClick={() => void refresh()}>もう一度読み込む</button></div>}
      <details>
      <summary><h2>変更履歴</h2><span className="small muted">{data ? `${data.history.length}件` : "読み込み中…"}</span><span className="history-chevron" aria-hidden="true">⌄</span></summary>
      {data && !data.history.length && <p className="muted">まだ変更履歴はありません。</p>}
      <ol>{[...(data?.history || [])].reverse().map((entry, i) => <li key={`${entry.at}-${i}`}><time dateTime={entry.at}>{new Date(entry.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</time><p>{entry.summary}</p></li>)}</ol>
      </details>
    </section>
    <section ref={requestSection} className="panel shop-consultation" aria-label="AIへの相談">
      <div className="section-top"><span className="ai-mark">✳</span><div><h2>AIとお店をつくる</h2><p className="small muted">相談・修正・新ページ作成を選べます。</p></div></div>
      <p className="muted">現在のお店の設定と変更履歴を見ながら、音声や文字でやりとりできます。</p>
      {data && config && <ShopRequest key={`${data.hash}-${generation}`} shopId={shopId} initialIntent={initialIntent} published={data.published} isOwner={isOwner} context={{ revision: data.revision, hash: data.hash }} currentConfig={config} plan={plan} onAccept={onAccept} onPlan={async (text, imageIds, intent, chat) => { setPlanning(true); try { return await onPlan(text, { revision: data.revision, hash: data.hash }, imageIds, intent, chat); } finally { setPlanning(false); } }} />}
      {planning && <p role="status">変更プランを作成しています…</p>}
    </section>
    <div className="shop-spec-column">
      <section className="panel shop-spec" aria-label="現在のお店の設定">
        <div className="section-top"><h2>現在のお店の設定</h2></div>
        {!data && <p>{loading ? "現在のお店の設定を読み込んでいます…" : "設定を読み込めませんでした。もう一度読み込んでください。"}</p>}
        {config && <>
          <div className="shop-spec-intro"><h3>{config.name}</h3><p>{config.description}</p><span className="pill">{data.published ? "現在の設定" : "公開前の設定"}</span></div>
          <div className="spec-stats"><div><strong>{config.menus.filter(m => m.active).length}</strong><span>メニュー</span></div><div><strong>{config.staff.length}</strong><span>スタッフ</span></div><div><strong>{8 + config.pages.length}</strong><span>お客様向け画面</span></div></div>
          <ol className="spec-booking-flow" aria-label="予約の流れ">{["Googleでログイン", "メニュー・指名・日時", "空き時間を確認", "予約・メール通知"].map((label, i) => <li key={label}><b>{String(i + 1).padStart(2, "0")}</b><span>{label}</span></li>)}</ol>
          <div className="spec-card-grid">
            <section className="spec-card"><h3><span aria-hidden="true">◷</span> 営業時間と受付</h3><p className="spec-highlight">{config.hours.start} – {config.hours.end}</p><p>定休日：{config.hours.closedWeekdays.map(d => `${days[d]}曜`).join("・") || "なし"}</p><p>臨時休業：{config.hours.holidays.join("・") || "なし"}</p><p>{config.rules.advanceDays}日前から・開始{config.rules.leadMinutes}分前まで受付</p><p>当日予約{config.rules.sameDay ? "可" : "不可"}／{config.rules.interval}分刻み</p><p>キャンセルは開始{config.rules.cancelHours}時間前まで</p></section>
            <section className="spec-card"><h3><span aria-hidden="true">◇</span> メニューと料金</h3>{config.menus.map(menu => <div className="spec-menu" key={menu.id}><span>{menu.name}{menu.imageId && <small>画像あり</small>}{!menu.active && <small>（受付停止）</small>}</span><b>{money(menu.price)}<small>{menu.duration}分</small></b></div>)}</section>
            <section className="spec-card spec-wide"><h3><span aria-hidden="true">♧</span> スタッフと予約の割り当て</h3><p>お客様が指名・指名なしを選択。指名なしは、対応するスタッフのうち空いている1人に割り当てます。</p><div className="spec-staff-list">{config.staff.map(staff => <div key={staff.id}><b>{staff.name}</b><p>{staff.weekdays.map(d => days[d]).join("・")} {staff.start} – {staff.end}</p><p>{staff.menuIds.map(id => config.menus.find(m => m.id === id)?.name).join("・")}</p></div>)}</div><p className="spec-note">営業時間・勤務・施術時間・予約済みの時間・連携済みのGoogle Calendarを確認して、予約可能な時間を表示します。</p></section>
            <section className="spec-card spec-wide"><h3>お客様管理</h3><p>予約・問い合わせをメールアドレスでまとめ、来店回数・最終来店日・合計金額を自動集計します。</p><p>期間指定、メモ・予約・問い合わせの絞り込み、非公開のメモと添付、画像一覧に対応。来店実績は終了した有効な予約だけで、キャンセル・無断キャンセルを除きます。</p><p>予約時のメッセージは予約情報に記録します。</p></section>
            <section className="spec-card spec-wide"><h3><span aria-hidden="true">▣</span> お店のページ</h3><div className="spec-page-tags">{["予約", "お店のこと", "マイページ", "お問い合わせ", "ブログ一覧・記事", "お知らせ一覧・記事", ...config.pages.map(p => p.title)].map((title, i) => <span key={i}>{title}</span>)}</div><p className="spec-note">ヘッダー・フッターは共通パーツとして個別に編集できます。</p><p>アクセス：{config.address}</p><p>お店への通知：{config.notificationEmail}</p></section>
          </div>
        </>}
      </section>
      <DataOverview isOwner={isOwner} google={google} open={open} />
    </div>
  </div>;
}
