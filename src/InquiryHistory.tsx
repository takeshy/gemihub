import { useRef, useState } from "react";
import { tr } from "../shared/i18n";
import { inquiryChannelLabel, newestInteractionFirst, type InquiryChannel, type InquiryInteraction } from "../server/inquiries";
import type { Inquiry } from "./App";
import { useApi } from "./api";
import { useShopDisplay } from "./money";
import { createRequestId } from "./request-id";
import { Pagination, usePagination } from "./Pagination";
import { InquiryAttachments, InquiryFilePicker, useInquiryFiles } from "./InquiryFiles";

export function InquiryHistory({ inquiry, shopId }: { inquiry: Inquiry; shopId: string }) {
  const { shopTime } = useShopDisplay();
  const entries = [...(inquiry.interactions || [])];
  if (inquiry.reply && !entries.some(entry => entry.kind === "email")) entries.unshift({ id: "legacy-reply", shopId: "", inquiryId: inquiry.id, kind: "email", text: inquiry.reply, at: "", legacy: true });
  entries.sort(newestInteractionFirst);
  const pagination = usePagination(entries, `${inquiry.id}:${entries.length}`);
  const delivery = (entry: InquiryInteraction) => entry.delivery === "sent" ? tr("送信済み") : entry.delivery === "retrying" ? tr("送信を再試行中") : entry.delivery === "simulated" ? tr("デモのため送信しません") : entry.delivery === "queued" ? tr("送信待ち") : entry.delivery === "failed" ? tr("送信できませんでした") : "";
  // Undelivered replies follow the inquiry's current address, so show where they will actually go.
  const recipient = (entry: InquiryInteraction) => entry.delivery === "queued" || entry.delivery === "retrying" ? inquiry.email : entry.to;
  return <section className="inquiry-history" aria-label={tr("やりとりの履歴")}>
    <h4>{tr("やりとりの履歴")}</h4><p className="small muted">{tr("新しい順に表示します。社内メモや電話対応の記録は、お客様へ送信されません。")}</p>
    {!entries.length && <p className="empty">{tr("まだ追加のやりとりはありません。")}</p>}
    <ol {...pagination.listProps}>{pagination.items.map(entry => <li key={entry.id} className={`inquiry-entry inquiry-entry-${entry.kind}`}>
      <div className="inquiry-entry-heading"><strong>{inquiryChannelLabel(entry.kind)}</strong><time dateTime={entry.at || undefined}>{entry.at ? shopTime(entry.at, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : tr("日時未記録")}</time></div>
      {entry.legacy && <p className="small muted">{tr("履歴機能の追加前に保存された最新の返信です。")}</p>}
      <p className="customer-message">{entry.text}</p>
      <InquiryAttachments files={entry.attachments} shopId={shopId} inquiryId={inquiry.id} />
      {entry.by && <p className="small muted">{tr("記録者：{0}", entry.by)}</p>}
      {recipient(entry) && <p className="small muted">{tr("返信先：")}{recipient(entry)}</p>}
      {delivery(entry) && <span className="pill">{delivery(entry)}</span>}
      {entry.delivery === "failed" && <p className="small muted">{tr("この返信メールを送信できませんでした。返信内容は記録に残っています。宛先と添付ファイルを確認してください。")}</p>}
    </li>)}</ol>
    <Pagination pagination={pagination} label={tr("やりとりの履歴")} />
  </section>;
}

export function InquiryContact({ inquiry, shopId, onChanged }: { inquiry: Inquiry; shopId: string; onChanged: () => Promise<void> }) {
  const api = useApi();
  const [email, setEmail] = useState(inquiry.email), [phone, setPhone] = useState(inquiry.phone || "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [previous, setPrevious] = useState({ email: inquiry.email, phone: inquiry.phone || "" });
  if (!inquiry.createdBy) return null;
  return <details className="inquiry-contact"><summary>{tr("連絡先を編集")}</summary><form onSubmit={event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    void (async () => {
      try {
        const next = { email: email.trim().toLowerCase(), phone: phone.trim() };
        await api(`/api/shops/${shopId}/inquiries/${inquiry.id}/contact`, { ...next, previousEmail: previous.email, previousPhone: previous.phone });
        await onChanged(); setPrevious(next);
      } catch (error) { setError(error instanceof Error ? error.message : tr("連絡先を保存できませんでした。")); }
      finally { setBusy(false); }
    })();
  }}>
    <label>{tr("メールアドレス（任意）")}<input type="email" value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /></label>
    <label>{tr("電話番号（任意）")}<input type="tel" value={phone} onChange={event => setPhone(event.target.value)} maxLength={50} disabled={busy} /></label>
    {error && <div className="alert" role="alert">{error}<button type="button" disabled={busy} onClick={() => {
      setBusy(true);
      void (async () => {
        try {
          const rows = await api<Inquiry[]>(`/api/shops/${shopId}/inquiries`);
          const current = rows.find(row => row.id === inquiry.id);
          if (current) setPrevious({ email: current.email, phone: current.phone || "" });
          await onChanged(); setError("");
        } catch (error) { setError(error instanceof Error ? error.message : tr("連絡先を保存できませんでした。")); }
        finally { setBusy(false); }
      })();
    }}>{tr("最新の状態を確認")}</button></div>}
    <button type="submit" disabled={busy || email.trim().toLowerCase() === previous.email && phone.trim() === previous.phone}>{tr("連絡先を保存")}</button>
  </form></details>;
}

export function InquiryRecordForm({ shopId, inquiry, onChanged, onReload, disabled = false, onBusyChange }: {
  shopId: string;
  inquiry: Inquiry;
  onChanged: () => Promise<void>;
  onReload: () => Promise<void>;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const api = useApi();
  const [kind, setKind] = useState<InquiryChannel>("note");
  // Email and record drafts stay separate, so switching to email never copies a private memo into it.
  const [drafts, setDrafts] = useState({ record: "", email: "" });
  const recordFiles = useInquiryFiles(), emailFiles = useInquiryFiles();
  const email = kind === "email", mode = email ? "email" : "record";
  const text = drafts[mode], selection = email ? emailFiles : recordFiles;
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const saving = useRef(false);
  const recordPending = useRef<{ serialized: string; requestId: string } | undefined>(undefined);
  const emailPending = useRef<{ serialized: string; requestId: string; previousReply: string; previousEmail: string } | undefined>(undefined);
  const locked = busy || disabled;
  function setWorking(value: boolean) { saving.current = value; setBusy(value); onBusyChange(value); }
  async function reload() {
    if (saving.current || disabled) return;
    setWorking(true);
    try { await onReload(); emailPending.current = undefined; setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : tr("記録を保存できませんでした。")); }
    finally { setWorking(false); }
  }
  return <form className="inquiry-record-form" aria-label={tr("対応を記録する")} onSubmit={event => {
    event.preventDefault(); if (!text.trim() || saving.current || disabled || email && !inquiry.email) return;
    const value = text.trim(), previousReply = inquiry.reply, previousEmail = inquiry.email;
    setWorking(true); setError(""); setNotice("");
    void (async () => {
      try {
        const fields = { text: value, ...await selection.read() };
        const serialized = JSON.stringify({ kind, ...fields });
        if (email) {
          const action = emailPending.current?.serialized === serialized ? emailPending.current : { serialized, requestId: createRequestId(), previousReply, previousEmail };
          emailPending.current = action;
          await api(`/api/shops/${shopId}/inquiries/${inquiry.id}/reply`, { ...fields, requestId: action.requestId, previousReply: action.previousReply, previousEmail: action.previousEmail });
        } else {
          const action = recordPending.current?.serialized === serialized ? recordPending.current : { serialized, requestId: createRequestId() };
          recordPending.current = action;
          await api(`/api/shops/${shopId}/inquiries/${inquiry.id}/interactions`, { ...fields, kind, requestId: action.requestId });
        }
        await onChanged();
        setDrafts(current => ({ ...current, [mode]: "" })); selection.clear();
        if (email) emailPending.current = undefined; else recordPending.current = undefined;
        setNotice(email ? tr("返信を受け付けました。") : tr("対応の記録を追加しました。メールは送信していません。"));
      } catch (error) { setError(error instanceof Error ? error.message : tr("記録を保存できませんでした。")); }
      finally { setWorking(false); }
    })();
  }}>
    <h4>{tr("対応を記録する")}</h4>
    <label>{tr("対応の種類")}<select aria-label={tr("対応の種類")} value={kind} disabled={locked} onChange={event => { setKind(event.target.value as InquiryChannel); setError(""); setNotice(""); }}>{(["note", "phone", "customer", "email"] as const).map(value => <option key={value} value={value} disabled={value === "email" && !inquiry.email}>{inquiryChannelLabel(value)}</option>)}</select></label>
    {email && <p className="small muted">{tr("返信先：")}{inquiry.email}</p>}
    {!inquiry.email && <p className="small muted">{tr("メールアドレスがないためメールを送信できません。電話対応やメモとして記録してください。")}</p>}
    <p className="small muted">{email ? tr("メールを送信し、やりとりの履歴にも保存します。") : tr("この対応は記録のみ保存し、メールは送信しません。")}</p>
    <label>{tr("対応内容")}<textarea aria-label={tr("対応内容")} value={text} onChange={event => setDrafts(current => ({ ...current, [mode]: event.target.value }))} disabled={locked} required maxLength={5000} rows={4} placeholder={email ? tr("お客様への返信を入力してください") : undefined} /></label>
    <InquiryFilePicker key={mode} selection={selection} disabled={locked} />
    {error && <div className="alert" role="alert"><p>{error}</p><button type="button" disabled={locked} onClick={() => void reload()}>{tr("最新の状態を確認")}</button></div>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <button type="submit" className={email ? "primary" : undefined} disabled={locked || !text.trim() || email && !inquiry.email}>{busy ? tr("保存しています…") : email ? tr("送信して保存") : tr("記録を追加")}</button>
  </form>;
}
