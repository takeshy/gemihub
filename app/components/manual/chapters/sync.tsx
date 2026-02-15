import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function SyncChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <SyncJa />;
  return <SyncEn />;
}

function SyncEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Sync: Push to Drive / Pull to Local</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/push_pull.png" alt="Sync: Push to Drive / Pull to Local" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          GemiHub uses an offline-first architecture. All files are cached locally in your browser&apos;s IndexedDB. Syncing with Google Drive is done manually via <strong>Push to Drive</strong> (upload local changes) and <strong>Pull to Local</strong> (download remote changes).
        </p>

        <h2>How Sync Works</h2>
        <ol>
          <li><strong>Edit locally</strong> — All file edits are saved to the browser cache immediately.</li>
          <li><strong>Push to Drive</strong> — Upload changed files from local cache to Google Drive.</li>
          <li><strong>Pull to Local</strong> — Download changed files from Google Drive to local cache.</li>
        </ol>
        <p>
          Before syncing, a diff dialog shows exactly which files will be synced, with status badges (new, modified, deleted).
        </p>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/pull_diff.png" alt="Sync diff dialog" className="w-full" loading="lazy" />
        </figure>
        <p>
          If you want to keep your local version over the pulled content, you can open the file first and upload it via <strong>Temp UP</strong>, then perform the Pull, and afterwards overwrite it using <strong>Temp DL</strong>. This will mark the file as locally modified so it will be uploaded on the next Push.
        </p>

        <h2>Sync Badges</h2>
        <p>
          The header shows sync badges with the number of pending changes. Click a badge to see the list of changed files and initiate sync.
        </p>

        <h2>Conflict Resolution</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/conflict.png" alt="Conflict resolution dialog" className="w-full" loading="lazy" />
        </figure>
        <p>
          A conflict occurs when the same file has been modified both locally and on Drive since the last sync. When conflicts are detected:
        </p>
        <ol>
          <li>A conflict dialog appears showing each conflicting file.</li>
          <li>Choose <strong>Keep Local</strong> or <strong>Keep Remote</strong> for each file.</li>
          <li>The overwritten version is automatically backed up to a conflict folder on Drive.</li>
          <li>You can restore conflict backups from <strong>Settings &gt; Sync &gt; Conflict Backups</strong>.</li>
        </ol>

        <h2>Sync Settings</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_sync.png" alt="Sync settings" className="w-full" loading="lazy" />
        </figure>
        <p>In <strong>Settings &gt; Sync</strong>, you can:</p>
        <ul>
          <li><strong>Full Push</strong> — Upload all cached files (overwrites remote).</li>
          <li><strong>Full Pull</strong> — Download all remote files (overwrites local cache).</li>
          <li><strong>Manage Trash</strong> — Restore or permanently delete trashed files.</li>
          <li><strong>Manage Conflict Backups</strong> — View and restore conflict backup files.</li>
          <li><strong>Rebuild File Tree</strong> — Re-scan Drive to fix sync metadata.</li>
          <li><strong>Detect Untracked Files</strong> — Find remote files not in local cache.</li>
        </ul>

        <h2>Trash</h2>
        <p>
          Deleting a file moves it to a <code>trash/</code> folder on Drive (soft delete). You can restore trashed files from Settings &gt; Sync, or permanently delete them.
        </p>

        <h2>Offline Usage</h2>
        <p>
          When offline, you can continue editing cached files. An offline indicator appears in the header. Sync features are disabled until connectivity is restored. Once online, use Push to Drive to upload your changes.
        </p>
      </div>
    </>
  );
}

function SyncJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">同期：ドライブ反映 / ローカル反映</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/push_pull.png" alt="同期：ドライブ反映 / ローカル反映" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          GemiHubはオフラインファーストアーキテクチャを採用しています。すべてのファイルはブラウザのIndexedDBにローカルキャッシュされます。Google Driveとの同期は<strong>ドライブ反映</strong>（ローカル変更のアップロード）と<strong>ローカル反映</strong>（リモート変更のダウンロード）で手動で行います。
        </p>

        <h2>同期の仕組み</h2>
        <ol>
          <li><strong>ローカルで編集</strong> — すべてのファイル編集はブラウザキャッシュに即座に保存。</li>
          <li><strong>ドライブ反映</strong> — ローカルキャッシュからGoogle Driveに変更ファイルをアップロード。</li>
          <li><strong>ローカル反映</strong> — Google Driveからローカルキャッシュに変更ファイルをダウンロード。</li>
        </ol>
        <p>
          同期の前に、差分ダイアログで同期対象のファイルがステータスバッジ（新規、変更、削除）付きで表示されます。
        </p>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/pull_diff.png" alt="同期差分ダイアログ" className="w-full" loading="lazy" />
        </figure>
        <p>
          Pullの内容よりローカルを優先したい場合は、いったん「開く」でファイルを開いて<strong>一時UL</strong>でアップロードし、Pullした後に<strong>一時DL</strong>で上書きすることで、そのファイルを次回のPushで更新することができます。
        </p>

        <h2>同期バッジ</h2>
        <p>
          ヘッダーに同期バッジが保留中の変更数とともに表示されます。バッジをクリックして変更ファイル一覧の確認と同期を実行します。
        </p>

        <h2>コンフリクト解決</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/conflict.png" alt="コンフリクト解決ダイアログ" className="w-full" loading="lazy" />
        </figure>
        <p>
          コンフリクトは、前回の同期以降に同じファイルがローカルとDriveの両方で変更された場合に発生します。コンフリクトが検出されると：
        </p>
        <ol>
          <li>コンフリクトダイアログが表示され、各競合ファイルを確認。</li>
          <li>各ファイルについて<strong>ローカルを保持</strong>または<strong>リモートを保持</strong>を選択。</li>
          <li>上書きされたバージョンは自動的にDriveのコンフリクトフォルダにバックアップ。</li>
          <li>コンフリクトバックアップは<strong>設定 &gt; 同期 &gt; コンフリクトバックアップ</strong>から復元可能。</li>
        </ol>

        <h2>同期設定</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_sync.png" alt="同期設定" className="w-full" loading="lazy" />
        </figure>
        <p><strong>設定 &gt; 同期</strong>では以下の操作が可能です：</p>
        <ul>
          <li><strong>完全ドライブ反映</strong> — キャッシュされた全ファイルをアップロード（リモートを上書き）。</li>
          <li><strong>完全ローカル反映</strong> — リモートの全ファイルをダウンロード（ローカルキャッシュを上書き）。</li>
          <li><strong>ゴミ箱管理</strong> — 削除されたファイルの復元または完全削除。</li>
          <li><strong>コンフリクトバックアップ管理</strong> — コンフリクトバックアップファイルの表示と復元。</li>
          <li><strong>ファイルツリーの再構築</strong> — Driveを再スキャンして同期メタデータを修復。</li>
          <li><strong>未追跡ファイルの検出</strong> — ローカルキャッシュにないリモートファイルを検出。</li>
        </ul>

        <h2>ゴミ箱</h2>
        <p>
          ファイルを削除するとDrive上の<code>trash/</code>フォルダに移動します（ソフトデリート）。設定 &gt; 同期から復元または完全削除できます。
        </p>

        <h2>オフライン使用</h2>
        <p>
          オフライン時もキャッシュ済みファイルの編集を続けられます。ヘッダーにオフラインインジケータが表示されます。接続が復旧するまで同期機能は無効です。オンラインになったらドライブ反映で変更をアップロードします。
        </p>
      </div>
    </>
  );
}
