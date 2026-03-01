# Workflow Execution

YAML パース、ハンドラベースのノードディスパッチ、SSE ストリーミング、インタラクティブプロンプト、AI ワークフロー生成を備えたワークフロー実行エンジン。

## Features

- **YAML パーサー**: YAML ワークフロー定義を実行可能な AST に変換
- **ハンドラベースの実行**: 24 種類のノードタイプを個別のハンドラ関数にディスパッチ
- **SSE ストリーミング**: Server-Sent Events によるリアルタイム実行ログ配信
- **インタラクティブプロンプト**: 実行を一時停止してユーザー入力を求め、再開
- **サブワークフロー実行**: 循環検出付きの再帰的ワークフロー呼び出し
- **変数テンプレート**: `{{var}}` 構文でネストアクセス、配列インデックス、JSON エスケープ対応
- **AI ワークフロー生成**: 自然言語から Gemini でワークフローを生成・修正
- **実行履歴**: ステップ単位の詳細を含む実行記録を Google Drive に保存
- **ショートカットキー実行**: カスタムキーボードショートカットで特定ワークフローを実行

---

## パーサー

`parseWorkflowYaml(yamlContent)` が YAML を `Workflow` オブジェクトに変換する。

### ワークフロー構造

```typescript
Workflow {
  nodes: Map<string, WorkflowNode>   // ノード ID → ノード定義
  edges: WorkflowEdge[]              // ノード間の接続
  startNode: string                  // エントリポイントのノード ID
  options?: WorkflowOptions          // { showProgress?: boolean }
  positions?: Map<string, Position>  // ダイアグラム上のビジュアル位置
}
```

### エッジの解決

エッジは以下の優先順位で解決される:

1. ノードの明示的な `next` / `trueNext` / `falseNext` プロパティ
2. 指定がない場合はシーケンシャル順で次のノード
3. `"end"` キーワードで実行パスを終了

条件分岐ノード（`if` / `while`）は `trueNext` が必須、`falseNext` は省略可（省略時はシーケンス内の次のノード）。

### ノード ID の正規化

- ID が未指定の場合は自動生成
- 重複は `_2`, `_3` サフィックスで対応
- ノードタイプは有効な型のセットに対してバリデーション

---

## エグゼキューター

`executeWorkflow()` がパース済みワークフローをスタックベースの深さ優先探索で実行する。

### 実行フロー

1. `startNode` をスタックにプッシュ
2. スタックからノードをポップ
3. 中断シグナルを確認
4. `node.type` に応じてハンドラにディスパッチ
5. ハンドラがロジックを実行し、`context.variables` を変更
6. 結果をログ記録（success / error）
7. `getNextNodes()` で次のノードを取得
8. 次のノードをスタックにプッシュ（左から右の実行順を維持するため逆順）
9. スタックが空になるかエラーが発生するまで繰り返し

### 実行制限

| 制限 | 値 | 説明 |
|------|-----|------|
| `MAX_WHILE_ITERATIONS` | 1,000 | while ループあたりの最大反復回数 |
| `MAX_TOTAL_STEPS` | 100,000 | 全体の最大ノード実行回数 |

### 実行コンテキスト

```typescript
ExecutionContext {
  variables: Map<string, string | number>  // ノード間で共有される状態
  logs: ExecutionLog[]                      // 全ノードの実行ログ
  lastCommandInfo?: LastCommandInfo         // command ノードの内省用
}
```

### サービスコンテキスト

ハンドラに注入される外部依存:

```typescript
ServiceContext {
  driveAccessToken: string
  driveRootFolderId: string
  driveHistoryFolderId: string            // 編集履歴ファイル用フォルダ ID
  geminiApiKey?: string
  abortSignal?: AbortSignal
  editHistorySettings?: EditHistorySettings  // リモート編集履歴設定
  settings?: UserSettings
  onDriveFileUpdated?: (data) => void   // SSE へブロードキャスト
  onDriveFileCreated?: (data) => void   // SSE へブロードキャスト
  onDriveFileDeleted?: (data) => void   // SSE へブロードキャスト
}
```

### エラーハンドリング

| レベル | 動作 |
|--------|------|
| ハンドラエラー | キャッチしてログ記録、ステータス `"error"` で実行停止 |
| 中断シグナル | 各ステップで確認、ステータス `"cancelled"` に設定 |
| プロンプトキャンセル | 値が `null`、ハンドラがエラーをスロー |
| サブワークフローエラー | "Sub-workflow execution failed" メッセージでラップ |
| 最大反復/ステップ数超過 | 無限ループを防止、エラーをスロー |

### 実行レコード

実行完了後（エラー時も含む）に Drive に保存:

```typescript
ExecutionRecord {
  id: string
  workflowId: string
  workflowName: string
  startTime: string        // ISO タイムスタンプ
  endTime: string
  status: "running" | "completed" | "error" | "cancelled"
  steps: ExecutionStep[]   // ノードごとの input/output/status/error
}
```

---

## 変数テンプレート

### テンプレート構文

| 構文 | 説明 |
|------|------|
| `{{varName}}` | 単純な変数置換 |
| `{{varName.field.nested}}` | ネストオブジェクトアクセス |
| `{{arr[0]}}` | 配列インデックス（数値リテラル） |
| `{{arr[idx]}}` | 配列インデックス（変数参照） |
| `{{varName:json}}` | JSON 文字列に埋め込むための JSON エスケープ |

### 解決方法

- 反復置換（ネストテンプレート用に最大 10 回反復）
- 文字列リテラルからクォートを除去
- 数値文字列の数値型自動検出
- JSON 文字列化された値の JSON パース

### 条件演算子

`if` および `while` ノードで使用:

| 演算子 | 説明 |
|--------|------|
| `==` | 等しい |
| `!=` | 等しくない |
| `<` | より小さい |
| `>` | より大きい |
| `<=` | 以下 |
| `>=` | 以上 |
| `contains` | 文字列を含む、または JSON 配列に要素を含む |

---

## SSE ストリーミング

実行はブラウザ内でローカルに行われる（21/24 ノードタイプ）。サーバーが必要なノード（mcp, rag-sync, gemihub-command）のみ API 呼出。

### エンドポイント

| メソッド | エンドポイント | 説明 |
|---------|--------------|------|
| POST | `/api/workflow/execute-node` | サーバー必須ノードの単体実行 |
| POST | `/api/workflow/mcp-proxy` | MCP ツール定義取得・実行プロキシ |
| GET/POST | `/api/workflow/history` | 実行履歴の一覧/読込/保存/削除 |
| `error` | 致命的エラーメッセージ |
| `prompt-request` | ユーザー入力待ちのプロンプト（type, title, options 等） |
| `drive-file-updated` | ワークフローが Drive ファイルを更新 |
| `drive-file-created` | ワークフローが Drive ファイルを作成 |

### クライアントサイドフック

`useLocalWorkflowExecution` が実行状態を管理:

```typescript
{
  logs: LogEntry[]
  status: "idle" | "running" | "completed" | "cancelled" | "error" | "waiting-prompt"
  promptData: Record<string, unknown> | null
}
```

メソッド: `executeWorkflow(yaml, options?)`, `stop()`, `handlePromptResponse(value)`

---

## インタラクティブプロンプト

ワークフローはユーザー入力のために一時停止できる。

### プロンプトフロー

1. ハンドラが `promptCallbacks.promptForValue(title, default, multiline)` を呼び出し
2. フックがステータスを `"waiting-prompt"` に設定しプロンプトモーダルを表示
3. ユーザーが入力を送信
4. `handlePromptResponse()` が Promise を解決しハンドラが再開

### プロンプトタイプ

| タイプ | UI | 戻り値 |
|--------|-----|--------|
| `value` | テキスト入力（単行/複数行） | 文字列 |
| `dialog` | ボタン選択 + オプションの入力欄 | JSON: `{button, selected, input?}` |
| `drive-file` | Drive ファイルピッカー | JSON: `{id, name, mimeType}` |
| `diff` | 差分の横並び表示 | `"OK"`（承認）または `"Cancel"`（拒否） |
| `password` | パスワード入力 | パスワード文字列 |

### キャンセル

- ユーザーがプロンプトをキャンセルすると値は `null`
- ハンドラがエラーをスロー、エグゼキューターは `"error"` ステータスで停止
- 停止エンドポイントも保留中のプロンプトを `null` で解決

---

## サブワークフロー実行

`workflow` ノードタイプが別のワークフローファイルを実行する。

### 機能

- Drive からファイルパスまたは名前でワークフローを読み込み
- 変数マッピング: JSON または `key=value` ペアによる入出力バインディング
- 出力分離のためのオプション変数プレフィックス
- `subWorkflowStack` による循環検出（最大深度: 20）
- 親と `serviceContext` および `promptCallbacks` を共有

---

## ハンドラ

24 種類のノードタイプのうち、21 はクライアントサイド（`app/engine/local-handlers/`）で、3 はサーバーサイド（`app/engine/handlers/`）で実行される。

### 制御フロー

| ハンドラ | ノードタイプ | 説明 |
|---------|------------|------|
| `handleVariableNode` | `variable` | 変数の宣言・初期化 |
| `handleSetNode` | `set` | 式で変数を更新（演算: `+`, `-`, `*`, `/`, `%`） |
| `handleIfNode` | `if` | 条件を評価し、分岐選択用のブール値を返す |
| `handleWhileNode` | `while` | ループ継続のための条件評価 |
| `handleSleepNode` | `sleep` | 中断シグナル対応の非同期スリープ |

### LLM / AI

| ハンドラ | ノードタイプ | 説明 |
|---------|------------|------|
| `handleCommandNode` | `command` | Gemini チャットストリーミング（ファンクションコール、Drive/MCP/RAG/Web Search ツール対応） |

### Drive 操作

| ハンドラ | ノードタイプ | 説明 |
|---------|------------|------|
| `handleDriveFileNode` | `drive-file` | Drive ファイルの作成/更新（上書き/追記、差分レビュー、暗号化対応） |
| `handleDriveReadNode` | `drive-read` | Drive ファイル内容の読み取り（テキストまたはバイナリを FileExplorerData として） |
| `handleDriveSearchNode` | `drive-search` | クエリによる Drive ファイル検索 |
| `handleDriveListNode` | `drive-list` | ファイル一覧（名前/作成日/更新日でソート、時間範囲フィルタ対応） |
| `handleDriveFolderListNode` | `drive-folder-list` | フォルダのみ一覧 |
| `handleDriveFilePickerNode` | `drive-file-picker` | インタラクティブな Drive ファイルピッカーダイアログ |
| `handleDriveSaveNode` | `drive-save` | FileExplorerData（バイナリ/テキスト）を Drive に保存 |
| `handleDriveDeleteNode` | `drive-delete` | ファイルのソフトデリート（trash/ に移動） |

### インタラクティブ

| ハンドラ | ノードタイプ | 説明 |
|---------|------------|------|
| `handlePromptValueNode` | `prompt-value` | テキスト入力プロンプト |
| `handlePromptFileNode` | `prompt-file` | Drive ファイルピッカープロンプト、ファイル内容を返す |
| `handlePromptSelectionNode` | `prompt-selection` | 複数行テキスト入力プロンプト |
| `handleDialogNode` | `dialog` | ボタンダイアログ（マルチセレクト、入力欄オプション付き） |

### インテグレーション

| ハンドラ | ノードタイプ | 説明 |
|---------|------------|------|
| `handleWorkflowNode` | `workflow` | 変数マッピング付きサブワークフロー実行 |
| `handleJsonNode` | `json` | JSON 文字列変数のパース（マークダウンコードブロック対応） |
| `handleHttpNode` | `http` | HTTP リクエスト（json/form-data/binary/text コンテンツタイプ） |
| `handleMcpNode` | `mcp` | OAuth 対応の HTTP 経由 MCP ツール呼び出し |
| `handleRagSyncNode` | `rag-sync` | Drive ファイルを Gemini RAG ストアに同期 |
| `handleGemihubCommandNode` | `gemihub-command` | 特殊コマンド: encrypt, publish, unpublish, duplicate, convert-to-pdf, convert-to-html, rename |

---

## AI ワークフロー生成

自然言語から Gemini を使ってワークフローを生成・修正する。

### エンドポイント

POST `/api/workflow/ai-generate`（SSE ストリーム）

### リクエスト

```typescript
{
  mode: "create" | "modify"
  name?: string                      // ワークフロー名（create モード）
  description: string                // 自然言語の説明
  currentYaml?: string               // 既存の YAML（modify モード）
  model?: ModelType                   // モデルオーバーライド
  history?: Array<{role, text}>      // 再生成用の会話履歴
  executionSteps?: ExecutionStep[]   // 改善用の実行コンテキスト
}
```

### SSE イベント

| タイプ | 説明 |
|--------|------|
| `thinking` | AI の推論内容 |
| `text` | 生成されたワークフロー YAML |
| `error` | エラーメッセージ |

### UI（AIWorkflowDialog）

1. **入力フェーズ**: 名前/説明入力、モデル選択、実行履歴のオプション追加
2. **生成フェーズ**: ストリーミングで思考過程と生成 YAML を表示
3. **プレビューフェーズ**: 最終 YAML の表示、編集・再生成オプション

再生成ではユーザー/モデルのターン会話履歴を維持。

---

## 実行 UI

### WorkflowPropsPanel

IDE 右サイドバーのワークフロービュー:

- ドラッグ&ドロップ対応のノードリスト
- ローカル実行の実行/停止ボタン
- ステータスアイコン付きのリアルタイム実行ログ表示
- ツール結果表示用の MCP アプリモーダル
- 入力待ち時のプロンプトモーダル

### PromptModal

プロンプトタイプに応じた異なる UI をレンダリング:

- `value`: テキスト入力（単行/複数行）
- `dialog`: ボタン選択（オプションのテキスト入力・マルチセレクト付き）
- `drive-file`: キャッシュ済みファイルツリーによるファイルブラウザ
- `diff`: 横並びの差分ビュー
- `password`: パスワード入力

---

## ショートカットキー実行

**設定 > ショートカット** でカスタムキーボードショートカットを設定し、特定のワークフローを実行できる。

### 設定項目

各ショートカットバインディングの構成:

| フィールド | 説明 |
|-----------|------|
| `action` | アクション種別（現在は `executeWorkflow` のみ） |
| `targetFileId` | 対象ワークフローの Drive ファイル ID |
| `targetFileName` | 対象ワークフローの表示名 |
| `key` | 押下するキー（例: `F5`, `e`, `r`） |
| `ctrlOrMeta` | Ctrl（Win/Linux）/ Cmd（Mac）を要求 |
| `shift` | Shift を要求 |
| `alt` | Alt を要求 |

### バリデーションルール

- **修飾キー必須**: 単一文字キー（a〜z, 0〜9 等）には Ctrl/Cmd または Alt が必要。Shift のみでは不十分。ファンクションキー（F1〜F12）は単独で使用可能。
- **ビルトイン衝突防止**: アプリケーションで予約されているキーの組み合わせ（検索の Ctrl+Shift+F、Quick Open の Ctrl+P）は割り当て不可。
- **重複検出**: 同じキーの組み合わせを複数のショートカットに割り当てることはできない。

### 実行フロー

1. ユーザーが IDE で設定済みショートカットキーを押下
2. `_index.tsx` の keydown ハンドラがバインディングにマッチ
3. 対象ワークフローがアクティブでない場合、`handleSelectFile()` でナビゲーション
4. `shortcut-execute-workflow` CustomEvent を対象 `fileId` 付きでディスパッチ
5. `WorkflowPropsPanel` がイベントを受信:
   - ワークフローが読み込み済み → `startExecution()` で即時実行
   - ワークフローが読み込み中（ナビゲーション直後）→ `pendingExecutionRef` で遅延実行し、ワークフロー読み込み完了後に発火

### 設定の保存先

ショートカットバインディングは Drive の `settings.json` 内の `shortcutKeys` フィールド（`ShortcutKeyBinding` の配列）に保存される。Settings ルートの `saveShortcuts` アクションで保存。

---

## Key Files

| File | Description |
|------|-------------|
| `app/engine/parser.ts` | YAML パーサー、AST ビルダー、エッジ解決 |
| `app/engine/executor.ts` | スタックベースのサーバーエグゼキューター |
| `app/engine/local-executor.ts` | クライアントサイドエグゼキューター（21/24 ローカル、3 サーバー） |
| `app/engine/local-handlers/` | ローカルノードハンドラ（command, http, drive, prompt, workflow） |
| `app/engine/types.ts` | コア型（WorkflowNode, ExecutionContext, ServiceContext, PromptCallbacks） |
| `app/engine/handlers/` | 24 種類のノードタイプハンドラ（サーバーサイド） |
| `app/hooks/useLocalWorkflowExecution.ts` | クライアントサイドローカル実行フック |
| `app/routes/api.workflow.execute-node.tsx` | サーバー必須ノードの単体実行 API |
| `app/routes/api.workflow.mcp-proxy.tsx` | MCP ツール定義取得・実行プロキシ |
| `app/routes/api.workflow.ai-generate.tsx` | AI ワークフロー生成エンドポイント |
| `app/services/drive-local.ts` | IndexedDB ベースの Drive 操作 |
| `app/services/drive-tools-local.ts` | ローカル Gemini function calling Drive ツール |
| `app/services/gemini-chat-core.ts` | ブラウザ互換 Gemini API クライアント |
| `app/utils/drive-file-local.ts` | ローカル実行用 Drive イベント UI ディスパッチ |
| `app/components/execution/PromptModal.tsx` | インタラクティブプロンプトモーダル |
| `app/components/ide/WorkflowPropsPanel.tsx` | ワークフローノードリスト、実行制御、ログ |
| `app/components/ide/AIWorkflowDialog.tsx` | AI 生成ダイアログ UI |
| `app/components/settings/ShortcutsTab.tsx` | ショートカットキー設定 UI |
| `app/types/settings.ts` | `ShortcutKeyBinding` 型、バリデーションヘルパー（`isBuiltinShortcut`, `isValidShortcutKey`） |
