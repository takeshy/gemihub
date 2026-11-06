import { tr, listSeparator } from "../shared/i18n";
import { useShopDisplay } from "./money";
import type { ChatReference } from "../server/shop-chat";
import type { RequestIntent } from "../server/request-intent";
import React, { useEffect, useRef, useState } from "react";
import { hoursText, specialDaysText, type ShopConfig } from "../server/domain";
import { shopInfographic } from "../shared/shop-infographic";
import { useApi } from "./api";
import { DataOverview } from "./DataOverview";
import { PeleDiagram } from "./PeleDiagram";
import { diagramLabel } from "../shared/diagrams";
import { ShopRequest } from "./ShopRequest";
import type { Plan, Workspace } from "./App";
export type BuildContext = { config: ShopConfig | null; published: boolean; revision: number; hash: string; history: { at: string; summary: string }[] };
const days = () => [tr("日"), tr("月"), tr("火"), tr("水"), tr("木"), tr("金"), tr("土")];
export function ShopOverview({ shopId, google, isOwner, publiclyPublished, onPlan, onAccept, plan, open, focusRequest = false, initialIntent }: { initialIntent?: RequestIntent; focusRequest?: boolean; google?: Workspace["google"]; open: (screen: string) => void; shopId: string; isOwner: boolean; publiclyPublished: boolean; onPlan: (text: string, context: Pick<BuildContext, "revision" | "hash">, imageIds?: string[], intent?: RequestIntent, chat?: ChatReference) => Promise<Plan>; onAccept: (plan: Plan) => Promise<void>; plan?: Plan }) {
  const api = useApi();
  const { money, shopTime } = useShopDisplay();
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
  async function retryPublication() {
    if (!plan?.approved) return;
    setLoading(true); setError("");
    try { await onAccept(plan); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [shopId]);
  const config = data?.config;
  const infographic = config ? shopInfographic(config) : undefined;
  return <div className="shop-build-layout">
    {/* Recovery must not depend on build-context, which is unavailable during an interrupted publish. */}
    {!data && isOwner && plan?.approved && <section className="panel request-review" data-publication-recovery aria-label={tr("中断した公開")}>
      <h3>{tr("中断した公開")}</h3>
      <p>{tr("承認済みの変更を使って、保存・反映を再試行します。")}</p>
      <ul>{plan.summary.map((summary, index) => <li key={index}>{summary}</li>)}</ul>
      <button className="primary" disabled={loading || planning} onClick={() => void retryPublication()}>{tr("反映を再試行")}</button>
    </section>}
    <section className="panel shop-history" aria-label={tr("お店の変更履歴")}>
      {error && <div className="alert" role="alert"><p>{error}</p><button disabled={loading || planning} onClick={() => void refresh()}>{tr("もう一度読み込む")}</button></div>}
      <details>
      <summary><h2>{tr("変更履歴")}</h2><span className="small muted">{data ? tr("{0}件", data.history.length) : tr("読み込み中…")}</span><span className="history-chevron" aria-hidden="true">⌄</span></summary>
      {data && !data.history.length && <p className="muted">{tr("まだ変更履歴はありません。")}</p>}
      <ol>{[...(data?.history || [])].reverse().map((entry, i) => <li key={`${entry.at}-${i}`}><time dateTime={entry.at}>{shopTime(entry.at)}</time><p>{entry.summary}</p></li>)}</ol>
      </details>
    </section>
    <section ref={requestSection} className="panel shop-consultation" aria-label={tr("AIへの相談")}>
      <div className="section-top"><span className="ai-mark">✳</span><div><h2>{tr("AIとお店をつくる")}</h2><p className="small muted">{tr("直したいことや追加したいページをAIに伝えます。質問はメニューの「相談・質問」へ。")}</p></div></div>
      <p className="muted">{tr("現在のお店の設定と変更履歴を見ながら、音声や文字でやりとりできます。")}</p>
      {data && config && <ShopRequest key={`${data.hash}-${generation}`} shopId={shopId} initialIntent={initialIntent} published={data.published} isOwner={isOwner} context={{ revision: data.revision, hash: data.hash }} currentConfig={config} plan={plan} onAccept={onAccept} onPlan={async (text, imageIds, intent, chat) => { setPlanning(true); try { return await onPlan(text, { revision: data.revision, hash: data.hash }, imageIds, intent, chat); } finally { setPlanning(false); } }} />}
      {planning && <p role="status">{tr("変更プランを作成しています…")}</p>}
    </section>
    <div className="shop-spec-column">
      <section className="panel shop-spec" aria-label={tr("現在のお店の設定")}>
        <div className="section-top"><h2>{tr("現在のお店の設定")}</h2></div>
        {!data && <p>{loading ? tr("現在のお店の設定を読み込んでいます…") : tr("設定を読み込めませんでした。もう一度読み込んでください。")}</p>}
        {config && infographic && <>
          <div className="shop-spec-intro"><h3>{config.name}</h3><p>{config.description}</p><span className="pill">{data.published ? tr("現在の設定") : tr("公開前の設定")}</span></div>
          <div className="spec-stats"><div><strong>{config.menus.filter(m => m.active).length}</strong><span>{tr("メニュー")}</span></div><div><strong>{infographic.staff.length}</strong><span>{tr("スタッフ")}</span></div><div><strong>{infographic.pageCount}</strong><span>{tr("お客様向け画面")}</span></div></div>
          <PeleDiagram label={tr("予約の流れ")} source={["flowchart LR", ...infographic.bookingFlow.map((step, i) => `step${i}[${diagramLabel(`${step.label}: ${step.detail}`)}]`), ...infographic.bookingFlow.slice(1).map((_, i) => `step${i} --> step${i + 1}`)].join("\n")} />
          <details><summary>{tr("予約の流れの説明")}</summary><ol className="spec-booking-flow" aria-label={tr("予約の流れ")} style={{ "--flow-steps": infographic.bookingFlow.length } as React.CSSProperties}>{infographic.bookingFlow.map((step, i) => <li key={i}><b>{String(i + 1).padStart(2, "0")}</b><span>{step.label}</span><small>{step.detail}</small></li>)}</ol></details>
          <div className="spec-card-grid">
            <section className="spec-card"><h3><span aria-hidden="true">◷</span> {tr(" 営業時間と受付")}</h3><p className="spec-highlight">{hoursText(config)}</p><p>{tr("定休日：")}{config.hours.closedWeekdays.map(d => tr("{0}曜", days()[d])).join(listSeparator()) || tr("なし")}</p><p>{tr("臨時休業：")}{config.hours.holidays.join(listSeparator()) || tr("なし")}</p>{!!config.hours.specialDays?.length && <p>{tr("特別営業日：")}{specialDaysText(config)}</p>}<p>{config.rules.advanceDays}{tr("日前から・開始")}{config.rules.leadMinutes}{tr("分前まで受付")}</p><p>{tr("当日予約")}{config.rules.sameDay ? tr("可") : tr("不可")}／{config.rules.interval}{tr("分刻み")}</p></section>
            <section className="spec-card"><h3><span aria-hidden="true">◇</span> {tr(" メニューと料金")}</h3>{config.menus.map(menu => <div className="spec-menu" key={menu.id}><span>{menu.name}{menu.imageId && <small>{tr("画像あり")}</small>}{!menu.active && <small>{tr("（受付停止）")}</small>}</span><b>{money(menu.price)}<small>{menu.duration}{tr("分")}</small></b></div>)}</section>
            <section className="spec-card spec-wide spec-payment"><h3>{tr("お支払いとキャンセル")}</h3><p>{infographic.payment.summary}</p>{infographic.payment.policy && <p>{tr("返金条件（お支払い額に対して）：{0}", infographic.payment.policy)}</p>}<p>{infographic.payment.cancellation}</p></section>
            <section className="spec-card spec-wide"><h3><span aria-hidden="true">♧</span> {tr(" スタッフと予約の割り当て")}</h3><p>{tr("お客様が指名・指名なしを選択。指名なしは、対応するスタッフのうち空いている1人に割り当てます。")}</p><div className="spec-staff-list">{infographic.staff.map(staff => <div key={staff.id}><b>{staff.name}</b><p>{staff.weekdays.map(d => days()[d]).join(listSeparator())} {staff.start} – {staff.end}</p><p>{staff.menuIds.map(id => config.menus.find(m => m.id === id)?.name).join(listSeparator())}</p></div>)}</div><p className="spec-note">{tr("営業時間・勤務・施術時間・予約済みの時間・連携済みのGoogle Calendarを確認して、予約可能な時間を表示します。")}</p></section>
            <section className="spec-card spec-wide"><h3>{tr("お客様管理")}</h3><p>{tr("予約・問い合わせをメールアドレスでまとめ、来店回数・最終来店日・合計金額を自動集計します。")}</p><p>{tr("期間指定、メモ・予約・問い合わせの絞り込み、非公開のメモと添付、画像一覧に対応。来店実績は終了した有効な予約だけで、キャンセル・無断キャンセルを除きます。")}</p><p>{tr("予約時のメッセージは予約情報に記録します。")}</p></section>
            <section className="spec-card spec-wide"><h3><span aria-hidden="true">▣</span> {tr(" お店のページ")}</h3><div className="spec-page-tags">{infographic.pages.map((page, i) => <span key={i}>{page.title}</span>)}</div><p className="spec-note">{tr("ヘッダー・フッターは共通パーツとして個別に編集できます。")}</p><p>{tr("アクセス：")}{config.address}</p><p>{tr("お店への通知：")}{config.notificationEmail}</p></section>
          </div>
        </>}
      </section>
      <DataOverview isOwner={isOwner} publiclyPublished={publiclyPublished} google={google} open={open} />
    </div>
  </div>;
}
