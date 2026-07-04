import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function PluginsChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <PluginsJa />;
  return <PluginsEn />;
}

function PluginsEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Plugins</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/setting_plugin.png" alt="Plugin settings" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          Plugins extend GemiHub with custom features. They are installed from GitHub releases and stored in your Drive.
        </p>

        <h2>Installing a Plugin</h2>
        <ol>
          <li>Go to <strong>Settings &gt; Plugins</strong>.</li>
          <li>Enter the GitHub repository in the format <code>owner/repo</code> (e.g., <code>takeshy/hub-ronginus</code>).</li>
          <li>Click <strong>Install</strong>.</li>
          <li>The plugin files are downloaded from the latest GitHub release and stored on your Drive.</li>
        </ol>

        <h2>Managing Plugins</h2>
        <ul>
          <li><strong>Enable / Disable</strong> — Toggle plugins on or off without uninstalling.</li>
          <li><strong>Update</strong> — Pull the latest release from GitHub.</li>
          <li><strong>Uninstall</strong> — Remove the plugin and all its data.</li>
          <li><strong>Settings</strong> — Some plugins provide custom settings tabs.</li>
        </ul>

        <h2>External Skills</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/external_skills_first.png" alt="External skills section in the Plugins tab" className="w-full" loading="lazy" />
        </figure>
        <p>
          The Plugins tab also hosts <strong>External skills</strong> — Agent Skills imported from the official <code>llm-hub-skills</code> repository into your Drive <code>skills/</code> folder. Click <strong>Load catalog</strong> to fetch the list of available skills, then <strong>Install</strong> the ones you want.
        </p>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/external_skills.png" alt="External skills catalog with the OKF Authoring skill" className="w-full" loading="lazy" />
        </figure>
        <p>
          For example, the <strong>OKF Authoring</strong> skill teaches the AI to turn folders of notes into OKF knowledge bundles. Installed skills appear in the skill selector above the chat input like any other Agent Skill.
        </p>

        <h2>Plugin Capabilities</h2>
        <p>Plugins can:</p>
        <ul>
          <li>Add custom sidebar views and main editor views.</li>
          <li>Register slash commands for the chat.</li>
          <li>Add custom settings tabs.</li>
          <li>Access the Gemini AI API.</li>
          <li>Read and write Drive files.</li>
          <li>Use scoped persistent storage on Drive.</li>
        </ul>

        <h2>Example: Ronginus</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/ronginus.png" alt="Ronginus debate plugin" className="w-full" loading="lazy" />
        </figure>
        <p>
          <strong>Ronginus</strong> is a debate plugin where multiple AIs discuss a topic from different perspectives. You can also participate as a debater. Install it with <code>takeshy/hub-ronginus</code>.
        </p>

        <h2>Developing Plugins</h2>
        <p>
          Plugins consist of a <code>manifest.json</code>, <code>main.js</code>, and optional <code>styles.css</code>. They receive a <code>PluginAPI</code> with access to language settings, UI registration, Gemini AI, Drive operations, and scoped storage. See the developer documentation for details.
        </p>
      </div>
    </>
  );
}

function PluginsJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">プラグイン</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/setting_plugin.png" alt="プラグイン設定" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          プラグインはGemiHubにカスタム機能を追加します。GitHubリリースからインストールされ、Driveに保存されます。
        </p>

        <h2>プラグインのインストール</h2>
        <ol>
          <li><strong>設定 &gt; プラグイン</strong>に移動。</li>
          <li>GitHubリポジトリを<code>owner/repo</code>形式で入力（例: <code>takeshy/hub-ronginus</code>）。</li>
          <li><strong>インストール</strong>をクリック。</li>
          <li>プラグインファイルがGitHubの最新リリースからダウンロードされ、Driveに保存されます。</li>
        </ol>

        <h2>プラグインの管理</h2>
        <ul>
          <li><strong>有効化 / 無効化</strong> — アンインストールせずにプラグインのオン/オフを切り替え。</li>
          <li><strong>更新</strong> — GitHubから最新リリースを取得。</li>
          <li><strong>アンインストール</strong> — プラグインとそのデータをすべて削除。</li>
          <li><strong>設定</strong> — 一部のプラグインはカスタム設定タブを提供。</li>
        </ul>

        <h2>External Skills（外部スキル）</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/external_skills_first.png" alt="プラグインタブのExternal skillsセクション" className="w-full" loading="lazy" />
        </figure>
        <p>
          プラグインタブには<strong>External skills</strong>もあります。公式の<code>llm-hub-skills</code>リポジトリからAgent SkillsをDriveの<code>skills/</code>フォルダにインポートする機能です。<strong>Load catalog</strong>をクリックして利用可能なスキルの一覧を取得し、使いたいものを<strong>Install</strong>します。
        </p>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/external_skills.png" alt="OKF AuthoringスキルのあるExternal skillsカタログ" className="w-full" loading="lazy" />
        </figure>
        <p>
          たとえば<strong>OKF Authoring</strong>スキルをインストールすると、ノートのフォルダをOKFナレッジバンドルに変換する方法をAIが習得します。インストールしたスキルは、他のAgent Skillと同様にチャット入力欄の上のスキルセレクタに表示されます。
        </p>

        <h2>プラグインの機能</h2>
        <p>プラグインは以下のことができます：</p>
        <ul>
          <li>カスタムサイドバービューやメインエディタビューの追加。</li>
          <li>チャット用スラッシュコマンドの登録。</li>
          <li>カスタム設定タブの追加。</li>
          <li>Gemini AI APIへのアクセス。</li>
          <li>Driveファイルの読み書き。</li>
          <li>Drive上のスコープ付き永続ストレージの使用。</li>
        </ul>

        <h2>例：Ronginus</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/ronginus.png" alt="Ronginusディベートプラグイン" className="w-full" loading="lazy" />
        </figure>
        <p>
          <strong>Ronginus</strong>は、複数のAIがテーマについてそれぞれの視点で議論するディベートプラグインです。ユーザーも参加できます。<code>takeshy/hub-ronginus</code>でインストールできます。
        </p>

        <h2>プラグインの開発</h2>
        <p>
          プラグインは<code>manifest.json</code>、<code>main.js</code>、オプションの<code>styles.css</code>で構成されます。<code>PluginAPI</code>を通じて言語設定、UI登録、Gemini AI、Drive操作、スコープ付きストレージにアクセスできます。詳細は開発者ドキュメントを参照してください。
        </p>
      </div>
    </>
  );
}
