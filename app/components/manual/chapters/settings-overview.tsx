import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function SettingsOverviewChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <SettingsJa />;
  return <SettingsEn />;
}

function SettingsEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Settings Overview</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/setting_general.png" alt="Settings page" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          The Settings page is accessible from the gear icon in the IDE header. Settings are stored as <code>settings.json</code> in your Drive <code>gemihub/</code> folder and synced across devices.
        </p>

        <h2>General</h2>
        <ul>
          <li><strong>Gemini API Key</strong> — Your API key for Gemini services.</li>
          <li><strong>API Plan</strong> — Free or Paid (determines available models).</li>
          <li><strong>Default Model</strong> — The default Gemini model for chat and workflows.</li>
          <li><strong>System Prompt</strong> — Custom instructions for the AI across all conversations.</li>
          <li><strong>Language</strong> — Interface language (English / Japanese).</li>
          <li><strong>Font Size</strong> — Editor font size.</li>
          <li><strong>Theme</strong> — Light / Dark / System.</li>
          <li><strong>Password &amp; Encryption</strong> — Set a password for API key encryption and file encryption features.</li>
          <li><strong>Encrypt Chat / Workflow History</strong> — Toggle encryption for saved histories.</li>
        </ul>

        <h2>MCP Servers</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_mcp.png" alt="MCP settings" className="w-full" loading="lazy" />
        </figure>
        <ul>
          <li>Add, edit, and remove MCP server connections.</li>
          <li>Test connections and view available tools.</li>
          <li>OAuth authentication management.</li>
        </ul>

        <h2>RAG</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_rag.png" alt="RAG settings" className="w-full" loading="lazy" />
        </figure>
        <ul>
          <li>Add and manage RAG store configurations (Internal / External).</li>
          <li>Configure target folders and exclude patterns.</li>
          <li>Sync files to RAG stores.</li>
          <li>Enable auto-registration on Push to Drive.</li>
          <li>Set Top-K result count.</li>
        </ul>

        <h2>Plugins</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_plugin.png" alt="Plugin settings" className="w-full" loading="lazy" />
        </figure>
        <ul>
          <li>Install plugins from GitHub repositories.</li>
          <li>Enable, disable, update, and uninstall plugins.</li>
          <li>Access plugin-specific settings.</li>
        </ul>

        <h2>Commands</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_command.png" alt="Command settings" className="w-full" loading="lazy" />
        </figure>
        <ul>
          <li>Create custom slash commands for the chat.</li>
          <li>Define prompt templates with <code>{"{content}"}</code>, <code>{"{selection}"}</code>, and <code>@filename</code> variables.</li>
          <li>Override model, search settings, Drive tool mode, and MCP servers per command.</li>
        </ul>

        <h2>Shortcuts</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_shortcut.png" alt="Shortcut settings" className="w-full" loading="lazy" />
        </figure>
        <ul>
          <li>Assign keyboard shortcuts to execute workflows.</li>
          <li>Supports Ctrl/Cmd + key, Alt + key, and function keys (F1–F12).</li>
          <li>Background execution option (no workflow panel needed).</li>
        </ul>

        <h2>Premium Plan</h2>
        <ul>
          <li>Subscribe to Lite or Pro plan via Stripe.</li>
          <li>Configure Spreadsheet ID for Google Sheets nodes.</li>
          <li>Set up custom domain and view domain status.</li>
          <li>Manage scheduled workflows (cron, timezone, retry, timeout).</li>
          <li>Access Stripe Billing Portal for subscription management.</li>
        </ul>

        <h2>Sync</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_sync.png" alt="Sync settings" className="w-full" loading="lazy" />
        </figure>
        <ul>
          <li>View sync status and last sync time.</li>
          <li>Full Push to Drive / Pull to Local operations.</li>
          <li>Trash management and conflict backup management.</li>
          <li>Edit history pruning and statistics.</li>
          <li>File tree rebuild and untracked file detection.</li>
        </ul>
      </div>
    </>
  );
}

function SettingsJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">設定一覧</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/setting_general.png" alt="設定ページ" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          設定ページはIDEヘッダーのギアアイコンからアクセスできます。設定はDriveの<code>gemihub/</code>フォルダに<code>settings.json</code>として保存され、デバイス間で同期されます。
        </p>

        <h2>一般</h2>
        <ul>
          <li><strong>Gemini APIキー</strong> — GeminiサービスのAPIキー。</li>
          <li><strong>APIプラン</strong> — 無料または有料（利用可能なモデルが決定）。</li>
          <li><strong>デフォルトモデル</strong> — チャットとワークフローのデフォルトGeminiモデル。</li>
          <li><strong>システムプロンプト</strong> — すべての会話に適用されるAIへのカスタム指示。</li>
          <li><strong>言語</strong> — インターフェース言語（英語 / 日本語）。</li>
          <li><strong>フォントサイズ</strong> — エディタのフォントサイズ。</li>
          <li><strong>テーマ</strong> — ライト / ダーク / システム。</li>
          <li><strong>パスワード & 暗号化</strong> — APIキー暗号化とファイル暗号化機能のパスワード設定。</li>
          <li><strong>チャット / ワークフロー履歴の暗号化</strong> — 保存される履歴の暗号化切り替え。</li>
        </ul>

        <h2>MCPサーバー</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_mcp.png" alt="MCP設定" className="w-full" loading="lazy" />
        </figure>
        <ul>
          <li>MCPサーバー接続の追加、編集、削除。</li>
          <li>接続テストと利用可能なツールの確認。</li>
          <li>OAuth認証の管理。</li>
        </ul>

        <h2>RAG</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_rag.png" alt="RAG設定" className="w-full" loading="lazy" />
        </figure>
        <ul>
          <li>RAGストア設定の追加と管理（内部 / 外部）。</li>
          <li>対象フォルダと除外パターンの設定。</li>
          <li>RAGストアへのファイル同期。</li>
          <li>ドライブ反映時の自動登録の有効化。</li>
          <li>Top-K結果数の設定。</li>
        </ul>

        <h2>プラグイン</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_plugin.png" alt="プラグイン設定" className="w-full" loading="lazy" />
        </figure>
        <ul>
          <li>GitHubリポジトリからプラグインをインストール。</li>
          <li>プラグインの有効化、無効化、更新、アンインストール。</li>
          <li>プラグイン固有の設定にアクセス。</li>
        </ul>

        <h2>コマンド</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_command.png" alt="コマンド設定" className="w-full" loading="lazy" />
        </figure>
        <ul>
          <li>チャット用のカスタムスラッシュコマンドを作成。</li>
          <li><code>{"{content}"}</code>、<code>{"{selection}"}</code>、<code>@ファイル名</code>変数を使ったプロンプトテンプレートを定義。</li>
          <li>コマンドごとにモデル、検索設定、Driveツールモード、MCPサーバーを上書き。</li>
        </ul>

        <h2>ショートカット</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_shortcut.png" alt="ショートカット設定" className="w-full" loading="lazy" />
        </figure>
        <ul>
          <li>キーボードショートカットにワークフロー実行を割り当て。</li>
          <li>Ctrl/Cmd + キー、Alt + キー、ファンクションキー（F1〜F12）に対応。</li>
          <li>バックグラウンド実行オプション（ワークフローパネル不要）。</li>
        </ul>

        <h2>プレミアムプラン</h2>
        <ul>
          <li>StripeでLiteまたはProプランに登録。</li>
          <li>Google Sheetsノード用のスプレッドシートIDを設定。</li>
          <li>カスタムドメインの設定とドメインステータスの確認。</li>
          <li>スケジュール実行の管理（cron、タイムゾーン、リトライ、タイムアウト）。</li>
          <li>Stripe Billing Portalでサブスクリプション管理。</li>
        </ul>

        <h2>同期</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_sync.png" alt="同期設定" className="w-full" loading="lazy" />
        </figure>
        <ul>
          <li>同期ステータスと最終同期時刻の確認。</li>
          <li>完全ドライブ反映 / 完全ローカル反映操作。</li>
          <li>ゴミ箱管理とコンフリクトバックアップ管理。</li>
          <li>編集履歴の整理と統計。</li>
          <li>ファイルツリーの再構築と未追跡ファイルの検出。</li>
        </ul>
      </div>
    </>
  );
}
