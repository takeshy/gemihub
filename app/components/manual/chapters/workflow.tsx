import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function WorkflowChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <WorkflowJa />;
  return <WorkflowEn />;
}

function WorkflowEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Workflows</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/visual_workflow_en.png" alt="Visual workflow builder" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          Workflows let you automate multi-step tasks. They are defined in YAML files and visualized as Mermaid flowchart diagrams. You can create them manually or let AI generate them from a natural language description.
        </p>

        <h2>Creating a Workflow</h2>
        <ol>
          <li>Create a new <code>.yaml</code> file from the file tree.</li>
          <li>Edit the workflow properties in the right sidebar or write YAML directly in Raw mode.</li>
          <li>Preview the flowchart diagram in Preview mode.</li>
        </ol>

        <h2>AI Workflow Generation</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/ai_generate_workflow.png" alt="AI workflow generation" className="w-full" loading="lazy" />
        </figure>
        <p>
          Describe what you want in plain language and AI will create the workflow YAML for you. Click the <strong>AI Generate</strong> button in the workflow editor, type a natural language description (e.g. &quot;Read all Markdown files in the reports folder and summarize each one&quot;), and the AI generates the corresponding YAML definition. A live Mermaid diagram preview updates as the YAML is generated, so you can see the workflow structure in real-time.
        </p>
        <p>
          You can iteratively refine the generated workflow by giving follow-up instructions in the same dialog — for example, &quot;add an error handling branch&quot; or &quot;save the summary to a new file&quot;. The AI modifies the existing YAML while preserving your previous changes.
        </p>

        <h2>Running a Workflow</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/workflow_execution_en.png" alt="Workflow execution results in the IDE" className="w-full" loading="lazy" />
        </figure>
        <ol>
          <li>Open a workflow file and switch to the Workflow panel in the right sidebar.</li>
          <li>Click <strong>Run</strong> to start execution.</li>
          <li>The execution log shows each node&apos;s status in real-time.</li>
          <li>Interactive nodes (prompts, dialogs, file pickers) pause execution and wait for your input.</li>
          <li>Click <strong>Stop</strong> to cancel a running workflow.</li>
        </ol>
        <p>Note: You must sync the workflow to Drive (Push to Drive) before executing it.</p>

        <h2>Node Types (24 types)</h2>
        <h3>Control Flow</h3>
        <ul>
          <li><strong>variable</strong> — Declare and initialize a variable.</li>
          <li><strong>set</strong> — Update a variable with an expression (supports arithmetic).</li>
          <li><strong>if</strong> — Conditional branching based on a condition.</li>
          <li><strong>while</strong> — Loop while a condition is true.</li>
          <li><strong>sleep</strong> — Pause execution for a specified duration.</li>
        </ul>

        <h3>AI / LLM</h3>
        <ul>
          <li><strong>command</strong> — Run a Gemini AI prompt with optional function calling, attachments, and system prompt.</li>
        </ul>

        <h3>Drive Operations</h3>
        <ul>
          <li><strong>drive-file</strong> — Create or update a file on Drive.</li>
          <li><strong>drive-read</strong> — Read a file&apos;s content.</li>
          <li><strong>drive-search</strong> — Search files by query.</li>
          <li><strong>drive-list</strong> — List files with sort and filter options.</li>
          <li><strong>drive-folder-list</strong> — List folders only.</li>
          <li><strong>drive-file-picker</strong> — Interactive file picker dialog.</li>
          <li><strong>drive-save</strong> — Save binary/text data to Drive.</li>
          <li><strong>drive-delete</strong> — Move a file to trash.</li>
        </ul>

        <h3>Interactive Prompts</h3>
        <ul>
          <li><strong>prompt-value</strong> — Ask the user for text input.</li>
          <li><strong>prompt-file</strong> — Ask the user to select a Drive file.</li>
          <li><strong>prompt-selection</strong> — Ask for multiline text input.</li>
          <li><strong>dialog</strong> — Show button choices with optional input field.</li>
        </ul>

        <h3>Integration</h3>
        <ul>
          <li><strong>workflow</strong> — Execute another workflow (sub-workflow).</li>
          <li><strong>json</strong> — Parse a JSON string variable.</li>
          <li><strong>http</strong> — Make HTTP requests (GET, POST, etc.).</li>
          <li><strong>mcp</strong> — Call an MCP tool.</li>
          <li><strong>rag-sync</strong> — Sync a file to the RAG store.</li>
          <li><strong>gemihub-command</strong> — Special commands (encrypt, publish, rename, etc.).</li>
        </ul>

        <h2>Template Variables</h2>
        <p>
          Use <code>{"{{variable}}"}</code> syntax to reference variables in node properties. Supports nested access (<code>{"{{obj.key}}"}</code>) and array indexing (<code>{"{{arr[0]}}"}</code>).
        </p>

        <h2>Execution History</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/edit_workflow.png" alt="Workflow editing" className="w-full" loading="lazy" />
        </figure>
        <p>
          Each execution is recorded and saved to Drive. You can reference past execution history when creating or modifying workflows.
        </p>
      </div>
    </>
  );
}

function WorkflowJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">ワークフロー</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/visual_workflow.png" alt="ビジュアルワークフロービルダー" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          ワークフローは複数ステップのタスクを自動化します。YAMLファイルで定義され、Mermaidフローチャートとして可視化されます。手動で作成するか、自然言語の説明からAIに生成させることができます。
        </p>

        <h2>ワークフローの作成</h2>
        <ol>
          <li>ファイルツリーから新しい<code>.yaml</code>ファイルを作成。</li>
          <li>右サイドバーでワークフロープロパティを編集するか、RawモードでYAMLを直接記述。</li>
          <li>プレビューモードでフローチャートを確認。</li>
        </ol>

        <h2>AIワークフロー生成</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/ai_generate_workflow.png" alt="AIワークフロー生成" className="w-full" loading="lazy" />
        </figure>
        <p>
          やりたいことを自然言語で伝えるだけで、AIがワークフローのYAMLを生成します。ワークフローエディタの<strong>AI生成</strong>ボタンをクリックし、説明を入力してください（例：「reportsフォルダ内のすべてのMarkdownファイルを読み取り、各ファイルを要約する」）。AIが対応するYAML定義を生成します。生成中はMermaidダイアグラムのライブプレビューがリアルタイムで更新され、ワークフローの構造を確認できます。
        </p>
        <p>
          同じダイアログで追加の指示を出すことで、生成されたワークフローを繰り返し改善できます。例えば「エラーハンドリングの分岐を追加」や「要約を新しいファイルに保存」など。AIは以前の変更を保持しながら既存のYAMLを修正します。
        </p>

        <h2>ワークフローの実行</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/workflow_execution.png" alt="ワークフロー実行" className="w-full" loading="lazy" />
        </figure>
        <ol>
          <li>ワークフローファイルを開き、右サイドバーのワークフローパネルに切り替え。</li>
          <li><strong>実行</strong>をクリックして開始。</li>
          <li>実行ログに各ノードのステータスがリアルタイムで表示。</li>
          <li>対話型ノード（プロンプト、ダイアログ、ファイルピッカー）は実行を一時停止して入力を待機。</li>
          <li><strong>停止</strong>をクリックして実行中のワークフローをキャンセル。</li>
        </ol>
        <p>注意：実行前にワークフローをドライブ反映でDriveに同期する必要があります。</p>

        <h2>ノードタイプ（24種類）</h2>
        <h3>制御フロー</h3>
        <ul>
          <li><strong>variable</strong> — 変数の宣言と初期化。</li>
          <li><strong>set</strong> — 式で変数を更新（算術演算対応）。</li>
          <li><strong>if</strong> — 条件に基づく分岐。</li>
          <li><strong>while</strong> — 条件が真の間ループ。</li>
          <li><strong>sleep</strong> — 指定時間の実行一時停止。</li>
        </ul>

        <h3>AI / LLM</h3>
        <ul>
          <li><strong>command</strong> — ファンクションコール、添付ファイル、システムプロンプト対応のGemini AIプロンプト実行。</li>
        </ul>

        <h3>Drive操作</h3>
        <ul>
          <li><strong>drive-file</strong> — Driveでファイルを作成・更新。</li>
          <li><strong>drive-read</strong> — ファイル内容の読み取り。</li>
          <li><strong>drive-search</strong> — クエリでファイル検索。</li>
          <li><strong>drive-list</strong> — ソート・フィルター付きファイル一覧。</li>
          <li><strong>drive-folder-list</strong> — フォルダのみ一覧表示。</li>
          <li><strong>drive-file-picker</strong> — 対話型ファイルピッカー。</li>
          <li><strong>drive-save</strong> — バイナリ/テキストデータをDriveに保存。</li>
          <li><strong>drive-delete</strong> — ファイルをゴミ箱に移動。</li>
        </ul>

        <h3>対話型プロンプト</h3>
        <ul>
          <li><strong>prompt-value</strong> — テキスト入力を要求。</li>
          <li><strong>prompt-file</strong> — Driveファイルの選択を要求。</li>
          <li><strong>prompt-selection</strong> — 複数行テキスト入力を要求。</li>
          <li><strong>dialog</strong> — ボタン選択（オプションで入力フィールド付き）。</li>
        </ul>

        <h3>連携</h3>
        <ul>
          <li><strong>workflow</strong> — 別のワークフロー（サブワークフロー）を実行。</li>
          <li><strong>json</strong> — JSON文字列変数をパース。</li>
          <li><strong>http</strong> — HTTPリクエスト（GET、POST等）。</li>
          <li><strong>mcp</strong> — MCPツールの呼び出し。</li>
          <li><strong>rag-sync</strong> — RAGストアにファイルを同期。</li>
          <li><strong>gemihub-command</strong> — 特殊コマンド（暗号化、公開、名前変更等）。</li>
        </ul>

        <h2>テンプレート変数</h2>
        <p>
          ノードプロパティで<code>{"{{variable}}"}</code>構文を使って変数を参照できます。ネストアクセス（<code>{"{{obj.key}}"}</code>）や配列インデックス（<code>{"{{arr[0]}}"}</code>）にも対応。
        </p>

        <h2>実行履歴</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/edit_workflow.png" alt="ワークフロー編集" className="w-full" loading="lazy" />
        </figure>
        <p>
          各実行は記録されDriveに保存されます。ワークフローの作成・修正時に過去の実行履歴を参照できます。
        </p>
      </div>
    </>
  );
}
