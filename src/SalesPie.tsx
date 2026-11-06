import type { Currency } from "../shared/region";
import { salesComposition } from "../shared/analytics-grouping";
import { chartSeriesColor } from "../shared/diagrams";
import { tr } from "../shared/i18n";
import { useShopDisplay } from "./money";
import "./PeleDiagram.css";

export function SalesPie({ rows, currency }: { rows: { id: string; name: string; revenue: number }[]; currency: Currency }) {
  const { money } = useShopDisplay();
  const slices = salesComposition(rows, currency);
  if (!slices.length) return null;
  const point = (angle: number, radius = 126) => [160 + Math.sin(angle) * radius, 160 - Math.cos(angle) * radius];
  const percentage = (value: number) => value < .1 ? "<0.1%" : `${value.toFixed(1)}%`;
  const describe = (row: typeof slices[number]) => `${row.name}: ${money(row.revenue, currency)} (${percentage(row.percent)})`;
  return <figure className="diagram-card sales-pie">
    <figcaption>{tr("メニュー別売上の構成比")}</figcaption>
    <p className="small muted">{tr("選択期間の売上合計に占める割合です。")}</p>
    <div className="pele-diagram" role="img" aria-label={tr("メニュー別売上の構成比")}>
      <svg viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">
        {slices.map(row => {
          const [x1, y1] = point(row.start), [x2, y2] = point(row.end);
          const path = `M160 160 L${x1} ${y1} A126 126 0 ${row.end - row.start > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`;
          return slices.length === 1
            ? <circle key={row.id} data-id={row.id} cx="160" cy="160" r="126" fill={chartSeriesColor(row.colorIndex)} tabIndex={0}><title>{describe(row)}</title></circle>
            : <path key={row.id} data-id={row.id} d={path} fill={chartSeriesColor(row.colorIndex)} tabIndex={0}><title>{describe(row)}</title></path>;
        })}
        {slices.filter(row => row.percent >= 7).map(row => {
          const [x, y] = slices.length === 1 ? [160, 160] : point((row.start + row.end) / 2, 83);
          return <text key={row.id} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="sales-pie-percent">{percentage(row.percent)}</text>;
        })}
      </svg>
    </div>
    <ul className="diagram-legend sales-pie-legend" aria-label={tr("凡例")}>{slices.map(row => <li key={row.id} data-id={row.id}>
      <span className="diagram-swatch diagram-swatch-bar" style={{ background: chartSeriesColor(row.colorIndex) }} aria-hidden="true" />
      <span>{row.name}<small>{money(row.revenue, currency)} · {percentage(row.percent)}</small></span>
    </li>)}</ul>
  </figure>;
}
