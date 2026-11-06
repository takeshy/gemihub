import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { detectType, load, mount, parse, type Mounted } from "pele/lazy";
import { tr } from "../shared/i18n";
import { diagramPlainText } from "../shared/diagrams";
import "./PeleDiagram.css";

/** Only Pele-produced SVG enters the DOM. Authors cannot enable links, images or resolvers. */
export function PeleDiagram({ source, label, colors = [] }: { source: string; label: string; colors?: readonly string[] }) {
  const element = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [error, setError] = useState(false);
  const [legend, setLegend] = useState<{ name: string; index: number; kind: string }[]>([]);
  useEffect(() => {
    let active = true, diagram: Mounted | undefined;
    setError(false); setLegend([]);
    if (!element.current) return;
    const target = element.current;
    void load(detectType(source)).then(() => {
      if (!active) return;
      if (detectType(source) === "xychart") {
        const model = parse(source, { limit: 50000, maxEdges: 160 });
        if (model.type === "xychart") setLegend(model.plots.flatMap((plot, index) => plot.title ? [{ name: diagramPlainText(plot.title), index, kind: plot.type }] : []));
      }
      diagram = mount(target, source, {
      idPrefix: `diagram-${id}-`, links: false, images: false,
      limit: 50000, outputLimit: 1000000, maxEdges: 160,
      config: { xyChart: { showLegend: false } },
      zoom: { labels: { zoomIn: tr("拡大"), zoomOut: tr("縮小"), reset: tr("表示をリセット") } },
      onError: () => { if (active) setError(true); },
      });
    })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; diagram?.destroy(); target.replaceChildren(); };
  }, [source, id]);
  return <div className="diagram-card" style={Object.fromEntries(colors.slice(0, 8).map((color, index) => [`--pele-series-${index + 1}`, color])) as CSSProperties}>
    {!error && !!legend.length && <ul className="diagram-legend pele-legend" aria-label={tr("凡例")}>{legend.map(item => <li className="pele-legend-item" data-id={item.name} key={item.index}>
      <span aria-hidden="true" className={`diagram-swatch diagram-swatch-${item.kind}`} style={{ "--series-color": `var(--pele-series-${item.index % 8 + 1})` } as CSSProperties} /><span>{item.name}</span>
    </li>)}</ul>}
    <div ref={element} className="pele-diagram" role="img" aria-label={label} hidden={error} />
    {error && <p role="status">{tr("図を表示できません。元のデータを確認してください。")}</p>}
    {error && <details className="diagram-source"><summary>{tr("図のデータ")}</summary><pre><code>{source}</code></pre></details>}
  </div>;
}
