# RAG (Retrieval-Augmented Generation)

Gemini File Search を利用したナレッジベース機能。Google Drive 上のファイルを Gemini の File Search Store に登録し、チャットやワークフローで意味検索を行う。

## 概要

- **Internal RAG**: Drive 上のファイルを自動的に File Search Store へ同期
- **External RAG**: 外部で作成済みの Store ID を手動で指定
- **Push 連動登録**: Push 時に対象ファイルを自動で RAG に登録（`"gemihub"` 設定が存在する場合に自動有効）
- **ワークフロー対応**: `rag-sync` / `command` ノードから RAG を利用可能
- **検索パネル**: RAG / Drive / Local の3モードで横断検索

---

## データモデル

### RagSetting (`app/types/settings.ts`)

```typescript
interface RagSetting {
  storeId: string | null;           // Internal用 Gemini API リソース名 (チャットで ragStoreIds に使用)
  storeIds: string[];               // External用 Store name の配列
  storeName: string | null;         // Gemini API リソース名 (API コール時に使用、storeId と同値)
  isExternal: boolean;              // External モードフラグ
  targetFolders: string[];          // Internal: 対象フォルダの仮想パスプレフィクス
  excludePatterns: string[];        // Internal: 除外パターン (正規表現)。デフォルト: ["^temporaries/", "^workflows/"]
  files: Record<string, RagFileInfo>; // ファイル名 → 登録状態のマップ
  lastFullSync: number | null;      // 最終フル同期タイムスタンプ
}

interface RagFileInfo {
  checksum: string;       // SHA-256 チェックサム
  uploadedAt: number;     // 登録タイムスタンプ
  fileId: string | null;  // File Search ドキュメント ID
  status: "registered" | "pending"; // 登録状態
}
```

### UserSettings 内の RAG 関連フィールド

| フィールド | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `ragEnabled` | `boolean` | `false` | RAG 有効フラグ (ファイル登録成功時に自動で `true`) |
| `ragTopK` | `number` | `5` | 検索結果の上位件数 (1–20) |
| `ragSettings` | `Record<string, RagSetting>` | `{}` | 名前付き RAG 設定の辞書 |
| `selectedRagSetting` | `string \| null` | `null` | チャットで使用する RAG 設定名 |
| `ragRegistrationOnPush` | `boolean` | `false` | Push 時の自動 RAG 登録。`"gemihub"` 設定が存在すると自動で `true` になる |

### デフォルト Store キー

`DEFAULT_RAG_STORE_KEY = "gemihub"` — Push 連動登録で使用される RAG 設定の名前。この設定が存在する場合、`ragRegistrationOnPush` は自動的に有効になる。

---

## Internal RAG vs External RAG

### Internal (`isExternal: false`)

Drive ファイルを GemiHub が管理する File Search Store へ同期する。

- **targetFolders**: 仮想パスプレフィクスで対象を絞り込み (例: `"notes"`, `"projects/src"`)。空の場合はルートフォルダ全体
- **excludePatterns**: 正規表現で除外 (例: `"node_modules"`, `"\\.test\\.ts$"`)
- **storeId**: `getOrCreateStore()` が `displayName` で検索→なければ作成。返却値は Gemini API リソース名 (`fileSearchStores/xxx`)
- フル同期・差分検出・孤立ドキュメント削除まで自動管理

### External (`isExternal: true`)

外部で作成済みの Gemini File Search Store を直接指定する。

- **storeIds**: Store name を手動で入力（1行に1つ）
- GemiHub はファイル登録・同期を行わない
- 用途: 共有 Store、別ツールで管理された Store

---

## 対象ファイル拡張子 (`app/constants/rag.ts`)

| カテゴリ | 拡張子 |
|---------|--------|
| テキスト | `.md` `.txt` `.csv` `.tsv` `.json` `.xml` `.html` `.yaml` `.yml` |
| コード | `.js` `.ts` `.jsx` `.tsx` `.py` `.java` `.rb` `.go` `.rs` `.c` `.cpp` `.h` `.cs` `.php` `.dart` `.sql` `.sh` |
| ドキュメント | `.pdf` `.doc` `.docx` `.xls` `.xlsx` `.pptx` |

`isRagEligible(fileName)` で判定。`smartSync` でもこのフィルタが適用され、対象拡張子のファイルのみが Store に同期される。

---

## サーバーサービス (`app/services/file-search.server.ts`)

### 主要関数

| 関数 | 説明 |
|------|------|
| `getOrCreateStore(apiKey, displayName)` | 既存 Store を `displayName` で検索し、なければ新規作成。リソース名を返す |
| `uploadDriveFile(apiKey, accessToken, fileId, fileName, storeName)` | Drive ファイルを読み取って Store にアップロード。ドキュメント名を返す |
| `smartSync(apiKey, accessToken, ragSetting, rootFolderId, onProgress?)` | フル同期: チェックサム比較→アップロード/スキップ/削除。並行5件 |
| `registerSingleFile(apiKey, storeName, fileName, content, existingFileId)` | 単一ファイル登録 (既存ドキュメントは先に削除) |
| `deleteSingleFileFromRag(apiKey, documentId)` | 単一ドキュメント削除 (例外を投げない) |
| `deleteStore(apiKey, storeName)` | Store 全体を削除 |
| `calculateChecksum(content)` | SHA-256 チェックサムを計算 |

### smartSync の処理フロー

```
1. Drive ルートフォルダからファイル一覧を取得 (sync meta 経由)
2. targetFolders でフィルタ (仮想パスプレフィクス一致)
3. excludePatterns で除外 (正規表現マッチ、空パターンはスキップ)
4. isRagEligible() でフィルタ (対象拡張子のみ)
5. 孤立エントリ削除 (Drive に存在しないが tracking にあるもの → Gemini Store 上のドキュメントも削除)
6. 各ファイルを並行処理 (CONCURRENCY_LIMIT = 5):
   ├─ Drive からコンテンツ読み取り
   ├─ SHA-256 チェックサム計算
   ├─ 既存と一致 → スキップ
   ├─ 変更あり → 既存ドキュメント削除 → 再アップロード
   └─ エラー → status: "pending" として記録
7. SyncResult を返却 (uploaded, skipped, deleted, errors, newFiles)
```

---

## API ルート

### POST /api/settings/rag-sync (`app/routes/api.settings.rag-sync.tsx`)

設定画面の Sync ボタンから呼ばれるフル同期エンドポイント。SSE でプログレスをストリーミング。

**リクエスト**: `{ ragSettingName?: string }`

**SSE イベント**:
| イベント | データ |
|---------|-------|
| `progress` | `{ current, total, fileName, action, message }` |
| `complete` | `{ uploaded, skipped, deleted, errors, errorDetails, ragSetting, message }` |
| `error` | `{ message }` |

**処理フロー**:
1. Store が未作成なら `getOrCreateStore()` で作成
2. `smartSync()` でフル同期 (プログレスコールバック → SSE)
3. 設定を更新して保存 (`storeId`, `files`, `lastFullSync`)

### POST /api/sync — RAG アクション (`app/routes/api.sync.tsx`)

Push/Pull の sync API 内に RAG 関連の4アクションがある:

| アクション | 説明 |
|-----------|------|
| `ragRegister` | Push 時に単一ファイルを RAG 登録。チェックサム一致ならスキップ |
| `ragSave` | Push 完了後に登録結果を一括保存。registered なファイルがあれば `ragEnabled` を自動有効化 |
| `ragDeleteDoc` | ドキュメント削除 (ロールバック用、ベストエフォート) |
| `ragRetryPending` | `status: "pending"` のファイルを再登録。`rebuildSyncMeta()` で Drive ファイル ID を解決 |

### POST /api/search (`app/routes/api.search.tsx`)

検索パネルから呼ばれる統合検索エンドポイント。

**リクエスト**: `{ query, mode, ragStoreIds?, topK?, model? }`

| モード | 説明 |
|--------|------|
| `"rag"` | Gemini File Search で意味検索。`ragStoreIds`, `topK`, `model` が必要 |
| `"drive"` | Google Drive API でフルテキスト検索 |

**RAG モードの詳細**:
- API プランに応じたモデル選択: paid → `gemini-3.1-pro-preview` / `gemini-3-flash-preview`, free → `gemini-2.5-flash-lite` / `gemini-2.5-flash`
- 指定モデルで `fileSearch` ツールが非対応の場合、同プラン内の別モデルにフォールバック
- システム指示: `"Search files and answer the query concisely in the query's language."`
- `groundingMetadata.groundingChunks.retrievedContext` からファイル名・URI を抽出
- バイナリ拡張子 (mp4, zip, exe 等) はフィルタ除外、タイトル重複排除
- AI テキスト応答 (`aiText`) はファイルリストとは別に返却

**レスポンス**:
- RAG: `{ mode: "rag", results: [{ title, uri? }], aiText? }`
- Drive: `{ mode: "drive", results: [{ id, name, mimeType }] }`

---

## Push 連動 RAG 登録

`"gemihub"` RAG 設定が存在する場合、`ragRegistrationOnPush` は自動的に `true` に設定され、Push 時に対象ファイルを自動で RAG に登録する。

**注意**: Push 連動登録は `DEFAULT_RAG_STORE_KEY = "gemihub"` の RAG 設定のみが対象。ユーザーが複数の Internal RAG 設定を作成していても、自動登録されるのは `"gemihub"` 設定だけ。他の Internal RAG 設定は設定画面の Sync ボタン (`/api/settings/rag-sync`) から手動でフル同期する必要がある。

### フロー (`app/services/rag-sync.ts`)

RAG 登録は Push 成功後にバックグラウンドで非同期実行される（Push をブロックしない）。`app/hooks/useSync.ts` が `ragRegisterInBackground()` を呼び出し、実装は `app/services/rag-sync.ts` にある。

```
Push 成功後 → ragRegisterInBackground(filesToPush) を fire-and-forget
├─ 対象ファイルを isRagEligible() でフィルタ
├─ 全対象ファイルを status: "pending" で先に保存 (ragSave)
│   └─ 途中で処理が失敗しても ragRetryPending で再試行可能
├─ 各ファイルについて:
│   ├─ POST /api/sync { action: "ragRegister", fileId, content, fileName }
│   │   ├─ 成功 → ragFileInfo を収集 (status: "registered")
│   │   └─ 失敗 → ragFileInfo を収集 (status: "pending")
├─ 登録結果を保存 (ragSave)
└─ POST /api/sync { action: "ragRetryPending" }
```

### ragRegister の詳細

1. `ragRegistrationOnPush` が無効 or API キーなし → スキップ
2. デフォルト RAG 設定 (`"gemihub"`) がなければ自動作成
3. `excludePatterns` に一致するファイル名 → スキップ（不正な正規表現は無視）
4. Store がなければ `getOrCreateStore()` で作成し設定を保存
5. コンテンツ解決: `fileId` が渡された場合は `readFileBytes()` で Drive からコンテンツを読み込む。失敗時は `content` パラメータにフォールバック。どちらもない場合はエラー
6. チェックサムが一致 → スキップ
7. `registerSingleFile()` でアップロード

### ragRetryPending の詳細

1. `status: "pending"` のファイルを抽出
2. `rebuildSyncMeta()` で最新の Drive ファイル ID を解決
3. Drive に存在しないファイルは tracking から削除
4. 再登録を試行、成功したら `status: "registered"` に更新

---

## Drive ファイル操作時の RAG 連携 (`app/routes/api.drive.files.tsx`)

### ファイルアップロード時の RAG 登録

`app/hooks/useFileUpload.ts` からファイルアップロード時に `ragRegisterNewFile()` (`app/services/rag-sync.ts`) が呼ばれ、Push を経由せずに個別に RAG 登録される。対象は `isRagEligible()` を満たすファイルのみ。

**注意**: `ragRegisterNewFile(fileId, fileName)` は `content` パラメータを渡さないため、サーバー側で `readFileBytes()` が失敗した場合はエラーとなり登録されない。この場合、次回の Push 時に `ragRegister` がコンテンツ付きで再試行される。

### ファイルリネーム

ファイル名が変更された場合、`"gemihub"` RAG 設定内の `files` エントリを新しい名前にリキーする（ベストエフォート）。

### ファイル削除

ファイル削除時、RAG Store 上の対応ドキュメントも削除し、tracking エントリを除去する（ベストエフォート）。

---

## チャットでの RAG 利用

### RAG Setting → Store ID の解決 (`app/components/ide/ChatPanel.tsx`)

```
ragEnabled が false → ragStoreIds = [] (RAG なし)
ragEnabled が true の場合、selectedRagSetting の値:
├─ "__websearch__" → Web Search モード (googleSearch tool)
├─ null → RAG なし (localStorage に空文字保存 → 読み込み時 null に変換)
└─ RAG設定名 → ragStoreIds を解決:
    ├─ isExternal → storeIds[]
    └─ Internal → [storeId]
```

`selectedRagSetting` は `localStorage` に永続化される (`gemihub:selectedRagSetting`)。スラッシュコマンドの `searchSetting` でオーバーライド可能。

**注意**: ワークフローの command ノードでは `"__none__"` を「RAG なし」として使用するが、ChatPanel では `null` がその役割を持つ。

### Gemini API への渡し方 (`app/services/gemini-chat.server.ts`)

```typescript
// ragStoreIds がある場合、tools に fileSearch を追加
geminiTools.push({
  fileSearch: {
    fileSearchStoreNames: ragStoreIds,
    topK: clampedTopK,  // 1-20 にクランプ
  },
});
```

### モデル制約 (`app/types/settings.ts: getDriveToolModeConstraint`)

| 条件 | Drive ツール | RAG | locked | 備考 |
|------|:-----------:|:---:|:------:|------|
| Gemma モデル | 不可 | 不可 | Yes | ツール非対応。MCP も無効化 |
| Web Search モード | 不可 | 不可 | Yes | `googleSearch` のみ使用。MCP も無効化 |
| RAG設定選択中 | 不可 | 可 | Yes | fileSearch + functionDeclarations は API 非対応。MCP も無効化 |
| RAG設定未選択 (`null`) | 全機能 | - | No | 制約なし |

### グラウンディングメタデータ

Gemini の応答に含まれる `groundingMetadata.groundingChunks` から RAG ソース情報を抽出:

- `retrievedContext` → RAG ソース (`rag_used` イベント)
- `web` → Web 検索ソース (`web_search_used` イベント)

チャット UI でソース一覧として表示される。

---

## 検索パネル (`app/components/ide/SearchPanel.tsx`)

左サイドバーから開く統合検索パネル。3つのモードをタブで切り替えて検索できる。

### 検索モード

タブ順序: Local → Drive → RAG。デフォルトは Local。

| モード | 表示条件 | 検索先 | 説明 |
|--------|---------|--------|------|
| Local | 常時 | IndexedDB (クライアント) | キャッシュ済みファイルの名前・内容を複数キーワード AND 検索 |
| Drive | 常時 | Google Drive API | フルテキスト検索 |
| RAG | `ragStoreIds` が存在 | Gemini File Search API | 意味検索。モデル選択可能。常に `"gemihub"` 設定の storeId を使用。External RAG 設定や `"gemihub"` 以外の Internal RAG 設定は検索パネルの RAG モードでは使用できない |

### RAG モードの詳細

- **複数行テキストエリア** (3行、リサイズ可能) でクエリ入力
- 送信: **Ctrl+Enter** (Mac は Cmd+Enter)
- API プランに応じたモデル選択ボタンが表示される
  - paid: `gemini-3.1-pro-preview`, `gemini-3-flash-preview`
  - free: `gemini-2.5-flash-lite`, `gemini-2.5-flash`
- 結果: `groundingChunks` からファイルリスト（バイナリ除外、タイトル重複排除）
- **AI テキスト** (`aiText`) はファイルリストの下に別ブロックとして表示
- 結果クリックでファイルを開く（`fileList` から ID を解決）

### Local モードの詳細

- `getAllCachedFiles()` で IndexedDB からキャッシュ済みファイルを取得
- **複数キーワード AND 検索**: クエリをスペース（半角・全角）で分割し、すべてのキーワードがファイル名またはコンテンツに含まれるかを大文字小文字無視で判定
- コンテンツマッチ時は最初のキーワード前後40文字をスニペットとして表示

### Drive モードの詳細

- Google Drive API (`searchFiles()`) によるフルテキスト検索
- ファイル ID、名前、MIME タイプを返却

---

## ワークフローでの RAG

### rag-sync ノード (`app/engine/handlers/ragSync.ts`)

Drive ファイルを RAG Store に登録するワークフローノード。

| プロパティ | 必須 | 説明 |
|-----------|:----:|------|
| `path` | Yes | Drive 上のファイルパス |
| `ragSetting` | Yes | RAG 設定名 |
| `saveTo` | No | 結果を保存する変数名 |

**処理**: Drive でファイル検索 (正確名 → `.md` 付き名のフォールバック) → Store を `getOrCreateStore()` で取得/作成 → アップロード → `serviceContext.settings` をインメモリ更新（後続ノードが参照可能に）

**saveTo の値**: `{ path, ragSetting, fileId, storeName, mode, syncedAt }`

### command ノードでの RAG (`app/engine/handlers/command.ts`)

`ragSetting` プロパティで RAG 設定を指定可能:

| 値 | 動作 |
|---|------|
| `"__websearch__"` | Web Search モード |
| `"__none__"` | RAG なし |
| RAG設定名 | 該当設定の storeId(s) を使用 |

storeId が未設定の場合は `getOrCreateStore()` でフォールバック作成し、設定をインメモリでキャッシュする。

---

## 設定 UI (`app/routes/settings.tsx: RagTab`)

### グローバル設定

| 項目 | 説明 |
|------|------|
| Search tip | RAG を検索パネルで利用できる旨のバナー |
| Auto RAG ボタン | `"gemihub"` 設定が未作成の場合に表示。モーダルで「All Files」(即座に同期開始) または「Customize」(編集モードで開く) を選択 |
| RAG TopK | 検索結果の上位件数 (1–20)。インライン編集 |

**注意**: `ragRegistrationOnPush` は UI にトグルとして表示されず、`"gemihub"` RAG 設定が存在する場合に自動的に `true` に設定される。

### RAG 設定リスト

各設定に対して以下の操作が可能:

- **追加**: 新しい RAG 設定を作成 (自動命名 `setting-N`、即座にリネームモードに入る)
- **リネーム**: ダブルクリックで名前変更
- **選択**: クリックでチャットで使用する設定を選択
- **Sync**: Store とのフル同期を実行 (SSE プログレス表示)
- **編集**: Internal/External 切り替え、targetFolders、excludePatterns、storeIds
- **削除**: RAG 設定を削除 (選択中の場合は次の設定に自動移動)
- **ファイル数表示**: total / registered / pending の件数表示。クリックで `RagFilesDialog` を開く

### Internal 設定の編集

- **Target Folders**: 仮想パスプレフィクス (1行1つ)。空ならルート全体
- **Exclude Patterns**: 除外正規表現 (1行1つ)

### External 設定の編集

- **Store IDs**: Gemini File Search Store の name (1行1つ)

### storeId 表示

同期済みの設定 (`storeId` が存在) には Store ID がモノスペースで表示され、コピーボタンでクリップボードにコピー可能。

### Register & Sync ボタン

選択中の Internal 設定で `storeId` が未設定の場合に表示。クリックでフル同期を開始。

### RagFilesDialog

- 検索可能なファイル一覧ダイアログ
- フィルタ: All / Registered / Pending
- 各ファイルのアップロード日時を表示

---

## アーキテクチャ

### データフロー

```
Browser                    Server                  Google (Gemini API / Drive)
┌──────────────┐    ┌──────────────────┐    ┌──────────────────────┐
│ ChatPanel    │    │ /api/chat        │    │ Gemini Chat API      │
│ (ragStoreIds)│───►│ (fileSearch tool)│───►│ (fileSearch grounding│
│              │    │                  │    │  + groundingMetadata) │
├──────────────┤    ├──────────────────┤    ├──────────────────────┤
│ SearchPanel  │    │ /api/search      │    │ File Search Store    │
│ (Local/Drive/│───►│ (rag/drive mode) │───►│ (意味検索)            │
│  RAG)        │    │                  │    │                      │
├──────────────┤    ├──────────────────┤    ├──────────────────────┤
│ useSync      │    │ /api/sync        │    │ File Search Store    │
│ (ragRegister │───►│ (ragRegister/    │───►│ (documents)          │
│  on push)    │    │  ragSave/retry)  │    │                      │
├──────────────┤    ├──────────────────┤    ├──────────────────────┤
│ RagTab       │    │ /api/settings/   │    │ Google Drive         │
│ (sync UI)    │───►│  rag-sync (SSE)  │───►│ (source files)       │
└──────────────┘    └──────────────────┘    └──────────────────────┘
```

### 主要ファイル

| ファイル | 役割 |
|---------|------|
| `app/types/settings.ts` | `RagSetting`, `RagFileInfo`, `DEFAULT_RAG_SETTING`, `getDriveToolModeConstraint` |
| `app/constants/rag.ts` | 対象拡張子リスト, `isRagEligible()` |
| `app/services/file-search.server.ts` | Store CRUD, ファイルアップロード, smartSync, 単一ファイル登録/削除 |
| `app/routes/api.settings.rag-sync.tsx` | フル同期 API (SSE) |
| `app/routes/api.sync.tsx` | Push 連動 RAG アクション (ragRegister/ragSave/ragDeleteDoc/ragRetryPending) のルーティング |
| `app/services/sync-rag.server.ts` | サーバー側 RAG アクションハンドラ (ragRegister/ragSave/ragDeleteDoc/ragRetryPending の実装) |
| `app/services/rag-sync.ts` | クライアント側 RAG 登録ロジック (`ragRegisterInBackground`, `ragRegisterNewFile`) |
| `app/routes/api.search.tsx` | 検索パネル API (RAG / Drive モード) |
| `app/routes/api.drive.files.tsx` | ファイルリネーム/削除時の RAG tracking 連携 |
| `app/hooks/useSync.ts` | Push 完了後の `ragRegisterInBackground()` 呼び出し |
| `app/services/gemini-chat.server.ts` | チャットでの fileSearch ツール統合, グラウンディングメタデータ処理 |
| `app/components/ide/ChatPanel.tsx` | RAG 設定選択, ragStoreIds 解決, ソース表示 |
| `app/components/ide/SearchPanel.tsx` | 検索パネル UI (RAG / Drive / Local モード) |
| `app/engine/handlers/ragSync.ts` | ワークフロー `rag-sync` ノードハンドラ |
| `app/engine/handlers/command.ts` | ワークフロー `command` ノードの RAG 設定解決 |
| `app/routes/settings.tsx` | RAG 設定 UI (RagTab コンポーネント) |
