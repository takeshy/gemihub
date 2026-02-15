import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function ChatChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <ChatJa />;
  return <ChatEn />;
}

function ChatEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">AI Chat</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/chat_rag.png" alt="AI Chat interface" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          The Chat panel is your interface for conversing with Google Gemini AI. It supports real-time streaming responses, automatic tool use, file attachments, and custom slash commands.
        </p>

        <h2>Basic Usage</h2>
        <ul>
          <li>Type your message in the input box and press Enter (or click Send).</li>
          <li>Responses stream in real-time. You can stop generation at any time.</li>
          <li>The AI sees the currently open file as context (you can dismiss this).</li>
          <li>Click <strong>New Chat</strong> to start a fresh conversation. Previous chats are saved in the history dropdown.</li>
        </ul>

        <h2>Model Selection</h2>
        <p>
          Select a Gemini model from the dropdown. Available models depend on your API plan (Free / Paid). Some models support extended thinking — the AI&apos;s reasoning process is displayed in a collapsible section.
        </p>

        <h3>Model-Specific Limitations</h3>
        <ul>
          <li><strong>Gemma models</strong> — Do not support function calling (tool use) or extended thinking. When a Gemma model is selected, all tools (Drive, MCP, RAG, Web Search) are automatically disabled.</li>
          <li><strong>Flash Lite + RAG</strong> — When RAG is enabled with a Flash Lite model, Drive and MCP tools are disabled. Flash Lite cannot combine function calling tools with RAG file search in a single request.</li>
        </ul>

        <h2>Function Calling (Agentic AI)</h2>
        <p>
          The AI can automatically choose and execute tools during the conversation:
        </p>
        <ul>
          <li><strong>Drive tools</strong> — Read files, search files, list folders, create and update files on your Drive.</li>
          <li><strong>Web Search</strong> — Search the internet using Google Search.</li>
          <li><strong>RAG / File Search</strong> — Semantic search through your RAG-indexed documents.</li>
          <li><strong>MCP tools</strong> — Tools from connected MCP servers (databases, APIs, etc.).</li>
          <li><strong>Image Generation</strong> — Generate images with compatible models.</li>
        </ul>
        <p>
          Tool mode can be set to <strong>Auto</strong> (AI decides), <strong>Manual</strong> (require confirmation), or <strong>None</strong> (disable tools).
        </p>

        <h3>Web Search Mode</h3>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/rag_web_search_selector.png" alt="RAG and Web Search selector" className="w-full" loading="lazy" />
        </figure>
        <p>
          When Web Search is enabled, the AI uses Google Search exclusively. <strong>All other tools (Drive, MCP, RAG) are disabled</strong> during Web Search mode, because Google Search is incompatible with other tool types in a single request.
        </p>

        <h3>RAG and Drive Search</h3>
        <p>
          When RAG is enabled, the Drive Search tool (<code>search_drive_files</code> / <code>list_drive_files</code>) is disabled by default. This is because the AI tends to spend tokens calling Drive search instead of using RAG&apos;s semantic search, often resulting in missed or irrelevant results. RAG provides more accurate, meaning-based retrieval. You can override this in the tool mode settings if needed.
        </p>

        <h3>Drive Tools &amp; MCP</h3>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/drive_tool_mcp_selector.png" alt="Drive tool and MCP selector" className="w-full" loading="lazy" />
        </figure>
        <p>
          Configure Drive tool mode and select which MCP servers to enable for the conversation. These settings control which tools are available to the AI during function calling.
        </p>

        <h2>File Attachments</h2>
        <p>
          Drag and drop images or PDFs onto the chat input to attach them to your message. The AI can analyze the attached files.
        </p>

        <h2>Slash Commands</h2>
        <p>
          Type <code>/</code> to see available commands. Slash commands are custom prompt templates configured in <strong>Settings &gt; Commands</strong>. They support template variables:
        </p>
        <ul>
          <li><code>{"{content}"}</code> — Content of the currently open file.</li>
          <li><code>{"{selection}"}</code> — Currently selected text in the editor.</li>
          <li><code>@filename</code> — Content of a specific Drive file (autocomplete available).</li>
        </ul>
        <p>Each command can override the model, search settings, Drive tool mode, and enabled MCP servers.</p>

        <h2>Chat History</h2>
        <p>
          Conversations are automatically saved to Drive. Open the history dropdown to browse, continue, or delete past conversations. History can optionally be encrypted.
        </p>

        <h2>Save to Drive</h2>
        <p>
          Click the <strong>Save to Drive</strong> icon (hard drive icon) in the chat header to export the current conversation as a Markdown file in your Drive.
        </p>
      </div>
    </>
  );
}

function ChatJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">AIチャット</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/chat_rag.png" alt="AIチャットインターフェース" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          チャットパネルは、Google Gemini AIとの対話インターフェースです。リアルタイムストリーミング応答、自動ツール使用、ファイル添付、カスタムスラッシュコマンドに対応しています。
        </p>

        <h2>基本的な使い方</h2>
        <ul>
          <li>入力ボックスにメッセージを入力してEnterキーを押す（または送信ボタンをクリック）。</li>
          <li>応答はリアルタイムでストリーミングされます。いつでも生成を停止できます。</li>
          <li>AIは現在開いているファイルをコンテキストとして認識します（この参照は解除可能）。</li>
          <li><strong>新しいチャット</strong>をクリックして新しい会話を開始。過去のチャットは履歴ドロップダウンに保存されます。</li>
        </ul>

        <h2>モデル選択</h2>
        <p>
          ドロップダウンからGeminiモデルを選択します。利用可能なモデルはAPIプラン（無料/有料）によって異なります。一部のモデルは拡張思考（Extended Thinking）に対応しており、AIの推論プロセスが折りたたみ可能なセクションに表示されます。
        </p>

        <h3>モデル固有の制限事項</h3>
        <ul>
          <li><strong>Gemmaモデル</strong> — ファンクションコール（ツール使用）および拡張思考に非対応です。Gemmaモデル選択時は、すべてのツール（Drive、MCP、RAG、Web検索）が自動的に無効化されます。</li>
          <li><strong>Flash Lite + RAG</strong> — Flash LiteモデルでRAGを有効にすると、DriveツールとMCPツールが無効化されます。Flash Liteは1つのリクエスト内でファンクションコールツールとRAGファイル検索を同時に使用できません。</li>
        </ul>

        <h2>ファンクションコール（エージェント型AI）</h2>
        <p>
          AIは会話中に自動的にツールを選択して実行できます：
        </p>
        <ul>
          <li><strong>Driveツール</strong> — ファイルの読み取り、検索、フォルダ一覧、Driveでのファイルの作成・更新。</li>
          <li><strong>Web検索</strong> — Google検索を使用したインターネット検索。</li>
          <li><strong>RAG / ファイル検索</strong> — RAGインデックス済みドキュメントの意味検索。</li>
          <li><strong>MCPツール</strong> — 接続されたMCPサーバーからのツール（データベース、API等）。</li>
          <li><strong>画像生成</strong> — 対応モデルで画像を生成。</li>
        </ul>
        <p>
          ツールモードは<strong>自動</strong>（AIが判断）、<strong>手動</strong>（確認が必要）、<strong>なし</strong>（ツール無効）に設定可能。
        </p>

        <h3>Web検索モード</h3>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/rag_web_search_selector.png" alt="RAGとWeb検索セレクター" className="w-full" loading="lazy" />
        </figure>
        <p>
          Web検索を有効にすると、AIはGoogle検索のみを使用します。<strong>他のすべてのツール（Drive、MCP、RAG）はWeb検索モード中は無効化</strong>されます。Google検索は1つのリクエスト内で他のツールタイプと併用できないためです。
        </p>

        <h3>RAGとDrive検索</h3>
        <p>
          RAGを有効にすると、Drive検索ツール（<code>search_drive_files</code> / <code>list_drive_files</code>）はデフォルトで無効化されます。これは、AIがRAGの意味検索ではなくDrive検索にトークンを消費してしまい、結果として的外れな検索や空振りに終わるケースがあるためです。RAGはより正確な意味ベースの検索を提供します。必要に応じてツールモード設定で上書きできます。
        </p>

        <h3>Driveツール・MCP</h3>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/drive_tool_mcp_selector.png" alt="DriveツールとMCPセレクター" className="w-full" loading="lazy" />
        </figure>
        <p>
          Driveツールモードの設定や、会話で有効にするMCPサーバーの選択ができます。これらの設定により、ファンクションコール時にAIが利用できるツールを制御します。
        </p>

        <h2>ファイル添付</h2>
        <p>
          チャット入力エリアに画像やPDFをドラッグ＆ドロップして添付できます。AIは添付ファイルを分析できます。
        </p>

        <h2>スラッシュコマンド</h2>
        <p>
          <code>/</code>を入力して利用可能なコマンドを表示します。スラッシュコマンドは<strong>設定 &gt; コマンド</strong>で設定するカスタムプロンプトテンプレートです。テンプレート変数に対応：
        </p>
        <ul>
          <li><code>{"{content}"}</code> — 現在開いているファイルの内容。</li>
          <li><code>{"{selection}"}</code> — エディタで選択中のテキスト。</li>
          <li><code>@ファイル名</code> — 特定のDriveファイルの内容（オートコンプリート対応）。</li>
        </ul>
        <p>各コマンドでモデル、検索設定、Driveツールモード、有効なMCPサーバーを上書きできます。</p>

        <h2>チャット履歴</h2>
        <p>
          会話は自動的にDriveに保存されます。履歴ドロップダウンを開いて過去の会話を閲覧、続行、削除できます。履歴はオプションで暗号化可能です。
        </p>

        <h2>Driveに保存</h2>
        <p>
          チャットヘッダーの<strong>Driveに保存</strong>アイコン（ハードドライブアイコン）をクリックすると、現在の会話をMarkdownファイルとしてDriveにエクスポートできます。
        </p>
      </div>
    </>
  );
}
