import { tr } from "../shared/i18n";
import { useShopDisplay } from "./money";
import React, { useRef, useState } from "react";
import { DateInput } from "./DateInput";
import { useApi } from "./api";
import { Pagination, usePagination } from "./Pagination";
import type { Inquiry } from "./App";
import { InquiryAttachments } from "./InquiryFiles";
import { InquiryCreate } from "./InquiryCreate";
import { InquiryHistory, InquiryRecordForm, InquiryContact } from "./InquiryHistory";
import "./Inquiries.css";
import {
  filterInquiries,
  inquiryReplyLabel, inquiryReplyState,
  inquiryStatus,
  inquiryStatusLabel, inquiryStatuses, inquiryChannelLabel,
  type InquiryStatus,
} from "../server/inquiries";
export function Inquiries({
  shopId,
  inquiries,
  reload,
}: {
  shopId: string;
  inquiries: Inquiry[];
  reload: () => Promise<unknown>;
}) {
  const api = useApi();
  const [view, setView] = useState<"list" | "board">("list");
  const [selectedId, setSelectedId] = useState("");
  const [moving, setMoving] = useState(false), [error, setError] = useState("");
  const moveBusy = useRef(false);
  async function move(inquiry: Inquiry, status: InquiryStatus) {
    if (moveBusy.current || inquiryStatus(inquiry) === status) return;
    moveBusy.current = true; setMoving(true); setError("");
    try {
      await api(`/api/shops/${shopId}/inquiries/${inquiry.id}/status`, { status, previousStatus: inquiryStatus(inquiry) });
      await reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : tr("対応状況を変更できませんでした。"));
      // A rejected move usually means this board is stale; if this refresh also fails, the next move retries it.
      await reload().catch(() => {});
    }
    finally { moveBusy.current = false; setMoving(false); }
  }
  const { shopTime, displayTimeZone } = useShopDisplay();
  const when = (at?: string) => at && Number.isFinite(Date.parse(at)) ? shopTime(at, {year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}) : tr("日時未記録");
  const [showCompleted, setShowCompleted] = useState(true),
    [query, setQuery] = useState("");
  const [reply, setReply] = useState<"all" | "unreplied" | "replied">("all");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const validRange = !from || !to || from <= to;
  const visible = validRange
    ? filterInquiries(inquiries, { showCompleted: view === "board" || showCompleted, query, reply, from, to }, displayTimeZone())
    : [];
  const pagination = usePagination(visible, JSON.stringify([shopId, view, showCompleted, query, reply, from, to]));
  const selected = inquiries.find(inquiry => inquiry.id === selectedId);
  const refresh = async () => { await reload(); };
  if (selected) return <section className="panel inquiry-detail" aria-label={tr("お問い合わせの詳細")}>
    <button type="button" onClick={() => setSelectedId("")}>{tr("← お問い合わせ一覧へ")}</button>
    {selected.email && <a className="button" data-customer-inquiry-link href={`/?${new URLSearchParams({ shop: shopId, customer: selected.email, inquiry: selected.id })}`}>{tr("お客様の詳細で対応する →")}</a>}
    <CustomerInquiry key={selected.id} shopId={shopId} inquiry={selected} onChanged={refresh} onReload={refresh} />
  </section>;
  return (
    <section className="panel inquiries-list" aria-label={tr("お問い合わせ一覧")}>
      <h2>{tr("お問い合わせ")}</h2>
      <InquiryCreate shopId={shopId} onCreated={async inquiry => { await reload(); setSelectedId(inquiry.id); }} />
      <div className="inquiry-view-switch" role="group" aria-label={tr("お問い合わせの表示方法")}>
        <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>{tr("一覧表示")}</button>
        <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}>{tr("カンバン表示")}</button>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      <p>
        {tr("お客様のお名前やお問い合わせを開くと、お客様の詳細画面で返信・対応状況の変更ができます。")}</p>
      <div className="inquiry-filters">
        <label className="inquiry-search-filter">
          {tr("お問い合わせを検索")}<input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr("氏名・メール・お問い合わせ・返信内容")}
          />
        </label>
        <label className="inquiry-reply-filter">
          {tr("返信状況")}<select
            aria-label={tr("返信状況")}
            value={reply}
            onChange={(event) => setReply(event.target.value as typeof reply)}
          >
            <option value="all">{tr("すべて")}</option>
            <option value="unreplied">{tr("未返信")}</option>
            <option value="replied">{tr("返信済み")}</option>
          </select>
        </label>
        <label>
          {tr("受付日（開始）")}<DateInput
            aria-label={tr("受付日（開始）")}
            value={from}
            onValueChange={setFrom}
          />
        </label>
        <label>
          {tr("受付日（終了）")}<DateInput
            aria-label={tr("受付日（終了）")}
            value={to}
            onValueChange={setTo}
          />
        </label>
      </div>
      {(view === "board" || showCompleted) && !from && !to && <p className="small muted">{tr("古い完了済みのレコードを表示するには期間指定してください。")}</p>}
      {view === "board" && <p className="small muted">{tr("カードはドラッグ＆ドロップで対応状況を変更できます。スマートフォンやキーボードでは、カードの対応状況を選んでください。")}</p>}
      {view === "list" && <label className="inquiry-completed-toggle">
        <input
          type="checkbox"
          checked={showCompleted}
          onChange={(event) => setShowCompleted(event.target.checked)}
        />
        {tr("対応済みも表示する")}</label>}
      {!validRange && (
        <p className="alert" role="alert">
          {tr("終了日は開始日以降にしてください。")}</p>
      )}
      <p className="small muted">
        {tr("条件に一致：{0}件／全{1}件", visible.length, inquiries.length)}</p>
      {!visible.length && (
        <p className="empty">
          {inquiries.length
            ? tr("条件に合うお問い合わせはありません。")
            : tr("まだお問い合わせはありません。")}
        </p>
      )}
      {view === "list" ? <>
        <div {...pagination.listProps} className="inquiry-list-items">{pagination.items.map(inquiry => <InquiryCard key={inquiry.id} inquiry={inquiry} shopId={shopId} when={when} open={() => setSelectedId(inquiry.id)} />)}</div>
        <Pagination pagination={pagination} label={tr("お問い合わせ一覧")} />
      </> : <div className="inquiry-board" aria-label={tr("お問い合わせカンバン")}>
        {inquiryStatuses.map(status => <InquiryColumn key={status} status={status} inquiries={visible} shopId={shopId} resetKey={JSON.stringify([query, reply, from, to])} when={when} open={setSelectedId} move={move} busy={moving} />)}
      </div>}
    </section>
  );
}
function InquiryCard({ inquiry, shopId, when, open }: { inquiry: Inquiry; shopId: string; when: (at?: string) => string | undefined; open: () => void }) {
  const content = <>
    <div className="inquiry-list-top"><strong>{inquiry.name} {tr(" 様")}</strong><time dateTime={inquiry.at}>{when(inquiry.at)}</time></div>
    {inquiry.subject && <h3>{inquiry.subject}</h3>}
    <span className="small muted">{inquiry.email || inquiry.phone || tr("連絡先未登録")}</span>
    <p className="inquiry-message-preview">{inquiry.message}</p>
    <div className="inquiry-badges"><span className={`pill inquiry-status-${inquiryStatus(inquiry)}`}>{inquiryStatusLabel(inquiryStatus(inquiry))}</span><span className={`pill inquiry-reply-${inquiryReplyState(inquiry)}`}>{inquiryReplyLabel(inquiry)}</span></div>
    <span className="inquiry-open">{inquiry.email ? tr("お客様の詳細で対応する →") : tr("やりとりを開く →")}</span>
  </>;
  return inquiry.email ? <a className="inquiry-list-item" data-customer-inquiry-link aria-label={tr("{0}のお問い合わせを開く", inquiry.name)} href={`/?${new URLSearchParams({ shop: shopId, customer: inquiry.email, inquiry: inquiry.id })}`}>{content}</a>
    : <button type="button" className="inquiry-list-item" aria-label={tr("{0}のお問い合わせを開く", inquiry.name)} onClick={open}>{content}</button>;
}
function InquiryColumn({ status, inquiries, shopId, resetKey, when, open, move, busy }: { status: InquiryStatus; inquiries: Inquiry[]; shopId: string; resetKey: string; when: (at?: string) => string | undefined; open: (id: string) => void; move: (inquiry: Inquiry, status: InquiryStatus) => Promise<void>; busy: boolean }) {
  const rows = inquiries.filter(inquiry => inquiryStatus(inquiry) === status);
  const pagination = usePagination(rows, `${shopId}:${resetKey}`);
  const label = inquiryStatusLabel(status);
  return <section className="inquiry-column" aria-label={tr("{0}のお問い合わせ", label)} onDragOver={event => { if (!busy) event.preventDefault(); }} onDrop={event => {
    event.preventDefault(); if (busy) return;
    const inquiry = inquiries.find(inquiry => inquiry.id === event.dataTransfer.getData("text/plain"));
    if (inquiry) void move(inquiry, status);
  }}>
    <h3>{label} <span className="count">{rows.length}</span></h3>
    {!rows.length && <p className="small muted">{tr("この状態のお問い合わせはありません。")}</p>}
    <div {...pagination.listProps}>{pagination.items.map(inquiry => <div className="inquiry-board-card" key={inquiry.id} draggable={!busy} onDragStart={event => { event.dataTransfer.setData("text/plain", inquiry.id); event.dataTransfer.effectAllowed = "move"; }}>
      <div className="inquiry-drag-handle" draggable={!busy} role="img" aria-label={tr("ドラッグして対応状況を変更")} title={tr("ドラッグして対応状況を変更")}>⠿</div>
      <InquiryCard inquiry={inquiry} shopId={shopId} when={when} open={() => open(inquiry.id)} />
      <label className="inquiry-card-status">{tr("対応状況")}<select aria-label={tr("{0}の対応状況", inquiry.name)} value={status} disabled={busy} onChange={event => void move(inquiry, event.target.value as InquiryStatus)}>{inquiryStatuses.map(value => <option key={value} value={value}>{inquiryStatusLabel(value)}</option>)}</select></label>
    </div>)}</div>
    <Pagination pagination={pagination} label={label} disabled={busy} />
  </section>;
}
export function CustomerInquiry({
  shopId,
  inquiry,
  onChanged,
  onReload,
}: {
  shopId: string;
  inquiry: Inquiry;
  onChanged: () => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const api = useApi();
  const { shopTime } = useShopDisplay();
  const when = (at?: string) =>
    at && Number.isFinite(Date.parse(at))
      ? shopTime(at, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : tr("日時未記録");

  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="customer-inquiry">
      <div className="inquiry-list-top">
        <h3>{tr("お問い合わせ")}</h3>
        <time dateTime={inquiry.at}>{when(inquiry.at)}</time>
      </div>
      {inquiry.subject && <h4>{inquiry.subject}</h4>}
      <p className="small muted">{inquiry.source && inquiryChannelLabel(inquiry.source)}{inquiry.phone && tr(" · 電話：{0}", inquiry.phone)}</p>
      <p className="customer-message">{inquiry.message}</p>
      <InquiryAttachments files={inquiry.attachments} shopId={shopId} inquiryId={inquiry.id} />
      <div className="inquiry-badges">
        <span className={`pill inquiry-reply-${inquiryReplyState(inquiry)}`}>
          {inquiryReplyLabel(inquiry)}
        </span>
        <label>
          {tr("対応状況")}<select
            aria-label={tr("対応状況")}
            value={inquiryStatus(inquiry)}
            disabled={busy}
            onChange={(event) => {
              const status = event.target.value as InquiryStatus;
              void run(async () => {
                await api(
                  `/api/shops/${shopId}/inquiries/${inquiry.id}/status`,
                  { status, previousStatus: inquiryStatus(inquiry) },
                );
                await onChanged();
                setNotice(tr("対応状況を保存しました。"));
              });
            }}
          >
            {inquiryStatuses.map(value => <option key={value} value={value}>{inquiryStatusLabel(value)}</option>)}
          </select>
        </label>
      </div>
      <InquiryContact inquiry={inquiry} shopId={shopId} onChanged={onChanged} />
      <InquiryHistory inquiry={inquiry} shopId={shopId} />

      {error && (
        <div className="alert" role="alert">
          <p>{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onReload();
              })
            }
          >
            {tr("最新の状態を確認")}</button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <InquiryRecordForm shopId={shopId} inquiry={inquiry} onChanged={onChanged} onReload={onReload} disabled={busy} onBusyChange={setBusy} />
    </article>
  );
}
