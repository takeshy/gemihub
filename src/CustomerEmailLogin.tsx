import React, { useEffect, useRef, useState } from "react";
import { tr } from "../shared/i18n";
import { useApi } from "./api";

function readLink() {
  if (typeof location === "undefined") return { open: false, token: "" };
  const params = new URLSearchParams(location.hash.slice(1));
  return { open: params.has("email-login"), token: params.get("email-login") || "" };
}

export function CustomerEmailLogin({ base, shopName, googleAuthUrl, open, onClose }: { base: string; shopName: string; googleAuthUrl?: string; open: boolean; onClose: () => void }) {
  const api = useApi();
  const dialog = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState(readLink);
  const [email, setEmail] = useState("");
  const [info, setInfo] = useState<{ email: string; shopName: string }>();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = open || link.open;
  function close() { setLink({ open: false, token: "" }); setInfo(undefined); setError(""); setBusy(false); onClose(); }
  useEffect(() => {
    const receive = () => {
      const next = readLink();
      if (!next.open) return;
      setLink(next);
      history.replaceState(history.state, "", location.pathname + location.search);
    };
    receive(); window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);
  useEffect(() => {
    if (visible) { if (!dialog.current?.open) dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [visible]);
  useEffect(() => {
    if (!link.token) return;
    let active = true;
    setBusy(true); setError(""); setInfo(undefined);
    void api<{ email: string; shopName: string }>(`${base}/auth/email/info`, { token: link.token })
      .then(value => { if (active) { setInfo(value); setEmail(value.email); } })
      .catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [base, link.token]);
  async function send(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(`${base}/auth/email`, { email }); setSent(true); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="customer-email-login" aria-labelledby="customer-email-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="section-top"><h2 id="customer-email-title">{link.token ? tr("メールアドレスを確認") : tr("会員登録・ログイン")}</h2><button type="button" aria-label={tr("閉じる")} disabled={busy} onClick={close}>×</button></div>
    <p className="small muted">{shopName}</p>
    {error && <p role="alert" className="alert">{error}</p>}
    {link.token ? <>
      {!info && busy && <p role="status">{tr("認証リンクを確認しています…")}</p>}
      {info && <><p>{tr("このメールアドレスでログインします。")}</p><p className="email-login-address">{info.email}</p><button className="primary" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { const result = await api<{ redirectTo: string }>(`${base}/auth/email/verify`, { token: link.token }); location.assign(result.redirectTo); }
        catch (error) { setError(error instanceof Error ? error.message : String(error)); setBusy(false); }
      }}>{busy ? tr("ログインしています…") : tr("メールアドレスを確認してログイン")}</button></>}
      {error && <button type="button" disabled={busy} onClick={() => { setLink({ open: true, token: "" }); setSent(false); setError(""); }}>{tr("新しい認証メールを送る")}</button>}
    </> : sent ? <div role="status"><h3>{tr("メールを確認してください")}</h3><p className="email-login-address">{email.trim()}</p><p>{tr("メール内のリンクを開いて、メールアドレスを確認してください。リンクは15分間有効です。")}</p><p className="small muted">{tr("メールが届かない場合は、迷惑メールフォルダとメールアドレスをご確認ください。")}</p><button type="button" onClick={() => { setSent(false); setError(""); }}>{tr("メールアドレスを変更")}</button></div> : <form onSubmit={send}>
      <p>{tr("メールアドレスでご利用いただけます。パスワードは不要です。")}</p>
      <label className="field"><span>{tr("メールアドレス")}</span><input type="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)}/></label>
      <button className="primary" disabled={busy}>{busy ? tr("メールを送信しています…") : tr("認証メールを送る")}</button>
      {googleAuthUrl && <div className="email-login-google"><p className="small muted">{tr("または")}</p><a className="button" href={googleAuthUrl} aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>{tr("Googleでログイン")}</a></div>}
    </form>}
  </dialog>;
}
