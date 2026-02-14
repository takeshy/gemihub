import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function EditorChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <EditorJa />;
  return <EditorEn />;
}

function EditorEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">File Editor</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/editor.png" alt="File editor" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          GemiHub includes a built-in editor that adapts to the file type. Markdown files get a full editing experience, workflow files show visual diagrams, and binary files are displayed with appropriate viewers.
        </p>

        <h2>Editing Modes (Markdown)</h2>
        <ul>
          <li><strong>Preview</strong> — Read-only rendered Markdown with syntax highlighting.</li>
          <li><strong>WYSIWYG</strong> — Rich text editing with formatting toolbar (bold, italic, headings, lists, tables, images, links).</li>
          <li><strong>Raw</strong> — Plain text editor for direct Markdown editing.</li>
        </ul>
        <p>Switch between modes using the tab bar at the top of the editor.</p>

        <h2>Workflow Editor</h2>
        <p>
          When a <code>.yaml</code> workflow file is selected, the Preview mode shows a Mermaid flowchart diagram. The Raw mode allows direct YAML editing. Workflow properties and execution controls are in the right sidebar.
        </p>

        <h2>Auto-Save</h2>
        <p>
          Changes are automatically saved to the local IndexedDB cache with a 1-second debounce (5 seconds for encrypted files). The &quot;Saved&quot; indicator appears in the top bar when changes are committed. Changes are synced to Drive via Push to Drive.
        </p>

        <h2>Diff View</h2>
        <p>
          Click the <strong>Diff</strong> tab to compare the current file with any other file in your workspace. Select the comparison target from the dropdown.
        </p>

        <h2>Edit History</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/editor_history.png" alt="Edit history" className="w-full" loading="lazy" />
        </figure>
        <p>
          Right-click a file and select <strong>History</strong> to view its edit history. You can:
        </p>
        <ul>
          <li>Browse past versions with timestamps.</li>
          <li>View diffs between versions.</li>
          <li>Restore a file to any previous version.</li>
          <li>Save a previous version as a new file.</li>
          <li>View remote history (changes made from other devices).</li>
        </ul>

        <h2>Publishing</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/pubish_web.png" alt="Publish to web" className="w-full" loading="lazy" />
        </figure>
        <p>
          Right-click a file and select <strong>Publish to Web</strong> to make it publicly accessible via URL. HTML and Markdown files are rendered; other types are served with their original MIME type.
        </p>

        <h2>File Type Support</h2>
        <ul>
          <li><strong>Markdown (.md)</strong> — Full editing with Preview / WYSIWYG / Raw modes.</li>
          <li><strong>YAML (.yaml)</strong> — Workflow editor with visual diagram.</li>
          <li><strong>JSON (.json)</strong> — Syntax-highlighted editor.</li>
          <li><strong>Images (.png, .jpg, etc.)</strong> — Image viewer with zoom.</li>
          <li><strong>PDF (.pdf)</strong> — Embedded PDF viewer.</li>
          <li><strong>Audio / Video</strong> — Media player.</li>
          <li><strong>Encrypted (.encrypted)</strong> — Password prompt, then decrypted content editor.</li>
        </ul>

        <h2>Temp Edit (Temporary File Sharing)</h2>
        <p>
          Share files temporarily with external tools or other devices. File content is stored in the Google Drive <code>__TEMP__</code> folder.
        </p>
        <h3>Temp Upload</h3>
        <ol>
          <li>Click the <strong>Temp UP</strong> button in the editor toolbar (or right-click a file and select Temp UP).</li>
          <li>A confirmation dialog asks whether to generate a shareable edit URL.</li>
          <li>If confirmed, the server issues a fresh access token (valid for 1 hour), encrypts it into the URL, and copies it to the clipboard.</li>
          <li>If declined, the file is uploaded to <code>__TEMP__</code> without generating a URL.</li>
        </ol>
        <h3>Edit URL</h3>
        <p>
          The generated URL (<code>/api/temp-edit/:token/:fileName</code>) allows unauthenticated GET/PUT access for 1 hour. The encrypted token contains the access credentials, so no login is required. External tools can read and write the file via this URL.
        </p>
        <h3>Temp Download</h3>
        <p>
          Click <strong>Temp Download</strong> to check the <code>__TEMP__</code> folder for changes and merge them into the editor.
        </p>

        <h2>New File Creation</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/editor_new.png" alt="New file dialog" className="w-full" loading="lazy" />
        </figure>
        <p>
          Click the <strong>New File</strong> button in the file tree toolbar to open the creation dialog. In addition to specifying a file name and extension, you can optionally include metadata in the initial content:
        </p>
        <ul>
          <li><strong>Add date/time</strong> — Inserts the current date and time at the top of the file.</li>
          <li><strong>Add location</strong> — Requests browser geolocation and inserts latitude/longitude coordinates.</li>
        </ul>
        <p>
          Checkbox preferences are saved and restored on the next file creation. For <code>.md</code> files, labels are bold-formatted. Geolocation uses the Web Geolocation API with a 10-second timeout; if it fails, the location is simply omitted.
        </p>

        <h3>Using Location Data with AI Chat</h3>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/editor_memo.png" alt="Memo with location and AI chat" className="w-full" loading="lazy" />
        </figure>
        <p>
          When a memo contains latitude and longitude, you can ask the AI in the chat panel to identify the place name. The AI reads the file content via the <code>read_drive_file</code> function call and resolves the coordinates to a human-readable location.
        </p>

        <h2>Context Menu Actions</h2>
        <p>Right-click a file in the file tree for additional actions:</p>
        <ul>
          <li>Rename, Download, Duplicate</li>
          <li>Convert to PDF / HTML</li>
          <li>Publish / Unpublish</li>
          <li>Encrypt / Decrypt</li>
          <li>Clear cache, Move to trash</li>
          <li>View edit history</li>
          <li>Temp file upload/download (for cross-device sharing)</li>
        </ul>
      </div>
    </>
  );
}

function EditorJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">ファイル編集</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/editor.png" alt="ファイルエディタ" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          GemiHubには、ファイルタイプに応じて適応する内蔵エディタがあります。Markdownファイルはフル編集体験、ワークフローファイルはビジュアルダイアグラム、バイナリファイルは適切なビューアで表示されます。
        </p>

        <h2>編集モード（Markdown）</h2>
        <ul>
          <li><strong>プレビュー</strong> — シンタックスハイライト付きの読み取り専用レンダリング。</li>
          <li><strong>WYSIWYG</strong> — フォーマットツールバー（太字、斜体、見出し、リスト、テーブル、画像、リンク）付きのリッチテキスト編集。</li>
          <li><strong>Raw</strong> — Markdownを直接編集するプレーンテキストエディタ。</li>
        </ul>
        <p>エディタ上部のタブバーでモードを切り替えます。</p>

        <h2>ワークフローエディタ</h2>
        <p>
          <code>.yaml</code>ワークフローファイルを選択すると、プレビューモードでMermaidフローチャートが表示されます。RawモードではYAMLを直接編集できます。ワークフロープロパティと実行コントロールは右サイドバーにあります。
        </p>

        <h2>自動保存</h2>
        <p>
          変更は3秒のデバウンスで自動的にローカルIndexedDBキャッシュに保存されます（新規ファイルは1秒、暗号化ファイルは5秒）。変更がコミットされると上部バーに「保存済み」インジケータが表示されます。Driveへの反映はドライブ反映で行います。
        </p>

        <h2>比較ビュー</h2>
        <p>
          <strong>比較</strong>タブをクリックして、現在のファイルをワークスペース内の他のファイルと比較します。ドロップダウンから比較対象を選択。
        </p>

        <h2>編集履歴</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/editor_history.png" alt="編集履歴" className="w-full" loading="lazy" />
        </figure>
        <p>
          ファイルを右クリックして<strong>履歴</strong>を選択すると、編集履歴が表示されます：
        </p>
        <ul>
          <li>タイムスタンプ付きの過去のバージョンを閲覧。</li>
          <li>バージョン間の差分を表示。</li>
          <li>ファイルを任意の過去のバージョンに復元。</li>
          <li>過去のバージョンを新しいファイルとして保存。</li>
          <li>リモート履歴（他のデバイスからの変更）を表示。</li>
        </ul>

        <h2>Web公開</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/pubish_web.png" alt="Web公開" className="w-full" loading="lazy" />
        </figure>
        <p>
          ファイルを右クリックして<strong>ウェブに公開</strong>を選択すると、URL経由で公開できます。HTMLとMarkdownファイルはレンダリングされ、他のタイプは元のMIMEタイプで配信されます。
        </p>

        <h2>ファイルタイプ対応</h2>
        <ul>
          <li><strong>Markdown (.md)</strong> — プレビュー / WYSIWYG / Rawモードでのフル編集。</li>
          <li><strong>YAML (.yaml)</strong> — ビジュアルダイアグラム付きワークフローエディタ。</li>
          <li><strong>JSON (.json)</strong> — シンタックスハイライト付きエディタ。</li>
          <li><strong>画像 (.png, .jpg等)</strong> — ズーム付き画像ビューア。</li>
          <li><strong>PDF (.pdf)</strong> — 埋め込みPDFビューア。</li>
          <li><strong>音声 / 動画</strong> — メディアプレーヤー。</li>
          <li><strong>暗号化 (.encrypted)</strong> — パスワード入力後、復号コンテンツのエディタ。</li>
        </ul>

        <h2>Temp Edit（一時ファイル共有）</h2>
        <p>
          外部ツールや他のデバイスとファイルを一時的に共有できます。ファイル内容はGoogle Driveの<code>__TEMP__</code>フォルダに保存されます。
        </p>
        <h3>Temp Upload</h3>
        <ol>
          <li>エディタツールバーの<strong>一時UP</strong>ボタンをクリック（またはファイルを右クリックして一時UPを選択）。</li>
          <li>共有用の編集URLを生成するかどうかの確認ダイアログが表示されます。</li>
          <li>「はい」の場合、サーバーで新しいアクセストークン（有効期限1時間）を発行し、暗号化してURLに埋め込み、クリップボードにコピーされます。</li>
          <li>「いいえ」の場合、URLを生成せずに<code>__TEMP__</code>にアップロードのみ行います。</li>
        </ol>
        <h3>編集URL</h3>
        <p>
          生成されたURL（<code>/api/temp-edit/:token/:fileName</code>）は、1時間の間、認証なしでGET/PUTアクセスが可能です。暗号化トークンにアクセス認証情報が含まれるため、ログインは不要です。外部ツールからこのURLでファイルの読み書きができます。
        </p>
        <h3>Temp Download</h3>
        <p>
          <strong>Temp Download</strong>をクリックすると、<code>__TEMP__</code>フォルダの変更を確認し、エディタにマージします。
        </p>

        <h2>新規ファイル作成</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/editor_new.png" alt="新規ファイルダイアログ" className="w-full" loading="lazy" />
        </figure>
        <p>
          ファイルツリーのツールバーにある<strong>新規ファイル</strong>ボタンから、ファイル作成ダイアログを開くことができます。ファイル名と拡張子の指定に加えて、以下のオプションで初期内容にメタデータを含めることができます：
        </p>
        <ul>
          <li><strong>日時を追加</strong> — 現在の日時をファイル先頭に挿入します。</li>
          <li><strong>位置情報を追加</strong> — ブラウザの位置情報を取得し、緯度・経度を挿入します。</li>
        </ul>
        <p>
          チェックボックスの状態は保存され、次回のファイル作成時に復元されます。<code>.md</code>ファイルの場合、ラベルは太字で表示されます。位置情報はWeb Geolocation APIを使用し、10秒のタイムアウトが設定されています。取得に失敗した場合は省略されます。
        </p>

        <h3>位置情報を使ったAIチャット</h3>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/editor_memo.png" alt="メモの位置情報とAIチャット" className="w-full" loading="lazy" />
        </figure>
        <p>
          メモに緯度・経度が含まれている場合、チャットパネルでAIに地名を質問できます。AIは<code>read_drive_file</code>ファンクションコールでファイル内容を読み取り、座標から地名を特定して回答します。
        </p>

        <h2>コンテキストメニューアクション</h2>
        <p>ファイルツリーでファイルを右クリックすると追加アクションが表示されます：</p>
        <ul>
          <li>名前変更、ダウンロード、複製</li>
          <li>PDF / HTMLに変換</li>
          <li>公開 / 公開解除</li>
          <li>暗号化 / 暗号化解除</li>
          <li>キャッシュクリア、ゴミ箱に移動</li>
          <li>編集履歴の表示</li>
          <li>一時ファイルのアップロード/ダウンロード（デバイス間共有用）</li>
        </ul>
      </div>
    </>
  );
}
