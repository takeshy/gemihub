import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function FaqChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <FaqJa />;
  return <FaqEn />;
}

function FaqEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">FAQ</h1>
      <div className={prose}>
        <h2>Where is my data stored?</h2>
        <p>
          All data is stored in your own Google Drive, in a folder called <code>gemihub/</code>. GemiHub does not use any external database. Your files, chat history, workflows, and settings are all in your Drive.
        </p>

        <h2>Do I need an API key?</h2>
        <p>
          Yes, you need a Gemini API key for AI features (chat, workflow AI nodes, RAG search, image generation). You can get one for free from <a href="https://aistudio.google.com/apikey" className="text-blue-600 hover:underline dark:text-blue-400" target="_blank" rel="noopener noreferrer">Google AI Studio</a>.
        </p>

        <h2>What happens if I lose my password?</h2>
        <p>
          If you set a password for encryption and forget it, encrypted data cannot be recovered. The password is used entirely on the client side and is not stored anywhere. Make sure to keep your password safe.
        </p>

        <h2>Can I use GemiHub offline?</h2>
        <p>
          Yes. All files are cached in your browser&apos;s IndexedDB. You can view and edit files offline. AI features and sync require an internet connection. Once you&apos;re back online, use Push to Drive to sync your changes.
        </p>

        <h2>How do I resolve sync conflicts?</h2>
        <p>
          When the same file is modified both locally and on Drive, a conflict dialog appears during sync. Choose either &quot;Keep Local&quot; or &quot;Keep Remote&quot; for each file. The overwritten version is automatically backed up.
        </p>

        <h2>Can I self-host GemiHub?</h2>
        <p>
          Yes. GemiHub can be self-hosted on any platform that supports Node.js. You need to set up Google OAuth credentials and configure the environment variables. See the README for deployment instructions.
        </p>

        <h2>What Gemini models are available?</h2>
        <p>
          Available models depend on your API plan. Free plan users have access to Flash and Flash Lite models. Paid plan users also have access to Pro models. The model list is updated automatically.
        </p>

        <h2>How does the workflow sync requirement work?</h2>
        <p>
          Workflows must be synced to Drive before execution because the server reads the workflow file from Drive. After editing a workflow, use Push to Drive, then execute it.
        </p>

        <h2>Can I restore deleted files?</h2>
        <p>
          Yes. Deletions are queued locally, then the next Push moves the files to a <code>trash/</code> folder on Drive. Go to <strong>Settings &gt; Sync</strong> and click <strong>Manage</strong> next to Trash to restore or permanently delete files.
        </p>

        <h2>How do I clear the local cache?</h2>
        <p>
          Right-click a file or folder and select <strong>Clear Cache</strong>. For a complete reset, use <strong>Full Pull to Local</strong> from Settings &gt; Sync, which re-downloads all files from Drive.
        </p>

        <h2>Is my API key secure?</h2>
        <p>
          Your API key is encrypted with AES using your password and stored on Drive. Without the password, the encrypted key cannot be decrypted. You&apos;ll need to enter your password when starting a new session to unlock the API key.
        </p>
      </div>
    </>
  );
}

function FaqJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">FAQ（よくある質問）</h1>
      <div className={prose}>
        <h2>データはどこに保存されますか？</h2>
        <p>
          すべてのデータはあなた自身のGoogle Driveの<code>gemihub/</code>フォルダに保存されます。GemiHubは外部データベースを使用しません。ファイル、チャット履歴、ワークフロー、設定はすべてDriveにあります。
        </p>

        <h2>APIキーは必要ですか？</h2>
        <p>
          はい、AI機能（チャット、ワークフローAIノード、RAG検索、画像生成）にはGemini APIキーが必要です。<a href="https://aistudio.google.com/apikey" className="text-blue-600 hover:underline dark:text-blue-400" target="_blank" rel="noopener noreferrer">Google AI Studio</a>から無料で取得できます。
        </p>

        <h2>パスワードを忘れた場合はどうなりますか？</h2>
        <p>
          暗号化のためのパスワードを忘れた場合、暗号化されたデータは復旧できません。パスワードは完全にクライアントサイドで使用され、どこにも保存されません。パスワードは安全に保管してください。
        </p>

        <h2>オフラインで使えますか？</h2>
        <p>
          はい。すべてのファイルがブラウザのIndexedDBにキャッシュされています。オフラインでファイルの表示と編集が可能です。AI機能と同期にはインターネット接続が必要です。オンラインに戻ったらドライブ反映で変更を同期します。
        </p>

        <h2>同期コンフリクトの解決方法は？</h2>
        <p>
          同じファイルがローカルとDriveの両方で変更された場合、同期時にコンフリクトダイアログが表示されます。各ファイルについて「ローカルを保持」または「リモートを保持」を選択します。上書きされたバージョンは自動的にバックアップされます。
        </p>

        <h2>セルフホストできますか？</h2>
        <p>
          はい。GemiHubはNode.jsをサポートする任意のプラットフォームでセルフホストできます。Google OAuth認証情報のセットアップと環境変数の設定が必要です。デプロイ手順はREADMEを参照してください。
        </p>

        <h2>利用可能なGeminiモデルは？</h2>
        <p>
          利用可能なモデルはAPIプランによって異なります。無料プランではFlashとFlash Liteモデルが利用可能です。有料プランではProモデルも利用可能です。モデルリストは自動的に更新されます。
        </p>

        <h2>ワークフローの同期要件とは？</h2>
        <p>
          ワークフローはサーバーがDriveからファイルを読み込むため、実行前にドライブ反映でDriveに同期する必要があります。ワークフローを編集したらドライブ反映してから実行してください。
        </p>

        <h2>削除したファイルは復元できますか？</h2>
        <p>
          はい。削除はまずローカルで予約され、次回のPushでDrive上の<code>trash/</code>フォルダに移動されます。<strong>設定 &gt; 同期</strong>のゴミ箱の横の<strong>管理</strong>をクリックして復元または完全削除できます。
        </p>

        <h2>ローカルキャッシュをクリアするには？</h2>
        <p>
          ファイルまたはフォルダを右クリックして<strong>キャッシュクリア</strong>を選択します。完全にリセットする場合は、設定 &gt; 同期の<strong>完全ローカル反映</strong>を使用してDriveからすべてのファイルを再ダウンロードします。
        </p>

        <h2>APIキーは安全ですか？</h2>
        <p>
          APIキーはパスワードを使用してAESで暗号化され、Driveに保存されます。パスワードがなければ暗号化されたキーは復号できません。新しいセッション開始時にAPIキーを解除するためにパスワードの入力が必要です。
        </p>
      </div>
    </>
  );
}
