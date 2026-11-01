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
    ? new Date(at).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "日時未記録";
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
    <section className="panel inquiries-list" aria-label="お問い合わせ一覧">
      <h2>お問い合わせ</h2>
      <p>
        お客様のお名前やお問い合わせを開くと、お客様の詳細画面で返信・対応状況の変更ができます。
      </p>
      <div className="inquiry-filters">
        <label>
          お問い合わせを検索
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="氏名・メール・お問い合わせ・返信内容"
          />
        </label>
        <label>
          返信状況
          <select
            aria-label="返信状況"
            value={reply}
            onChange={(event) => setReply(event.target.value as typeof reply)}
          >
            <option value="all">すべて</option>
            <option value="unreplied">未返信</option>
            <option value="replied">返信済み</option>
          </select>
        </label>
        <label>
          受付日（開始）
          <DateInput
            aria-label="受付日（開始）"
            value={from}
            onValueChange={setFrom}
          />
        </label>
        <label>
          受付日（終了）
          <DateInput
            aria-label="受付日（終了）"
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
        対応済みも表示する
      </label>
      {!validRange && (
        <p className="alert" role="alert">
          終了日は開始日以降にしてください。
        </p>
      )}
      <p className="small muted">
        {visible.length}件表示／全{inquiries.length}件
      </p>
      {!visible.length && (
        <p className="empty">
          {inquiries.length
            ? "条件に合うお問い合わせはありません。"
            : "まだお問い合わせはありません。"}
        </p>
      )}
      <div className="inquiry-list-items">
        {visible.map((inquiry) => (
          <a
            key={inquiry.id}
            className="inquiry-list-item"
            data-customer-inquiry-link
            aria-label={`${inquiry.name}のお問い合わせを開く`}
            href={`/?${new URLSearchParams({ shop: shopId, customer: inquiry.email, inquiry: inquiry.id })}`}
          >
            <div className="inquiry-list-top">
              <strong>{inquiry.name} 様</strong>
              <time dateTime={inquiry.at}>{when(inquiry.at)}</time>
            </div>
            <span className="small muted">{inquiry.email}</span>
            <p className="inquiry-message-preview">{inquiry.message}</p>
            <div className="inquiry-badges">
              <span className={`pill inquiry-status-${inquiryStatus(inquiry)}`}>
                {inquiryStatus(inquiry) === "completed" ? "対応済み" : "対応中"}
              </span>
              <span
                className={`pill ${inquiryReplied(inquiry) ? "inquiry-replied" : "inquiry-unreplied"}`}
              >
                {inquiryReplied(inquiry) ? "返信済み" : "未返信"}
              </span>
              <span className="inquiry-open">お客様の詳細で対応する →</span>
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
        <h3>お問い合わせ</h3>
        <time dateTime={inquiry.at}>{when(inquiry.at)}</time>
      </div>
      <p className="customer-message">{inquiry.message}</p>
      <div className="inquiry-badges">
        <span
          className={`pill ${inquiryReplied(inquiry) ? "inquiry-replied" : "inquiry-unreplied"}`}
        >
          {inquiryReplied(inquiry) ? "返信済み" : "未返信"}
        </span>
        <label>
          対応状況
          <select
            aria-label="対応状況"
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
                setNotice("対応状況を保存しました。");
              });
            }}
          >
            <option value="in_progress">対応中</option>
            <option value="completed">対応済み</option>
          </select>
        </label>
      </div>
      {inquiry.reply && (
        <div className="customer-reply">
          <b>お店からの返信（最新）</b>
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
            最新の状態を確認
          </button>
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
            setNotice("返信を受け付けました。");
          });
        }}
      >
        <label>
          返信内容
          <textarea
            aria-label="返信内容"
            required
            rows={4}
            maxLength={5000}
            disabled={busy}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="お客様への返信を入力してください"
          />
        </label>
        <p className="small muted">返信先：{inquiry.email}</p>
        <button className="primary" disabled={busy || !text.trim()}>
          {busy ? "保存しています…" : "メールで返信"}
        </button>
      </form>
    </article>
  );
}
