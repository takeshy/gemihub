import { useEffect, useState } from "react";
import { tr } from "../shared/i18n";
import { articleAccessDays, type ArticleAccessDays, type ArticleAccessResult, type SiteTrafficResult } from "../shared/article-access";
import { postLabel } from "../server/post-domain";
import { useApi } from "./api";
import "./ShopAccess.css";
import { Pagination, usePagination } from "./Pagination";

export function ShopAccess({ shopId, initialView = "daily" }: { shopId: string; initialView?: "daily" | "articles" }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<ArticleAccessDays>(30);
  const [view, setView] = useState(initialView);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ArticleAccessResult>();
  const [traffic, setTraffic] = useState<SiteTrafficResult>();
  const [error, setError] = useState("");
  const dailyPages = usePagination(traffic?.rows || [], JSON.stringify([shopId, days, view, attempt]));
  const articlePages = usePagination(result?.rows || [], JSON.stringify([shopId, days, view, attempt]));
  useEffect(() => {
    if (!open) return;
    let active = true;
    setResult(undefined); setTraffic(undefined); setError("");
    const request = view === "articles" ? api<ArticleAccessResult>(`/api/shops/${shopId}/posts/access?days=${days}`).then(value => { if (active) setResult(value); }) : api<SiteTrafficResult>(`/api/shops/${shopId}/access?days=${days}`).then(value => { if (active) setTraffic(value); });
    void request.catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api, shopId, days, attempt, open, view]);
  return <section className="panel shop-access" style={{ gridColumn: "1 / -1", minWidth: 0 }} aria-label={tr("お店のアクセス数")}>
    <details onToggle={event => setOpen(event.currentTarget.open)}>
      <summary><strong>{tr("お店のアクセス数")}</strong></summary>
      <div className="shop-access-controls">
        <label>{tr("表示する集計")}<select aria-label={tr("表示する集計")} value={view} onChange={event => setView(event.target.value as "daily" | "articles")}><option value="daily">{tr("日別の訪問数")}</option><option value="articles">{tr("ブログ・お知らせの記事別")}</option></select></label>
        <label>{tr("集計期間")}<select aria-label={tr("アクセス数の集計期間")} value={days} onChange={event => setDays(Number(event.target.value) as ArticleAccessDays)}>{articleAccessDays.map(value => <option key={value} value={value}>{tr("過去{0}日", value)}</option>)}</select></label>
        <button type="button" onClick={() => setAttempt(value => value + 1)}>{tr("更新")}</button>
      </div>
      <p className="small muted">{tr("ログイン前も含みます。PVは再読み込みを含む表示回数、ユニークはブラウザ数の目安です。別端末やシークレットモードは別扱いです。店主・スタッフの確認は除外します。記録開始前や送信できなかった閲覧は含まず、保存機能が使えないブラウザはPVのみ集計します。")}</p>
      {error && <p className="alert" role="alert">{error}</p>}
      {!result && !traffic && !error && <p role="status">{tr("アクセス数を読み込んでいます…")}</p>}
      {traffic && <>
        <p>{tr("日付の基準：{0}。同じ日の同じブラウザは、複数ページ見ても1件です。", traffic.timeZone)}</p>
        <div {...dailyPages.listProps} className="shop-access-scroll"><table className="shop-access-table"><thead><tr><th>{tr("日付")}</th><th>PV</th><th>{tr("ユニーク（ブラウザ）")}</th></tr></thead><tbody>{dailyPages.items.map(row => <tr key={row.date}><td><time dateTime={row.date}>{row.date}</time></td><td>{row.views}</td><td>{row.uniqueBrowsers}</td></tr>)}</tbody></table></div>
        <Pagination pagination={dailyPages} label={tr("日別の訪問数")} />
      </>}
      {result && <>
        <p><b>{tr("公開記事の合計：{0} PV", result.total)}</b>　{tr("ブログ：{0} PV・お知らせ：{1} PV", result.byCategory.blogs, result.byCategory.announcements)}</p>
        {!result.rows.length ? <p className="empty">{tr("公開中の記事はありません。")}</p> : <div {...articlePages.listProps} className="shop-access-scroll"><table className="shop-access-table article-access-table">
          <thead><tr><th>{tr("種類")}</th><th>{tr("記事")}</th><th>PV</th><th>{tr("ユニーク（ブラウザ）")}</th></tr></thead>
          <tbody>{articlePages.items.map(row => <tr key={row.postId}><td>{postLabel(row.category)}</td><td style={{ overflowWrap: "anywhere" }}>{row.title}</td><td>{row.views}</td><td>{row.uniqueBrowsers}</td></tr>)}</tbody>
        </table></div>}
        <Pagination pagination={articlePages} label={tr("ブログ・お知らせの記事別")} />
      </>}
    </details>
  </section>;
}
