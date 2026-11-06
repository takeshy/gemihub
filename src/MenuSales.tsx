import { useState } from "react";
import type { BookingAnalytics } from "../shared/booking-analytics";
import { salesTrendSeries, type AnalyticsUnit } from "../shared/analytics-grouping";
import { fromMinor, toMinor } from "../shared/region";
import { tr } from "../shared/i18n";
import { chartSeriesColor, xyChart } from "../shared/diagrams";
import { useShopDisplay } from "./money";
import { PeleDiagram } from "./PeleDiagram";
import { SalesPie } from "./SalesPie";

export function MenuSales({ data, unit }: { data: BookingAnalytics; unit: AnalyticsUnit }) {
  const { money } = useShopDisplay();
  const [menuId, setMenuId] = useState("");
  const selected = data.menus.find(row => row.id === menuId);
  const sum = (values: number[]) => fromMinor(values.reduce((total, value) => total + toMinor(value, data.currency), 0), data.currency);
  const compared = selected ? data.staff.map((person, colorIndex) => ({
    id: person.id, name: person.name, colorIndex, trend: person.menus.find(menu => menu.id === selected.id)?.trend || [],
  })) : data.menus;
  const trend = salesTrendSeries(compared, data.cohorts.map(row => row.date), unit, data.currency);
  const trendTitle = selected ? tr("{0}のスタッフ別売上推移", selected.name) : unit === "month" ? tr("メニュー別の月別売上推移") : tr("メニュー別の日別売上推移");
  return <section className="menu-sales" aria-label={tr("メニュー別売上")}>
    <h3>{tr("メニュー別売上")}</h3>
    <div className="analytics-kpis"><div><strong>{money(sum(data.menus.map(row => row.revenue)), data.currency)}</strong><span>{tr("売上")}</span></div></div>
    <SalesPie rows={data.menus} currency={data.currency} />
    {!data.menus.some(row => row.visits) && <p className="empty">{tr("この期間に施術が終了した予約はありません。")}</p>}
    <label className="analytics-staff-filter">{tr("売上推移のメニュー")}<select value={selected?.id || ""} onChange={event => setMenuId(event.target.value)}><option value="">{tr("全メニュー")}</option>{data.menus.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    <PeleDiagram label={trendTitle} source={xyChart(trendTitle, trend.labels.map(date => unit === "month" ? date : date.slice(5)), trend.series.map(row => row.values), "line", data.currency, trend.series.map(row => row.name))} colors={trend.series.map(row => chartSeriesColor(row.colorIndex))} />
    <div className="shop-access-scroll"><table className="shop-access-table"><thead><tr><th>{tr("メニュー")}</th><th>{tr("種類")}</th><th>{tr("予約件数")}</th><th>{tr("売上")}</th></tr></thead><tbody>{data.menus.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.kind === "addon" ? tr("追加メニュー") : row.kind === "unknown" ? tr("内訳不明") : tr("基本メニュー")}</td><td>{row.visits}</td><td>{money(row.revenue, data.currency)}</td></tr>)}</tbody></table></div>
    <p className="small muted">{tr("基本メニューと追加メニューを分けて集計します。割引後の予約金額を、予約時に保存した各メニューの料金比率で配分するため、合計は予約の売上と一致します。複数メニューの料金内訳が残っていない予約は「内訳不明」に集計します。件数は、そのメニューを含む施術終了済みの予約数です。")}</p>
  </section>;
}
