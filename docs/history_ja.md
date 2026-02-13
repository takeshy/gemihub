# 編集履歴

編集履歴はローカル（IndexedDB）とリモート（Drive）の2つの独立したレイヤーでファイルの変更を別々に追跡します。

## 概要

| レイヤー | ストレージ | diff の生成方法 | 保持期間 |
|---------|-----------|---------------|---------|
| **ローカル** | IndexedDB `editHistory` ストア | クライアントの自動保存がベースから現在の内容への diff を計算 | ファイル単位: Push 時にクリア。Full Pull で全クリア |
| **リモート** | Drive のファイルごとの `.history.json` | サーバーが Drive 上の旧コンテンツと Push された新コンテンツの diff を計算 | 編集履歴設定に従い保持 |

2つのレイヤーは独立しており、ローカルの diff は Drive にアップロード **されません**。Push 時、サーバーが Drive 側の旧コンテンツと Push された新コンテンツから独自に diff を計算し、`.history.json` に追記します。

---

## ローカル編集履歴（IndexedDB）

各ファイルに1つの `CachedEditHistoryEntry`（`diffs[]` 配列付き）があります。各配列要素は1つの diff セッション（コミットポイント）を表します。

### 自動保存（3秒ごと）

1. IndexedDB キャッシュから旧コンテンツを読み取り（キャッシュ更新前）
2. 最後の diff が存在する場合: 逆適用してベースを復元
3. ベースから新コンテンツへの累積 diff を計算
4. `diffs[]` の最後のエントリを上書き（同セッションの更新は1つの diff に累積）

逆適用に失敗した場合（例: 外部からの内容変更によるパッチ不一致）、コミット境界が挿入されて破損した diff が確定され、現在の旧キャッシュ内容から新セッションが開始されます。

セッション中は最後の diff が継続的に上書きされるため、アクティブなセッションは常に `base → 現在の内容` を表す **1つの非空 diff エントリ** のみを持ちます。

### コミット境界

明示的な保存イベントにより、コミット境界（空の diff エントリ）が `diffs[]` に挿入されます。これにより次の自動保存は前回の diff を上書きせず **新しい diff を追加** し、新セッションが開始されます。

`addCommitBoundary(fileId)` は最後の diff が非空であれば空の境界を追加します。

トリガー:
- ファイル開く、リロード、Pull 後のエディタ更新（`useFileWithCache`）
- Pull（ダウンロードファイルごと）、コンフリクト解決（remote 選択時）、Full Pull（`useSync`）
- 一時 diff 受入（`MainViewer`、`WorkflowEditor`）
- `restoreToHistoryEntry` はリストア diff エントリの前後に直接境界を追加

### データモデル

`saveLocalEdit` は常に `diffs[]` の最後のエントリを **上書き** するため、コミット境界は次の自動保存で置換されます。実際に発生する3つの状態:

```
ケース1: セッション1のみ（commit なし）
  [0] { diff: "base → 現在" }                    ← 自動保存で継続更新

ケース2: commit 後 + セッション2で編集あり
  [0] { diff: "base → session1終了時" }          ← 確定済み
  [1] { diff: "session1終了時 → 現在" }          ← 境界を置換、自動保存で継続更新

ケース3: commit 後、まだ編集なし
  [0] { diff: "base → session1終了時" }          ← 確定済み
  [1] { diff: "" }                               ← 境界（次の編集で置換される）
```

- 自動保存で更新されるのは常に **最後のエントリ** のみ
- それ以前のエントリは確定済みで変更されない
- コミット境界は一時的なもの — セッション間にのみ存在し、次の自動保存で置換される

### メモリ効率

- キャッシュ（最新コンテンツ）+ diff のみ保存（ベースコンテンツの完全コピーなし）
- ベースコンテンツは必要時に逆適用で復元
- 逆適用: `+`/`-` 行とハンクヘッダーのカウントを入れ替え、パッチを適用

---

## リモート編集履歴（Drive）

リモート編集履歴はローカル編集履歴とは独立してサーバー側で計算されます。Drive 上のファイルが更新される際、サーバーは:
1. 上書き前に Drive から旧ファイル内容を読み取り
2. diff（Drive 上の旧コンテンツ → 新コンテンツ）を計算
3. ファイルの `.history.json` に diff エントリを追記

この処理は2つの経路で発生します:
- **Push**（`api.sync.tsx` `pushFiles` アクション）: バックグラウンドで履歴保存（fire-and-forget、best-effort）
- **直接ファイル更新**（`api.drive.files.tsx` `update` アクション）: インラインで履歴保存（await、best-effort）

Push 後、ローカルの IndexedDB 編集履歴は Push に成功したファイル分がクリアされます（キャッシュが Drive と一致するため、ローカル diff は不要になります）。Push に失敗したファイルはローカル編集履歴が保持されます。

リモートエントリにはメタデータが含まれます: `id`、`timestamp`、`source`（workflow/propose_edit/manual/auto）、オプションの `workflowName` と `model`。

---

## 履歴の閲覧

ファイルツリーでファイルを右クリック → 「履歴」で編集履歴モーダルを開きます。

モーダルには以下が表示されます:
- **ローカルエントリ**（IndexedDB）がデフォルト — 編集セッションの diff とリストアボタン付き
- **リモートエントリ**（Drive）はオンデマンド — 「リモート履歴を表示」クリックで過去の diff を Drive から読み込み（閲覧のみ）

各エントリの表示内容: タイムスタンプ、元バッジ（local/remote）、追加/削除の統計、展開可能な diff ビュー。

---

## リストア

リストアは、選択した履歴エントリ以降の diff を最新から順に逆適用し、そのエントリの変更が行われる **前の状態** にファイルを復元します。

### 仕組み

`restoreToHistoryEntry`（ステップ 1-4）が復元内容を計算し編集履歴を更新します。呼び出し元（`EditHistoryModal.handleRestore`）がステップ 5-6 を実行します。

1. IndexedDB キャッシュから現在の内容を読み取り
2. 最新の非空 diff から選択したエントリまで（そのエントリを含む）各 diff を逆適用:
   - `+`/`-` 行を入れ替え、ハンクヘッダーを反転し、パッチを適用
3. リストアを新しい履歴エントリとして記録: `diff(現在 → 復元後)`
4. リストアエントリの前後にコミット境界を追加
5. IndexedDB キャッシュを復元された内容で更新 *（呼び出し元）*
6. `file-restored` イベントを発行してエディタを更新 *（呼び出し元）*

### 例: 1エントリのリストア

非空 diff が1つだけの場合（アクティブセッション、コミットなし）:

```
diffs: [{ diff: "base → 現在" }]
cache: 現在

リストア (filteredIndex=0):
  diff[0] を「現在」に逆適用 → 「base」
  結果: "base"
```

ファイルは現在のセッションで編集が行われる前の状態に復元されます。

### 例: 複数エントリのリストア

```
diffs: [
  { diff: "base → v1" },       ← index 0（確定済み）
  { diff: "v1 → 現在" },       ← index 1（アクティブ）
]
cache: 現在

index 0 にリストア (filteredIndex=0):
  diff[1] を「現在」に逆適用 → 「v1」
  diff[0] を「v1」に逆適用 → 「base」
  結果: "base"

index 1 にリストア (filteredIndex=1):
  diff[1] を「現在」に逆適用 → 「v1」
  結果: "v1"
```

### 制限事項

- `reverseApplyDiff` が失敗した場合（パッチ不一致）、リストアは null を返し何も変更されない
- リストア後、エディタは即座に復元内容を反映。変更は次の Push までローカルのみ

---

## 設定

設定 → 同期 → 編集履歴:

| アクション | 説明 |
|-----------|------|
| 整理 | 古い編集履歴エントリを削除して Drive ストレージを解放 |
| 統計 | 編集履歴のストレージ使用量とエントリ数を表示 |

保持設定（ユーザーごと）:
- `maxEntriesPerFile`: ファイルごとの最大エントリ数（0 = 無制限）
- `maxAgeInDays`: 最大保持日数（0 = 無制限）

diff 設定:
- `contextLines`: リモート diff のコンテキスト行数（デフォルト: 3）。ローカル diff は固定値 3 を使用。

---

## 主要ファイル

| ファイル | 役割 |
|---------|------|
| `app/services/edit-history-local.ts` | クライアント側の編集履歴: 自動保存（`saveLocalEdit`）、コミット境界（`addCommitBoundary`）、リストア（`restoreToHistoryEntry`）、逆適用 diff |
| `app/services/edit-history.server.ts` | サーバー側の編集履歴: Push 時に Drive `.history.json` に保存、履歴読込、保持ポリシー |
| `app/services/indexeddb-cache.ts` | IndexedDB ストア: `editHistory` CRUD、`CachedEditHistoryEntry` / `EditHistoryDiff` 型定義 |
| `app/hooks/useFileWithCache.ts` | キャッシュ優先のファイル読取、自動保存連携（`saveToCache` が `saveLocalEdit` を呼出）、`file-restored` イベントハンドラ |
| `app/components/ide/EditHistoryModal.tsx` | 履歴モーダル UI: ローカル/リモートエントリ表示、リストアハンドラ、リモート履歴クリア |
| `app/components/shared/DiffView.tsx` | 統一 diff 表示コンポーネント |
| `app/routes/api.settings.edit-history.tsx` | API: リモート履歴の取得・削除 |
| `app/routes/api.settings.edit-history-stats.tsx` | API: 履歴統計の取得 |
| `app/routes/api.settings.edit-history-prune.tsx` | API: 古い履歴の整理 |
