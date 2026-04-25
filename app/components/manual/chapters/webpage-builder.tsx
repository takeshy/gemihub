import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function WebpageBuilderChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <WebpageBuilderJa />;
  return <WebpageBuilderEn />;
}

function WebpageBuilderEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">AI Web Builder</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          <iframe
            src="https://www.youtube-nocookie.com/embed/rdVAgAhHLxk"
            title="Webpage Builder demo"
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
        <figcaption className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
          Sample: building a website end-to-end through chat.
        </figcaption>
      </figure>
      <div className={prose}>
        <p>
          The <strong>Webpage Builder</strong> is a built-in Agent Skill that ships with the Pro plan and turns the chat into an end-to-end website author. You describe what you want — a booking page, a member portal, a contact form — and the AI produces the HTML, the workflow YAML behind it, the sheet schema it needs, and the spec / change-log entries to go with it.
        </p>
        <p>
          The skill is auto-provisioned to <code>skills/webpage-builder/</code> on your Drive the first time you open the IDE on a Pro account, and is updated in place on every release. You don&apos;t install it; you just turn it on for a chat.
        </p>

        <h2>Activate</h2>
        <ol>
          <li>Open the chat panel and click the <strong>Sparkles</strong> icon next to the input.</li>
          <li>Pick <strong>Webpage Builder</strong> — a purple chip appears above the input.</li>
          <li>(Or type <code>/webpage-builder</code> at the start of your message.)</li>
        </ol>

        <h2>Plan → Approval Flow</h2>
        <p>
          Webpage Builder follows a fixed three-step protocol so you always see what is about to be created before any file lands on Drive.
        </p>
        <ol>
          <li>
            <strong>Interview.</strong> The AI asks a short list of focused questions — what the site does, which account types log in (e.g. <code>talent</code>, <code>company</code>), which sheets the data lives in, who receives notification emails. Answer in plain prose; you don&apos;t have to know the file layout.
          </li>
          <li>
            <strong>Plan.</strong> The AI replies with a numbered list of every file it will create with full <code>web/...</code> (or <code>admin/...</code>) paths — pages, workflow YAMLs, mocks, the schema delta, the spec / history entries. Nothing is written yet.
          </li>
          <li>
            <strong>Approval.</strong> Reply <code>OK</code> / <code>yes</code> / <code>進めて</code> to start file creation, or push back on the plan (&quot;split the booking form into two pages&quot;, &quot;use the existing <code>members</code> sheet, not a new one&quot;) and the AI re-plans.
          </li>
        </ol>
        <p>
          After approval, files are created one at a time via <code>create_drive_file</code>, with a Pre-Save Checklist run against each one (auth boundary, escaping, schema match, mock parity). New sheet columns are migrated through <code>migrate_spreadsheet_schema</code> before any workflow that writes them executes.
        </p>

        <h2>What It Generates</h2>
        <pre><code>{`web/
  index.html, login/talent.html, partner/...      ← public pages
  api/<endpoint>.yaml                             ← workflow APIs
    (served as /__gemihub/api/<endpoint>)
  __gemihub/
    auth/me.json                                  ← auth mock for IDE preview
    api/<endpoint>.json                           ← per-endpoint mocks
    schema.md, spec.md, history.md                ← living docs

admin/                                            ← IDE-only operator pages
  bookings.html, inquiries.html, ...              ← (see Premium Plan ch.)
  api/<endpoint>.yaml                             ← admin workflows`}</code></pre>
        <p>
          The split is deliberate: <code>web/</code> is what the public serving layer exposes on your custom domain; <code>admin/</code> is reachable only from the IDE preview, under the Drive owner&apos;s OAuth.
        </p>

        <h2>Conventions the AI Enforces</h2>
        <ul>
          <li><strong>Soft delete.</strong> Cancel / no-show / archive flips a <code>status</code> column via <code>sheet-update</code>; <code>sheet-delete</code> is never used for booking-like records.</li>
          <li><strong>Authentication ≠ authorization.</strong> Every workflow with <code>requireAuth</code> filters its <code>sheet-read</code> by <code>{`{{auth.email}}`}</code> — without the filter, any logged-in user sees every row.</li>
          <li><strong>Mocks for IDE preview.</strong> Each API endpoint gets a sample JSON at <code>web/__gemihub/api/...</code> so the iframe preview renders without hitting the network.</li>
          <li><strong>Living docs.</strong> Every iteration appends a dated entry to <code>web/__gemihub/history.md</code> and updates <code>spec.md</code>.</li>
        </ul>

        <h2>Iterating on a Generated Site</h2>
        <p>
          Open any generated file from the file tree to edit it directly — the HTML editor&apos;s preview tab renders the page against the cached mocks, so you see the result without pushing to Drive. To extend the site through the AI again, keep the Webpage Builder skill active and ask for the change in plain language; the AI re-runs the Plan → Approval flow scoped to just the diff.
        </p>
        <p>
          When the AI itself needs adjustment (your project always uses an existing <code>members</code> sheet, the welcome email should always cite a specific URL, etc.), use <strong>Modify Skill with AI</strong> from the Skill Settings to teach the persistent instructions instead of repeating them every chat.
        </p>

        <h2>Admin (Operator) Pages</h2>
        <p>
          Operator-facing screens — cancel a booking, mark a no-show, reply to an inquiry — go under <code>admin/</code> instead of <code>web/admin/</code>, so they are never served on the public domain. The Drive owner opens them from the IDE preview, where calls bridge through to <code>/api/hubwork/admin/*</code> under the IDE OAuth session. See the <strong>Admin Pages (IDE Preview)</strong> section in the Premium Plan chapter for the full bridge / security / soft-delete rules.
        </p>
      </div>
    </>
  );
}

function WebpageBuilderJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">AI Web ビルダー</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          <iframe
            src="https://www.youtube-nocookie.com/embed/rdVAgAhHLxk"
            title="Webpage Builder デモ"
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
        <figcaption className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
          サンプル: チャットでウェブサイトをエンドツーエンドに構築する様子。
        </figcaption>
      </figure>
      <div className={prose}>
        <p>
          <strong>Webpage Builder</strong> は Pro プランに同梱される組み込み Agent Skill で、チャットをウェブサイトのエンドツーエンド作成ツールに変えます。「予約ページが欲しい」「会員制ポータルを作りたい」「問い合わせフォームを置きたい」と話すだけで、AI が HTML、裏側のワークフロー YAML、必要なシートスキーマ、仕様書 / 変更履歴まで一式生成します。
        </p>
        <p>
          このスキルは Pro アカウントで初めて IDE を開いたときに <code>skills/webpage-builder/</code> へ自動プロビジョニングされ、リリースのたびに上書き更新されます。インストール作業は不要で、チャットで有効化するだけです。
        </p>

        <h2>有効化</h2>
        <ol>
          <li>チャットパネルを開き、入力欄横の<strong>Sparkles</strong>アイコンをクリック。</li>
          <li><strong>Webpage Builder</strong>を選択 — 入力欄の上に紫のチップが表示されます。</li>
          <li>（または、メッセージ冒頭に<code>/webpage-builder</code>と入力。）</li>
        </ol>

        <h2>Plan → Approval フロー</h2>
        <p>
          Webpage Builder は固定の 3 ステッププロトコルに従うため、Drive にファイルが書き込まれる前に必ず内容を確認できます。
        </p>
        <ol>
          <li>
            <strong>ヒアリング。</strong> AI が必要な情報を絞った質問で集めます — サイトの目的、ログインするアカウントタイプ（例: <code>talent</code>、<code>company</code>）、データを置くシート、通知メールの宛先など。ファイル構成を把握している必要はなく、自然な日本語で答えれば OK。
          </li>
          <li>
            <strong>プラン提示。</strong> AI が作成予定の全ファイルを <code>web/...</code> / <code>admin/...</code> のフルパス付きで番号リストとして返します — ページ、ワークフロー YAML、モック、スキーマ差分、spec / history への追記。この時点ではまだ何も書き込まれません。
          </li>
          <li>
            <strong>承認。</strong> <code>OK</code> / <code>進めて</code> / <code>yes</code> と返すと作成が始まります。プランに修正を入れたい場合（「予約フォームを 2 ページに分けて」「新規シートではなく既存の <code>members</code> シートを使って」など）はそのまま指示すれば AI が再プランします。
          </li>
        </ol>
        <p>
          承認後、ファイルは <code>create_drive_file</code> で 1 つずつ作成され、各ファイルに対して Pre-Save Checklist（認証境界、エスケープ、スキーマ整合性、モック対応）が走ります。新しいシート列が必要な場合は、書き込みワークフローの実行前に <code>migrate_spreadsheet_schema</code> でマイグレーションされます。
        </p>

        <h2>生成されるファイル</h2>
        <pre><code>{`web/
  index.html, login/talent.html, partner/...      ← 公開ページ
  api/<endpoint>.yaml                             ← ワークフロー API
    （/__gemihub/api/<endpoint> として配信）
  __gemihub/
    auth/me.json                                  ← IDE プレビュー用 auth モック
    api/<endpoint>.json                           ← エンドポイント別モック
    schema.md, spec.md, history.md                ← リビングドキュメント

admin/                                            ← IDE 専用の運営者ページ
  bookings.html, inquiries.html, ...              ← （プレミアムプラン章を参照）
  api/<endpoint>.yaml                             ← admin ワークフロー`}</code></pre>
        <p>
          この分割は意図的です: <code>web/</code> はカスタムドメインで一般公開される領域、<code>admin/</code> は IDE プレビューからしか到達できず、Drive 所有者の OAuth で動きます。
        </p>

        <h2>AI が守る規約</h2>
        <ul>
          <li><strong>ソフトデリート。</strong> キャンセル / 無断 / アーカイブは <code>sheet-update</code> で <code>status</code> 列を書き換えるだけ。予約系レコードに <code>sheet-delete</code> は使いません。</li>
          <li><strong>認証 ≠ 認可。</strong> <code>requireAuth</code> 付きワークフローは必ず <code>sheet-read</code> を <code>{`{{auth.email}}`}</code> でフィルタします — フィルタなしでは、ログイン済みユーザーが他人の行まで見えてしまいます。</li>
          <li><strong>IDE プレビュー用モック。</strong> 各 API エンドポイントには <code>web/__gemihub/api/...</code> にサンプル JSON が置かれ、iframe プレビューがネットワークに出ずにレンダリングできます。</li>
          <li><strong>リビングドキュメント。</strong> イテレーションごとに <code>web/__gemihub/history.md</code> に日付付きエントリを追加し、<code>spec.md</code> を更新します。</li>
        </ul>

        <h2>生成済みサイトの編集</h2>
        <p>
          ファイルツリーから生成済みファイルを開けば直接編集できます。HTML エディタのプレビュータブはキャッシュ済みモックを使ってページをレンダリングするので、Drive に Push しなくても結果を確認できます。AI に追加の改修を頼みたい場合は、Webpage Builder を有効にしたまま自然言語で指示すれば、差分だけを対象にした Plan → Approval フローが再走します。
        </p>
        <p>
          AI 自体の挙動を恒久的に調整したい場合（毎回既存の <code>members</code> シートを使ってほしい、ウェルカムメールには必ず特定の URL を含めたい等）は、Skill 設定の<strong>Modify Skill with AI</strong>から指示を追記すれば、毎回伝え直す必要がなくなります。
        </p>

        <h2>管理画面（運営者向けページ）</h2>
        <p>
          予約のキャンセル、無断キャンセル記録、問い合わせ返信といった運営者向け画面は、<code>web/admin/</code> ではなく <code>admin/</code> 配下に置かれるため、公開ドメインからは到達できません。Drive 所有者が IDE プレビューから操作し、リクエストは IDE の OAuth セッションで <code>/api/hubwork/admin/*</code> に橋渡しされます。橋渡しの仕組み・セキュリティ・ソフトデリート規約の詳細は、プレミアムプラン章の<strong>管理画面（IDE プレビュー）</strong>セクションを参照してください。
        </p>
      </div>
    </>
  );
}
