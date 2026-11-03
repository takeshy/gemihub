import { tr, intlLocale } from "../shared/i18n";
import { useEffect, useState } from "react";
import { useApi } from "./api";

type Run = (fn: () => Promise<void>) => Promise<void>;
type ProviderStatus = { model: string; imageModel: string; ready: boolean; key?: boolean; project?: boolean };
type AdminStatus = {
  demoGoogle: { email: string; connectedAt: string; connectedBy: string; rootFolderId?: string; healthy?: boolean } | null;
  judge: { active: boolean; configured: boolean; until: string | null; aiLimit: number; inviteUrl: string; inviteUrlEn: string; inviteUrlJa: string };
  ai: { provider: "vertex" | "openai"; changedAt?: string; changedBy?: string; vertex: ProviderStatus; openai: ProviderStatus };
};
type JudgeRow = { email: string; shopName: string | null; slug: string | null; publication: string | null; createdAt: string | null; aiUsed: number; aiLimit: number; resets: number; mails: number; lastUsedAt: string | null };
const at = (value?: string | null) => value ? new Date(value).toLocaleString(intlLocale(), { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const providerName = (provider: "vertex" | "openai") => provider === "vertex" ? "Vertex AI (Gemini)" : "OpenAI";

function Copy({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="admin-copy"><input readOnly value={value} onFocus={event => event.target.select()} aria-label={tr("招待URL")} />
    <button type="button" onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}>{copied ? tr("コピーしました") : tr("コピー")}</button></div>;
}

/** Operator administration: the demo Google connection, judge access and the AI provider. */
export function Admin({ run }: { run: Run }) {
  const api = useApi();
  const [status, setStatus] = useState<AdminStatus>();
  const [judges, setJudges] = useState<JudgeRow[]>([]);
  const [test, setTest] = useState<{ provider: string; ok: boolean; milliseconds?: number; error?: string }>();
  const load = async () => { setStatus(await api<AdminStatus>("/api/admin/status")); setJudges(await api<JudgeRow[]>("/api/admin/judges")); };
  useEffect(() => { void run(load); }, []);
  if (!status) return null;
  const google = status.demoGoogle;
  const judgeState = !status.judge.configured ? tr("未設定") : !status.judge.active ? tr("期限切れ") : !google ? tr("デモ用 Google が未接続") : tr("有効");
  return <div className="admin">
    <section className="panel" aria-labelledby="admin-title">
      <p className="eyebrow">ADMIN</p>
      <h1 id="admin-title">{tr("運営管理")}</h1>
      <p className="small muted">{tr("審査員アクセスと AI の設定を管理します。この画面は運営者だけが見られます。")}</p>
    </section>

    <section className="panel" aria-labelledby="admin-google-title">
      <h2 id="admin-google-title">{tr("デモ用 Google")}</h2>
      <p className="small muted">{tr("審査員のお店はこの Google アカウントの Drive に、審査員ごとのフォルダで保存されます。店主の予約枠には、このアカウントのカレンダーの空き状況を使います。メールは送信しないため Gmail の権限は求めません。")}</p>
      {google ? <dl className="admin-facts">
        <div><dt>{tr("接続中のアカウント")}</dt><dd>{google.email}</dd></div>
        <div><dt>{tr("接続日時")}</dt><dd>{at(google.connectedAt)}<br /><small className="muted">{google.connectedBy}</small></dd></div>
        <div><dt>{tr("状態")}</dt><dd>{google.healthy === false ? <span className="admin-bad">{tr("再接続が必要です")}</span> : tr("接続済み")}</dd></div>
        {google.rootFolderId && <div><dt>{tr("保存先")}</dt><dd><a href={`https://drive.google.com/drive/folders/${google.rootFolderId}`} target="_blank" rel="noreferrer">gemihub judges ↗</a></dd></div>}
      </dl> : <p className="alert">{tr("未接続です。接続するまで審査員のお店は保存できません。")}</p>}
      <div className="admin-actions">
        <a className="button primary" href="/admin/google/connect">{google ? tr("接続し直す") : tr("デモ用 Google を接続")}</a>
        {google && <button type="button" onClick={() => run(async () => {
          if (!confirm(tr("接続を解除すると、再接続するまで審査員のお店が使えなくなります。解除しますか？"))) return;
          await api("/api/admin/google/disconnect", {}); await load();
        })}>{tr("接続を解除")}</button>}
      </div>
    </section>

    <section className="panel" aria-labelledby="admin-invite-title">
      <h2 id="admin-invite-title">{tr("審査員アクセス")}</h2>
      <dl className="admin-facts">
        <div><dt>{tr("状態")}</dt><dd>{judgeState}</dd></div>
        <div><dt>{tr("期限")}</dt><dd>{at(status.judge.until)}</dd></div>
        <div><dt>{tr("AIの上限（1人あたり）")}</dt><dd>{status.judge.aiLimit}</dd></div>
      </dl>
      {status.judge.inviteUrl ? <>
        <h3>{tr("招待URL（英語）")}</h3><Copy value={status.judge.inviteUrlEn} />
        <h3>{tr("招待URL（日本語）")}</h3><Copy value={status.judge.inviteUrlJa} />
        <p className="small muted">{tr("招待URLは提出フォームのテスト手順にだけ記載し、公開のREADMEには書かないでください。")}</p>
      </> : <p className="muted">{tr("JUDGE_INVITE が設定されていません。")}</p>}
    </section>

    <section className="panel" aria-labelledby="admin-judges-title">
      <h2 id="admin-judges-title">{tr("審査員の一覧")}</h2>
      {!judges.length ? <p className="muted">{tr("まだ審査員はいません。")}</p> : <div className="admin-table"><table>
        <thead><tr><th>{tr("作成日時")}</th><th>{tr("お店")}</th><th>AI</th><th>{tr("初期化")}</th><th>{tr("メール")}</th><th>{tr("最終利用")}</th></tr></thead>
        <tbody>{judges.map(judge => <tr key={judge.email}>
          <td>{at(judge.createdAt)}</td>
          <td>{judge.slug ? <a href={`/s/${judge.slug}`} target="_blank" rel="noreferrer">{judge.shopName}</a> : <span className="muted">{tr("未作成")}</span>}{judge.publication === "provisional" && <small className="muted">{tr("（仮公開）")}</small>}</td>
          <td>{judge.aiUsed} / {judge.aiLimit}</td>
          <td>{judge.resets}</td>
          <td>{judge.mails}</td>
          <td>{at(judge.lastUsedAt)}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>

    <section className="panel" aria-labelledby="admin-ai-title">
      <h2 id="admin-ai-title">{tr("AIプロバイダ")}</h2>
      <p>{tr("使用中：{0}", providerName(status.ai.provider))}{status.ai.changedAt && <span className="small muted">{tr("（{0} に {1} が変更）", at(status.ai.changedAt), status.ai.changedBy)}</span>}</p>
      <div className="admin-providers">
        {(["vertex", "openai"] as const).map(provider => {
          const info = status.ai[provider];
          return <div key={provider} className={`admin-provider${status.ai.provider === provider ? " current" : ""}`}>
            <h3>{providerName(provider)}</h3>
            <dl className="admin-facts">
              <div><dt>{tr("モデル")}</dt><dd>{info.model || tr("未設定")}</dd></div>
              <div><dt>{tr("画像モデル")}</dt><dd>{info.imageModel || tr("未設定")}</dd></div>
              {provider === "openai" && <div><dt>{tr("APIキー")}</dt><dd>{info.key ? tr("設定済み") : tr("未設定")}</dd></div>}
              <div><dt>{tr("状態")}</dt><dd>{info.ready ? tr("利用できます") : <span className="admin-bad">{tr("設定が足りません")}</span>}</dd></div>
            </dl>
            <div className="admin-actions">
              {status.ai.provider !== provider && <button type="button" className="primary" disabled={!info.ready} onClick={() => run(async () => {
                if (!confirm(tr("すべてのお店のAIを {0} に切り替えますか？", providerName(provider)))) return;
                await api("/api/admin/ai-provider", { provider }); await load();
              })}>{tr("このプロバイダに切り替える")}</button>}
              <button type="button" disabled={!info.ready} onClick={() => run(async () => { setTest({ provider, ...await api<{ ok: boolean; milliseconds?: number; error?: string }>("/api/admin/ai-test", { provider }) }); })}>{tr("接続テスト")}</button>
            </div>
            {test?.provider === provider && <p className={test.ok ? "notice" : "alert"} role="status">{test.ok ? tr("応答しました（{0} ms）", test.milliseconds) : tr("接続できませんでした：{0}", test.error || "")}</p>}
          </div>;
        })}
      </div>
      <p className="small muted">{tr("切り替えはすべてのお店に反映されます。選んだプロバイダが失敗しても、もう一方へ自動で切り替えることはありません。")}</p>
    </section>
  </div>;
}
