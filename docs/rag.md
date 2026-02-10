# RAG (Retrieval-Augmented Generation)

Gemini File Search を利用したナレッジベース機能。Google Drive 上のファイルを Gemini の File Search Store に登録し、チャットやワークフローで意味検索を行う。

## 概要

- **Internal RAG**: Drive 上のファイルを自動的に File Search Store へ同期
- **External RAG**: 外部で作成済みの Store ID を手動で指定
- **Push 連動登録**: Push 時に対象ファイルを自動で RAG に登録（オプション）
- **ワークフロー対応**: `rag-sync` / `command` ノードから RAG を利用可能

---

## データモデル

### RagSetting (`app/types/settings.ts`)

```typescript
interface RagSetting {
  storeId: string | null;           // Internal用 Store name (Gemini APIリソース名)
  storeIds: string[];               // External用 Store name の配列
  storeName: string | null;         // Store の Gemini API リソース名
  isExternal: boolean;              // External モードフラグ
  targetFolders: string[];          // Internal: 対象フォルダの仮想パスプレフィクス
  excludePatterns: string[];        // Internal: 除外パターン (正規表現)
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
| `ragRegistrationOnPush` | `boolean` | `false` | Push 時の自動 RAG 登録 |

### デフォルト Store キー

`DEFAULT_RAG_STORE_KEY = "gemihub"` — Push 連動登録で自動作成される RAG 設定の名前。

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

`isRagEligible(fileName)` で判定。

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
3. excludePatterns で除外 (正規表現マッチ)
4. 孤立エントリ削除 (Drive に存在しないが tracking にあるもの)
5. 各ファイルを並行処理 (CONCURRENCY_LIMIT = 5):
   ├─ Drive からコンテンツ読み取り
   ├─ SHA-256 チェックサム計算
   ├─ 既存と一致 → スキップ
   ├─ 変更あり → 既存ドキュメント削除 → 再アップロード
   └─ エラー → status: "pending" として記録
6. SyncResult を返却 (uploaded, skipped, deleted, errors, newFiles)
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
| `complete` | `{ uploaded, skipped, deleted, errors, errorDetails, message }` |
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
| `ragRetryPending` | `status: "pending"` のファイルを再登録。sync meta から Drive ファイル ID を解決 |

---

## Push 連動 RAG 登録

`ragRegistrationOnPush: true` の場合、Push 時に対象ファイルを自動で RAG に登録する。

**注意**: Push 連動登録は `DEFAULT_RAG_STORE_KEY = "gemihub"` の RAG 設定のみが対象。ユーザーが複数の Internal RAG 設定を作成していても、自動登録されるのは `"gemihub"` 設定だけ。他の Internal RAG 設定は設定画面の Sync ボタン (`/api/settings/rag-sync`) から手動でフル同期する必要がある。

### フロー (`app/hooks/useSync.ts`)

```
Push 開始
├─ 各ファイルについて:
│   ├─ isRagEligible(fileName) → 対象外ならスキップ
│   ├─ POST /api/sync { action: "ragRegister", fileId, content, fileName }
│   │   ├─ 成功 → ragFileInfo を収集 (status: "registered")
│   │   └─ 失敗 → ragFileInfo を収集 (status: "pending")
│   └─ Drive ファイル更新 (RAG 失敗でもブロックしない)
├─ Drive 更新すべて成功:
│   ├─ POST /api/sync { action: "ragSave", updates, storeName }
│   └─ POST /api/sync { action: "ragRetryPending" }
└─ Drive 更新失敗:
    ├─ ragSave を試行 (ベストエフォート)
    └─ 登録済みドキュメントのクリーンアップ (ragDeleteDoc)
```

### ragRegister の詳細

1. `ragRegistrationOnPush` が無効 or API キーなし → スキップ
2. デフォルト RAG 設定 (`"gemihub"`) がなければ自動作成
3. Store がなければ `getOrCreateStore()` で作成し設定を保存
4. チェックサムが一致 → スキップ
5. `registerSingleFile()` でアップロード

### ragRetryPending の詳細

1. `status: "pending"` のファイルを抽出
2. sync meta から最新の Drive ファイル ID を解決
3. Drive に存在しないファイルは tracking から削除
4. 再登録を試行、成功したら `status: "registered"` に更新

---

## Drive ファイル操作時の RAG 連携 (`app/routes/api.drive.files.tsx`)

### ファイルリネーム

ファイル名が変更された場合、`"gemihub"` RAG 設定内の `files` エントリを新しい名前にリキーする（ベストエフォート）。

### ファイル削除

ファイル削除時、RAG Store 上の対応ドキュメントも削除し、tracking エントリを除去する（ベストエフォート）。

---

## チャットでの RAG 利用

### RAG Setting → Store ID の解決 (`app/components/ide/ChatPanel.tsx`)

```
selectedRagSetting の値:
├─ "__websearch__" → Web Search モード (googleSearch tool)
├─ "__none__" → RAG なし
└─ RAG設定名 → ragStoreIds を解決:
    ├─ isExternal → storeIds[]
    └─ Internal → [storeId]
```

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

| 条件 | Drive ツール | RAG | 備考 |
|------|:-----------:|:---:|------|
| Gemma モデル | 不可 | 不可 | ツール非対応 |
| Web Search モード | 不可 | 不可 | `googleSearch` のみ使用 |
| Flash Lite + RAG | 不可 | 可 | Drive ツールと RAG の併用不可 |
| Flash/Pro + RAG | 検索以外 | 可 | `defaultMode: "noSearch"` |
| RAG なし | 全機能 | - | 制約なし |

### グラウンディングメタデータ

Gemini の応答に含まれる `groundingMetadata.groundingChunks` から RAG ソース情報を抽出:

- `retrievedContext` → RAG ソース (`rag_used` イベント)
- `web` → Web 検索ソース (`web_search_used` イベント)

チャット UI でソース一覧として表示される。

---

## ワークフローでの RAG

### rag-sync ノード (`app/engine/handlers/ragSync.ts`)

Drive ファイルを RAG Store に登録するワークフローノード。

| プロパティ | 必須 | 説明 |
|-----------|:----:|------|
| `path` | Yes | Drive 上のファイルパス |
| `ragSetting` | Yes | RAG 設定名 |
| `saveTo` | No | 結果を保存する変数名 |

**処理**: Drive でファイル検索 → Store を `getOrCreateStore()` で取得/作成 → アップロード → `serviceContext.settings` をインメモリ更新（後続ノードが参照可能に）

**saveTo の値**: `{ path, ragSetting, fileId, storeName, mode, syncedAt }`

### command ノードでの RAG (`app/engine/handlers/command.ts`)

`ragSetting` プロパティで RAG 設定を指定可能:

| 値 | 動作 |
|---|------|
| `"__websearch__"` | Web Search モード |
| `"__none__"` | RAG なし |
| RAG設定名 | 該当設定の storeId(s) を使用 |

storeId が未設定の場合は `getOrCreateStore()` でフォールバック作成する。

---

## 設定 UI (`app/routes/settings.tsx: RagTab`)

### グローバル設定

| 項目 | 説明 |
|------|------|
| RAG TopK | 検索結果の上位件数スライダー (1–20) |
| RAG Registration on Push | Push 時の自動登録トグル |
| Pending files | `status: "pending"` のファイル数を表示 |

### RAG 設定リスト

各設定に対して以下の操作が可能:

- **追加**: 新しい RAG 設定を作成 (自動命名 `setting-N`)
- **リネーム**: ダブルクリックで名前変更
- **選択**: チャットで使用する設定を選択
- **Sync**: Store とのフル同期を実行 (SSE プログレス表示)
- **編集**: Internal/External 切り替え、targetFolders、excludePatterns、storeIds
- **削除**: RAG 設定を削除

### Internal 設定の編集

- **Target Folders**: 仮想パスプレフィクス (1行1つ)。空ならルート全体
- **Exclude Patterns**: 除外正規表現 (1行1つ)

### External 設定の編集

- **Store IDs**: Gemini File Search Store の name (1行1つ)

### storeId 表示

同期済みの設定 (`storeId` が存在) には Store ID がモノスペースで表示され、コピーボタンでクリップボードにコピー可能。

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
| `app/routes/api.sync.tsx` | Push 連動 RAG アクション (ragRegister/ragSave/ragDeleteDoc/ragRetryPending) |
| `app/routes/api.drive.files.tsx` | ファイルリネーム/削除時の RAG tracking 連携 |
| `app/hooks/useSync.ts` | クライアント側 Push 連動 RAG 登録ロジック |
| `app/services/gemini-chat.server.ts` | チャットでの fileSearch ツール統合, グラウンディングメタデータ処理 |
| `app/components/ide/ChatPanel.tsx` | RAG 設定選択, ragStoreIds 解決, ソース表示 |
| `app/engine/handlers/ragSync.ts` | ワークフロー `rag-sync` ノードハンドラ |
| `app/engine/handlers/command.ts` | ワークフロー `command` ノードの RAG 設定解決 |
| `app/routes/settings.tsx` | RAG 設定 UI (RagTab コンポーネント) |
