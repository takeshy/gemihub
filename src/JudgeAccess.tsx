import { tr, intlLocale } from "../shared/i18n";
import { useEffect, useState } from "react";
import { useApi } from "./api";
import { createRequestId } from "./request-id";

type Run = (fn: () => Promise<void>) => Promise<void>;
const at = (value: string) => new Date(value).toLocaleString(intlLocale(), { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** The shared invitation page. Judges start without Google; the same browser resumes its account. */
export function JudgeStart({ invite, signedIn, run }: { invite: string; signedIn: boolean; run: Run }) {
  const api = useApi();
  const [starting, setStarting] = useState(false);
  return <section className="panel judge-access" aria-labelledby="judge-start-title">
    <p className="eyebrow">JUDGE ACCESS</p>
    <h1 id="judge-start-title">{tr("審査員アクセス")}</h1>
    <p>{tr("Google アカウントなしで、店主としてお店づくりから予約・PayPal Sandbox の支払いまで試せます。")}</p>
    <ul>
      <li>{tr("メールは送信されません。送信されるはずのメールは「審査メニュー」で確認できます。")}</li>
      <li>{tr("データは運営者の Google Drive に審査員ごとに保存し、審査終了後に削除します。")}</li>
      <li>{tr("このブラウザでは同じアカウントを続けて使えます。別のブラウザや端末では新しいアカウントになります。")}</li>
    </ul>
    <div className="judge-actions">
      <button className="primary" type="button" disabled={starting} onClick={() => { setStarting(true); void run(async () => { try { await api("/api/judge/start", { invite }); location.assign("/"); } finally { setStarting(false); } }); }}>
        {signedIn ? tr("続きから試す") : tr("はじめる")}
      </button>
    </div>
  </section>;
}

type JudgePhone = { number: string; caller: string; pin: string };
type JudgeStatus = { until: string; aiUsed: number; aiLimit: number; storage: boolean; slug: string; published: boolean; phone?: JudgePhone };
type JudgeMail = { id: string; to: string; cc?: string[]; subject: string; body: string; at: string };
/** Judge-only menu: mails that would have been sent, usage, the trial path and a full reset. */
export function JudgeMenu({ customer = false, canReturnToOwner = false, run }: { customer?: boolean; canReturnToOwner?: boolean; run: Run }) {
  const api = useApi();
  const [status, setStatus] = useState<JudgeStatus>();
  const [mails, setMails] = useState<JudgeMail[]>([]);
  const [open, setOpen] = useState<string>();
  useEffect(() => { if (!customer) void run(async () => { setStatus(await api<JudgeStatus>("/api/judge/status")); setMails(await api<JudgeMail[]>("/api/judge/mails")); }); }, [customer]);
  const reset = () => run(async () => {
    if (!confirm(tr("お店、予約、問い合わせ、お客様、記事、画像、記録されたメールをすべて削除し、最初からやり直します。元に戻せません。"))) return;
    await api("/api/judge/reset", { requestId: createRequestId() });
    location.assign("/");
  });
  if (customer) return <section className="panel judge-menu" aria-labelledby="judge-menu-title">
    <h1 id="judge-menu-title">{tr("審査メニュー")}</h1>
    <JudgeBar customer run={run} menuLink={false} />
  </section>;
  return <div className="judge-menu">
    <section className="panel" aria-labelledby="judge-menu-title">
      <p className="eyebrow">JUDGE</p>
      <h1 id="judge-menu-title">{tr("審査メニュー")}</h1>
      <div className="judge-actions"><a className="button" href="/">{tr("トップページへ戻る")}</a></div>
      <JudgeBar customer={false} recovery={canReturnToOwner} published={!!status?.published} run={run} menuLink={false} />
      {status && !status.storage && <p className="alert">{tr("デモ環境の準備中です。しばらくしてからお試しください。")}</p>}
      {status && <dl className="judge-facts">
        <div><dt>{tr("AIの利用回数")}</dt><dd>{status.aiUsed} / {status.aiLimit}</dd></div>
        <div><dt>{tr("利用期限")}</dt><dd>{at(status.until)}</dd></div>
      </dl>}
      <h2>{tr("試し方")}</h2>
      <ol className="judge-steps">
        <li>{tr("「AIとお店をつくる」でお店のことを話し、提案を確認して仮公開します。")}</li>
        <li>{tr("「お店の基本情報」の予約ルールで「予約時にPayPalで全額お支払いいただく」を有効にします。")}</li>
        <li>{tr("公開ページで「お客様として試す」を押し、予約して PayPal Sandbox で支払います。")}</li>
        <li>{tr("お客様のマイページからキャンセルし、返金を確認します。問い合わせも送れます。")}</li>
        <li>{tr("「店主に戻る」で管理画面に戻り、予約・返金・問い合わせ・送信されたメールを確認します。")}</li>
      </ol>
      <p className="small muted">{tr("PayPal Sandbox の購入者アカウントは、提出フォームのテスト手順に記載しています。")}</p>
      <div className="judge-actions">
        <a className="button" href="/">{tr("管理画面に戻る")}</a>
        {status?.published && <a className="button" href={`/s/${status.slug}`}>{tr("公開ページを開く")}</a>}
      </div>
    </section>
    <section className="panel" aria-labelledby="judge-mails-title">
      <h2 id="judge-mails-title">{tr("送信されたメール")}</h2>
      <p className="small muted">{tr("審査員アクセスではメールは送信されません。本番ではこのメールが店主の Gmail から送信されます。")}</p>
      {!mails.length ? <p className="muted">{tr("まだメールはありません。")}</p> : <ul className="judge-mails">
        {mails.map(mail => <li key={mail.id}>
          <button type="button" aria-expanded={open === mail.id} onClick={() => setOpen(open === mail.id ? undefined : mail.id)}>
            <span>{at(mail.at)}</span><strong>{mail.subject}</strong><small>{tr("宛先：{0}", mail.to)}</small>
            {!!mail.cc?.length && <small>CC: {mail.cc.join(", ")}</small>}
          </button>
          {open === mail.id && <pre>{mail.body}</pre>}
        </li>)}
      </ul>}
    </section>
    {status?.phone && <JudgePhoneDemo phone={status.phone} published={status.published} run={run} />}
    <section className="panel" aria-labelledby="judge-reset-title">
      <h2 id="judge-reset-title">{tr("アカウントデータの初期化")}</h2>
      <p>{tr("お店づくりの最初から試し直せます。AIの利用回数は戻りません。")}</p>
      <button type="button" className="danger" onClick={reset}>{tr("アカウントデータを初期化")}</button>
    </section>
  </div>;
}

function displayJudgePhone(number: string) {
  return number.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")
    .replace(/^\+81(50)(\d{4})(\d{4})$/, "0$1-$2-$3");
}

function JudgePhoneDemo({ phone, published, run }: { phone: JudgePhone; published: boolean; run: Run }) {
  const api = useApi();
  const [saved, setSaved] = useState(displayJudgePhone(phone.caller));
  const [caller, setCaller] = useState(saved);
  const [busy, setBusy] = useState(false);
  const save = (value: string) => {
    setBusy(true);
    void run(async () => {
      try {
        const result = await api<{ caller: string }>("/api/judge/phone", { caller: value });
        const formatted = displayJudgePhone(result.caller);
        setSaved(formatted);
        setCaller(formatted);
      } finally { setBusy(false); }
    });
  };
  return <section className="panel" aria-labelledby="judge-phone-title">
    <h2 id="judge-phone-title">{tr("AI電話受付を試す")}</h2>
    <p>{tr("お店を公開したら、下の番号にかけてテスト予約や問い合わせを試せます。")}</p>
    <p>{tr("かけ先の番号")} <strong>{displayJudgePhone(phone.number)}</strong></p>
    <p>{tr("電話用の暗証番号")} <strong>{phone.pin}</strong></p>
    <p className="small muted">{tr("発信元の番号を登録せずに試す場合は、電話の音声案内に従ってこの8桁の暗証番号をキーで入力してください。番号通知でおかけください。暗証番号はお店の初期化で変わります。")}</p>
    <form onSubmit={event => { event.preventDefault(); save(caller.trim()); }}>
      <label>{tr("発信元の電話番号")}<input type="tel" autoComplete="tel" required maxLength={40} value={caller} disabled={busy} onChange={event => setCaller(event.target.value)} /></label>
      <div className="judge-actions">
        <button type="submit" disabled={busy || !caller.trim() || caller.trim() === saved}>{tr("発信元の番号を登録")}</button>
        {saved && <button type="button" disabled={busy} onClick={() => save("")}>{tr("電話番号の登録を解除")}</button>}
      </div>
    </form>
    {saved && <p className="small muted" role="status">{tr("登録済みの発信元：{0}", saved)}</p>}
    {!published && <p className="small muted">{tr("自分のお店を公開してからお試しください")}</p>}
  </section>;
}

/** Explicit role actions shared by the storefront and management menu. */
export function JudgeBar({ customer, recovery = false, published = false, menuLink = true, run }: { customer: boolean; recovery?: boolean; published?: boolean; menuLink?: boolean; run: Run }) {
  const api = useApi();
  return <div className="judge-bar" role="region" aria-label={tr("審査員アクセス")}>
    {customer || recovery ? <>
      <span>{customer ? tr("審査用のお客様としてログイン中です。") : tr("元の店主アカウントに戻れます。")}</span>
      <button type="button" onClick={() => run(async () => { await api("/api/judge/owner", {}); location.assign("/"); })}>{tr("店主に戻る")}</button>
    </> : <>
      <span>{tr("店主としてログイン中です。")}</span>
      <button type="button" className="primary" disabled={!published} onClick={() => run(async () => { const { slug } = await api<{ slug: string }>("/api/judge/customer", {}); location.assign(`/s/${slug}?pane=reserve`); })}>{tr("お客様として試す")}</button>
    </>}
    {menuLink && <a href="/judge-menu">{tr("審査メニュー")}</a>}
  </div>;
}

/** New owners enter the invitation password before their first shop is created. */
export function AccessPassword({ email, run }: { email: string; run: Run }) {
  const api = useApi();
  const [password, setPassword] = useState("");
  return <section className="panel access-password" aria-labelledby="access-password-title">
    <h1 id="access-password-title">{tr("招待パスワード")}</h1>
    <p>{tr("gemihub は現在招待制で公開しています。案内された招待パスワードを入力してください。")}</p>
    <p className="small muted">{tr("Googleアカウント: {0}", email)}</p>
    <form onSubmit={event => { event.preventDefault(); void run(async () => { await api("/api/access/verify", { password }); location.assign("/"); }); }}>
      <label>{tr("招待パスワード")}<input type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} required maxLength={256} /></label>
      <button className="primary" type="submit" disabled={!password}>{tr("続ける")}</button>
    </form>
  </section>;
}
