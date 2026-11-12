import { tr } from "../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const kiokuflowMigrationUrl = "https://kiokuflow.net/settings/migration";
export function LegacyNotes({ email, check }: { email?: string; check: (force: boolean) => Promise<void> }) {
  const [remaining, setRemaining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (remaining && !dialog.current?.open) dialog.current?.showModal(); }, [remaining]);
  async function attempt(force: boolean) {
    setBusy(true); setError("");
    try { await check(force); setRemaining(false); }
    catch (e) {
      // 409 means the old settings were found; the owner may wait for the handover or continue anyway.
      if (!force && (e as { status?: number }).status === 409) setRemaining(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }
  return <section className="panel legacy-notes" aria-labelledby="legacy-notes-title">
    <p className="small muted">{tr("設定 / 旧環境からの引き継ぎ")}</p>
    <h1 id="legacy-notes-title">{tr("ノートとAIチャットはkiokuflowへ移動しました")}</h1>
    <p>{tr("以前のGemiHubで使っていたノートの設定が見つかりました。ノート・AIチャットの新しいURLはkiokuflow.netです。")}</p>
    {email && <p>{tr("Googleアカウント: {0}", email)}</p>}
    <p>{tr("同じGoogleアカウントでkiokuflowへログインすると、設定の「旧環境からの引き継ぎ」でデータをコピーできます。元のDriveファイルは残ります。")}</p>
    <p>{tr("始める前に旧環境で全端末の変更をPushしてください。暗号化のパスワードはそのまま使えます。RAG索引・公開リンク・外部同期は移行後に確認してください。")}</p>
    {error && !remaining && <p className="alert" role="alert">{error}</p>}
    <div className="legacy-notes-actions">
      <a className="button primary" href="https://kiokuflow.net/auth/google?returnTo=%2Fsettings%2Fmigration" target="_blank" rel="noopener noreferrer">{tr("kiokuflowで引き継ぐ")}</a>
      <button type="button" disabled={busy} onClick={() => void attempt(false)}>{tr("移行完了を確認する")}</button>
    </div>
    <p className="small muted">{tr("コピーと検証が済むと、kiokuflowが旧設定をゴミ箱へ移します。この画面に戻って移行完了を確認すると、GemiHubのお店づくりを始められます。")}</p>
    {remaining && createPortal(<dialog ref={dialog} className="legacy-notes-dialog" aria-labelledby="legacy-notes-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) setRemaining(false); }}>
      <h2 id="legacy-notes-dialog-title">{tr("旧設定が残っています")}</h2>
      <p>{tr("kiokuflowでの引き継ぎが完了していないか、旧設定のファイルがGoogle ドライブに残っています。")}</p>
      <p>{tr("強制的に進めると、引き継ぎを確認せずにGemiHubのお店づくりを始めます。旧環境のファイルは変更しません。次回のログインからは、この確認を行いません。")}</p>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="actions"><button type="button" autoFocus disabled={busy} onClick={() => setRemaining(false)}>{tr("やめる")}</button><button type="button" className="danger" disabled={busy} onClick={() => void attempt(true)}>{tr("強制的に進める")}</button></div>
    </dialog>, document.body)}
  </section>;
}
