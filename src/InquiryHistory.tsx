import { useRef, useState } from "react";
import { tr } from "../shared/i18n";
import { inquiryChannelLabel, type InquiryChannel, type InquiryInteraction } from "../server/inquiries";
import type { Inquiry } from "./App";
import { useApi } from "./api";
import { useShopDisplay } from "./money";
import { createRequestId } from "./request-id";
import { Pagination, usePagination } from "./Pagination";

export function InquiryHistory({ inquiry }: { inquiry: Inquiry }) {
  const { shopTime } = useShopDisplay();
  const entries = [...(inquiry.interactions || [])];
  if (inquiry.reply && !entries.some(entry => entry.kind === "email")) entries.unshift({ id: "legacy-reply", shopId: "", inquiryId: inquiry.id, kind: "email", text: inquiry.reply, at: "", legacy: true });
  entries.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) || a.id.localeCompare(b.id));
  const pagination = usePagination(entries, `${inquiry.id}:${entries.length}`);
  const delivery = (entry: InquiryInteraction) => entry.delivery === "sent" ? tr("送信済み") : entry.delivery === "retrying" ? tr("送信を再試行中") : entry.delivery === "simulated" ? tr("デモのため送信しません") : entry.delivery === "queued" ? tr("送信待ち") : "";
  return <section className="inquiry-history" aria-label={tr("やりとりの履歴")}>
    <h4>{tr("やりとりの履歴")}</h4><p className="small muted">{tr("新しい順に表示します。社内メモや電話対応の記録は、お客様へ送信されません。")}</p>
    {!entries.length && <p className="empty">{tr("まだ追加のやりとりはありません。")}</p>}
    <ol {...pagination.listProps}>{pagination.items.map(entry => <li key={entry.id} className={`inquiry-entry inquiry-entry-${entry.kind}`}>
      <div className="inquiry-entry-heading"><strong>{inquiryChannelLabel(entry.kind)}</strong><time dateTime={entry.at || undefined}>{entry.at ? shopTime(entry.at, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : tr("日時未記録")}</time></div>
      {entry.legacy && <p className="small muted">{tr("履歴機能の追加前に保存された最新の返信です。")}</p>}
      <p className="customer-message">{entry.text}</p>
      {entry.by && <p className="small muted">{tr("記録者：{0}", entry.by)}</p>}
      {entry.to && <p className="small muted">{tr("返信先：")}{entry.to}</p>}
      {delivery(entry) && <span className="pill">{delivery(entry)}</span>}
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

export function InquiryRecordForm({ shopId, inquiryId, onChanged }: { shopId: string; inquiryId: string; onChanged: () => Promise<void> }) {
  const api = useApi();
  const [kind, setKind] = useState<Exclude<InquiryChannel, "email">>("note"), [text, setText] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const saving = useRef(false);
  const pending = useRef<{ kind: typeof kind; text: string; requestId: string } | undefined>(undefined);
  return <form className="inquiry-record-form" aria-label={tr("対応を記録する")} onSubmit={event => {
    event.preventDefault(); if (!text.trim() || saving.current) return;
    const input = pending.current?.kind === kind && pending.current.text === text.trim() ? pending.current : { kind, text: text.trim(), requestId: createRequestId() };
    pending.current = input; saving.current = true; setBusy(true); setError(""); setNotice("");
    void (async () => {
      try {
        await api(`/api/shops/${shopId}/inquiries/${inquiryId}/interactions`, input);
        await onChanged(); setText(""); pending.current = undefined; setNotice(tr("対応の記録を追加しました。メールは送信していません。"));
      } catch (error) { setError(error instanceof Error ? error.message : tr("記録を保存できませんでした。")); }
      finally { saving.current = false; setBusy(false); }
    })();
  }}>
    <h4>{tr("対応を記録する")}</h4>
    <label>{tr("記録の種類")}<select aria-label={tr("記録の種類")} value={kind} disabled={busy} onChange={event => setKind(event.target.value as typeof kind)}>{(["note", "phone", "customer"] as const).map(value => <option key={value} value={value}>{inquiryChannelLabel(value)}</option>)}</select></label>
    <label>{tr("対応内容")}<textarea aria-label={tr("対応内容")} value={text} onChange={event => setText(event.target.value)} disabled={busy} required maxLength={5000} rows={3} /></label>
    {error && <p className="alert" role="alert">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}
    <button type="submit" disabled={busy || !text.trim()}>{busy ? tr("保存しています…") : tr("記録を追加")}</button>
  </form>;
}
