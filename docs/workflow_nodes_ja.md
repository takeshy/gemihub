# Workflow Node リファレンス

ワークフローで使用できる全ノードタイプの詳細仕様です。

## ノードタイプ一覧

| カテゴリ | ノード | 説明 |
|---------|--------|------|
| 変数 | `variable`, `set` | 変数の宣言と更新 |
| 制御 | `if`, `while`, `sleep` | 条件分岐、ループ、一時停止 |
| LLM | `command` | Gemini API でプロンプトを実行 |
| データ | `http`, `json`, `script` | HTTP リクエスト、JSON パース、JavaScript 実行 |
| Drive | `drive-file`, `drive-read`, `drive-search`, `drive-list`, `drive-folder-list`, `drive-save`, `drive-delete` | Google Drive ファイル操作 |
| プロンプト | `prompt-value`, `prompt-file`, `prompt-selection`, `dialog`, `drive-file-picker` | ユーザー入力ダイアログ |
| 合成 | `workflow` | 別のワークフローをサブワークフローとして実行 |
| 外部連携 | `mcp` | リモート MCP サーバーを呼び出し |
| RAG | `rag-sync` | ファイルを RAG ストアに同期 |
| コマンド | `gemihub-command` | GemiHub ファイル操作を実行 |

---

## ノードリファレンス

### variable

変数を宣言し初期化します。

```yaml
- id: init
  type: variable
  name: counter
  value: "0"
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `name` | Yes | No | 変数名 |
| `value` | No | Yes | 初期値（デフォルト: 空文字列） |

数値は自動検出されます。値が数値としてパースできる場合、数値型として保存されます。

**`variable` ノードの `value` は省略可能です。** 省略した場合、2 つの便利な挙動があります:

- **入力宣言** — 呼び出し元（親ワークフロー、スキル呼び出し、ホットキートリガー）で既に変数がセットされていれば、その値を保持します。ワークフローが受け取る入力変数を宣言するのに使えます（上書きしません）。
- **空のアキュムレータ** — 呼び出し元で値がセットされていなければ、`""` で初期化されます。後から追記していくアキュムレータ用途に安全です。

```yaml
# 入力宣言 — 呼び出し元の値を使用、なければ ""
- id: declare-input
  type: variable
  name: inputText

# アキュムレータ — "" で開始し、後から追記される
- id: init-output
  type: variable
  name: outputMarkdown

# 明示的な初期値 — 呼び出し元の状態に関係なく常に 0 にリセット
- id: init-counter
  type: variable
  name: counter
  value: 0
```

---

### set

式を評価して変数を更新します。

```yaml
- id: increment
  type: set
  name: counter
  value: "{{counter}} + 1"
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `name` | Yes | No | 更新する変数名 |
| `value` | Yes | Yes | 評価する式 |

算術演算子をサポート: `+`, `-`, `*`, `/`, `%`。変数が先に展開され、結果が `数値 演算子 数値` のパターンに一致すれば算術演算として評価されます。

---

### if

条件分岐。

```yaml
- id: branch
  type: if
  condition: "{{count}} > 10"
  trueNext: handleMany
  falseNext: handleFew
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `condition` | Yes | Yes | 比較演算子を含む条件式 |

**対応演算子:** `==`, `!=`, `<`, `>`, `<=`, `>=`, `contains`

**エッジルーティング:** `trueNext` / `falseNext`（YAML で定義、プロパティではなく）

`contains` 演算子は文字列と JSON 配列の両方で動作します:
- 文字列: `{{text}} contains error`
- 配列: `{{dialogResult.selected}} contains Option A`

---

### while

条件付きループ。

```yaml
- id: loop
  type: while
  condition: "{{counter}} < {{total}}"
  trueNext: processItem
  falseNext: done
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `condition` | Yes | Yes | ループ条件（`if` と同じ形式） |

**エッジルーティング:** `trueNext`（ループ本体）/ `falseNext`（終了）

while ノードあたりの最大反復回数: 1000（グローバル制限）。

---

### sleep

ワークフローの実行を一時停止します。

```yaml
- id: wait
  type: sleep
  duration: "2000"
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `duration` | Yes | Yes | スリープ時間（ミリ秒） |

---

### command

Gemini API を使用して LLM プロンプトを実行します。

```yaml
- id: ask
  type: command
  prompt: "要約してください: {{content}}"
  model: gemini-2.5-flash
  ragSetting: __websearch__
  driveToolMode: all
  mcpServers: "mcp_server_id_1,mcp_server_id_2"
  attachments: "imageVar"
  saveTo: summary
  saveImageTo: generatedImage
  systemPrompt: "あなたは親切なアシスタントです。"
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `prompt` | Yes | Yes | LLM に送信するプロンプトテキスト |
| `model` | No | Yes | モデル名（デフォルト: ユーザーが選択したモデル） |
| `ragSetting` | No | No | RAG 設定名、`__websearch__` でウェブ検索、`__none__`（デフォルト） |
| `driveToolMode` | No | No | `none`（デフォルト）、`all`、`noSearch` — Drive ツール呼び出しを有効化 |
| `mcpServers` | No | No | 有効にする MCP サーバー ID（カンマ区切り） |
| `attachments` | No | Yes | FileExplorerData を含む変数名（カンマ区切り） |
| `saveTo` | No | No | テキスト応答を保存する変数 |
| `saveImageTo` | No | No | 生成画像を保存する変数（FileExplorerData JSON） |
| `systemPrompt` | No | Yes | LLM のシステムプロンプト |
| `enableThinking` | No | No | `"true"`（デフォルト）で思考/推論を有効化、`"false"` で無効化 |

`command` ノードはチャットと同じツール制約を使用します:
- Gemma モデルはファンクションツール（Drive/MCP）を強制的に無効化
- ウェブ検索モードはファンクションツール（Drive/MCP）を強制的に無効化

---

### http

HTTP リクエストを実行します。

```yaml
- id: fetch
  type: http
  url: "https://api.example.com/data"
  method: POST
  contentType: json
  headers: '{"Authorization": "Bearer {{token}}"}'
  body: '{"query": "{{searchTerm}}"}'
  saveTo: response
  saveStatus: statusCode
  throwOnError: "true"
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `url` | Yes | Yes | リクエスト URL |
| `method` | No | No | `GET`（デフォルト）, `POST`, `PUT`, `PATCH`, `DELETE` |
| `contentType` | No | No | `json`（デフォルト）, `form-data`, `text`, `binary` |
| `headers` | No | Yes | JSON オブジェクトまたは `Key: Value` 形式（1行1ペア） |
| `body` | No | Yes | リクエストボディ（POST/PUT/PATCH 用） |
| `responseType` | No | Yes | `auto`（デフォルト）, `text`, `binary` — Content-Type 自動判定をオーバーライド |
| `saveTo` | No | No | レスポンスボディを保存する変数 |
| `saveStatus` | No | No | HTTP ステータスコードを保存する変数 |
| `throwOnError` | No | Yes | 4xx/5xx 時にエラーをスローするか。**デフォルト: `"true"`** — HTTP エラーでワークフロー停止。明示的なエラー処理分岐がある場合のみ `"false"` を使用。 |

**`throwOnError` のデフォルトは `"true"`。** 4xx/5xx レスポンスでワークフローが停止し、失敗がチャット AI・ユーザー・復旧 UI（スキル失敗時の「Open workflow」ボタン）に伝わります。`saveStatus` を実際に読み取って分岐する場合など、ワークフロー内で実際にエラーハンドリング分岐がある場合のみ `"false"` を使ってください（単に "crash させないため" の用途は避ける）。

```yaml
# ✅ デフォルト: HTTP エラーでワークフロー停止
- id: fetch
  type: http
  url: "{{url}}"
  saveTo: body
  saveStatus: status

# ✅ 許容: 明示的なエラー処理分岐を下流に持つ場合
- id: fetch
  type: http
  url: "{{url}}"
  throwOnError: "false"
  saveTo: body
  saveStatus: status
- id: check-status
  type: if
  condition: "{{status}} >= 400"
  trueNext: handle-error    # 実際に何かする分岐

# ❌ アンチパターン: ハンドラなしですべての HTTP 失敗を握り潰す
- id: fetch
  type: http
  url: "{{url}}"
  throwOnError: "false"   # 503 でもワークフローは「成功」扱い
  saveTo: body
```

**クロスオリジン（CORS）:** ブラウザの `fetch()` で実行します。同一オリジンおよび CORS 対応のクロスオリジンエンドポイントは直接成功します。それ以外のクロスオリジン URL（ニュースサイト、OGP 取得、CORS ヘッダーを返さない旧来の API 等）は、全プランでサーバプロキシ（`/api/workflow/http-fetch`）経由で透過的にルーティングされ成功します。無料プランは 2 req/分、Premium は 60 req/分のレートリミットが適用されます。

**プロキシ制限:** サーバプロキシは以下の制限を強制します:
- **プラン別レートリミット** — Premium は 60 req/分、無料プランは 2 req/分。超過時は 429 + `Retry-After: 60`。
- **20 MB レスポンスサイズ上限** — 超過ボディは 413（`Content-Length` チェックと読み取り時の二段階で強制）。
- **30 秒 upstream タイムアウト** — 応答が詰まった upstream は 502。
- **SSRF ガード** — private / loopback / metadata IP レンジに解決されるホスト名は 400 で拒否。DNS 解決失敗は SSRF ではなく 502 として区別して返すため、再試行ロジックが正しく動作します。

**レスポンスタイプ判定:** デフォルト（`auto`）では Content-Type ヘッダーからバイナリ/テキストを自動判定します。`responseType: text` でテキスト処理を強制（例: サーバーが JSON を `application/octet-stream` で返す場合）、`responseType: binary` でバイナリ処理を強制できます。

**バイナリレスポンス**は自動検出され、FileExplorerData JSON（Base64 エンコード）として保存されます。

**binary contentType:** FileExplorerData を元の mimeType で生バイナリとして送信します。`drive-file-picker` や画像生成の結果と組み合わせて使用します。

**form-data の例:**
```yaml
- id: upload
  type: http
  url: "https://example.com/upload"
  method: POST
  contentType: form-data
  body: '{"file": "{{fileData}}"}'
  saveTo: response
```

`form-data` の場合:
- FileExplorerData（`drive-file-picker` / `drive-save` から）は自動検出されバイナリとして送信
- テキストファイルフィールドには `fieldName:filename` 構文を使用（例: `"file:report.html": "{{htmlContent}}"`)

---

### json

JSON 文字列をパースしてプロパティアクセスを可能にします。

```yaml
- id: parseResponse
  type: json
  source: response
  saveTo: data
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `source` | Yes | No | JSON 文字列を保持する **素の変数名**（`{{...}}` 不要、クォートで囲まない） |
| `saveTo` | Yes | No | パース結果を保存する変数 |

パース後、ドット表記でプロパティにアクセス: `{{data.items[0].name}}`

**マークダウンコードブロック内の JSON:** `` ```json ... ``` `` から自動抽出されます。

**`source` は素の変数名です。** 変数名だけを渡してください — 補間しない、クォートで囲まない、角括弧で囲まない:

```yaml
# ✅ 正しい
- id: parse-body
  type: json
  source: apiResponseBody
  saveTo: parsed

# ❌ 誤り
- id: parse-body
  type: json
  source: "{{apiResponseBody}}"          # ここでは補間しない
  # または: source: "[{{apiResponseBody}}]"  # ラップすると有効な JSON が壊れる
  saveTo: parsed
```

---

### script

サンドボックス化された iframe 内で JavaScript コードを実行します。DOM・ネットワーク・ストレージへのアクセスはなく、純粋な計算のみ可能です。`set` ノードの算術演算では対応できない文字列加工・データ変換・計算・エンコード/デコード等に使用します。

```yaml
- id: transform
  type: script
  code: |
    var items = '{{rawList}}'.split(',').map(function(s){ return s.trim(); });
    items.sort();
    return items.join('\n');
  saveTo: sortedList
  timeout: "5000"
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `code` | Yes | Yes | 実行する JavaScript コード。`return` で値を返す |
| `saveTo` | No | No | 結果を保存する変数 |
| `timeout` | No | No | タイムアウト（ミリ秒、デフォルト: 10000） |

**戻り値:**
- `undefined` / `null` → 空文字列
- 文字列以外 → JSON シリアライズ（配列、オブジェクト、数値など）
- 文字列 → そのまま保存

**非同期対応:** Promise は自動的に await されます。

**セキュリティ:** `sandbox="allow-scripts"` の iframe（opaque origin）で実行。親 DOM・Cookie・localStorage・ネットワークへのアクセス不可。

**例 — Base64 エンコード:**
```yaml
- id: encode
  type: script
  code: "return btoa('{{plainText}}')"
  saveTo: encoded
```

**例 — ユニーク単語の抽出:**
```yaml
- id: unique-words
  type: script
  code: |
    var words = '{{text:json}}'.split(/\s+/);
    var unique = [...new Set(words)];
    return unique.sort().join(', ');
  saveTo: uniqueWords
```

> **備考:** `command` ノードの function calling にも `execute_javascript` ツールがあり、AI がチャットやワークフロー実行中に JavaScript コードを動的に記述・実行できます。

---

### drive-file

Google Drive にファイルを書き込みます。

```yaml
- id: save
  type: drive-file
  path: "output/{{filename}}.md"
  content: "{{result}}"
  mode: overwrite
  confirm: "true"
  history: "true"
  open: "true"
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `path` | Yes | Yes | ファイルパス（`.md` 拡張子がない場合は自動付与） |
| `content` | No | Yes | 書き込む内容（デフォルト: 空文字列） |
| `mode` | No | No | `overwrite`（デフォルト）, `append`, `create`（既存ならスキップ） |
| `confirm` | No | No | `"true"`（デフォルト）で既存ファイル更新時に差分レビューダイアログを表示、`"false"` で確認なしに書き込み |
| `history` | No | No | `"true"` で編集履歴を保存 |
| `open` | No | No | `"true"` でワークフロー完了後にエディタでファイルを開く |

---

### drive-read

Google Drive からファイルを読み取ります。

```yaml
- id: read
  type: drive-read
  path: "notes/config.md"
  saveTo: content
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `path` | Yes | Yes | ファイルパスまたは Drive ファイル ID |
| `saveTo` | Yes | No | ファイル内容を保存する変数 |

**パス解決の仕組み:**
- パスが Drive ファイル ID のように見える場合（拡張子なし、20文字超）: 直接読み取り
- それ以外: ファイル名で検索し、`.md` 拡張子のフォールバックも試行

---

### drive-search

Google Drive でファイルを検索します。

```yaml
- id: search
  type: drive-search
  query: "{{searchTerm}}"
  searchContent: "true"
  limit: "10"
  saveTo: results
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `query` | Yes | Yes | 検索クエリ文字列 |
| `searchContent` | No | No | `"true"` でファイル内容も検索（デフォルト: 名前のみ） |
| `limit` | No | Yes | 最大件数（デフォルト: 10） |
| `saveTo` | Yes | No | 結果を保存する変数 |

**出力形式:**
```json
[
  {"id": "abc123", "name": "notes/todo.md", "modifiedTime": "2026-01-01T00:00:00Z"}
]
```

---

### drive-list

ファイル一覧をフィルタリング付きで取得します。

```yaml
- id: list
  type: drive-list
  folder: "Projects"
  limit: "20"
  sortBy: modified
  sortOrder: desc
  modifiedWithin: "7d"
  saveTo: fileList
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `folder` | No | Yes | 仮想フォルダプレフィックス（例: `"Projects"`） |
| `limit` | No | Yes | 最大件数（デフォルト: 50） |
| `sortBy` | No | No | `modified`（デフォルト）、`created`、`name` |
| `sortOrder` | No | No | `desc`（デフォルト）、`asc` |
| `modifiedWithin` | No | Yes | 時間フィルタ（例: `"7d"`, `"24h"`, `"30m"`） |
| `createdWithin` | No | Yes | 時間フィルタ（例: `"30d"`） |
| `saveTo` | Yes | No | 結果を保存する変数 |

**出力形式:**
```json
{
  "notes": [
    {"id": "abc123", "name": "Projects/todo.md", "modifiedTime": "...", "createdTime": "..."}
  ],
  "count": 5,
  "totalCount": 12,
  "hasMore": true
}
```

同期メタデータを使用した高速な一覧取得（ファイルごとの API 呼び出し不要）。「フォルダ」は仮想的なもので、ファイル名のパスプレフィックスから導出されます。

---

### drive-folder-list

仮想フォルダの一覧を取得します。

```yaml
- id: listFolders
  type: drive-folder-list
  folder: "Projects"
  saveTo: folderList
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `folder` | No | Yes | 親フォルダパス |
| `saveTo` | Yes | No | 結果を保存する変数 |

**出力形式:**
```json
{
  "folders": [{"name": "Active"}, {"name": "Archive"}],
  "count": 2
}
```

直下のサブフォルダのみ（1階層）を返し、アルファベット順にソートされます。

---

### drive-save

FileExplorerData を Google Drive にファイルとして保存します。

```yaml
- id: saveImage
  type: drive-save
  source: imageData
  path: "images/output"
  savePathTo: savedPath
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `source` | Yes | Yes | FileExplorerData JSON を含む変数名またはテンプレート |
| `path` | Yes | Yes | 保存先パス（ソースデータから拡張子を自動付与） |
| `savePathTo` | No | No | 最終ファイル名を保存する変数 |

---

### drive-delete

ファイルを `trash/` サブフォルダに移動してソフトデリートします。

```yaml
- id: cleanup
  type: drive-delete
  path: "notes/old-file.md"
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `path` | Yes | Yes | 削除するファイルのパス（`.md` 拡張子がない場合は自動付与） |

ファイルは `trash/` に移動され（完全削除ではなく）、同期メタデータから削除されます。`drive-file` と同じパス解決をサポートします（companion `_fileId` 変数、完全名フォールバック）。

---

### prompt-value

テキスト入力ダイアログを表示します。

```yaml
- id: input
  type: prompt-value
  title: "値を入力してください"
  default: "{{defaultText}}"
  multiline: "true"
  saveTo: userInput
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `title` | No | Yes | プロンプトラベル（デフォルト: `"Input"`） |
| `default` | No | Yes | デフォルト値 |
| `multiline` | No | No | `"true"` で複数行テキストエリア |
| `saveTo` | Yes | No | ユーザー入力を保存する変数 |

ユーザーがキャンセルした場合はエラーがスローされます。

---

### prompt-file

ファイルピッカーを表示し、選択されたファイルの内容を読み取ります。

```yaml
- id: pickFile
  type: prompt-file
  title: "ファイルを選択"
  saveTo: fileContent
  saveFileTo: fileInfo
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `title` | No | Yes | ピッカーダイアログのタイトル（デフォルト: `"Select a file"`） |
| `saveTo` | No | No | ファイル内容を保存する変数（テキスト） |
| `saveFileTo` | No | No | ファイル情報 JSON を保存する変数（`{path, basename, name, extension}`） |

`saveTo` または `saveFileTo` のいずれかが必須です。`drive-file-picker` と異なり、このノードはファイル内容を自動的に読み取ります。

ユーザーがキャンセルした場合はエラーがスローされます。

---

### prompt-selection

複数行テキスト入力ダイアログを表示します。

```yaml
- id: getText
  type: prompt-selection
  title: "テキストを入力してください"
  saveTo: selection
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `title` | No | Yes | プロンプトラベル（デフォルト: `"Enter text"`） |
| `saveTo` | Yes | No | ユーザー入力を保存する変数 |

常に複数行テキストエリアを表示します。ユーザーがキャンセルした場合はエラーがスローされます。

---

### dialog

オプション、ボタン、テキスト入力を含むダイアログを表示します。

```yaml
- id: ask
  type: dialog
  title: オプションを選択
  message: "処理する項目を選んでください"
  markdown: "true"
  options: "Option A, Option B, Option C"
  multiSelect: "true"
  inputTitle: "補足メモ"
  multiline: "true"
  defaults: '{"input": "デフォルトテキスト", "selected": ["Option A"]}'
  button1: 確認
  button2: キャンセル
  saveTo: dialogResult
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `title` | No | Yes | ダイアログタイトル（デフォルト: `"Dialog"`） |
| `message` | No | Yes | メッセージ内容 |
| `markdown` | No | No | `"true"` でメッセージを Markdown レンダリング |
| `options` | No | Yes | カンマ区切りの選択肢リスト |
| `multiSelect` | No | No | `"true"` でチェックボックス、`"false"` でラジオボタン |
| `inputTitle` | No | Yes | テキスト入力フィールドのラベル（設定時に入力欄を表示） |
| `multiline` | No | No | `"true"` で複数行テキストエリア |
| `defaults` | No | Yes | `input` と `selected` の初期値を含む JSON |
| `button1` | No | Yes | 主ボタンラベル（デフォルト: `"OK"`） |
| `button2` | No | Yes | 副ボタンラベル |
| `saveTo` | No | No | 結果を保存する変数 |

**結果の形式**（`saveTo` 変数）:
```json
{
  "button": "確認",
  "selected": ["Option A", "Option B"],
  "input": "テキスト"
}
```

> **重要:** `if` 条件で選択値をチェックする場合:
> - 単一選択: `{{dialogResult.selected[0]}} == Option A`
> - 配列に含まれるか（multiSelect）: `{{dialogResult.selected}} contains Option A`

---

### drive-file-picker

ファイル選択ダイアログを表示して Drive ファイルを選択します。`saveTo` を使用すると、ファイル内容が自動的に読み込まれます。バイナリファイル（PDF、画像など）は Base64 エンコード、テキストファイルはそのまま読み込まれます。

```yaml
- id: selectFile
  type: drive-file-picker
  title: "ファイルを選択"
  mode: select
  extensions: "pdf,doc,md"
  saveTo: fileData
  savePathTo: filePath
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `title` | No | Yes | ピッカーダイアログのタイトル（デフォルト: `"Select a file"`） |
| `mode` | No | No | `select`（デフォルト）で既存ファイルを選択、`create` で新しいパスを入力 |
| `default` | No | Yes | デフォルトファイルパス（`create` モードの初期値として使用） |
| `extensions` | No | No | カンマ区切りの許可拡張子 |
| `path` | No | Yes | 直接ファイルパス（設定時はピッカーをバイパス） |
| `saveTo` | No | No | FileExplorerData JSON を保存する変数（ファイル内容を含む） |
| `savePathTo` | No | No | ファイル名/パスを保存する変数 |

`saveTo` または `savePathTo` のいずれかが必須です。

**FileExplorerData の形式:**
```json
{
  "id": "abc123",
  "path": "notes/report.pdf",
  "basename": "report.pdf",
  "name": "report",
  "extension": "pdf",
  "mimeType": "application/pdf",
  "contentType": "binary",
  "data": "JVBERi0xLjQg..."
}
```

- `contentType`: バイナリファイル（PDF、画像など）は `"binary"`、テキストファイルは `"text"`
- `data`: バイナリファイルは Base64 エンコード、テキストファイルはプレーンテキスト
- `create` モードでは `data` は空（ファイルがまだ存在しないため）

**例 — 画像分析:**
```yaml
- id: select-image
  type: drive-file-picker
  title: "分析する画像を選択"
  extensions: "png,jpg,jpeg,gif,webp"
  saveTo: imageData
- id: analyze
  type: command
  prompt: "この画像を詳しく説明してください"
  attachments: imageData
  saveTo: analysis
```

**例 — ダイアログなしでファイル読み込み:**
```yaml
- id: load-pdf
  type: drive-file-picker
  path: "{{pdfPath}}"
  saveTo: pdfData
```

---

### workflow

別のワークフローをサブワークフローとして実行します。

```yaml
- id: runSub
  type: workflow
  path: "workflows/summarize.yaml"
  name: "Summarizer"
  input: '{"text": "{{content}}"}'
  output: '{"result": "summary"}'
  prefix: "sub_"
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `path` | Yes | Yes | ワークフローファイルのパス |
| `name` | No | Yes | ワークフロー名（複数ワークフローファイル用） |
| `input` | No | Yes | サブワークフロー入力の JSON または `key=value` マッピング |
| `output` | No | Yes | 出力変数の JSON または `key=value` マッピング |
| `prefix` | No | No | 全出力変数のプレフィックス（`output` 未指定時） |

**入力マッピング:** `'{"subVar": "{{parentValue}}"}'` または `subVar={{parentValue}},x=hello`

**出力マッピング:** `'{"parentVar": "subResultVar"}'` または `parentVar=subResultVar`

`output` も `prefix` も指定しない場合、サブワークフローの全変数が直接コピーされます。

---

### mcp

HTTP 経由でリモート MCP（Model Context Protocol）サーバーのツールを呼び出します。

```yaml
- id: search
  type: mcp
  url: "https://mcp.example.com/v1"
  tool: "web_search"
  args: '{"query": "{{searchTerm:json}}"}'
  headers: '{"Authorization": "Bearer {{apiKey}}"}'
  saveTo: searchResults
  saveUiTo: uiData
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `url` | Yes | Yes | MCP サーバーエンドポイント URL |
| `tool` | Yes | Yes | 呼び出すツール名 |
| `args` | No | Yes | ツール引数の JSON オブジェクト |
| `headers` | No | Yes | HTTP ヘッダーの JSON オブジェクト |
| `saveTo` | No | No | 結果を保存する変数 |
| `saveUiTo` | No | No | UI リソースデータを保存する変数（サーバーが `_meta.ui.resourceUri` を返す場合） |

JSON-RPC 2.0 プロトコル（`tools/call` メソッド）を使用。レスポンスのテキストコンテンツパーツは改行で結合されます。

---

### rag-sync

Drive ファイルを Gemini RAG ストア（File Search）に同期します。

```yaml
- id: sync
  type: rag-sync
  path: "notes/knowledge-base.md"
  ragSetting: "myRagStore"
  saveTo: syncResult
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `path` | Yes | Yes | Drive 上のファイルパス |
| `ragSetting` | Yes | Yes | RAG 設定名（設定 > RAG から） |
| `saveTo` | No | No | 同期結果を保存する変数 |

指定した Drive ファイルを RAG ストアにアップロードします。ストアが存在しない場合は作成します。結果には `{path, ragSetting, fileId, storeName, mode, syncedAt}` が含まれます。

RAG 対応の `command` ノード（同じ設定名を `ragSetting` に指定）でファイルを利用する準備に使用します。

---

### gemihub-command

GemiHub のファイル操作（暗号化、公開、名前変更など）をワークフローノードとして実行します。

```yaml
- id: pub
  type: gemihub-command
  command: publish
  path: "notes/readme.md"
  saveTo: url
```

| プロパティ | 必須 | テンプレート | 説明 |
|-----------|:----:|:----------:|------|
| `command` | Yes | Yes | コマンド名（下表参照） |
| `path` | Yes | Yes | ファイルパス、Drive ファイル ID、または `{{variable}}` |
| `text` | No | Yes | 追加テキスト引数（用途はコマンドにより異なる） |
| `saveTo` | No | No | 結果を保存する変数 |

**利用可能なコマンド:**

| コマンド | `text` の用途 | `saveTo` の結果 |
|---------|-------------|-----------------|
| `encrypt` | — | 新しいファイル名（`.encrypted` サフィックス付き） |
| `publish` | — | 公開 URL |
| `unpublish` | — | `"ok"` |
| `duplicate` | カスタム名（任意; デフォルト: `"name (copy).ext"`） | 新しいファイル名 |
| `convert-to-pdf` | — | PDF ファイル名（`temporaries/` に保存） |
| `convert-to-html` | — | HTML ファイル名（`temporaries/` に保存） |
| `rename` | 新しい名前（**必須**） | 新しいファイル名 |

**パス解決**は `drive-read` と同じパターンに従います:
- 直接 Drive ファイル ID（20文字以上の英数字）
- `drive-file-picker` からの companion `_fileId` 変数
- ファイル名検索 → `findFileByExactName` フォールバック

**例:**

```yaml
# ファイルを暗号化
- id: enc
  type: gemihub-command
  command: encrypt
  path: "notes/secret.md"
  saveTo: encryptedName

# カスタム名で複製
- id: dup
  type: gemihub-command
  command: duplicate
  path: "templates/report.md"
  text: "reports/2026-report.md"
  saveTo: newFile

# ユーザーが選択したファイルの名前を変更
- id: pick
  type: drive-file-picker
  title: "名前を変更するファイルを選択"
  savePathTo: filePath
- id: ren
  type: gemihub-command
  command: rename
  path: "{{filePath}}"
  text: "{{filePath}}-archived.md"
  saveTo: renamedName

# マークダウンを PDF に変換
- id: pdf
  type: gemihub-command
  command: convert-to-pdf
  path: "notes/report.md"
  saveTo: pdfName

# マークダウンを HTML に変換
- id: html
  type: gemihub-command
  command: convert-to-html
  path: "notes/report.md"
  saveTo: htmlName
```

---

## 変数展開

`{{variable}}` 構文で変数を参照します:

```yaml
# 基本
path: "{{folder}}/{{filename}}.md"

# オブジェクト/配列アクセス
url: "https://api.example.com?id={{data.id}}"
content: "{{items[0].name}}"

# 動的インデックス（ループ用）
path: "{{parsed.notes[counter].path}}"
```

### JSON エスケープ修飾子

`{{variable:json}}` で **文字列リテラル内に埋め込む** ための値をエスケープします。改行、クォート、その他の特殊文字を適切にエスケープします。

**重要:** `:json` は *内容のみ* をエスケープし、**外側のクォートは付けません**。文字列内に埋め込む場合は自分でクォートを書く必要があります。

```yaml
# :json なし - 内容に改行/クォートがあると壊れる
args: '{"text": "{{content}}"}'       # 特殊文字があるとエラー

# :json あり - どんな内容でも安全（周囲の "..." は自分で書いた文字列リテラル）
args: '{"text": "{{content:json}}"}'  # OK - 適切にエスケープ
```

**`script` ノード（JavaScript）内:**

`:json` はコード実行前にプレーンテキストとして置換されるため、JS 文字列にしたい場合はクォートで囲む必要があります:

```yaml
# ✅ 正しい — エスケープされた内容の文字列リテラル
code: |
  var text = "{{userInput:json}}";
  var data = JSON.parse("{{jsonStr:json}}");

# ❌ 誤り — 外側のクォートがない、無効な JS
code: |
  var text = {{userInput:json}};          # 構文エラー
  JSON.parse({{jsonStr:json}});           # JSON.parse は文字列引数が必要
```

変数が既にパース済みのオブジェクト/配列を保持している場合（前の `json` ノードの結果など）は、`{{var:json}}` を *クォートなし* で使って JS のオブジェクト/配列リテラルにしてください:

```yaml
code: |
  var arr = {{parsedArray:json}};         # var arr = [{"url":"..."}] になる
```

これはファイル内容やユーザー入力を JSON ボディを持つ `mcp`、`http`、`script` ノードに渡すときに不可欠です。

---

## ワークフローの終了

`next: end` でワークフローを明示的に終了します:

```yaml
- id: save
  type: drive-file
  path: "output.md"
  content: "{{result}}"
  next: end    # ここでワークフロー終了

- id: branch
  type: if
  condition: "{{cancel}}"
  trueNext: end      # true の場合ワークフロー終了
  falseNext: continue
```

---

## 実用例

### 1. Drive ファイルの要約

```yaml
name: ファイル要約
nodes:
  - id: select
    type: drive-file-picker
    title: "要約するファイルを選択"
    extensions: "md,txt"
    savePathTo: filePath
  - id: read
    type: drive-read
    path: "{{filePath}}"
    saveTo: content
  - id: summarize
    type: command
    prompt: "このテキストを要約してください:\n\n{{content}}"
    saveTo: summary
  - id: save
    type: drive-file
    path: "summaries/{{filePath}}"
    content: "# 要約\n\n{{summary}}"
```

### 2. API 連携

```yaml
name: 天気予報
nodes:
  - id: city
    type: dialog
    title: 都市名
    inputTitle: 都市
    saveTo: cityInput
  - id: geocode
    type: http
    url: "https://geocoding-api.open-meteo.com/v1/search?name={{cityInput.input}}&count=1"
    method: GET
    saveTo: geoResponse
  - id: parseGeo
    type: json
    source: geoResponse
    saveTo: geo
  - id: weather
    type: http
    url: "https://api.open-meteo.com/v1/forecast?latitude={{geo.results[0].latitude}}&longitude={{geo.results[0].longitude}}&current=temperature_2m"
    method: GET
    saveTo: weatherData
  - id: report
    type: command
    prompt: "天気予報を作成してください:\n{{weatherData}}"
    saveTo: summary
  - id: save
    type: drive-file
    path: "weather/{{cityInput.input}}.md"
    content: "# 天気: {{cityInput.input}}\n\n{{summary}}"
```

### 3. ループによるバッチ処理

```yaml
name: タグ分析
nodes:
  - id: init
    type: variable
    name: counter
    value: "0"
  - id: initReport
    type: variable
    name: report
    value: "# タグ提案\n\n"
  - id: list
    type: drive-list
    folder: "Clippings"
    limit: "5"
    saveTo: notes
  - id: parse
    type: json
    source: notes
    saveTo: parsed
  - id: loop
    type: while
    condition: "{{counter}} < {{parsed.count}}"
    trueNext: read
    falseNext: finish
  - id: read
    type: drive-read
    path: "{{parsed.notes[counter].name}}"
    saveTo: content
  - id: analyze
    type: command
    prompt: "以下のテキストに3つのタグを提案してください:\n\n{{content}}"
    saveTo: tags
  - id: append
    type: set
    name: report
    value: "{{report}}## {{parsed.notes[counter].name}}\n{{tags}}\n\n"
  - id: increment
    type: set
    name: counter
    value: "{{counter}} + 1"
    next: loop
  - id: finish
    type: drive-file
    path: "reports/tag-suggestions.md"
    content: "{{report}}"
```

### 4. サブワークフロー合成

**ファイル: `workflows/translate.yaml`**
```yaml
name: 翻訳
nodes:
  - id: translate
    type: command
    prompt: "{{targetLang}}に翻訳してください:\n\n{{text}}"
    saveTo: translated
```

**ファイル: `workflows/main.yaml`**
```yaml
name: 多言語エクスポート
nodes:
  - id: input
    type: dialog
    title: 翻訳するテキストを入力
    inputTitle: テキスト
    multiline: "true"
    saveTo: userInput
  - id: toEnglish
    type: workflow
    path: "workflows/translate.yaml"
    name: "翻訳"
    input: '{"text": "{{userInput.input}}", "targetLang": "英語"}'
    output: '{"englishText": "translated"}'
  - id: toSpanish
    type: workflow
    path: "workflows/translate.yaml"
    name: "翻訳"
    input: '{"text": "{{userInput.input}}", "targetLang": "スペイン語"}'
    output: '{"spanishText": "translated"}'
  - id: save
    type: drive-file
    path: "translations/output.md"
    content: |
      # 原文
      {{userInput.input}}

      ## 英語
      {{englishText}}

      ## スペイン語
      {{spanishText}}
```

### 5. MCP と RAG サーバー

```yaml
name: RAG 検索
nodes:
  - id: query
    type: mcp
    url: "http://localhost:8080"
    tool: "query"
    args: '{"store_name": "mystore", "question": "認証はどう動作しますか？", "show_citations": true}'
    headers: '{"X-API-Key": "mysecretkey"}'
    saveTo: result
  - id: show
    type: dialog
    title: "検索結果"
    message: "{{result}}"
    markdown: "true"
    button1: "OK"
```
