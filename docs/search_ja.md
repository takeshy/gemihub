# Search

ローカル、Drive、RAG の 3 モード検索と、Quick Open によるファイル高速ナビゲーション。

## Features

- **ローカル検索**: IndexedDB キャッシュ済みファイルを名前・内容で検索（オフライン対応）
- **Drive 検索**: Google Drive のファイル全文検索（名前 + 内容）
- **RAG 検索**: Gemini File Search によるセマンティック検索と AI 生成回答
- **Quick Open**: キーボードショートカット（Cmd+P / Ctrl+P）によるファイル高速ナビゲーション

---

## キーボードショートカット

| ショートカット | アクション |
|--------------|----------|
| Cmd+Shift+F (Ctrl+Shift+F) | 検索パネルを開く |
| Cmd+P (Ctrl+P) | Quick Open ダイアログを開く |

---

## 検索パネル

左サイドバーからアクセス可能。有効時はファイルツリーに代わって表示される。

### ローカルモード

IndexedDB にキャッシュされたファイルを検索（オフライン対応）。

- **複数語検索**: スペースで区切り、すべての語が一致する必要あり（AND 論理）
- **マッチング**: ファイル名と内容の両方を検索（大文字小文字不区別）
- **スニペット**: 内容一致時、最初のマッチ語の前後 40 文字を表示
- **制限**: ローカルキャッシュ済みファイルのみ検索、Drive の最新内容は対象外

### Drive モード

Google Drive API による全文検索。

- ユーザーの `gemihub/` フォルダ内のファイル名と内容を検索
- ネットワーク依存、リアルタイムの結果を返す
- ファイル ID、名前、MIME タイプを返す

### RAG モード

Gemini の File Search ツールによるセマンティック検索。

- Settings で設定済みの RAG ストアが必要
- 複数行テキストエリア入力（Ctrl+Enter / Cmd+Enter で検索）
- マッチしたファイル結果と AI 生成の回答の両方を返す
- バイナリファイル拡張子は結果からフィルタリング

#### モデル選択

利用可能なモデルは API プランに依存:

| プラン | モデル |
|--------|--------|
| Free | gemini-2.5-flash-lite, gemini-2.5-flash |
| Paid | gemini-3.1-pro-preview, gemini-3-flash-preview |

#### RAG 結果マッチング

RAG 結果はナビゲーション用のファイル ID を提供するためにローカルファイルリストとマッチングされる。マッチしない結果はナビゲーション機能なしで表示。

### 結果表示

各結果は以下を表示:

- ファイルタイプアイコン（YAML: オレンジ、Markdown: 青、JSON: 黄、その他: グレー）
- ファイル名
- ファイルパス（利用可能な場合）
- 内容スニペット（ローカルモードのみ）

結果をクリックするとエディタでファイルが開く。

---

## Quick Open

ファイル高速選択用のモーダルダイアログ。

### 機能

- **部分文字列マッチング**: ファイル名とパスに対する大文字小文字不区別の検索
- **キーボードナビゲーション**: 矢印キーで選択移動、Enter で開く、Escape で閉じる
- **リアルタイムフィルタ**: 入力に応じて結果が即時更新
- **自動スクロール**: 選択項目がビューにスクロール
- **最大表示**: 一度に 10 項目を表示（スクロール可能）

### 画像ピッカーモード

Quick Open は WYSIWYG エディタで画像ピッカーとしても使用される:

- ファイルリストを画像拡張子（`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`）でフィルタ
- コールバック経由で画像 URL を返す

---

## API

### リクエスト

POST `/api/search`

```typescript
{
  query: string              // 検索クエリ（必須）
  mode: "rag" | "drive"     // 検索モード（必須）
  ragStoreIds?: string[]    // RAG ストア ID（RAG モード時必須）
  topK?: number             // 結果制限、1-20（デフォルト: 5、RAG モードのみ）
  model?: string            // Gemini モデル名（RAG モードのみ）
}
```

### レスポンス

**Drive モード:**
```json
{
  "mode": "drive",
  "results": [
    { "id": "fileId", "name": "file.md", "mimeType": "text/markdown" }
  ]
}
```

**RAG モード:**
```json
{
  "mode": "rag",
  "results": [
    { "title": "file.md", "uri": "..." }
  ],
  "aiText": "マッチしたファイルに基づく AI 生成回答。"
}
```

---

## Key Files

| File | Description |
|------|-------------|
| `app/routes/api.search.tsx` | 検索 API エンドポイント（Drive + RAG モード） |
| `app/components/ide/SearchPanel.tsx` | 検索パネル UI（Local / Drive / RAG タブ） |
| `app/components/ide/QuickOpenDialog.tsx` | Quick Open ダイアログ（Cmd+P） |
| `app/routes/_index.tsx` | キーボードショートカット登録 |
