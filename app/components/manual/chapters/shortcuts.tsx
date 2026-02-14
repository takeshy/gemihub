import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function ShortcutsChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <ShortcutsJa />;
  return <ShortcutsEn />;
}

function ShortcutsEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Keyboard Shortcuts</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/setting_shortcut.png" alt="Shortcut settings" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <h2>Built-in Shortcuts</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4 text-left font-semibold">Shortcut</th>
                <th className="py-2 text-left font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              <tr><td className="py-2 pr-4"><kbd>Ctrl+P</kbd> / <kbd>Cmd+P</kbd></td><td>Quick Open (file search)</td></tr>
              <tr><td className="py-2 pr-4"><kbd>Ctrl+Shift+F</kbd> / <kbd>Cmd+Shift+F</kbd></td><td>Open Search Panel</td></tr>
            </tbody>
          </table>
        </div>

        <h2>Custom Workflow Shortcuts</h2>
        <p>
          You can assign keyboard shortcuts to execute specific workflows. Configure them in <strong>Settings &gt; Shortcuts</strong>.
        </p>

        <h3>Adding a Shortcut</h3>
        <ul>
          <li>Click <strong>Add Shortcut</strong>.</li>
          <li>Press the desired key combination (e.g., <kbd>Ctrl+Shift+R</kbd>).</li>
          <li>Select a workflow to execute.</li>
          <li>Optionally enable <strong>Background</strong> mode to run without opening the workflow panel.</li>
        </ul>

        <h3>Key Combination Rules</h3>
        <ul>
          <li>Letter and number keys require <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> or <kbd>Alt</kbd> modifier. <kbd>Shift</kbd> alone is not sufficient.</li>
          <li>Function keys (<kbd>F1</kbd>–<kbd>F12</kbd>) can be used without modifiers.</li>
          <li>Key combinations reserved by the application (e.g., <kbd>Ctrl+Shift+F</kbd>, <kbd>Ctrl+P</kbd>) cannot be assigned.</li>
          <li>Duplicate key combinations are not allowed.</li>
        </ul>

        <h3>Background Execution</h3>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/workflow_shortcut_background.jpg" alt="Background workflow execution" className="w-full" loading="lazy" />
        </figure>
        <p>
          When <strong>Background</strong> is enabled, the workflow runs without switching to the workflow panel. Progress and completion are shown in the status bar. If the workflow has a file picker dialog, the currently open file is automatically selected.
        </p>
      </div>
    </>
  );
}

function ShortcutsJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">キーボードショートカット</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/setting_shortcut.png" alt="ショートカット設定" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <h2>組み込みショートカット</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4 text-left font-semibold">ショートカット</th>
                <th className="py-2 text-left font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              <tr><td className="py-2 pr-4"><kbd>Ctrl+P</kbd> / <kbd>Cmd+P</kbd></td><td>Quick Open（ファイル検索）</td></tr>
              <tr><td className="py-2 pr-4"><kbd>Ctrl+Shift+F</kbd> / <kbd>Cmd+Shift+F</kbd></td><td>検索パネルを開く</td></tr>
            </tbody>
          </table>
        </div>

        <h2>カスタムワークフローショートカット</h2>
        <p>
          特定のワークフローの実行にキーボードショートカットを割り当てることができます。<strong>設定 &gt; ショートカット</strong>で設定します。
        </p>

        <h3>ショートカットの追加</h3>
        <ul>
          <li><strong>ショートカットを追加</strong>をクリック。</li>
          <li>希望するキーの組み合わせを押す（例: <kbd>Ctrl+Shift+R</kbd>）。</li>
          <li>実行するワークフローを選択。</li>
          <li>オプションで<strong>バックグラウンド</strong>モードを有効にし、ワークフローパネルを開かずに実行。</li>
        </ul>

        <h3>キーの組み合わせルール</h3>
        <ul>
          <li>文字キーや数字キーには<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>または<kbd>Alt</kbd>修飾キーが必要。<kbd>Shift</kbd>のみでは不十分。</li>
          <li>ファンクションキー（<kbd>F1</kbd>〜<kbd>F12</kbd>）は修飾キーなしで使用可能。</li>
          <li>アプリケーションで予約されているキーの組み合わせ（<kbd>Ctrl+Shift+F</kbd>、<kbd>Ctrl+P</kbd>等）は割り当て不可。</li>
          <li>重複するキーの組み合わせは許可されません。</li>
        </ul>

        <h3>バックグラウンド実行</h3>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/workflow_shortcut_background.jpg" alt="バックグラウンドワークフロー実行" className="w-full" loading="lazy" />
        </figure>
        <p>
          <strong>バックグラウンド</strong>が有効な場合、ワークフローパネルに切り替えずに実行されます。進捗と完了はステータスバーに表示されます。ワークフローにファイルピッカーダイアログがある場合、現在開いているファイルが自動的に選択されます。
        </p>
      </div>
    </>
  );
}
