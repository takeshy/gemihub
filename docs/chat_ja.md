# チャット

Gemini ストリーミング、Function Calling、RAG、画像生成、MCP 連携を備えた AI チャット。

## 機能

- **ストリーミングレスポンス**: Server-Sent Events (SSE) によるリアルタイムテキスト生成
- **Function Calling**: Gemini が Drive ツール、MCP ツール、RAG/File Search、Google Search を呼び出し
- **Drive ツール連携**: チャットから Drive ファイルの読み取り・検索・一覧・作成・更新
- **MCP ツール**: MCP サーバーから動的に検出されるツール（`mcp_{serverId}_{tool}` 形式）
- **RAG / Web Search**: Gemini File Search による検索拡張生成、または Google Search モード
- **拡張思考**: 対応モデルでの折りたたみ可能な思考/推論表示
- **画像生成**: Imagen 対応モデルによる画像生成
- **チャット履歴**: Google Drive に自動保存、暗号化オプション対応
- **スラッシュコマンド**: テンプレート変数とコマンド別オーバーライドを備えた `/command`
- **ファイル参照**: `@filename` でメッセージ内から Drive ファイルを参照
- **添付ファイル**: ドラッグ＆ドロップまたはファイルピッカーで画像・PDF を添付

---

## ストリーミングプロトコル

チャットは SSE (Server-Sent Events) を使用。サーバーは `data: {JSON}\n\n` チャンクを送信。

### チャンクタイプ

| Type | 説明 |
|------|------|
| `text` | テキストコンテンツ（増分） |
| `thinking` | 拡張思考/推論コンテンツ |
| `tool_call` | Function Call（名前 + 引数） |
| `tool_result` | Function Call の結果 |
| `rag_used` | レスポンスで使用された RAG ソース |
| `web_search_used` | 使用された Web 検索ソース |
| `image_generated` | Base64 エンコードされた生成画像 |
| `mcp_app` | MCP ツール UI メタデータ |
| `drive_changed` | Drive ファイルが作成/更新された（ファイルツリー更新をトリガー） |
| `error` | エラーメッセージ |
| `done` | ストリーム完了 |

### クライアント側の処理

1. `POST /api/chat` を SSE ストリームとして開く
2. `data:` 行をパースし、text/thinking/toolCalls を蓄積
3. `drive_changed` を受信 → `sync-complete` イベントを dispatch（ファイルツリーを更新）
4. `done` を受信 → 最終 `Message` オブジェクトを構築し履歴に保存

---

## Function Calling

有効時、Gemini はチャット中にツールを呼び出せる。ツール実行は SSE ストリーム内でサーバーサイドで行われる。

### Drive ツール

| ツール | 説明 |
|--------|------|
| `read_drive_file` | ID でファイル内容を読み取り |
| `search_drive_files` | 名前またはコンテンツで検索、フォルダフィルタ対応 |
| `list_drive_files` | ファイルと仮想フォルダを一覧表示 |
| `create_drive_file` | 新規ファイル作成（パス区切りで仮想フォルダ対応） |
| `update_drive_file` | 既存ファイルの内容を更新 |

`create_drive_file` または `update_drive_file` の後、サーバーは `_sync-meta.json` を更新し `drive_changed` SSE チャンクを送信。クライアントは `sync-complete` を dispatch し、手動 Pull なしでファイルツリーが更新される。

### Drive ツールモード

| モード | 利用可能なツール |
|--------|------------------|
| `all` | 全 5 ツール |
| `noSearch` | Read、Create、Update のみ（Search/List なし） |
| `none` | Drive ツールなし |

モデルと RAG 設定によりモードが自動制約される：
- **Gemma モデル**: `none` に強制（Function Calling 非対応）
- **Web Search モード**: `none` に強制（他のツールと非互換）
- **RAG 有効時**: Function Calling ツール無効（fileSearch + functionDeclarations は Gemini API 非対応）

### MCP ツール

MCP ツールは設定済み MCP サーバーから動的に検出される。ツール名は `mcp_{serverId}_{toolName}` 形式。MCP サーバーの選択はサーバー ID として `localStorage` に永続化。

### Function Call 制限

| 設定 | デフォルト | 説明 |
|------|-----------|------|
| `maxFunctionCalls` | 20 | レスポンスあたりの最大ツール呼び出し数 |
| `functionCallWarningThreshold` | 5 | 残り呼び出し数がこの値以下になったら警告 |

制限に達すると、Gemini は収集済み情報の要約を要求するシステムメッセージを受信する。

---

## モデル

モデルはユーザーの API プラン（Free または Paid）により決定される。各モデルの機能は異なる：

- **標準モデル**: ストリーミングテキスト + Function Calling + 思考
- **画像モデル**: 画像生成（Function Calling なし）
- **Gemma モデル**: テキストのみ（Function Calling なし、思考なし）
- **Flash Lite**: `thinkingBudget: -1`（明示的な制限なし）で思考有効

モデル選択はドロップダウンでチャットごとに設定可能。スラッシュコマンドでモデルをオーバーライド可能。

---

## RAG & Web Search

### RAG (File Search)

ドロップダウンから RAG ストアを選択。Gemini は設定済みストア ID で Gemini File Search を使用。結果にはバッジとしてソース帰属が表示される。

### Web Search

ドロップダウンから「Web Search」を選択。`googleSearch` ツールを使用。Function Calling および MCP ツールとは非互換（自動無効化）。

### RAG Top-K

設定で変更可能（1-20、デフォルト 5）。検索結果の考慮件数を制御。

---

## スラッシュコマンド

`/` を入力するとコマンドオートコンプリートが開く。コマンドは以下を提供：

| 機能 | 説明 |
|------|------|
| `promptTemplate` | メッセージとして送信されるテキストテンプレート |
| テンプレート変数 | `{content}`（アクティブファイル）、`{selection}`（エディタ選択テキスト） |
| モデルオーバーライド | このコマンド用に特定のモデルを使用 |
| 検索設定オーバーライド | 特定の RAG ストアまたは Web Search を使用 |
| Drive ツールモードオーバーライド | コマンド別にツールアクセスを制御 |
| MCP サーバーオーバーライド | 特定の MCP サーバーを有効化 |

### ファイル参照

`@` を入力するとファイルメンションのオートコンプリートが開く。`@filename` 参照は送信前に解決される：
- **Drive ツール有効時**: `[file: name, fileId: id]` に置換（Gemini がツール経由で読み取り可能）
- **Drive ツール無効時**: ファイル内容を取得してインライン展開

### アクティブファイルコンテキスト

明示的なコンテキスト（`{content}`、`{selection}`、`@file`）が指定されない場合、現在開いているファイルの名前と ID が自動的に付加され、Gemini が必要に応じて `read_drive_file` を使用可能。

---

## 添付ファイル

ドラッグ＆ドロップまたはクリップボタンをクリックしてファイルを添付。

| タイプ | 形式 |
|--------|------|
| 画像 | `image/*` — インライン Base64 データとして送信 |
| PDF | `application/pdf` — インライン Base64 データとして送信 |

添付ファイルは Gemini API リクエストの `inlineData` パーツとして含まれる。

---

## 画像生成

画像対応モデル（例: `gemini-2.5-flash-image`）を選択すると、チャットは画像生成モードに切り替わる：
- `generateContent` を使用（ストリーミングチャットではない）
- レスポンスにはテキストと画像の両方を含むことが可能
- 画像はダウンロードボタンと Drive 保存ボタン付きでインライン表示
- Drive 保存は `sync-complete` を dispatch してファイルツリーを更新

---

## チャット履歴

### 保存先

チャット履歴は Google Drive の `history/chats/` に JSON ファイルとして保存。各チャットは以下を持つ：
- `id`: 一意のチャット識別子
- `title`: 最初のメッセージ内容（50 文字に切り詰め）
- `messages`: `Message` オブジェクトの配列
- `createdAt` / `updatedAt`: タイムスタンプ

チャット履歴フォルダ内の `_meta.json` ファイルが、全チャットを高速一覧のためにインデックス。

### 暗号化

設定で `encryptChatHistory` が有効な場合、新規チャットは Drive 保存前に暗号化される。暗号化されたチャットはキャッシュ済み認証情報またはパスワードプロンプトを使用してクライアントサイドで復号化される。

### 操作

| アクション | 説明 |
|------------|------|
| 新規チャット | メッセージをクリアして新規開始 |
| チャット選択 | Drive からメッセージを読み込み（必要に応じて復号化） |
| チャット削除 | Drive と履歴リストから削除 |
| 自動保存 | アシスタントの応答完了後（`done` チャンク受信時）に保存 |

---

## アーキテクチャ

### データフロー

```
ブラウザ (ChatPanel)          サーバー (api.chat)        Gemini API
┌──────────────────┐    ┌──────────────────┐    ┌──────────────┐
│ messages state    │    │ SSE stream       │    │ generateContent│
│ streaming state   │◄──►│ executeToolCall   │◄──►│ Stream       │
│ tool call display │    │  ├─ Drive tools   │    │ Function calls│
│ autocomplete      │    │  ├─ MCP tools     │    └──────────────┘
│ chat history      │    │  └─ drive_changed │
└──────────────────┘    └──────────────────┘
                              │
                        ┌─────▼──────┐
                        │ Google Drive│
                        │ _sync-meta │
                        │ history/   │
                        └────────────┘
```

### 主要ファイル

| ファイル | 役割 |
|----------|------|
| `app/routes/api.chat.tsx` | Chat SSE API — ストリーミング、ツールディスパッチ、`drive_changed` 送信 |
| `app/routes/api.chat.history.tsx` | チャット履歴 CRUD（一覧、保存、削除） |
| `app/services/gemini-chat.server.ts` | Gemini ストリーミング + Function Calling、RAG、思考、画像生成 |
| `app/services/drive-tools.server.ts` | Drive ツール定義と実行 |
| `app/services/chat-history.server.ts` | チャット履歴の永続化（Drive + `_meta.json`） |
| `app/services/mcp-tools.server.ts` | MCP ツールの検出と実行 |
| `app/components/ide/ChatPanel.tsx` | チャットパネル — 状態管理、SSE パース、履歴 UI |
| `app/components/chat/ChatInput.tsx` | 入力エリア — モデル/RAG/ツール選択、オートコンプリート、添付 |
| `app/components/chat/MessageList.tsx` | メッセージリスト、ストリーミング中の部分メッセージ表示 |
| `app/components/chat/MessageBubble.tsx` | メッセージ表示 — 思考、ツールバッジ、画像、Markdown |
| `app/components/chat/AutocompletePopup.tsx` | オートコンプリートポップアップ UI |
| `app/hooks/useAutocomplete.ts` | オートコンプリートロジック（スラッシュコマンド、ファイルメンション、変数） |
| `app/types/chat.ts` | チャット型定義（Message、StreamChunk、ToolCall 等） |

### API ルート

| ルート | メソッド | 説明 |
|--------|----------|------|
| `/api/chat` | POST | Function Calling 付き Chat SSE ストリーム |
| `/api/chat/history` | GET | チャット履歴一覧 |
| `/api/chat/history` | POST | チャット履歴保存 |
| `/api/chat/history` | DELETE | チャット履歴削除 |
