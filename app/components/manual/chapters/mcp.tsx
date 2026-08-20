import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function McpChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <McpJa />;
  return <McpEn />;
}

function McpEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">MCP (Model Context Protocol)</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/mcp_apps.png" alt="MCP Apps" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          MCP allows GemiHub to connect to external services and tools. The AI can automatically discover and use tools provided by MCP-compatible servers during chat conversations and workflow execution.
        </p>

        <h2>Setting Up MCP Servers</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_mcp_en.png" alt="MCP settings" className="w-full" loading="lazy" />
        </figure>
        <ol>
          <li>Go to <strong>Settings &gt; MCP Servers</strong>.</li>
          <li>Click <strong>Add Server</strong>.</li>
          <li>Enter a <strong>Name</strong> and the server <strong>URL</strong>.</li>
          <li>Optionally add custom <strong>Headers</strong> (JSON format) for authentication.</li>
          <li>Click <strong>Test &amp; Add</strong> to verify the connection and discover available tools.</li>
        </ol>

        <h2>OAuth Authentication</h2>
        <p>
          MCP servers that support OAuth are automatically detected. GemiHub handles the OAuth flow — click the authenticate button and follow the prompts. Tokens are stored and refreshed automatically.
        </p>

        <h2>Using MCP Tools in Chat</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_mcp_server_tool.png" alt="MCP server tools" className="w-full" loading="lazy" />
        </figure>
        <p>
          When MCP servers are configured, the AI can use their tools during conversation. Tools appear with prefixed names like <code>mcp_serverName_toolName</code>. You can enable or disable specific servers per chat session.
        </p>

        <h2>MCP Apps</h2>
        <p>
          When an MCP tool returns rich content (HTML, JSON), GemiHub renders it in a sandboxed iframe called an &quot;MCP App.&quot; This allows interactive visualizations and custom UIs from external tools.
        </p>

        <h2>MCP in Workflows</h2>
        <p>
          Use the <strong>mcp</strong> node type in workflows to call MCP tools directly. Specify the server, tool name, and parameters. The result is stored in a variable for use in subsequent nodes.
        </p>
      </div>
    </>
  );
}

function McpJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">MCP（モデルコンテキストプロトコル）</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/mcp_apps.png" alt="MCPアプリ" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          MCPにより、GemiHubは外部サービスやツールに接続できます。AIはチャットやワークフロー実行中に、MCP互換サーバーが提供するツールを自動的に発見して使用できます。
        </p>

        <h2>MCPサーバーのセットアップ</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_mcp.png" alt="MCP設定" className="w-full" loading="lazy" />
        </figure>
        <ol>
          <li><strong>設定 &gt; MCPサーバー</strong>に移動。</li>
          <li><strong>サーバーを追加</strong>をクリック。</li>
          <li><strong>名前</strong>とサーバーの<strong>URL</strong>を入力。</li>
          <li>必要に応じて認証用のカスタム<strong>ヘッダー</strong>（JSON形式）を追加。</li>
          <li><strong>テスト＆追加</strong>をクリックして接続を確認し、利用可能なツールを検出。</li>
        </ol>

        <h2>OAuth認証</h2>
        <p>
          OAuthをサポートするMCPサーバーは自動検出されます。GemiHubがOAuthフローを処理します。認証ボタンをクリックしてプロンプトに従ってください。トークンは自動的に保存・更新されます。
        </p>

        <h2>チャットでのMCPツール使用</h2>
        <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_mcp_server_tool.png" alt="MCPサーバーツール" className="w-full" loading="lazy" />
        </figure>
        <p>
          MCPサーバーが設定されている場合、AIは会話中にそれらのツールを使用できます。ツールは<code>mcp_サーバー名_ツール名</code>のプレフィックス付き名前で表示されます。チャットセッションごとに特定のサーバーを有効/無効にできます。
        </p>

        <h2>MCPアプリ</h2>
        <p>
          MCPツールがリッチコンテンツ（HTML、JSON）を返す場合、GemiHubはサンドボックス化されたiframe「MCPアプリ」でレンダリングします。外部ツールからのインタラクティブな可視化やカスタムUIが可能です。
        </p>

        <h2>ワークフローでのMCP</h2>
        <p>
          ワークフローで<strong>mcp</strong>ノードタイプを使用してMCPツールを直接呼び出せます。サーバー、ツール名、パラメータを指定します。結果は変数に保存され、後続のノードで使用できます。
        </p>
      </div>
    </>
  );
}
