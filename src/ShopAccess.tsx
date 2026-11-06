import { useEffect, useState } from "react";
import { tr } from "../shared/i18n";
import { articleAccessDays, type ArticleAccessDays, type ArticleAccessResult, type SiteTrafficResult, type MonthlyTrafficResult } from "../shared/article-access";
import type { AnalyticsUnit } from "../shared/analytics-grouping";
import { postLabel } from "../server/post-domain";
import { useApi } from "./api";
import "./ShopAccess.css";
import { Pagination, usePagination } from "./Pagination";
import { PeleDiagram } from "./PeleDiagram";
import { xyChart } from "../shared/diagrams";
import type { BookingAnalytics as Analytics } from "../shared/booking-analytics";
import { BookingAnalytics } from "./BookingAnalytics";
export type AccessView = "daily" | "articles" | "cohorts" | "staff" | "menus";

export function ShopAccess({ shopId, initialView = "daily", initialOpen = false, initialUnit = "day" }: { shopId: string; initialView?: AccessView; initialOpen?: boolean; initialUnit?: AnalyticsUnit }) {
  const api = useApi();
  const [open, setOpen] = useState(initialOpen);
  const [days, setDays] = useState<ArticleAccessDays>(30);
  const [view, setView] = useState<AccessView>(initialView);
  const [unit, setUnit] = useState<AnalyticsUnit>(initialUnit);
  const [staffId, setStaffId] = useState("");
  const [analytics, setAnalytics] = useState<Analytics>();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ArticleAccessResult>();
  const [traffic, setTraffic] = useState<SiteTrafficResult | MonthlyTrafficResult>();
  const [error, setError] = useState("");
  const dailyPages = usePagination<{ date: string; views: number; uniqueBrowsers: number | null }>(traffic?.rows || [], JSON.stringify([shopId, days, view, attempt, unit]));
  const articlePages = usePagination(result?.rows || [], JSON.stringify([shopId, days, view, attempt]));
  const trafficUnit = view === "daily" ? unit : "day";
  useEffect(() => {
    if (!open) return;
    let active = true;
    setResult(undefined); setTraffic(undefined); setAnalytics(undefined); setError("");
    const receiveAnalytics = (value: Analytics) => {
      if (!active) return;
      setAnalytics(value);
      setStaffId(id => value.staff.some(row => row.id === id) ? id : "");
    };
    const request = view === "cohorts" || view === "staff" || view === "menus" ? api<Analytics>(`/api/shops/${shopId}/booking-analytics?days=${days}`).then(receiveAnalytics) : view === "articles" ? api<ArticleAccessResult>(`/api/shops/${shopId}/posts/access?days=${days}`).then(value => { if (active) setResult(value); }) : api<SiteTrafficResult | MonthlyTrafficResult>(`/api/shops/${shopId}/access?days=${days}${trafficUnit === "month" ? "&unit=month" : ""}`).then(value => { if (active) setTraffic(value); });
    void request.catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api, shopId, days, attempt, open, view, trafficUnit]);
  const monthly = !!traffic && "unit" in traffic && traffic.unit === "month";
  const trafficTitle = monthly ? tr("月別の訪問数") : tr("日別の訪問数");
  const orderedTraffic = [...(traffic?.rows || [])].reverse();
  const uniqueAvailable = !traffic || !("uniqueCountsAvailable" in traffic) || traffic.uniqueCountsAvailable;
  return <section className="panel shop-access" style={{ gridColumn: "1 / -1", minWidth: 0 }} aria-label={tr("お店のアクセス数")}>
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary><strong>{tr("お店のアクセス数")}</strong></summary>
      <div className="shop-access-controls">
        <label>{tr("表示する集計")}<select aria-label={tr("表示する集計")} value={view} onChange={event => setView(event.target.value as AccessView)}><option value="daily">{tr("訪問数")}</option><option value="articles">{tr("ブログ・お知らせの記事別")}</option><option value="cohorts">{tr("予約ページ閲覧と予約確定")}</option><option value="staff">{tr("スタッフ別売上・予約の遷移")}</option><option value="menus">{tr("メニュー別売上")}</option></select></label>
        <label>{tr("集計期間")}<select aria-label={tr("アクセス数の集計期間")} value={days} onChange={event => setDays(Number(event.target.value) as ArticleAccessDays)}>{articleAccessDays.map(value => <option key={value} value={value}>{tr("過去{0}日", value)}</option>)}</select></label>
        {view !== "articles" && <label>{tr("表示単位")}<select value={unit} onChange={event => setUnit(event.target.value as AnalyticsUnit)}><option value="day">{tr("日別")}</option><option value="month">{tr("月別")}</option></select></label>}
        <button type="button" onClick={() => setAttempt(value => value + 1)}>{tr("更新")}</button>
      </div>
      {unit === "month" && view !== "articles" && <p className="small muted">{tr("月別は選択期間に含まれる日だけをまとめます。月の途中から始まる期間や当月は、月全体の合計ではありません。アクセスと予約導線の記録は過去90日までです。")}</p>}
      <p className="small muted">{tr("ログイン前も含みます。PVは再読み込みを含む表示回数、ユニークはブラウザ数の目安です。別端末やシークレットモードは別扱いです。店主・スタッフの確認は除外します。記録開始前や送信できなかった閲覧は含まず、保存機能が使えないブラウザはPVのみ集計します。")}</p>
      {error && <p className="alert" role="alert">{error}</p>}
      {!result && !traffic && !analytics && !error && <p role="status">{tr("アクセス数を読み込んでいます…")}</p>}
      {analytics && (view === "cohorts" || view === "staff" || view === "menus") && <BookingAnalytics key={`${shopId}:${days}`} data={analytics} view={view} unit={unit} staffId={staffId} onStaffChange={setStaffId} />}
      {traffic && <>
        <p>{monthly ? tr("日付の基準：{0}。月別ユニークは選択期間の同じ月に訪れた同じブラウザを1件と数えます。日別ユニークの合計ではありません。", traffic.timeZone) : tr("日付の基準：{0}。同じ日の同じブラウザは、複数ページ見ても1件です。", traffic.timeZone)}</p>
        {!uniqueAvailable && <p role="status" className="alert">{tr("記録件数が上限を超えたため、月別ユニークは表示できません。PVは全件の集計です。期間を短くしてください。")}</p>}
        <PeleDiagram label={trafficTitle} source={xyChart(trafficTitle, orderedTraffic.map(row => monthly ? row.date : row.date.slice(5)), [orderedTraffic.map(row => row.views), ...(uniqueAvailable ? [orderedTraffic.map(row => row.uniqueBrowsers!)] : [])], "line", tr("件数"), [tr("PV（表示回数）"), ...(uniqueAvailable ? [tr("訪問ブラウザ数")] : [])])} />
        <div {...dailyPages.listProps} className="shop-access-scroll"><table className="shop-access-table"><thead><tr><th>{monthly ? tr("対象月") : tr("日付")}</th><th>PV</th><th>{tr("ユニーク（ブラウザ）")}</th></tr></thead><tbody>{dailyPages.items.map(row => <tr key={row.date}><td><time dateTime={row.date}>{row.date}</time></td><td>{row.views}</td><td>{row.uniqueBrowsers ?? "—"}</td></tr>)}</tbody></table></div>
        <Pagination pagination={dailyPages} label={trafficTitle} />
      </>}
      {result && <>
        <p><b>{tr("公開記事の合計：{0} PV", result.total)}</b>　{tr("ブログ：{0} PV・お知らせ：{1} PV", result.byCategory.blogs, result.byCategory.announcements)}</p>
        {!!result.rows.length && <PeleDiagram label={tr("記事別PV（上位10件）")} source={xyChart(tr("記事別PV（上位10件）"), result.rows.slice(0, 10).map(row => row.title), [result.rows.slice(0, 10).map(row => row.views)], "bar", "PV")} />}
        {!result.rows.length ? <p className="empty">{tr("公開中の記事はありません。")}</p> : <div {...articlePages.listProps} className="shop-access-scroll"><table className="shop-access-table article-access-table">
          <thead><tr><th>{tr("種類")}</th><th>{tr("記事")}</th><th>PV</th><th>{tr("ユニーク（ブラウザ）")}</th></tr></thead>
          <tbody>{articlePages.items.map(row => <tr key={row.postId}><td>{postLabel(row.category)}</td><td style={{ overflowWrap: "anywhere" }}>{row.title}</td><td>{row.views}</td><td>{row.uniqueBrowsers}</td></tr>)}</tbody>
        </table></div>}
        <Pagination pagination={articlePages} label={tr("ブログ・お知らせの記事別")} />
      </>}
    </details>
  </section>;
}
