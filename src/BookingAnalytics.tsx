import { tr } from "../shared/i18n";
import type { BookingAnalytics as Analytics } from "../shared/booking-analytics";
import { chartSeriesColor, xyChart } from "../shared/diagrams";
import { fromMinor, toMinor } from "../shared/region";
import { groupCohorts, salesTrendSeries, type AnalyticsUnit } from "../shared/analytics-grouping";
import { PeleDiagram } from "./PeleDiagram";
import { useShopDisplay } from "./money";
import { Pagination, usePagination } from "./Pagination";
import { MenuSales } from "./MenuSales";

const rate = (completed: number, entered: number) => entered ? `${(completed / entered * 100).toFixed(1)}%` : "—";
export function BookingAnalytics({ data, view, unit = "day", staffId, onStaffChange }: { data: Analytics; view: "cohorts" | "staff" | "menus"; unit?: AnalyticsUnit; staffId: string; onStaffChange: (id: string) => void }) {
  const { money } = useShopDisplay();
  const cohorts = groupCohorts(data.cohorts, unit);
  const pages = usePagination([...cohorts].reverse(), `${data.from}:${data.to}:${unit}`);
  const selected = data.staff.find(row => row.id === staffId);
  const total = (amounts: number[]) => fromMinor(amounts.reduce((sum, amount) => sum + toMinor(amount, data.currency), 0), data.currency);
  const menuRows = selected?.menus.map(menu => ({ ...menu, colorIndex: Math.max(0, data.menus.findIndex(row => row.id === menu.id)) })) || [];
  const compared = selected ? menuRows.length ? menuRows : [{ id: "empty", name: tr("売上"), trend: [] }] : data.staff;
  const trend = salesTrendSeries(compared, data.cohorts.map(row => row.date), unit, data.currency);
  const cohortTitle = unit === "month" ? tr("月別の予約ページ閲覧数と予約確定数") : tr("予約ページの閲覧数と予約確定数");
  const trendTitle = selected ? tr("{0}のメニュー別売上推移", selected.name) : unit === "month" ? tr("月別売上推移") : tr("売上推移");
  return <div className="booking-analytics">
    <p className="small muted">{tr("集計日：{0}以降／{1}。売上は施術終了日の有効な予約金額で、キャンセル・無断キャンセル・未来の予約を除きます。決済入金額とは異なります。", data.from, data.timeZone)}</p>
    {data.logsTruncated && (view === "cohorts" || view === "staff" && !selected) && <p className="alert" role="status">{tr("記録件数が上限を超えたため、予約導線の集計を表示できません。期間を短くしてください。売上集計は全予約が対象です。")}</p>}
    {view === "menus" && <MenuSales data={data} unit={unit} />}
    {view === "cohorts" && !data.logsTruncated && <>
      <h3>{tr("予約ページ閲覧から予約確定まで")}</h3>
      <div className="analytics-kpis"><div><strong>{data.funnel.entered}</strong><span>{tr("予約ページを閲覧")}</span></div><div><strong>{data.funnel.completed}</strong><span>{tr("予約確定")}</span></div><div><strong>{rate(data.funnel.completed, data.funnel.entered)}</strong><span>{tr("確定率")}</span></div></div>
      {data.funnel.entered ? <>
        <PeleDiagram label={tr("予約の到達数")} source={xyChart(tr("予約の到達数"), [tr("予約ページ"), tr("メニュー選択"), tr("日時選択"), tr("予約確定")], [[data.funnel.entered, data.funnel.menu, data.funnel.slot, data.funnel.completed]], "bar", tr("件数"))} />
        <PeleDiagram label={cohortTitle} source={xyChart(cohortTitle, cohorts.map(row => unit === "month" ? row.date : row.date.slice(5)), [cohorts.map(row => row.entered), cohorts.map(row => row.completed)], "line", tr("件数"), [tr("予約ページ閲覧"), tr("予約確定")])} />
      </> : <p className="empty">{tr("この期間の予約ページ閲覧記録はありません。")}</p>}
      <p className="small muted">{tr("集計期間内で最初に予約ページを開いた日ごとに、閲覧数とその後の予約確定数を表示します。月別は初回閲覧月でまとめます。同じブラウザは期間内で1件、保存できない場合はログイン顧客で照合します。ログイン前の閲覧は同じブラウザでログイン後に結び付いたものだけ予約完了と照合できます。別端末は別扱いで、複数端末がある場合は直近の閲覧先に完了を割り当てます。譲渡購入は除外します。")}</p>
      <p className="small muted">{tr("選択段階は記録開始後の到達数です。初期選択のまま予約した場合や送信できなかった行動は記録されないため、段階間の差は厳密な離脱数ではありません。完了はサーバーの予約確定記録を使います。")}</p>
      <p className="small muted">{tr("照合できない予約ページの表示：{0} PV。1日・7日以内は最初の閲覧から24・168時間以内の完了率です。観測期間が満了していない行は「集計中」と表示します。", data.unidentifiedViews)}</p>
      <div {...pages.listProps} className="shop-access-scroll"><table className="shop-access-table cohort-table"><thead><tr><th>{unit === "month" ? tr("初回閲覧月") : tr("初回閲覧日")}</th><th>{tr("閲覧")}</th><th>{tr("予約確定")}</th><th>{tr("確定率")}</th><th>{tr("1日以内")}</th><th>{tr("7日以内")}</th></tr></thead><tbody>{pages.items.map(row => <tr key={row.date}><td>{row.date}</td><td>{row.entered}</td><td>{row.completed}</td><td>{rate(row.completed, row.entered)}</td><td>{!row.mature1Day ? tr("集計中") : rate(row.within1Day, row.entered)}</td><td>{!row.mature7Days ? tr("集計中") : rate(row.within7Days, row.entered)}</td></tr>)}</tbody></table></div>
      <Pagination pagination={pages} label={tr("予約ページ閲覧と予約確定")} />
    </>}
    {view === "staff" && <>
      <h3>{selected ? tr("{0}のメニュー別売上", selected.name) : tr("スタッフ別売上・予約の遷移")}</h3>
      <div className="analytics-kpis"><div><strong>{money(selected ? selected.revenue : total(data.staff.map(row => row.revenue)), data.currency)}</strong><span>{tr("売上")}</span></div><div><strong>{selected ? selected.visits : data.staff.reduce((sum, row) => sum + row.visits, 0)}</strong><span>{tr("来店数")}</span></div></div>
      <label className="analytics-staff-filter">{tr("表示するスタッフ")}<select value={selected?.id || ""} onChange={event => onStaffChange(event.target.value)}><option value="">{tr("全スタッフ")}</option>{data.staff.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <PeleDiagram label={trendTitle} source={xyChart(trendTitle, trend.labels.map(date => unit === "month" ? date : date.slice(5)), trend.series.map(row => row.values), "line", data.currency, trend.series.map(row => row.name))} colors={trend.series.map(row => chartSeriesColor(row.colorIndex))} />
      {selected ? <>
        {!menuRows.length && <p className="empty">{tr("このスタッフは選択期間内に施術が終了した予約がありません。")}</p>}
        <div className="shop-access-scroll"><table className="shop-access-table staff-menu-table"><thead><tr><th>{tr("メニュー")}</th><th>{tr("予約件数")}</th><th>{tr("売上")}</th></tr></thead><tbody>{menuRows.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.visits}</td><td>{money(row.revenue, data.currency)}</td></tr>)}</tbody></table></div>
        <p className="small muted">{tr("選んだスタッフが担当した予約だけを、基本・追加メニュー別に集計しています。割引は予約時の料金内訳に沿って配分します。")}</p>
      </> : <>
        <div className="shop-access-scroll"><table className="shop-access-table staff-analytics-table"><thead><tr><th>{tr("スタッフ")}</th><th>{tr("来店数")}</th><th>{tr("売上")}</th><th>{tr("選択・割当")}</th><th>{tr("予約確定")}</th><th>{tr("確定率")}</th></tr></thead><tbody>{data.staff.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.visits}</td><td>{money(row.revenue, data.currency)}</td><td>{data.logsTruncated ? "—" : row.selected}</td><td>{data.logsTruncated ? "—" : row.completed}</td><td>{data.logsTruncated ? "—" : rate(row.completed, row.selected)}</td></tr>)}</tbody></table></div>
        <p className="small muted">{tr("選択・割当は、期間内の予約ページ閲覧からスタッフの選択または日時の割当を記録したブラウザ数です。同じ訪問で複数スタッフを選ぶと各スタッフに含みます。完了は確定時の担当者に集計し、指名なしの予約は割当先に含みます。売上の対象期間とは基準が異なります。")}</p>
      </>}
    </>}
  </div>;
}
