# ダッシュボード

ダッシュボードは IDE のホーム画面に表示される、設定可能な **ウィジェット** のグリッドです。編集モードでドラッグ/リサイズ/設定して視覚的にオーサリングし、ユーザーの Drive 上に `.dashboard` YAML ファイルとして永続化します。すべてローカルファースト：編集は IndexedDB キャッシュを更新し、通常の Push フローで Drive に反映されます。

> 実装は `app/dashboard/` 配下にあります。本書は `dashboard.md`（英語）の日本語ミラーです。

## ファイル形式と保存場所

- ダッシュボードは拡張子 `.dashboard` の YAML ファイル。
- 新規ダッシュボードは `dashboards/{name}.dashboard` に保存。レガシーの単一ダッシュボードがルートに `home.dashboard` として存在することがある。
- サイドカーキャッシュ（再生成可能なワークフロー結果）は `dashboards/.cache/<dashboardFileId>.json` に保存。
- ゴミ箱/履歴のコピー（`trash/…`, `history/…`）は一覧から除外。

スキーマ（version 1）:

```yaml
version: 1
grid:
  cols: 12
  rowHeight: 80
  gap: 8
widgets:
  - id: <uuid>
    type: markdown | file-list | web | card | table | workflow
    layout:
      lg: { x: 0, y: 0, w: 6, h: 3 }
      sm: { x: 0, y: 0, w: 12, h: 3 }   # 省略時は自動導出
    config: { ... }                      # ウィジェット種別ごとの config（後述）
```

未知のトップレベルキーおよび未知のウィジェット config キーは**ラウンドトリップで保持**されます（プラグインウィジェット、将来の拡張）。未知のウィジェット*型*は `UnknownWidget` にフォールバックし、config をそのまま保持するため、無損失で削除・保存できます。

主要ファイル: `dashboardFile.ts`（parse/serialize/load/save/list/rename/delete）、`types.ts`（スキーマ型）。

## レイアウト・グリッド・編集モード

- 2 つのブレークポイント: `lg`（広い）と `sm`（狭い、しきい値 `BREAKPOINT_THRESHOLD = 768px`）。`sm` レイアウトが無い場合は `deriveSmLayout` が自動導出（全幅・縦積み）。
- **編集モード**でドラッグ（移動）・リサイズ・ウィジェットごとの設定/削除、および config 編集を coalescing する undo/redo が有効。
- キャンバス（`DashboardCanvas.tsx`）がグリッドを描画。各ウィジェットはドラッグ/リサイズを担う `GridCell.tsx` に入る。`DashboardHost.tsx` がダッシュボードのライフサイクル（作成/リネーム/削除/切替、`settings.homeDashboard` による home ピン留め）とデバウンス保存を担う。
- ウィジェット追加は `WidgetPalette` モーダルを開き、登録済みの全ウィジェット型を一覧表示する。

## ウィジェット型

ウィジェットは `widgets/registry.ts` の `registerWidget(def)` で登録する。各 `WidgetDef` は `type`、パレットの `label`/`icon`、`defaultConfig`、`defaultSize`、`render(config, ctx)` 関数、任意の `ConfigEditor` を持つ。

| 型 | 役割 | ソース |
|------|---------|--------|
| `markdown` | インライン Markdown、または Drive の Markdown ファイル本文を描画 | 静的 / Drive ファイル |
| `file-list` | フォルダ内ファイルのコンパクトな一覧 | フォルダ |
| `web` | 外部 URL を埋め込み（埋め込み可否チェック + フォールバックカード） | URL |
| `card` | Markdown ファイルのフォルダに対するカードグリッド | フォルダ |
| `table` | Markdown ファイルのフォルダに対する編集可能テーブル | フォルダ |
| `workflow` | ワークフローを実行し出力を描画 | ワークフロー |

`markdown` / `file-list` / `web` は初期リリースから変更なし。データ指向の `card` / `table` / `workflow` を以下で説明する。

> **経緯。** 以前のビルドには汎用の `data` ウィジェット（`source` folder|workflow × `view` table|cards）と `file-table` ウィジェットがあった。これらは本書の 3 つの明示ウィジェットに置き換えられた。ダッシュボード機能は未リリースだったため**互換シムは無い** — `data` / `file-table` 型は廃止され、旧テスト用 `.dashboard` は新型で作り直すこと。

### 共通の構成部品

`card` / `table` / `workflow` は共通パイプラインを再利用する:

- **行モデル** — `DataRow`（`data-widget/types.ts`）: `{ id, fileName?, fileId?, mtime?, ctime?, cells }`。`cells` は名前をキーとするプロパティ値（frontmatter キー + `file.*` 属性）を保持。
- **フォルダソース** — `loadFolderRows(folder)` / `scanFolderFields(folder)`（`folder-source.ts`）がフォルダ内の Markdown を読み、frontmatter + ファイル属性を行/フィールドとして公開。
- **後段パイプライン** — `applyPostSource(rows, { filter, sort, limit })`（`filter.ts`）: フィルタ条件 → ソート → limit。補助: `getCellValue`, `formatCell`, `detectFields`。
- **ビュー** — `CardsView.tsx`（フィールドマッピングカード）と `TableView.tsx`（任意のインラインセル編集付きテーブル）。
- **Config 部品** — `data-widget/config-parts/` に再利用可能なエディタ部品（`FilterEditor`, `SortLimitFields`, `CardMappingEditor`, `ColumnsEditor`, `useFolderFields`）があり、3 つの config エディタで共有。

## Card と Table（フォルダウィジェット）

両者ともフォルダから Markdown を読み、フィルタ → ソート → limit を通す。行の描画方法だけが異なる。共有の `FolderWidget` で実装し、registry が型ごとにビューを出し分ける。

**`card` config**

```yaml
config:
  folder: projects        # 読むフォルダ（空 = ルート）
  filter: [ ... ]         # 任意の FilterCondition[]
  sort: "-mtime"          # -mtime | mtime | -ctime | ctime | name | -name | <prop> | -<prop>
  limit: 50
  card:                   # フィールド→プロパティのマッピング
    title: file.name      # 既定で file.name なのでカードが空にならない
    subtitle: status
    image: cover
    body: summary
    badges: [tags]
  cols: 3                 # 1 行あたりのカード数（極端に狭いと 1 列に縮退）
```

カードは行フィールドを構造化スロット（title/subtitle/image/body/badges）に割り当てる — 自由テンプレート文字列は無い。`title` 未マッピング時は `CardsView` が行のファイル名にフォールバックするため、追加直後のカードでも必ず何か表示される（「空カード」症状の修正）。`image` はインライン data URI（`data:image/...;base64,...`、IndexedDB キャッシュ上の画像形式）・フル URL・Drive ファイル ID・Drive パス（`findFileByNameLocal` で解決）を受け付ける。カードクリックで対象ファイルを開く。

**`table` config**

```yaml
config:
  folder: projects
  filter: [ ... ]
  sort: "-mtime"
  limit: 50
  columns: [file.name, status, tags]   # 列キー（file.* 属性または frontmatter キー）
```

編集モードでは frontmatter セルをインライン編集でき、編集は順序/本文を保全して元ファイルに書き戻され（`frontmatter-writeback.ts`）、`dashboard-data-changed` イベントで他ウィジェットに通知して再表示させる。`file.*` 属性の列は読み取り専用。値がインライン data URI（`data:image/...`）のセルはテキストではなくサムネイル画像として表示され、編集不可になる。

## Workflow ウィジェット

`workflow` ウィジェットは GemiHub ワークフローをヘッドレス実行し、その出力を描画する。`WorkflowWidget.tsx` + `workflow-runner.ts` で実装。

```yaml
config:
  workflow: reports/weekly.yaml       # ワークフローファイルのパス（.yaml / .yml）
  outputVariable: result              # 任意。出力を保持する変数
  output: table                       # card | table | markdown | html
  # 出力別:
  card: { title: name, body: summary }   # output=card のとき
  cols: 3
  columns: [name, status]                # output=table のとき
  # 後段処理（card/table のみ）:
  filter: [ ... ]
  sort: "-name"
  limit: 50
  refreshInterval: 60                 # 分。0/省略 = 手動のみ
```

### 出力契約

- **`card` / `table`** — ワークフローは**オブジェクトの JSON 配列**（1 行 1 オブジェクト）を出力変数（既定 `result`）に格納する。配列を返す `script` ノードが最も簡単。各オブジェクトのキーが行の列 / カードフィールドになる。テスト実行後、config エディタがフィールドマッピングを自動シードする（table は列、card はフィールド名とサンプル値から title/image/subtitle/body/badges を推測 — `image`/`cover`/… や data URI・画像URL を持つセルが card image に割り当てられる）。行オブジェクトが `fileId`（または `file.fileId`）キーを持つ場合、その card/table 行はクリック可能になり参照先ノートを開く（フォルダソース行と同じ）。
- **`markdown` / `html`** — ワークフローは出力変数に**文字列**を出力する。`GfmMarkdownPreview`（markdown）、またはサンドボックス `<iframe sandbox="allow-scripts">` で `buildHtmlPreviewSrcDoc` 経由（html、HTML ファイルエディタから再利用）で描画する。

config エディタはこの契約を AI ワークフロー生成プロンプトに付与する（`buildFormatGuidance`、出力形式で出し分け）ので、生成されるワークフローが正しい形を出力する。ワークフローは**無人実行**される — 対話ノード（`prompt-value`, `prompt-file`, `prompt-selection`, `dialog`, `drive-file-picker`）を使ってはならない。使った場合、ランナーが具体的なエラーを表示する。

### config エディタ

- **ワークフロー選択** — `.yaml`/`.yml` を一覧表示するが、`skills/…`（スキル同梱）と `web/…`（Web 公開）のワークフローは**除外**する。
- **AI ボタン** — 未選択時は新規作成（`mode=create`）、選択済みのときはそのワークフローの YAML と fileId を渡して `mode=modify` で開く。これにより**実行履歴ピッカー**から失敗実行のステップを AI に渡せる（IDE でワークフローを編集する時と同じフロー）。受理した YAML は既存ファイルを上書きする。
- **実行** — 「実行」ボタンで選択中のワークフローを実行し、出力プレビューとフィールド検出を行う。検出フィールドはオープン時に直近のキャッシュ実行からシードされる（再実行せずともマッピングの現在値が表示される）。ドロップダウンの選択肢は、保存済み設定が参照しているキーとも union される。
- すべての実行（実行ボタン・ヘッダ更新・間隔自動実行）はワークフローの fileId をキーに Drive の**実行履歴**にも保存される — これが上記の失敗フィードバックを可能にする。

### 実行モデルとキャッシュ

結果はダッシュボードごとのサイドカー（`dashboards/.cache/<dashboardFileId>.json`）に `WorkflowCacheRecord`（`{ widgetId, ranAt, status, rows?, fields?, text?, error? }`、last-write-wins）として保存。マウント時はキャッシュを読んで描画する。

実行のトリガ:

1. **手動リフレッシュ** — ウィジェットヘッダの更新ボタン（キャンセル可）。
2. **config エディタの「実行」** — 作成/設定変更時に出力プレビューとフィールド検出を行う。
3. **間隔による自動実行** — マウント時、`refreshInterval > 0` かつ `now - cacheRecord.ranAt > refreshInterval * 60_000`（またはキャッシュ未取得）なら**1 回だけ**自動実行。`useRef` ガードで再描画/ブレークポイント変更時の多重実行を防止。ダッシュボードを開いている間の定期タイマーは無く、鮮度判定はダッシュボードを（再）オープンした時のみ。これは手動/テスト実行を律する「render/effect から実行しない」原則に対する、唯一の意図的な例外。

実行失敗時は前回の rows/text を保持し、エラーと並べて「stale」表示を出す。

## 拡張性

プラグインは `registerWidget(def)`（`widgets/registry.ts`）でカスタムウィジェット型を追加できる。拡張点は `WidgetDef` 契約（`types.ts`）: `render` と任意の `ConfigEditor` を提供する。未知の型は `UnknownWidget` に degrade する。

## 主要ファイル

- `app/dashboard/DashboardHost.tsx` — ライフサイクル（作成/リネーム/削除/切替、home ピン留め）、保存。
- `app/dashboard/DashboardCanvas.tsx`, `GridCell.tsx`, `useGridLayout.ts`, `useBreakpoint.ts` — グリッドと操作。
- `app/dashboard/dashboardFile.ts`, `types.ts` — ファイル I/O とスキーマ。
- `app/dashboard/widgets/registry.ts`, `WidgetPalette.tsx`, `WidgetRenderer.tsx`, `WidgetSettingsPanel.tsx` — 登録と UI。
- `app/dashboard/widgets/` — `MarkdownWidget`, `FileListWidget`, `WebWidget`, `UnknownWidget`（+ それぞれの config エディタ）。
- `app/dashboard/data-widget/` — `FolderWidget`, `WorkflowWidget`, `CardsView`, `TableView`, `folder-source.ts`, `filter.ts`, `workflow-runner.ts`、`Card`/`Table`/`Workflow` config エディタ、共有 `config-parts/`。
- `app/dashboard/frontmatter-writeback.ts`, `frontmatter-cache.ts` — テーブルセルの書き戻し。
