# MCP (Model Context Protocol)

外部 MCP サーバーとの統合による Gemini のツール機能拡張。

## 機能

- **動的ツール検出**: MCP サーバーからツール定義を自動取得
- **チャット統合**: Drive ツールと並んで MCP ツールを AI チャットで利用可能
- **ワークフロー統合**: 専用 `mcp` ワークフローノードでサーバーを直接呼び出し
- **MCP Apps**: MCP ツール結果からリッチ UI をサンドボックス iframe で表示
- **OAuth サポート**: RFC 9728 ディスカバリ、動的クライアント登録、PKCE、トークンリフレッシュ
- **クライアントキャッシュ**: サーバーごとの永続 MCP クライアントインスタンスでセッションを再利用
- **SSRF 保護**: プライベート IP 範囲とメタデータエンドポイントをブロックする URL バリデーション

---

## プロトコル

GemiHub は MCP の **Streamable HTTP トランスポート** を使用します。

| パラメータ | 値 |
|-----------|------|
| トランスポート | HTTP POST (JSON-RPC 2.0) |
| プロトコルバージョン | `2024-11-05` |
| セッション管理 | `Mcp-Session-Id` ヘッダー |
| セッション終了 | セッションヘッダー付き HTTP DELETE |
| レスポンス形式 | `application/json` または `text/event-stream`（自動検出） |
| リクエストタイムアウト | 30秒（標準）、10秒（通知）、60秒（ワークフローツール呼び出し） |

### ライフサイクル

```
1. initialize      → サーバーが capabilities + serverInfo を返す
2. notifications/initialized  → クライアントが初期化確認（通知、レスポンスなし）
3. tools/list      → サーバーが利用可能なツールを返す
4. tools/call      → ツールを実行（繰り返し可能）
5. resources/read  → UI リソースを取得（オプション）
6. DELETE          → セッションを終了
```

---

## 設定

MCP サーバーは **Settings > MCP Servers** で設定します。

### サーバー設定

| フィールド | 必須 | 説明 |
|-----------|------|------|
| Name | はい | サーバーの表示名 |
| URL | はい | HTTP エンドポイント（本番では HTTPS 必須） |
| Headers | いいえ | JSON 形式のカスタムヘッダー（例: `{"Authorization": "Bearer ..."}`) |
| OAuth | いいえ | 自動検出または手動設定の OAuth 設定 |

### 接続テスト

「Test」ボタンは `POST /api/settings/mcp-test` を呼び出し、以下を実行します：
1. SSRF 保護のため URL を検証
2. MCP セッションを初期化
3. 利用可能なツールを一覧取得
4. ツール定義を返す（サーバー設定にキャッシュ）

サーバーが 401 を返した場合、OAuth ディスカバリが自動的にトリガーされます。

---

## OAuth 認証

RFC 9728 に基づく OAuth 2.0 認証が必要なサーバーをサポートします。

### ディスカバリフロー

```
1. サーバーに POST → 401 Unauthorized
2. WWW-Authenticate ヘッダーから resource_metadata URL をパース
3. /.well-known/oauth-protected-resource を取得
4. /.well-known/oauth-authorization-server を取得
5. 動的クライアント登録を試行（registration_endpoint がある場合）
6. 登録失敗時は clientId "gemihub" にフォールバック
```

### 認可フロー

1. PKCE コード検証子とチャレンジを生成
2. PKCE パラメータ付き認可 URL でポップアップウィンドウを開く
3. ユーザーがポップアップで認可
4. コールバックが `POST /api/settings/mcp-oauth-token` 経由で認可コードをトークンに交換
5. トークンをサーバー設定に保存（`oauthTokens`）

### トークン管理

| 機能 | 説明 |
|------|------|
| 自動注入 | `Authorization` ヘッダーで Bearer トークンをリクエストに追加 |
| 有効期限チェック | 期限切れの 5 分前にバッファ |
| 自動リフレッシュ | テスト時にリフレッシュトークンで新しいアクセストークンを取得 |
| ストレージ | Drive 上の `settings.json` にトークンを永続化 |

---

## チャット統合

### ツール選択

チャット入力のツールドロップダウンで、各 MCP サーバーがチェックボックスとして表示されます。ユーザーはチャットセッションごとにサーバーを有効/無効にできます。選択は `localStorage` に永続化されます。

### ツール命名

MCP ツールはプレフィックス付きの名前で Gemini に公開されます：

```
mcp_{sanitizedServerName}_{sanitizedToolName}
```

サニタイズ: 小文字化、英数字以外を `_` に置換、先頭/末尾の `_` を除去。

例: サーバー「Brave Search」、ツール「web_search」→ `mcp_brave_search_web_search`

### 実行フロー

```
Gemini が mcp_server_tool(args) を呼び出す
  → api.chat.tsx: executeToolCall が executeMcpTool() にディスパッチ
    → mcp-tools.server.ts: プレフィックスでサーバーを特定、元のツール名で呼び出し
      → McpClient.callToolWithUi(toolName, args)
        → MCP サーバーに JSON-RPC tools/call
        → テキストコンテンツを抽出 → Gemini にツール結果として返す
        → resourceUri がある場合 → UI リソースを取得
          → クライアントに mcp_app SSE チャンクを送信
            → McpAppRenderer がサンドボックス iframe で表示
```

### 非互換性

- **Web Search** モードがアクティブな場合、MCP ツールは無効
- **Gemma モデル** が選択されている場合、MCP ツールは無効（Function Calling 非対応）
- Drive ツールモードがロックされている場合、MCP ツールドロップダウンもロック

---

## MCP Apps（リッチ UI）

MCP ツールが UI メタデータ（`_meta.ui.resourceUri`）を返すと、結果はインタラクティブな MCP App として表示されます。

### リソース読み込み

1. サーバーサイド: ツール実行中に `McpClient.readResource(uri)` で HTML コンテンツを取得
2. クライアントサイドフォールバック: サーバーサイド取得が利用できない場合、`POST /api/mcp/resource-read` プロキシを使用
3. コンテンツは `text`（HTML 文字列）または `blob`（Base64 エンコード）

### Iframe サンドボックス

MCP App の HTML はサンドボックス化された iframe でレンダリングされます：

```html
<iframe sandbox="allow-scripts allow-forms" srcDoc="...">
```

**許可**: JavaScript 実行、フォーム送信
**ブロック**: ナビゲーション、ポップアップ、同一オリジンアクセス

### Iframe 通信（postMessage）

**親 → Iframe**（読み込み時）：
```json
{ "jsonrpc": "2.0", "method": "toolResult", "params": { "content": [...], "isError": false } }
```

**Iframe → 親**（ツール呼び出し）：
```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "toolName", "arguments": {} } }
```

**Iframe → 親**（コンテキスト更新）：
```json
{ "jsonrpc": "2.0", "id": 2, "method": "context/update", "params": { ... } }
```

iframe からのツール呼び出しは CORS を回避するため `POST /api/mcp/tool-call` 経由でサーバーサイドにプロキシされます。`context/update` は `{ ok: true }` で応答されます。

### UI コントロール

- **折りたたみ/展開**: MCP App の表示切替
- **最大化**: フルスクリーンオーバーレイ（5% インセット、Escape で閉じる）
- **読み込み状態**: リソース取得中のスピナー表示

---

## ワークフロー統合

### MCP ノード

`mcp` ワークフローノードは MCP サーバーツールを直接呼び出します。

| プロパティ | 必須 | 説明 |
|-----------|------|------|
| `url` | はい | MCP サーバー URL |
| `tool` | はい | 呼び出すツール名 |
| `args` | いいえ | 引数の JSON 文字列（`{{variable}}` 置換対応） |
| `headers` | いいえ | カスタムヘッダーの JSON 文字列 |
| `saveTo` | いいえ | テキスト結果を保存する変数名 |
| `saveUiTo` | いいえ | UI リソース JSON を保存する変数名 |

### ワークフロー実行

ワークフローの MCP ハンドラーは実行ごとに専用の `McpClient` を作成します（キャッシュなし）：

1. MCP セッションを初期化（ハンドシェイク + `notifications/initialized`）
2. `McpClient` 経由で `tools/call` を呼び出し（60秒タイムアウト）
3. 結果からテキストコンテンツを抽出
4. `_meta.ui.resourceUri` がある場合、`resources/read` を呼び出し（30秒タイムアウト）
5. 実行ログ表示用に `McpAppInfo` を返す
6. セッションを終了

### Command ノード

`command` ワークフローノードは `mcpServers` プロパティ（カンマ区切りのサーバー名）をサポートし、ワークフロー内の Gemini チャットで MCP ツールを有効にします。

---

## セキュリティ

### SSRF 保護

すべての MCP サーバー URL は使用前に検証されます。ブロック対象：

| カテゴリ | ブロック対象 |
|---------|------------|
| ループバック | `127.*`、`::1`、`localhost` |
| デフォルトルート | `0.*` |
| プライベートネットワーク (IPv4) | `10.*`、`172.16-31.*`、`192.168.*` |
| プライベートネットワーク (IPv6) | `fc00:*`、`fd*` |
| リンクローカル | `169.254.*`、`fe80:*` |
| クラウドメタデータ | `metadata.google.internal`、`169.254.169.254` |
| プロトコル | 本番では HTTP をブロック（HTTPS 必須） |

開発モードでは、ローカル MCP サーバーのテスト用に HTTP と localhost を許可します。

### Iframe セキュリティ

- `sandbox="allow-scripts allow-forms"` — ナビゲーション、ポップアップ、同一オリジンアクセスなし
- iframe からのツール呼び出しはサーバーサイドでプロキシ（ブラウザから MCP サーバーへの直接アクセスなし）
- すべての postMessage 通信で JSON-RPC メッセージバリデーション

---

## アーキテクチャ

### データフロー

```
設定 UI                         サーバー                       MCP サーバー
┌──────────────┐         ┌──────────────────┐         ┌──────────────┐
│ サーバー設定   │         │ mcp-client.server│         │ JSON-RPC 2.0 │
│ OAuth トークン │────────►│ mcp-tools.server │◄───────►│ tools/list   │
│ ツールキャッシュ│         │ mcp-oauth.server │         │ tools/call   │
└──────────────┘         └──────────────────┘         │ resources/read│
                               │                       └──────────────┘
チャット / ワークフロー        │
┌──────────────┐         ┌─────▼──────┐
│ ツール呼び出し │────────►│ プロキシ API │
│ MCP App UI   │◄────────│ tool-call  │
│ iframe        │         │ resource   │
└──────────────┘         └────────────┘
```

### 主要ファイル

| ファイル | 役割 |
|----------|------|
| `app/services/mcp-client.server.ts` | MCP クライアント — JSON-RPC 通信、セッション管理、SSE パース |
| `app/services/mcp-tools.server.ts` | ツール検出、命名、実行、クライアントキャッシュ、UI リソース取得 |
| `app/services/mcp-oauth.server.ts` | RFC 9728 OAuth ディスカバリ、クライアント登録、トークン交換/リフレッシュ |
| `app/services/url-validator.server.ts` | SSRF 保護 — MCP エンドポイントの URL バリデーション |
| `app/routes/api.mcp.tool-call.tsx` | iframe ツール呼び出し用サーバーサイドプロキシ |
| `app/routes/api.mcp.resource-read.tsx` | iframe リソース読み取り用サーバーサイドプロキシ |
| `app/routes/api.settings.mcp-test.tsx` | 接続テスト、ツール検出、401 時の OAuth ディスカバリ |
| `app/routes/api.settings.mcp-oauth-token.tsx` | OAuth 認可コードをトークンに交換（PKCE） |
| `app/components/chat/McpAppRenderer.tsx` | MCP App レンダリング — iframe サンドボックス、postMessage、最大化 |
| `app/engine/handlers/mcp.ts` | ワークフロー MCP ノードハンドラー — 実行ごとに専用 McpClient を使用 |

### API ルート

| ルート | メソッド | 説明 |
|--------|----------|------|
| `/api/mcp/tool-call` | POST | iframe 用ツール呼び出しプロキシ（CORS バイパス） |
| `/api/mcp/resource-read` | POST | iframe 用リソース読み取りプロキシ |
| `/api/settings/mcp-test` | POST | サーバー接続テスト、ツール一覧取得、OAuth ディスカバリ |
| `/api/settings/mcp-oauth-token` | POST | OAuth 認可コードをトークンに交換 |
