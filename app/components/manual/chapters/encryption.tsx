import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function EncryptionChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <EncryptionJa />;
  return <EncryptionEn />;
}

function EncryptionEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Encryption</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/workflow_execute_log_encrypted.png" alt="Encrypted execution log" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          GemiHub supports client-side encryption using a hybrid RSA+AES scheme. All encryption and decryption happens in your browser — your password is never sent to any server.
        </p>

        <h2>Setting Up Encryption</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_general_en.png" alt="General settings with encryption" className="w-full" loading="lazy" />
        </figure>
        <ol>
          <li>Go to <strong>Settings &gt; General</strong>.</li>
          <li>In the <strong>API Key &amp; Password</strong> section, set a password (minimum 8 characters).</li>
          <li>The password is used to derive encryption keys on the client side.</li>
        </ol>

        <h2>Encrypting Files</h2>
        <ol>
          <li>Right-click a file in the file tree.</li>
          <li>Select <strong>Encrypt</strong>.</li>
          <li>The file will be encrypted and renamed with an <code>.encrypted</code> extension.</li>
        </ol>
        <p>
          To open an encrypted file, click on it and enter your password when prompted. The decrypted content is displayed in the editor.
        </p>

        <h2>Decrypting Files</h2>
        <p>
          Right-click an encrypted file and select <strong>Decrypt</strong> to permanently remove encryption. The <code>.encrypted</code> extension is removed.
        </p>

        <h2>Chat History Encryption</h2>
        <p>
          Enable <strong>Encrypt Chat History</strong> in Settings &gt; General to automatically encrypt all chat conversations when saved to Drive.
        </p>

        <h2>Workflow History Encryption</h2>
        <p>
          Enable <strong>Encrypt Workflow History</strong> to encrypt workflow execution logs saved to Drive.
        </p>

        <h2>API Key Protection</h2>
        <p>
          Your Gemini API key is encrypted with your password and stored securely on Drive. You&apos;ll need to enter your password when starting a new session to unlock the API key.
        </p>

        <h2>Important Notes</h2>
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 dark:border-red-700 dark:bg-red-950/30 mb-4">
          <p className="font-bold text-red-700 dark:text-red-400 !mt-0">
            Warning: If you lose your password, there is no way to recover encrypted data.
          </p>
          <p className="!mb-0">
            The password is used entirely on the client side and is never stored on any server. GemiHub cannot reset or recover your password. Encrypted files, chat history, workflow history, and your API key will all become permanently inaccessible. Always keep your password in a safe place.
          </p>
        </div>
        <ul>
          <li>Encrypted files are stored on Drive in encrypted form — even Google cannot read them.</li>
          <li>The password is cached in your browser session. You only need to enter it once per session.</li>
          <li>Resetting encryption keys will make all previously encrypted data unreadable.</li>
        </ul>
      </div>
    </>
  );
}

function EncryptionJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">暗号化</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/workflow_execute_log_encrypted.png" alt="暗号化された実行ログ" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          GemiHubは、ハイブリッドRSA+AES方式によるクライアントサイド暗号化をサポートしています。すべての暗号化・復号はブラウザ内で行われ、パスワードがサーバーに送信されることはありません。
        </p>

        <h2>暗号化のセットアップ</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_general.png" alt="一般設定（暗号化）" className="w-full" loading="lazy" />
        </figure>
        <ol>
          <li><strong>設定 &gt; 一般</strong>に移動。</li>
          <li><strong>APIキー &amp; パスワード</strong>セクションでパスワードを設定（8文字以上）。</li>
          <li>パスワードはクライアントサイドで暗号化キーの生成に使用されます。</li>
        </ol>

        <h2>ファイルの暗号化</h2>
        <ol>
          <li>ファイルツリーでファイルを右クリック。</li>
          <li><strong>暗号化</strong>を選択。</li>
          <li>ファイルが暗号化され、<code>.encrypted</code>拡張子でリネームされます。</li>
        </ol>
        <p>
          暗号化ファイルを開くには、クリックしてパスワードプロンプトにパスワードを入力します。復号された内容がエディタに表示されます。
        </p>

        <h2>ファイルの暗号化解除</h2>
        <p>
          暗号化ファイルを右クリックして<strong>暗号化解除</strong>を選択すると、暗号化を永続的に解除します。<code>.encrypted</code>拡張子が除去されます。
        </p>

        <h2>チャット履歴の暗号化</h2>
        <p>
          設定 &gt; 一般で<strong>チャット履歴を暗号化</strong>を有効にすると、Driveに保存されるすべてのチャット会話が自動的に暗号化されます。
        </p>

        <h2>ワークフロー履歴の暗号化</h2>
        <p>
          <strong>ワークフロー履歴を暗号化</strong>を有効にすると、Driveに保存されるワークフロー実行ログが暗号化されます。
        </p>

        <h2>APIキーの保護</h2>
        <p>
          Gemini APIキーはパスワードで暗号化され、Driveに安全に保存されます。新しいセッション開始時にAPIキーを解除するためにパスワードの入力が必要です。
        </p>

        <h2>重要な注意事項</h2>
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 dark:border-red-700 dark:bg-red-950/30 mb-4">
          <p className="font-bold text-red-700 dark:text-red-400 !mt-0">
            警告：パスワードを紛失すると、暗号化されたデータを復元する方法はありません。
          </p>
          <p className="!mb-0">
            パスワードは完全にクライアントサイドで使用され、サーバーには一切保存されません。GemiHubがパスワードをリセットしたり復元することはできません。暗号化されたファイル、チャット履歴、ワークフロー履歴、APIキーのすべてが永久にアクセス不能になります。パスワードは必ず安全な場所に保管してください。
          </p>
        </div>
        <ul>
          <li>暗号化ファイルは暗号化された状態でDriveに保存されます。Googleでさえ読み取れません。</li>
          <li>パスワードはブラウザセッションにキャッシュされます。セッションごとに1回入力するだけです。</li>
          <li>暗号化キーをリセットすると、以前に暗号化されたすべてのデータが読み取れなくなります。</li>
        </ul>
      </div>
    </>
  );
}
