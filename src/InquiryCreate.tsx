import { useRef, useState } from "react";
import { tr } from "../shared/i18n";
import { inquiryChannelLabel } from "../server/inquiries";
import type { Inquiry } from "./App";
import { useApi } from "./api";
import { createRequestId } from "./request-id";
import { InquiryFilePicker, readInquiryFiles, useInquiryFiles } from "./InquiryFiles";

export function InquiryCreate({ shopId, customer, onCreated }: { shopId: string; customer?: { name: string; email: string; phone?: string }; onCreated: (inquiry: Inquiry) => Promise<void> }) {
  const api = useApi();
  const phoneCustomer = !!customer?.phone && customer.email.startsWith("tel:");
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [name, setName] = useState(customer?.name || ""), [email, setEmail] = useState(phoneCustomer ? "" : customer?.email || ""), [phone, setPhone] = useState(customer?.phone || "");
  const [subject, setSubject] = useState(""), [message, setMessage] = useState(""), [source, setSource] = useState<"phone" | "customer" | "note">("phone");
  const pending = useRef<{ serialized: string; requestId: string } | undefined>(undefined);
  const saving = useRef(false);
  const selection = useInquiryFiles();
  return <div className="inquiry-create">
    <button type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen(value => !value)}>{open ? tr("新規作成を閉じる") : tr("お問い合わせを新規作成")}</button>
    {open && <form className="inquiry-create-form" aria-label={tr("お問い合わせを新規作成")} onSubmit={event => {
      event.preventDefault(); if (saving.current) return;
      const fields = { name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), subject: subject.trim(), message: message.trim(), source };
      saving.current = true; setBusy(true); setError("");
      void (async () => {
        try {
          const payload = { ...fields, ...await readInquiryFiles(selection.files) };
          const serialized = JSON.stringify(payload);
          const requestId = pending.current?.serialized === serialized ? pending.current.requestId : createRequestId(); pending.current = { serialized, requestId };
          const result = await api<{ inquiry: Inquiry }>(`/api/shops/${shopId}/inquiries`, { ...payload, requestId });
          await onCreated(result.inquiry); setMessage(""); setSubject(""); selection.clear(); pending.current = undefined; setOpen(false);
        } catch (error) { setError(error instanceof Error ? error.message : tr("お問い合わせを作成できませんでした。")); }
        finally { saving.current = false; setBusy(false); }
      })();
    }}>
      <h3>{tr("お問い合わせを新規作成")}</h3>
      <p className="small muted">{tr("電話・来店・お客様からの連絡を手動で登録できます。作成時にメールは送信しません。メールアドレスは任意です。")}</p>
      <fieldset disabled={busy}>
        <label>{tr("お客様の氏名")}<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required /></label>
        <label>{tr("メールアドレス（任意）")}<input type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} readOnly={!!customer} /></label>
        <label>{tr("電話番号（任意）")}<input type="tel" value={phone} onChange={event => setPhone(event.target.value)} maxLength={50} readOnly={phoneCustomer} /></label>
        <label>{tr("受付方法")}<select aria-label={tr("受付方法")} value={source} onChange={event => setSource(event.target.value as typeof source)}>{(["phone", "customer", "note"] as const).map(value => <option key={value} value={value}>{inquiryChannelLabel(value)}</option>)}</select></label>
        <label>{tr("件名（任意）")}<input value={subject} onChange={event => setSubject(event.target.value)} maxLength={200} /></label>
        <label>{tr("お問い合わせ内容")}<textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={5000} rows={4} required /></label>
        <InquiryFilePicker selection={selection} disabled={busy} />
      </fieldset>
      {error && <p className="alert" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={busy || !name.trim() || !message.trim()}>{busy ? tr("保存しています…") : tr("お問い合わせを作成")}</button>
    </form>}
  </div>;
}
