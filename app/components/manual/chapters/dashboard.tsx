import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function DashboardChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <DashboardJa />;
  return <DashboardEn />;
}

function DashboardEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Dashboards</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/dashboard_en.png" alt="GemiHub dashboard" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          The home screen can be a customizable dashboard saved as a plain <code>.dashboard</code> file in your Drive. A dashboard is a grid of widgets for notes, folder views, kanban boards, workflow output, and web embeds.
        </p>

        <h2>Creating and Editing</h2>
        <ul>
          <li>Open the home screen or a <code>.dashboard</code> file.</li>
          <li>Click <strong>Edit</strong> to show widget controls.</li>
          <li>Use <strong>Add widget</strong> to add file, base, kanban, calendar, Timeline, workflow, web, memo-list, or secret-manager widgets.</li>
          <li>Drag widgets to move them and drag the corner to resize.</li>
          <li>Use Undo / Redo for layout changes. Changes are saved automatically.</li>
        </ul>

        <figure>
          <img src="/images/dashboard_edit.png" alt="Dashboard edit mode" loading="lazy" />
        </figure>

        <h2>Widget Types</h2>
        <ul>
          <li><strong>Markdown</strong> — Embed and edit an existing Markdown file by Drive path.</li>
          <li><strong>File list</strong> — Show files from a folder with view-time filter and sort controls.</li>
          <li><strong>Card / Table</strong> — Render Markdown files from a folder using frontmatter fields. Table cells can edit frontmatter inline.</li>
          <li><strong>Kanban</strong> — Group Markdown files by a status property. Create new cards from the board header or drag cards between columns to update frontmatter.</li>
          <li><strong>Calendar</strong> — See local events and Timeline activity by month, and explicitly reflect Google Calendar events for the visible month.</li>
          <li><strong>Workflow</strong> — Run a workflow and render its output as cards, a table, Markdown, or HTML. Use auto-refresh for recurring reports.</li>
          <li><strong>Base</strong> — Render a view from a <code>.base</code> file. If <code>view</code> is empty, the first view is used.</li>
          <li><strong>Web</strong> — Embed an external page in an iframe.</li>
        </ul>

        <h2>Calendar</h2>
        <figure>
          <img src="/images/dashboard_calendar_en.png" alt="Calendar day modal opened from the Launcher" loading="lazy" />
        </figure>
        <p>
          Click <strong>Google events</strong> to fetch events for the month currently shown. The result is cached by month in this browser, so it remains available after opening another file or returning from the Launcher; use the button again when you want fresh data. Clicking a date opens its events and Timeline activity in a modal without enlarging the calendar. Use <strong>Add event</strong> to create a local event. Escape closes the day modal first while leaving the Launcher open.
        </p>

        <h2>Workflow Widgets</h2>
        <figure>
          <img src="/images/dashboard_workflow.png" alt="Dashboard workflow widget" loading="lazy" />
        </figure>
        <p>
          Workflow widgets read from a cache until you run them. Click <strong>Run</strong> in settings or <strong>Refresh</strong> in the widget header to execute the workflow. The output is saved in a sidecar cache file so dashboards open quickly.
        </p>

        <h2>Kanban Boards</h2>
        <figure>
          <img src="/images/dashboard_kanban.png" alt="Dashboard kanban board" loading="lazy" />
        </figure>
        <p>
          Kanban widgets work directly with Markdown files. Configure a folder, a status property, and columns. Dragging a card writes the new status back to the file frontmatter.
        </p>

        <h2>Raw YAML</h2>
        <p>
          Dashboards can also be edited as YAML. File references are path-based where possible, so files can be written by hand and synchronized with Obsidian-oriented tooling.
        </p>
      </div>
    </>
  );
}

function DashboardJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">ダッシュボード</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/dashboard.png" alt="GemiHub ダッシュボード" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          ホーム画面は自由に編集できるダッシュボードにできます。ダッシュボードは Drive 内の <code>.dashboard</code> ファイルとして保存され、ノート、フォルダビュー、カンバン、ワークフロー出力、Web 埋め込みをグリッドに配置できます。
        </p>

        <h2>作成と編集</h2>
        <ul>
          <li>ホーム画面、または <code>.dashboard</code> ファイルを開きます。</li>
          <li><strong>編集</strong>を押すと、ウィジェット操作が表示されます。</li>
          <li><strong>ウィジェットを追加</strong>からファイル、Base、カンバン、カレンダー、タイムライン、ワークフロー、Web、メモ一覧、シークレット管理を追加できます。</li>
          <li>ドラッグで移動し、右下のハンドルでサイズ変更します。</li>
          <li>レイアウト変更は Undo / Redo できます。変更は自動保存されます。</li>
        </ul>

        <figure>
          <img src="/images/dashboard_edit.png" alt="ダッシュボード編集モード" loading="lazy" />
        </figure>

        <h2>ウィジェットの種類</h2>
        <ul>
          <li><strong>Markdown</strong> — 既存 Markdown ファイルを Drive パスで参照し、インライン編集します。</li>
          <li><strong>ファイル一覧</strong> — フォルダ内のファイルを表示し、表示時だけのフィルター・ソートを使えます。</li>
          <li><strong>カード / テーブル</strong> — フォルダ内 Markdown の frontmatter を使って表示します。テーブルでは frontmatter を直接編集できます。</li>
          <li><strong>カンバン</strong> — status などのプロパティで Markdown を列に分けます。カード作成やドラッグ移動は frontmatter に書き戻されます。</li>
          <li><strong>カレンダー</strong> — 月ごとにローカル予定とタイムラインの活動を確認し、表示中の月にGoogle Calendarの予定を反映できます。</li>
          <li><strong>ワークフロー</strong> — ワークフローを実行し、結果をカード、テーブル、Markdown、HTML で表示します。定期更新も設定できます。</li>
          <li><strong>Base</strong> — <code>.base</code> ファイルのビューを表示します。<code>view</code> が空なら最初のビューを使います。</li>
          <li><strong>Web</strong> — 外部ページを iframe で埋め込みます。</li>
        </ul>

        <h2>カレンダー</h2>
        <figure>
          <img src="/images/dashboard_calendar.png" alt="Launcherから開いたカレンダーの日付モーダル" loading="lazy" />
        </figure>
        <p>
          <strong>Google予定</strong>を押すと、表示中の月だけを取得します。結果は月単位でこのブラウザにキャッシュされるため、別ファイルを開いた後やLauncherから戻った後も残ります。最新の予定が必要なときは、もう一度ボタンを押してください。日付を押すと、カレンダーを大きくせず、その日の予定とタイムラインがモーダルで開きます。ローカル予定は<strong>予定を追加</strong>から登録できます。Launcher内では、Escを押すと先に日付モーダルだけが閉じます。
        </p>

        <h2>ワークフローウィジェット</h2>
        <figure>
          <img src="/images/dashboard_workflow.png" alt="ダッシュボード ワークフローウィジェット" loading="lazy" />
        </figure>
        <p>
          ワークフローウィジェットは、実行結果をキャッシュから表示します。設定内の <strong>実行</strong>、またはウィジェットヘッダーの <strong>更新</strong> でワークフローを実行します。結果はサイドカーキャッシュに保存されるため、ダッシュボードをすばやく開けます。
        </p>

        <h2>カンバンボード</h2>
        <figure>
          <img src="/images/dashboard_kanban.png" alt="ダッシュボード カンバンボード" loading="lazy" />
        </figure>
        <p>
          カンバンウィジェットは Markdown ファイルを直接扱います。フォルダ、ステータスプロパティ、列を設定します。カードをドラッグすると、移動先のステータスがファイルの frontmatter に書き戻されます。
        </p>

        <h2>Raw YAML</h2>
        <p>
          ダッシュボードは YAML としても編集できます。ファイル参照は可能な限りパスベースなので、手書きしやすく、Obsidian 系のツールとも同期しやすくなっています。
        </p>
      </div>
    </>
  );
}
