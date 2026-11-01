import { tr, intlLocale } from "../shared/i18n";
import React, { useRef, useState } from "react";
import { DateInput } from "./DateInput";
import { useApi } from "./api";
import { createRequestId } from "./request-id";
import type { Inquiry } from "./App";
import {
  filterInquiries,
  inquiryReplied,
  inquiryStatus,
  type InquiryStatus,
} from "../server/inquiries";
const when = (at?: string) =>
  at && Number.isFinite(Date.parse(at))
    ? new Date(at).toLocaleString(intlLocale(), {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : tr("日時未記録");
export function Inquiries({
  shopId,
  inquiries,
}: {
  shopId: string;
  inquiries: Inquiry[];
}) {
  const [showCompleted, setShowCompleted] = useState(false),
    [query, setQuery] = useState("");
  const [reply, setReply] = useState<"all" | "unreplied" | "replied">("all");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const validRange = !from || !to || from <= to;
  const visible = validRange
    ? filterInquiries(inquiries, { showCompleted, query, reply, from, to })
    : [];
  return (
    <section className="panel inquiries-list" aria-label={tr("お問い合わせ一覧")}>
      <h2>{tr("お問い合わせ")}</h2>
      <p>
        {tr("お客様のお名前やお問い合わせを開くと、お客様の詳細画面で返信・対応状況の変更ができます。")}</p>
      <div className="inquiry-filters">
        <label>
          {tr("お問い合わせを検索")}<input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr("氏名・メール・お問い合わせ・返信内容")}
          />
        </label>
        <label>
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
      <label className="inquiry-completed-toggle">
        <input
          type="checkbox"
          checked={showCompleted}
          onChange={(event) => setShowCompleted(event.target.checked)}
        />
        {tr("対応済みも表示する")}</label>
      {!validRange && (
        <p className="alert" role="alert">
          {tr("終了日は開始日以降にしてください。")}</p>
      )}
      <p className="small muted">
        {visible.length}{tr("件表示／全")}{inquiries.length}{tr("件")}</p>
      {!visible.length && (
        <p className="empty">
          {inquiries.length
            ? tr("条件に合うお問い合わせはありません。")
            : tr("まだお問い合わせはありません。")}
        </p>
      )}
      <div className="inquiry-list-items">
        {visible.map((inquiry) => (
          <a
            key={inquiry.id}
            className="inquiry-list-item"
            data-customer-inquiry-link
            aria-label={tr("{0}のお問い合わせを開く", inquiry.name)}
            href={`/?${new URLSearchParams({ shop: shopId, customer: inquiry.email, inquiry: inquiry.id })}`}
          >
            <div className="inquiry-list-top">
              <strong>{inquiry.name} {tr(" 様")}</strong>
              <time dateTime={inquiry.at}>{when(inquiry.at)}</time>
            </div>
            <span className="small muted">{inquiry.email}</span>
            <p className="inquiry-message-preview">{inquiry.message}</p>
            <div className="inquiry-badges">
              <span className={`pill inquiry-status-${inquiryStatus(inquiry)}`}>
                {inquiryStatus(inquiry) === "completed" ? tr("対応済み") : tr("対応中")}
              </span>
              <span
                className={`pill ${inquiryReplied(inquiry) ? "inquiry-replied" : "inquiry-unreplied"}`}
              >
                {inquiryReplied(inquiry) ? tr("返信済み") : tr("未返信")}
              </span>
              <span className="inquiry-open">{tr("お客様の詳細で対応する →")}</span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<
    { text: string; id: string; previousReply: string } | undefined
  >(undefined);
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
      <p className="customer-message">{inquiry.message}</p>
      <div className="inquiry-badges">
        <span
          className={`pill ${inquiryReplied(inquiry) ? "inquiry-replied" : "inquiry-unreplied"}`}
        >
          {inquiryReplied(inquiry) ? tr("返信済み") : tr("未返信")}
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
            <option value="in_progress">{tr("対応中")}</option>
            <option value="completed">{tr("対応済み")}</option>
          </select>
        </label>
      </div>
      {inquiry.reply && (
        <div className="customer-reply">
          <b>{tr("お店からの返信（最新）")}</b>
          <p className="customer-message">{inquiry.reply}</p>
        </div>
      )}
      {error && (
        <div className="alert" role="alert">
          <p>{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onReload();
                pending.current = undefined;
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = text.trim();
          if (!value || busy) return;
          const action =
            pending.current?.text === value
              ? pending.current
              : {
                  text: value,
                  id: createRequestId(),
                  previousReply: inquiry.reply,
                };
          pending.current = action;
          void run(async () => {
            await api(`/api/shops/${shopId}/inquiries/${inquiry.id}/reply`, {
              text: value,
              requestId: action.id,
              previousReply: action.previousReply,
            });
            pending.current = undefined;
            setText("");
            await onChanged();
            setNotice(tr("返信を受け付けました。"));
          });
        }}
      >
        <label>
          {tr("返信内容")}<textarea
            aria-label={tr("返信内容")}
            required
            rows={4}
            maxLength={5000}
            disabled={busy}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={tr("お客様への返信を入力してください")}
          />
        </label>
        <p className="small muted">{tr("返信先：")}{inquiry.email}</p>
        <button className="primary" disabled={busy || !text.trim()}>
          {busy ? tr("保存しています…") : tr("メールで返信")}
        </button>
      </form>
    </article>
  );
}
