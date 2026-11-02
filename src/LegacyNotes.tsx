import { tr } from "../shared/i18n";

export const kiokuflowMigrationUrl = "https://kiokuflow.net/settings/migration";
export function LegacyNotes({ email, onCheck }: { email?: string; onCheck: () => void }) {
  return <section className="panel legacy-notes" aria-labelledby="legacy-notes-title">
    <p className="small muted">{tr("設定 / 旧環境からの引き継ぎ")}</p>
    <h1 id="legacy-notes-title">{tr("ノートとAIチャットはkiokuflowへ移動しました")}</h1>
    <p>{tr("以前のGemiHubで使っていたノートの設定が見つかりました。ノート・AIチャットの新しいURLはkiokuflow.netです。")}</p>
    {email && <p>{tr("Googleアカウント: {0}", email)}</p>}
    <p>{tr("同じGoogleアカウントでkiokuflowへログインすると、設定の「旧環境からの引き継ぎ」でデータをコピーできます。元のDriveファイルは残ります。")}</p>
    <p>{tr("始める前に旧環境で全端末の変更をPushしてください。暗号化のパスワードはそのまま使えます。RAG索引・公開リンク・外部同期は移行後に確認してください。")}</p>
    <div className="legacy-notes-actions">
      <a className="button primary" href="https://kiokuflow.net/auth/google?returnTo=%2Fsettings%2Fmigration" target="_blank" rel="noopener noreferrer">{tr("kiokuflowで引き継ぐ")}</a>
      <button type="button" onClick={onCheck}>{tr("移行完了を確認する")}</button>
    </div>
    <p className="small muted">{tr("コピーと検証が済むと、kiokuflowが旧設定をゴミ箱へ移します。この画面に戻って移行完了を確認すると、GemiHubのお店づくりを始められます。")}</p>
  </section>;
}
