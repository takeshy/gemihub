import { useEffect, useState } from "react";
import { tr } from "../shared/i18n";
import type { CustomerActivityResult } from "../shared/customer-activity";
import { useApi } from "./api";
import { useShopDisplay } from "./money";

export function CustomerActivityHistory({ base, rangeQuery }: { base: string; rangeQuery: string }) {
  const api = useApi();
  const { shopTime, timeZoneLabel } = useShopDisplay();
  const [result, setResult] = useState<CustomerActivityResult>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(undefined); setError("");
    api<CustomerActivityResult>(`${base}/activity${rangeQuery}`).then(value => { if (active) setResult(value); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api, base, rangeQuery, attempt]);
  const labels: Record<string, string> = {
    login: tr("ログインした"), reserve_view: tr("予約画面を開いた"), mypage_view: tr("マイページを開いた"),
    booking_started: tr("予約の支払いを開始した"), booking_completed: tr("予約が確定した"), booking_cancelled: tr("予約をキャンセルした"),
    booking_cancellation_requested: tr("キャンセルして代わりの予約を受け付けた"), booking_cancellation_withdrawn: tr("キャンセルを取り消した"),
  };
  return <section className="panel" aria-label={tr("行動履歴")}>
    <div className="section-top"><h2>{tr("行動履歴")}</h2><button onClick={() => setAttempt(value => value + 1)}>{tr("更新")}</button></div>
    <p className="small muted">{tr("ログイン後の主な操作を直近90日・最新100件まで表示します（{0}）。記録開始前や、通信できなかった操作は含まれません。", timeZoneLabel)}</p>
    {error && <p className="alert" role="alert">{error}</p>}
    {!result && !error && <p role="status">{tr("履歴を読み込んでいます…")}</p>}
    {result && !result.rows.length && <p className="empty">{tr("この期間の行動履歴はありません。")}</p>}
    {result && <ol className="customer-history">{result.rows.map(row => <li key={row.id}>
      <time dateTime={row.at}>{shopTime(row.at, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
      <h3>{labels[row.operation] || tr("お客様の操作")}</h3>
      {row.bookingId && <p className="small muted">{tr("予約ID：{0}", row.bookingId)}</p>}
    </li>)}</ol>}
    {result?.truncated && <p className="small muted">{tr("最新100件を表示しています。")}</p>}
  </section>;
}
