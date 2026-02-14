# エディタ

WYSIWYG マークダウンエディタ、ワークフロービジュアルエディタ、HTML プレビュー、バイナリファイルビューアを備えたファイル編集システム。

## 機能一覧

- **ファイルタイプ別エディタ**: 拡張子に応じて最適なエディタを自動選択
- **マークダウン 3 モード**: プレビュー / WYSIWYG / Raw を切り替え可能
- **ワークフロービジュアル編集**: YAML を Mermaid フローチャートとして表示・編集
- **自動保存**: 3 秒のデバウンス付きで IndexedDB に自動キャッシュ
- **編集履歴**: ローカルの変更履歴を保持し、任意のバージョンに復元可能
- **Diff 表示**: 任意のファイルと比較して差分を確認
- **一時ファイル共有**: Temp Upload で共有可能な一時編集 URL を生成
- **暗号化ファイル対応**: `.encrypted` ファイルの復号・編集・再暗号化
- **プラグイン拡張**: プラグインによるカスタムエディタビューの追加
- **画像挿入**: Drive ファイルピッカーから画像を選択してマークダウンに挿入

---

## ファイルタイプ別エディタ

`MainViewer` がファイルの拡張子と MIME タイプに応じて表示コンポーネントを切り替える。

### テキストファイル

| 拡張子 | エディタ | モード |
|--------|----------|--------|
| `.md` | MarkdownFileEditor | プレビュー / WYSIWYG / Raw |
| `.yaml`, `.yml` | WorkflowEditor | ビジュアル / YAML |
| `.html`, `.htm` | HtmlFileEditor | プレビュー / Raw |
| その他 (`.txt`, `.js`, `.json` 等) | TextFileEditor | Raw のみ |

### バイナリファイル

バイナリファイルはファイル拡張子（大文字小文字を区別しない）で判定され、MIME タイプはフォールバックとして使用される。

| 種別 | 拡張子 | 表示方法 |
|------|--------|----------|
| 画像 | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico` | `<img>` による画像表示 |
| 動画 | `.mp4`, `.webm`, `.ogg`, `.mov`, `.avi`, `.mkv` | `<video>` プレーヤー |
| 音声 | `.mp3`, `.wav`, `.flac`, `.aac`, `.m4a`, `.opus` | `<audio>` プレーヤー |
| PDF | `.pdf` | iframe プレビュー |

バイナリファイルには Temp Download / Temp Upload ボタンが表示され、ローカルでの編集やダウンロードが可能。

### 暗号化ファイル

`.encrypted` 拡張子のファイルは `EncryptedFileViewer` で処理される。パスワードを入力して復号後、プレーンテキストとして編集できる。セッション中はパスワードがキャッシュされ、自動復号される。

復号後は **Permanent Decrypt** ボタンが利用可能。このボタンを押すと平文をサーバーに送信し、ファイル名から `.encrypted` 拡張子を除去して暗号化なしで Drive に保存する。実行前に確認ダイアログが表示される。

### プラグインによる拡張

プラグインは `mainViews` に対応する拡張子とコンポーネントを登録することで、カスタムファイルタイプのエディタを追加できる。プラグインビューはビルトインエディタよりも**先にチェック**されるため、任意の拡張子（例: `.md`, `.yaml`）のデフォルトエディタを上書きできる。

---

## マークダウンエディタ

マークダウンファイル (`.md`) は 3 つの編集モードを持つ。

### プレビューモード

`GfmMarkdownPreview` によるリードオンリー表示。

- GitHub Flavored Markdown (テーブル、チェックリスト、取り消し線)
- コードブロックのシンタックスハイライト (`rehype-highlight`)
- Mermaid ダイアグラムのインラインレンダリング

### WYSIWYG モード

`wysimark-lite` ライブラリによるリッチテキスト編集。

- ボールド、イタリック、リスト、コードブロック等のリッチテキスト操作
- マークダウン構文を保持しながらの編集
- 画像挿入 (Drive ファイルピッカー経由)
- 遅延ロード (`useEffect` でのダイナミックインポート)

### Raw モード

プレーン `<textarea>` によるマークダウンソースの直接編集。モノスペースフォントで表示される。

---

## ワークフローエディタ

ワークフローファイル (`.yaml`, `.yml`) は 2 つの編集モードを持つ。

### ビジュアルモード

- YAML を `engine/parser.ts` でパースし、`workflow-to-mermaid.ts` で Mermaid フローチャートに変換
- SVG ダイアグラムとしてインタラクティブに表示
- ノードクリックでプロパティパネル (右サイドバー) を開く

### YAML モード

- Raw テキストエリアでの YAML 直接編集
- 3 秒デバウンスの自動保存

---

## 自動保存

すべてのエディタは共通の自動保存パターンを使用する。

1. コンテンツ変更から **3 秒** のデバウンス後に IndexedDB キャッシュに保存
2. エディタがフォーカスを失った時 (blur) にも未保存の内容をフラッシュ
3. 保存時に `file-modified` イベントを発行し、ファイルツリーのバッジを更新
4. `editHistory` ストアに変更を記録 (Sync 用)

Drive への反映は手動の Push 操作で行う。

---

## ツールバー

エディタの上部にはモード切り替えとアクションボタンが表示される。

### モード切り替え

ファイルタイプに応じたモード切り替えボタン (例: マークダウンの場合は プレビュー / WYSIWYG / Raw)。

### アクションボタン (`EditorToolbarActions`)

| ボタン | 説明 |
|--------|------|
| **Edit History** | 編集履歴モーダルを開き、過去のバージョンを確認・復元 |
| **Diff** | 比較対象ファイルを選択し、差分をユニファイド形式で表示 |
| **Temp Upload** | 一時編集 URL を生成してクリップボードにコピー |
| **Temp Download** | 一時的な変更を取得してエディタにマージ |

---

## 編集履歴

ローカルの編集履歴を管理する機能。

- ファイルを開いた時点でスナップショット境界を記録
- Edit History ボタンから履歴モーダルを開く
- 任意のバージョンを選択して復元可能
- 復元時に `file-restored` イベントを発行してエディタを更新

関連サービス: `app/services/edit-history-local.ts`

---

## Diff 表示

任意のファイルとの差分を確認する機能。

1. Diff ボタンをクリック
2. `QuickOpenDialog` で比較対象ファイルを選択
3. 上段: 編集可能なテキストエリア (現在のファイル)、下段: ユニファイド diff 表示
4. `diff` パッケージの `createTwoFilesPatch()` を使用

---

## Temp Edit (一時ファイル共有)

外部での一時的な編集を可能にする仕組み。

### アーキテクチャ

- ファイル内容は Google Drive の `__TEMP__` フォルダに保存される（ローカルファイルシステムは使用しない）
- 編集 URL には暗号化トークン（AES-256-GCM、`SESSION_SECRET` 派生キー）が埋め込まれ、`{ accessToken, rootFolderId, fileId, fileName, createdAt }` を含む
- URL 生成時に access token を再発行し、GET/PUT ともに **1 時間** の有効期限となる
- マルチサーバー対応: サーバーローカルの状態を持たない

### Temp Upload

1. エディタの Temp Upload ボタンをクリック
2. `/api/drive/temp` に現在のファイル内容をアップロード（Drive `__TEMP__` フォルダに保存）
3. 共有 URL を生成するかどうかの確認ダイアログが表示される
4. 「はい」の場合、サーバーで access token を再発行（フル 1 時間）し、認証情報を暗号化した URL を生成してクリップボードにコピー
5. 「いいえ」の場合、「Uploaded」メッセージのみ表示される（URL は生成されない）

### 編集 URL による外部アクセス

- **GET** `/api/temp-edit/:token/:fileName` — Drive `__TEMP__` から読み取り、適切な Content-Type でコンテンツを返す
- **PUT** `/api/temp-edit/:token/:fileName` — リクエストボディを Drive `__TEMP__` ファイルに書き戻す
- 両メソッドとも暗号化トークンの検証と 1 時間の有効期限チェックを行う（期限切れの場合 410 Gone を返す）

### Temp Download

1. Temp Download ボタンをクリック
2. 一時ファイルに変更があるか確認
3. 変更がある場合、エディタにマージ

---

## 画像挿入

WYSIWYG モードでの画像挿入フロー:

1. wysimark エディタの画像ボタンをクリック
2. `QuickOpenDialog` で画像ファイルを選択 (対応拡張子: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`)
3. Drive にアップロード (`/api/drive/files`, action: `create-image`)
4. 返却された Drive ファイル URL をマークダウン画像リンクとして挿入

---

## EditorContext

エディタの共有状態を管理するコンテキスト (`app/contexts/EditorContext.tsx`)。

### 提供する値

| フィールド | 型 | 説明 |
|------------|------|------|
| `activeFileId` | `string \| null` | 現在開いているファイルの ID |
| `activeFileContent` | `string \| null` | 現在のファイル内容 |
| `activeFileName` | `string \| null` | 現在のファイル名 |
| `fileList` | `FileListItem[]` | ファイルツリーから取得した全ファイルリスト |
| `getActiveSelection` | `() => SelectionInfo \| null` | 現在の選択テキストを取得 |
| `hasActiveSelection` | `boolean` | コンテンツを持つファイルが開いているかどうか（テキストが選択されているかではない） |

### 選択テキストの追跡

チャットパネルのスラッシュコマンド (`{selection}`) で使用するため、エディタの選択テキストを追跡する。

- **Raw textarea**: `onSelect` イベントで `{text, start, end}` を記録
- **WYSIWYG**: `selectionchange` イベントで DOM 選択を監視 (`WysiwygSelectionTracker`)
- **チャットからのアクセス**: `editorCtx.getActiveSelection()` で取得

---

## キーボードショートカット

| ショートカット | 機能 |
|---------------|------|
| `Ctrl/Cmd+Shift+F` | 検索パネルを開く |
| `Ctrl/Cmd+P` | クイックファイルピッカーを開く |

---

## モバイル対応

- スワイプナビゲーションでファイル/エディタ/チャットパネルを切り替え
- iOS Safari 向けの `visualViewport` 対応 (ソフトキーボード表示時のレイアウト調整)
- レスポンシブツールバー (モバイルではドロップダウンメニュー)
- HTML プレビュー内のタッチスワイプを `postMessage` で親に転送

---

## 主要ファイル

| ファイル | 説明 |
|----------|------|
| `app/components/editor/MarkdownEditor.tsx` | WYSIWYG マークダウンエディタ (wysimark-lite) |
| `app/components/ide/MainViewer.tsx` | ファイルタイプに応じたエディタ振り分け |
| `app/components/ide/WorkflowEditor.tsx` | ワークフロービジュアル + YAML エディタ |
| `app/components/ide/EncryptedFileViewer.tsx` | 暗号化ファイルの復号・編集 |
| `app/components/ide/GfmMarkdownPreview.tsx` | GFM マークダウンプレビュー (Mermaid 対応) |
| `app/components/ide/EditorToolbarActions.tsx` | ツールバーアクション (Diff, History, Temp) |
| `app/contexts/EditorContext.tsx` | エディタ共有状態コンテキスト |
| `app/hooks/useFileWithCache.ts` | キャッシュファースト読み込み + 自動保存 |
| `app/services/edit-history-local.ts` | ローカル編集履歴管理 |
