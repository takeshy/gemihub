import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function PremiumChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <PremiumJa />;
  return <PremiumEn />;
}

function PremiumEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Premium Plan</h1>
      <div className={prose}>
        <p>
          GemiHub&apos;s Premium plan transforms it into a web app builder with Google Sheets/Gmail integration, static page hosting, scheduled workflows, and custom domain support.
        </p>

        <h2>Plans</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-300 dark:border-gray-600">
                <th className="py-2 text-left">Feature</th>
                <th className="py-2 text-center">Free</th>
                <th className="py-2 text-center">Lite (¥300/mo)</th>
                <th className="py-2 text-center">Pro (¥2,000/mo)</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Max File Size</td><td className="text-center">20 MB</td><td className="text-center">5 GB</td><td className="text-center">5 GB</td></tr>
              <tr><td>Interactions API Chat</td><td className="text-center">—</td><td className="text-center">✓</td><td className="text-center">✓</td></tr>
              <tr><td>Gmail Send</td><td className="text-center">—</td><td className="text-center">✓</td><td className="text-center">✓</td></tr>
              <tr><td>PDF Generation</td><td className="text-center">—</td><td className="text-center">✓</td><td className="text-center">✓</td></tr>
              <tr><td>Obsidian Sync Token</td><td className="text-center">—</td><td className="text-center">✓</td><td className="text-center">✓</td></tr>
              <tr><td>Temp Upload URL</td><td className="text-center">—</td><td className="text-center">✓</td><td className="text-center">✓</td></tr>
              <tr><td>Google Sheets CRUD</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✓</td></tr>
              <tr><td>Static Page Hosting (CDN)</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✓</td></tr>
              <tr><td>Custom Domains (auto SSL)</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✓</td></tr>
              <tr><td>Scheduled Workflows</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✓</td></tr>
              <tr><td>Server-Side Execution</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✓</td></tr>
              <tr><td>AI Web Builder</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✓</td></tr>
            </tbody>
          </table>
        </div>

        <h2>Getting Started</h2>
        <ol>
          <li>Open <strong>Settings &gt; Premium Plan</strong> and click <strong>Subscribe</strong>.</li>
          <li>Complete payment on the Stripe checkout page.</li>
          <li>Return to Settings — Premium features are automatically enabled.</li>
        </ol>
        <p>
          Manage your subscription (cancel, update payment method) from the Stripe Billing Portal link in the Premium Plan settings tab.
        </p>

        <h2>Lite Plan Features</h2>

        <h3>Interactions API Chat</h3>
        <p>
          Multi-round AI chat via a server-side proxy. Unlike the free plan&apos;s direct Gemini API calls, the Interactions API supports function calling, RAG, and web search simultaneously in a single conversation.
        </p>

        <h3>Gmail Send</h3>
        <p>
          Send emails from workflows using the <code>gmail-send</code> node. Specify recipient, subject, and HTML body. Useful for notifications, reports, and automated emails.
        </p>

        <h3>PDF Generation</h3>
        <p>
          Generate PDF files from Markdown or HTML within workflows. Ideal for invoices, reports, and certificates.
        </p>

        <h3>Obsidian Sync Token</h3>
        <p>
          A migration token that allows syncing GemiHub files with Obsidian or other external editors.
        </p>

        <h3>Temp Upload URL</h3>
        <p>
          Generate temporary URLs for file uploads. External tools can read and write files via these time-limited URLs without authentication.
        </p>

        <h2>Pro Plan Features</h2>
        <p>All Lite features are included in the Pro plan.</p>

        <h3>Google Sheets CRUD</h3>
        <p>
          Four workflow nodes for Google Sheets operations:
        </p>
        <ul>
          <li><strong>sheet-read</strong> — Read rows with optional filter and limit.</li>
          <li><strong>sheet-write</strong> — Append rows to a sheet.</li>
          <li><strong>sheet-update</strong> — Update rows matching a filter.</li>
          <li><strong>sheet-delete</strong> — Delete rows matching a filter.</li>
        </ul>
        <p>
          Configure the Spreadsheet ID in <strong>Settings &gt; Premium Plan</strong>. Sheets nodes use the tab name and JSON filter syntax.
        </p>

        <h3>Static Page Hosting</h3>
        <p>
          Files in the <code>web/</code> folder on Drive are served as static pages via Cloud CDN. Every account gets a built-in subdomain (<code>{"{accountSlug}"}.gemihub.net</code>) immediately.
        </p>
        <p>File-based routing:</p>
        <ul>
          <li><code>web/index.html</code> → <code>/</code></li>
          <li><code>web/about.html</code> → <code>/about</code></li>
          <li><code>web/users/[id].html</code> → <code>/users/123</code> (dynamic route)</li>
        </ul>
        <p>
          Any static asset (HTML, CSS, JS, images, fonts) is supported. MIME types are auto-detected. No publish step needed — files go live after Push to Drive.
        </p>

        <h3>Custom Domains</h3>
        <p>
          Add a custom domain with automatic SSL certificate provisioning:
        </p>
        <ol>
          <li>Enter your domain in <strong>Settings &gt; Premium Plan &gt; Custom Domain</strong>.</li>
          <li>Create the CNAME DNS record shown in the instructions.</li>
          <li>Google verifies DNS and provisions an SSL certificate automatically.</li>
        </ol>
        <p>
          Domain status transitions: <code>pending_dns</code> → <code>provisioning_cert</code> → <code>active</code>. The built-in subdomain continues to work while the custom domain is being set up.
        </p>

        <h3>Authentication</h3>
        <p>
          Multi-type magic link authentication for hosted pages. Each account type (e.g., &quot;talent&quot;, &quot;company&quot;) has an independent session. Authentication is configured via Google Sheets — define which sheet and email column to use for each type.
        </p>
        <p>
          Include the client helper script to use authentication in your pages:
        </p>
        <pre><code>{`<script src="/__gemihub/api.js"></script>
<script>
  (async () => {
    const user = await gemihub.auth.require("talent");
    document.getElementById("app").innerHTML = \`Welcome, \${user.email}\`;
  })();
</script>`}</code></pre>

        <h3>Scheduled Workflows</h3>
        <p>
          Run workflows on a cron schedule. Configure in <strong>Settings &gt; Premium Plan &gt; Schedules</strong>:
        </p>
        <ul>
          <li><strong>Cron expression</strong> — 5-field format (minute, hour, day, month, weekday).</li>
          <li><strong>Timezone</strong> — IANA timezone (e.g., <code>Asia/Tokyo</code>).</li>
          <li><strong>Variables</strong> — Pass variables to the workflow at execution time.</li>
          <li><strong>Retry</strong> — Automatic retry on failure (deferred to subsequent ticks).</li>
          <li><strong>Timeout</strong> — Execution timeout (default 300s, max 600s).</li>
          <li><strong>Concurrency policy</strong> — Allow or forbid overlapping runs.</li>
        </ul>

        <h3>Server-Side Execution</h3>
        <p>
          The <code>script</code> workflow node can execute JavaScript server-side using an isolated V8 sandbox. Each execution runs in a fresh isolate with a 128 MB memory limit and no network/filesystem access.
        </p>

        <h3>AI Web Builder</h3>
        <p>
          A built-in Agent Skill that builds entire websites — pages, workflow APIs, schemas, mocks, even admin screens — from a chat conversation. See the <strong>AI Web Builder</strong> chapter for activation, the Plan → Approval flow, and the conventions the AI enforces.
        </p>
      </div>
    </>
  );
}

function PremiumJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">プレミアムプラン</h1>
      <div className={prose}>
        <p>
          GemiHubのプレミアムプランです。Google Sheets/Gmail連携、静的ページホスティング、スケジュール実行、カスタムドメインなどの機能により、Webアプリビルダーとして利用できます。
        </p>

        <h2>プラン一覧</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-300 dark:border-gray-600">
                <th className="py-2 text-left">機能</th>
                <th className="py-2 text-center">Free</th>
                <th className="py-2 text-center">Lite（¥300/月）</th>
                <th className="py-2 text-center">Pro（¥2,000/月）</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>1ファイル最大サイズ</td><td className="text-center">20 MB</td><td className="text-center">5 GB</td><td className="text-center">5 GB</td></tr>
              <tr><td>Interactions API チャット</td><td className="text-center">—</td><td className="text-center">✓</td><td className="text-center">✓</td></tr>
              <tr><td>Gmail 送信</td><td className="text-center">—</td><td className="text-center">✓</td><td className="text-center">✓</td></tr>
              <tr><td>PDF 生成</td><td className="text-center">—</td><td className="text-center">✓</td><td className="text-center">✓</td></tr>
              <tr><td>Obsidian 同期トークン</td><td className="text-center">—</td><td className="text-center">✓</td><td className="text-center">✓</td></tr>
              <tr><td>一時アップロードURL</td><td className="text-center">—</td><td className="text-center">✓</td><td className="text-center">✓</td></tr>
              <tr><td>Google Sheets CRUD</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✓</td></tr>
              <tr><td>静的ページホスティング（CDN）</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✓</td></tr>
              <tr><td>カスタムドメイン（自動SSL）</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✓</td></tr>
              <tr><td>スケジュール実行</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✓</td></tr>
              <tr><td>サーバーサイド実行</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✓</td></tr>
              <tr><td>AI Webビルダー</td><td className="text-center">—</td><td className="text-center">—</td><td className="text-center">✓</td></tr>
            </tbody>
          </table>
        </div>

        <h2>はじめ方</h2>
        <ol>
          <li><strong>設定 &gt; プレミアムプラン</strong> を開き、<strong>Subscribe</strong>をクリック。</li>
          <li>Stripeの決済ページで支払いを完了。</li>
          <li>設定に戻ると、プレミアム機能が自動的に有効化されます。</li>
        </ol>
        <p>
          サブスクリプションの管理（解約、支払い方法の変更）は、プレミアムプラン設定タブのStripe Billing Portalリンクから行えます。
        </p>

        <h2>Liteプランの機能</h2>

        <h3>Interactions API チャット</h3>
        <p>
          サーバー経由のマルチラウンドAIチャット。無料プランのブラウザ直接API呼び出しと異なり、ファンクションコール・RAG・Web検索を1つの会話で同時に利用できます。
        </p>

        <h3>Gmail 送信</h3>
        <p>
          ワークフローの<code>gmail-send</code>ノードでメールを送信します。宛先、件名、HTML本文を指定可能。通知、レポート、自動メールに活用できます。
        </p>

        <h3>PDF 生成</h3>
        <p>
          ワークフロー内でMarkdownやHTMLからPDFファイルを生成します。請求書、レポート、証明書の作成に最適です。
        </p>

        <h3>Obsidian 同期トークン</h3>
        <p>
          GemiHubのファイルをObsidianなどの外部エディタと同期するためのトークンです。
        </p>

        <h3>一時アップロードURL</h3>
        <p>
          ファイルアップロード用の一時URLを生成します。外部ツールから認証なしで時間制限付きのファイル読み書きが可能です。
        </p>

        <h2>Proプランの機能</h2>
        <p>Liteプランの全機能がProプランに含まれます。</p>

        <h3>Google Sheets CRUD</h3>
        <p>
          Google Sheets操作用の4つのワークフローノード：
        </p>
        <ul>
          <li><strong>sheet-read</strong> — フィルタやリミット付きで行を読み取り。</li>
          <li><strong>sheet-write</strong> — シートに行を追加。</li>
          <li><strong>sheet-update</strong> — フィルタに一致する行を更新。</li>
          <li><strong>sheet-delete</strong> — フィルタに一致する行を削除。</li>
        </ul>
        <p>
          <strong>設定 &gt; プレミアムプラン</strong> でスプレッドシートIDを設定します。Sheetsノードはタブ名とJSONフィルタ構文を使用します。
        </p>

        <h3>静的ページホスティング</h3>
        <p>
          Driveの<code>web/</code>フォルダ内のファイルがCloud CDN経由で静的ページとして配信されます。アカウント作成時にサブドメイン（<code>{"{accountSlug}"}.gemihub.net</code>）が即時発行されます。
        </p>
        <p>ファイルベースルーティング：</p>
        <ul>
          <li><code>web/index.html</code> → <code>/</code></li>
          <li><code>web/about.html</code> → <code>/about</code></li>
          <li><code>web/users/[id].html</code> → <code>/users/123</code>（動的ルート）</li>
        </ul>
        <p>
          HTML、CSS、JS、画像、フォントなど、あらゆる静的アセットに対応。MIMEタイプは自動検出されます。公開ステップは不要 — ドライブ反映後すぐにファイルが公開されます。
        </p>

        <h3>カスタムドメイン</h3>
        <p>
          自動SSL証明書付きのカスタムドメインを追加：
        </p>
        <ol>
          <li><strong>設定 &gt; プレミアムプラン &gt; カスタムドメイン</strong>にドメインを入力。</li>
          <li>表示されるCNAME DNSレコードを登録。</li>
          <li>GoogleがDNSを検証し、SSL証明書を自動発行します。</li>
        </ol>
        <p>
          ドメインステータス：<code>pending_dns</code> → <code>provisioning_cert</code> → <code>active</code>。カスタムドメインの設定中も、サブドメインは引き続き利用可能です。
        </p>

        <h3>認証</h3>
        <p>
          ホスティングページ向けのマルチタイプ・マジックリンク認証。各アカウントタイプ（例：「talent」「company」）は独立したセッションを持ちます。認証はGoogle Sheetsで設定 — タイプごとに使用するシートとメールカラムを定義します。
        </p>
        <p>
          ページで認証を使用するには、クライアントヘルパースクリプトを読み込みます：
        </p>
        <pre><code>{`<script src="/__gemihub/api.js"></script>
<script>
  (async () => {
    const user = await gemihub.auth.require("talent");
    document.getElementById("app").innerHTML = \`Welcome, \${user.email}\`;
  })();
</script>`}</code></pre>

        <h3>スケジュール実行</h3>
        <p>
          cronスケジュールでワークフローを自動実行。<strong>設定 &gt; プレミアムプラン &gt; スケジュール</strong>で設定：
        </p>
        <ul>
          <li><strong>cron式</strong> — 5フィールド形式（分、時、日、月、曜日）。</li>
          <li><strong>タイムゾーン</strong> — IANAタイムゾーン（例：<code>Asia/Tokyo</code>）。</li>
          <li><strong>変数</strong> — 実行時にワークフローへ変数を渡す。</li>
          <li><strong>リトライ</strong> — 失敗時の自動再試行（次回のスケジューラ実行時に繰り延べ）。</li>
          <li><strong>タイムアウト</strong> — 実行タイムアウト（デフォルト300秒、最大600秒）。</li>
          <li><strong>同時実行ポリシー</strong> — 重複実行を許可または禁止。</li>
        </ul>

        <h3>サーバーサイド実行</h3>
        <p>
          ワークフローの<code>script</code>ノードをサーバーサイドのV8サンドボックスで実行可能。各実行は新しいアイソレートで行われ、128MBのメモリ制限、ネットワーク/ファイルシステムアクセスなしの環境です。
        </p>

        <h3>AI Webビルダー</h3>
        <p>
          チャットだけでウェブサイト一式 — ページ、ワークフロー API、スキーマ、モック、管理画面まで — を生成する組み込み Agent Skill。有効化方法、Plan → Approval フロー、AI が守る規約の詳細は <strong>AI Webビルダー</strong>章を参照してください。
        </p>
      </div>
    </>
  );
}
