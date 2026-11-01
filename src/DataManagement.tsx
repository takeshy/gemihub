import React, { useEffect, useState } from "react";
import { useApi } from "./api";
import { shopData } from "../server/shop-data";
import type { DataCell, DataSheet, DataTable } from "../server/data-management";

export function DataManagement({ shopId, open, showMenus = false }: { shopId: string; open: (screen: string) => void; showMenus?: boolean }) {
  const api = useApi();
  const [sheets, setSheets] = useState<DataSheet[]>();
  const [chosen, setChosen] = useState("");
  const [table, setTable] = useState<DataTable>();
  const [draft, setDraft] = useState<{ row: number; previous: DataCell[]; values: DataCell[] }>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    let active = true;
    api<DataSheet[]>(`/api/shops/${shopId}/data/sheets`).then(result => { if (active) { setSheets(result); setChosen(current => result.some(sheet => sheet.id === current) ? current : result[0]?.id || ""); setError(""); } }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [shopId, attempt, api]);
  useEffect(() => {
    let active = true; setTable(undefined); setPage(0);
    if (!chosen) return;
    api<DataTable>(`/api/shops/${shopId}/data/sheets/${chosen}`).then(result => { if (active) { setTable(result); setError(""); } }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [shopId, chosen, attempt, api]);
  const rows = table?.rows.filter(row => row.values.some(value => String(value).toLowerCase().includes(query.trim().toLowerCase()))) || [];
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || !table || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/shops/${shopId}/data/sheets/${chosen}/rows/${draft.row}`, { headers: table.headers, previous: draft.previous, values: draft.values });
      setDraft(undefined); setAttempt(value => value + 1); setNotice("データを保存しました。");
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="panel data-management">
    <h2>データ管理</h2><p>メニュー・料金や予約などは下の管理メニューから、その他のデータは一覧から変更できます。</p>
    <details className="data-menu-links" open={showMenus||undefined}><summary>専用メニューで管理するデータ</summary><div className="actions">{Array.from(new Map(shopData.filter(data=>!("internal" in data&&data.internal)).map(data => [data.screen, data.screenLabel])).entries()).map(([screen, label]) => <button key={screen} type="button" onClick={() => open(screen)}>{label} →</button>)}</div></details>
    {error && <p className="alert" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <div className="actions"><button type="button" disabled={busy || !!draft} onClick={() => setAttempt(value => value + 1)}>最新の内容を読み直す</button></div>
    {!sheets && !error && <p role="status">追加データを読み込んでいます…</p>}
    {sheets?.length === 0 && <p className="empty">現在、専用メニューのない追加データはありません。台帳に追加したシートをここで管理できます。</p>}
    {!!sheets?.length && <>
      <label className="field">追加データ<select aria-label="追加データ" value={chosen} disabled={busy || !!draft} onChange={event => { setChosen(event.target.value); setQuery(""); setNotice(""); }}>{sheets.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.title}</option>)}</select></label>
      {!table && !error && <p role="status">行を読み込んでいます…</p>}
      {table && <>
        {!draft && <div className="customer-controls"><label>データを検索<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label><button type="button" disabled={table.nextRow > 1001} onClick={() => setDraft({ row: table.nextRow, previous: table.headers.map(() => ""), values: table.headers.map(() => "") })}>行を追加</button></div>}
        {draft ? <form onSubmit={save}><h3>{draft.row === table.nextRow ? "行を追加" : `${draft.row - 1}件目を編集`}</h3><div className="form-grid">{table.headers.map((header, index) => {
          const value = draft.values[index]; const original = draft.previous[index];
          const formula = typeof original === "string" && original.startsWith("=");
          const type = typeof (original !== "" ? original : table.rows.map(row => row.values[index]).find(value => value !== "") ?? "");
          return <label className="field" key={index}>{header}{formula ? <input aria-label={header} readOnly value={String(value)} /> : type === "boolean" ? <select aria-label={header} disabled={busy} value={String(value)} onChange={event => setDraft({ ...draft, values: draft.values.map((current, i) => i === index ? event.target.value === "" ? "" : event.target.value === "true" : current) })}><option value="">未設定</option><option value="true">はい</option><option value="false">いいえ</option></select> : <input aria-label={header} disabled={busy} type={type === "number" ? "number" : "text"} step={type === "number" ? "any" : undefined} value={String(value)} maxLength={50000} onChange={event => setDraft({ ...draft, values: draft.values.map((current, i) => i === index ? type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value : current) })} />}{formula && <small>自動計算のセル</small>}</label>;
        })}</div><div className="actions"><button type="submit" className="primary" disabled={busy}>保存</button><button type="button" disabled={busy} onClick={() => { setDraft(undefined); setError(""); }}>編集をやめる</button></div></form> : <>
          <p className="small muted">{rows.length}件 · 列名・列順と計算式は維持して保存します。</p>
          <div className="customer-table-wrap"><table className="customer-table"><thead><tr>{table.headers.map((header, i) => <th key={i}>{header}</th>)}<th>操作</th></tr></thead><tbody>{rows.slice(page * 50, (page + 1) * 50).map(row => <tr key={row.row}>{row.values.map((value, i) => <td key={i}>{String(value)}</td>)}<td><button type="button" onClick={() => setDraft({ ...row, previous: [...row.values], values: [...row.values] })}>編集</button></td></tr>)}</tbody></table></div>
          {rows.length === 0 && <p className="empty">表示するデータはありません。</p>}
          {rows.length > 50 && <div className="actions"><button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>前へ</button><span>{page + 1} / {Math.ceil(rows.length / 50)}</span><button type="button" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(value => value + 1)}>次へ</button></div>}
        </>}
      </>}
    </>}
  </section>;
}
