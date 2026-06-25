# ダッシュボード

ダッシュボードは IDE のホーム画面に表示される、設定可能な **ウィジェット** のグリッドです。編集モードでドラッグ/リサイズ/設定して視覚的にオーサリングし、ユーザーの Drive 上に `.dashboard` YAML ファイルとして永続化します。すべてローカルファースト：編集は IndexedDB キャッシュを更新し、通常の Push フローで Drive に反映されます。

> 実装は `app/dashboard/` 配下にあります。本書は `dashboard.md`（英語）の日本語ミラーです。

## ファイル形式と保存場所

- ダッシュボードは拡張子 `.dashboard` の YAML ファイル。
- 新規ダッシュボードは**必ず** `dashboards/` 配下に作成（`dashboards/{name}.dashboard`、空状態のスターターは `dashboards/home.dashboard`）— workflows が `workflows/` 配下にあるのと同様。レガシーの単一ダッシュボードはルートの `home.dashboard` から**読込**のみ互換維持し、新規はそこに書かない。
- ワークフロー結果データは `dashboards/data/<dashboardFileId>.json` に**通常の同期ファイル**として保存。push/pull の同期対象で、ファイルツリーや push/pull 差分一覧にも他のファイルと同様に出る（実行していない別マシンでも Pull で結果を取得できる）。再生成可能な last-write-wins データで、ウィジェットはロード時に最新版を遅延フェッチもする（`loadCacheFile`）。
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
| `markdown` | 既存 Drive Markdown ファイルをインライン編集（preview/wysiwyg/code） | Drive ファイル |
| `file-list` | フォルダ内ファイルの一覧（ヘッダにパス + 絞り込み/並び替え） | フォルダ |
| `web` | 外部 URL を埋め込み（埋め込み可否チェック + フォールバックカード） | URL |
| `card` | Markdown ファイルのフォルダに対するカードグリッド | フォルダ |
| `table` | Markdown ファイルのフォルダに対する編集可能テーブル | フォルダ |
| `kanban` | Markdown ファイルのフォルダに対するカンバンボード | フォルダ |
| `workflow` | ワークフローを実行し出力を描画 | ワークフロー |

`web` は初期リリースから変更なし。`markdown` / `file-list`（直下）とデータ指向の `card` / `table` / `kanban` / `workflow` を以下で説明する。

### Markdown ウィジェット

**既存**の Drive Markdown ファイルを参照し（インライン content は廃止）、`MarkdownFileEditor` で通常エディタと同じ **preview / wysiwyg / code** 切替・frontmatter・wiki リンク・local-first 保存（`useFileWithCache`）をインライン描画する。ツールバーは *パス + モード切替* のみに絞る（`hideToolbarActions`）。左のファイルパスは `MarkdownFilePicker`（`editorCtx.fileList` に対する @ 風検索）で、**編集モード外でも**参照ファイルを切替でき、選択は `ctx.onConfigChange({ fileId, fileName })` で永続化される。これにより 2 カラム（例: `file-list` の隣に `markdown` エディタ）が実用的になる。表示モードはセッション初回のみ **preview** が既定で、その後はセッションスコープの変数がユーザーの最後の明示的な切替を記憶し、別ファイルを開いても保持される（wysiwyg/code のまま）。config: `{ fileId, fileName }`。

### File List ウィジェット

フォルダのファイル一覧。ヘッダにフォルダパスと、ビューモードで効く 2 つのアイコン — **絞り込み**（ファイル名の部分一致）と**並び替え**（mtime/ctime/name の 6 種）— を表示する。いずれもエフェメラルなビュー時オーバーレイで、絞り込みは読込済みリストにクライアント側で適用、並び替えは設定の `sort` を上書き（`listFilesLocal` で再取得）する。`.dashboard` には書き戻さない。ポップオーバーは `data-widget/ViewControls.tsx` のポータル `Popover` を再利用。

ファイルをクリックしても**すぐには開かず**、`FilePreviewModal`（ポータルのオーバーレイ）で内容をプレビューする（Markdown は `GfmMarkdownPreview` で描画、その他はプレーンテキスト）。モーダルのヘッダには遷移アイコン（エディタで開く）と閉じるアイコンがあり、遷移アイコンを押したときだけ実際の `plugin-select-file` 遷移を行う。

> **経緯。** 以前のビルドには汎用の `data` ウィジェット（`source` folder|workflow × `view` table|cards）と `file-table` ウィジェットがあった。これらは本書の 3 つの明示ウィジェットに置き換えられた。ダッシュボード機能は未リリースだったため**互換シムは無い** — `data` / `file-table` 型は廃止され、旧テスト用 `.dashboard` は新型で作り直すこと。

### 共通の構成部品

`card` / `table` / `workflow` は共通パイプラインを再利用する:

- **行モデル** — `DataRow`（`data-widget/types.ts`）: `{ id, fileName?, fileId?, mtime?, ctime?, cells }`。`cells` は名前をキーとするプロパティ値（frontmatter キー + `file.*` 属性）を保持。
- **フォルダソース** — `loadFolderRows(folder)` / `scanFolderFields(folder)`（`folder-source.ts`）がフォルダ内の Markdown を読み、frontmatter + ファイル属性を行/フィールドとして公開。
- **後段パイプライン** — `applyPostSource(rows, { filter, sort, limit })`（`filter.ts`）: フィルタ条件 → ソート → limit。補助: `getCellValue`, `formatCell`, `detectFields`。
- **ビュー** — `CardsView.tsx`（フィールドマッピングカード）と `TableView.tsx`（任意のインラインセル編集付きテーブル）。
- **Config 部品** — `data-widget/config-parts/` に再利用可能なエディタ部品（`FilterEditor`, `SortLimitFields`, `CardMappingEditor`, `ColumnsEditor`, `useFolderFields`）があり、3 つの config エディタで共有。

### ビュー時の絞り込み・並び替え（ヘッダ操作）

`card`/`table` フォルダウィジェットと `card`/`table` のワークフロー出力には、ヘッダに 2 つの独立したアイコン — **絞り込み**アイコン（`FilterEditor` ポップオーバーを開く）と**並び替え**アイコン（ソート候補リストを開く）— が表示される。`ViewControls.tsx` で実装され、**編集モードに入らずビューモードのまま**操作できる:

- 状態は**エフェメラル**: ビュー時フィルタはウィジェットの設定済み `filter` に AND され、ビュー時ソートは設定済み `sort` を上書きする。`.dashboard` ファイルには書き戻されず、ダッシュボードを再読み込みするとリセットされる。
- アクティブ時は各アイコンに青いドットが付く。並び替えポップオーバーには上書きを解除する「リセット」項目がある。
- ポップオーバーはポータル描画（ウィジェットセルは `overflow-hidden` で、そのままだとクリップされる）。絞り込みポップオーバーは幅広（`w-80`）で、プロパティセレクタは縮小可能（`min-w-0`）なため条件行がパネルからはみ出さない。

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

カードは行フィールドを構造化スロット（title/subtitle/image/body/badges）に割り当てる — 自由テンプレート文字列は無い。`title` 未マッピング時は `CardsView` が行のファイル名にフォールバックするため、追加直後のカードでも必ず何か表示される（「空カード」症状の修正）。`image` は Obsidian 内部埋め込み/リンク（`![[folder/cover.png]]` / `[[cover.png]]`、`findFileByNameLocal` で解決）・Drive パス（`folder/cover.png`）・Drive ファイル ID・フル URL・インライン data URI（`data:image/...;base64,...`、IndexedDB キャッシュ上の画像形式）を受け付ける。base64 より参照（`![[…]]` / パス）を推奨 — AI 生成ガイダンスは既存 Drive 画像を参照し、実際に新規画像を生成する場合のみ base64 を埋め込むようモデルに指示する。カードクリックで対象ファイルを開く。

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

## Kanban ウィジェット

`kanban` ウィジェットはフォルダ内の Markdown ファイルを読み、frontmatter のステータスプロパティで列分けする。カードを別の列へドラッグすると、同じファイルの frontmatter にステータス変更を書き戻す。

![Kanban ボード](../public/images/dashboard_kanban.png)

```yaml
config:
  folder: projects
  title: Tasks
  statusProperty: status              # 列に使う frontmatter キー
  titleProperty: title                # カードタイトルのキー。なければファイル名
  columns:
    - { value: todo, label: To Do }
    - { value: in-progress, label: In Progress }
    - { value: done, label: Done }
  showUnspecified: true               # 空/未知ステータスのカードを表示
  displayFields: [owner, due]
  filter: [ ... ]
  limit: 100
```

新しい Kanban ウィジェットではボードタイトルが必須。ヘッダーの **新規** ボタンから、選択した列のステータスを持つ Markdown ノートを設定フォルダ内に作成できる。`showUnspecified` が有効なときだけ、空または未知ステータスのカードが「未指定」列に表示される。その列へドロップすると frontmatter からステータスキーを削除する。互換性のため `columns: [todo, doing, done]` 形式も引き続き読み込める。

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
  refreshInterval: 60                 # 分。0/省略 = 手動のみ。ダッシュボードを開いている間は定期的に再実行
```

### 出力契約

- **`card` / `table`** — ワークフローは**オブジェクトの JSON 配列**（1 行 1 オブジェクト）を出力変数（既定 `result`）に格納する。配列を返す `script` ノードが最も簡単。各オブジェクトのキーが行の列 / カードフィールドになる。テスト実行後、config エディタがフィールドマッピングを自動シードする（table は列、card はフィールド名とサンプル値から title/image/subtitle/body/badges を推測 — `image`/`cover`/… や data URI・画像URL・`![[…]]` 埋め込み・画像拡張子パスを持つセルが card image に割り当てられる）。行オブジェクトが `fileId`（または `file.fileId`）キーを持つ場合、その card/table 行はクリック可能になり参照先ノートを開く（フォルダソース行と同じ）。
- **`markdown` / `html`** — ワークフローは出力変数に**文字列**を出力する。`GfmMarkdownPreview`（markdown）、またはサンドボックス `<iframe sandbox="allow-scripts">` で `buildHtmlPreviewSrcDoc` 経由（html、HTML ファイルエディタから再利用）で描画する。

config エディタはこの契約を AI ワークフロー生成プロンプトに付与する（`buildFormatGuidance`、出力形式で出し分け）ので、生成されるワークフローが正しい形を出力する。ワークフローは**無人実行**される — 対話ノード（`prompt-value`, `prompt-file`, `prompt-selection`, `dialog`, `drive-file-picker`）を使ってはならない。使った場合、ランナーが具体的なエラーを表示する。

### config エディタ

- **ワークフロー選択** — `.yaml`/`.yml` を一覧表示するが、`skills/…`（スキル同梱）と `web/…`（Web 公開）のワークフローは**除外**する。
- **AI ボタン** — 未選択時は新規作成（`mode=create`）、選択済みのときはそのワークフローの YAML と fileId を渡して `mode=modify` で開く。これにより**実行履歴ピッカー**から失敗実行のステップを AI に渡せる（IDE でワークフローを編集する時と同じフロー）。受理した YAML は既存ファイルを上書きする。
- **実行** — 「実行」ボタンで選択中のワークフローを実行し、出力プレビューとフィールド検出を行う。検出フィールドはオープン時に直近のキャッシュ実行からシードされる（再実行せずともマッピングの現在値が表示される）。ドロップダウンの選択肢は、保存済み設定が参照しているキーとも union される。
- すべての実行（実行ボタン・ヘッダ更新・間隔自動実行）はワークフローの fileId をキーに Drive の**実行履歴**にも保存される — これが上記の失敗フィードバックを可能にする。

### 実行モデルとキャッシュ

結果はダッシュボードごとのファイル（`dashboards/data/<dashboardFileId>.json`）に `WorkflowCacheRecord`（`{ widgetId, ranAt, status, rows?, fields?, text?, error? }`、last-write-wins）として保存。マウント時はキャッシュを読んで描画する。これは通常の同期ファイル（上記「ファイル形式と保存場所」参照）なので、ワークフローを実行していないマシンでも最新結果を描画できる — `loadCacheFile` はローカルに無い、または remote の方が新しい場合に Drive から内容を遅延フェッチもする。

実行のトリガ:

1. **手動リフレッシュ** — ウィジェットヘッダの更新ボタン（キャンセル可）。
2. **config エディタの「実行」** — 作成/設定変更時に出力プレビューとフィールド検出を行う。
3. **間隔による自動実行** — マウント時、`refreshInterval > 0` かつ `now - cacheRecord.ranAt > refreshInterval * 60_000`（またはキャッシュ未取得）なら一度自動実行する。その後、ダッシュボードを開いている間は `refreshInterval` 分ごとにワークフローを再実行する定期タイマーを登録する。タイマーはアンマウント時、またはワークフロー/間隔設定の変更時に解除される。

実行失敗時は前回の rows/text を保持し、エラーと並べて「stale」表示を出す。

## 拡張性

プラグインは `registerWidget(def)`（`widgets/registry.ts`、`PluginAPI.registerWidget` 経由で公開）でカスタムウィジェット型を追加できる。拡張点は `WidgetDef` 契約（`types.ts`）: `render` と任意の `ConfigEditor` を提供する。未知の型は `UnknownWidget` に degrade し、config・未知キーは保存時も保持される。

**遅延登録。** プラグインは非同期ロードされ、ダッシュボード描画後に登録されることが多い。`registerWidget` は `dashboard-widgets-changed` イベントを発火し、`DashboardCanvas` がそれを購読して再描画するため、後からロードされた型は `UnknownWidget` からリロード無しで実描画に差し替わる。

**`base` ウィジェット（プラグイン提供、例: Obsidian Bases）。** `.base` の読込/作成/描画はコアではなくプラグインに置く方針。規約はウィジェット `{ type: "base", config: { base: "dashboards/xx.base", view: "<view名>" } }`: プラグインが `type: "base"` を登録し、参照 `.base` の指定 view を描画する。コアに専用 import 機構は不要 — `.dashboard` は widget を保存するだけ、`WidgetContext`（size/editMode/widgetId/dashboardFileId/`onConfigChange`）が渡り、プラグイン未導入時は config を保持したまま `UnknownWidget` を表示する。（注: `drive-local.ts` の `EXCLUDED_PREFIXES` は `dashboards/` を含むため、プラグインが `.base` を発見する際は `listFiles` ではなく `readFile`/`searchFiles` を使うこと。）

**ビューモードでの config 更新。** `WidgetContext.onConfigChange(config)` により、ウィジェットがビューモードから自身の config を永続化できる（`GridCell` → `DashboardCanvas` → ダッシュボード保存に配線）。Markdown ウィジェットのヘッダファイルピッカーで使用。

## 主要ファイル

- `app/dashboard/DashboardHost.tsx` — ライフサイクル（作成/リネーム/削除/切替、home ピン留め）、保存。
- `app/dashboard/DashboardCanvas.tsx`, `GridCell.tsx`, `useGridLayout.ts`, `useBreakpoint.ts` — グリッドと操作。
- `app/dashboard/dashboardFile.ts`, `types.ts` — ファイル I/O とスキーマ。
- `app/dashboard/widgets/registry.ts`, `WidgetPalette.tsx`, `WidgetRenderer.tsx`, `WidgetSettingsPanel.tsx` — 登録と UI。
- `app/dashboard/widgets/` — `MarkdownWidget`, `FileListWidget`, `WebWidget`, `UnknownWidget`（+ それぞれの config エディタ）。
- `app/dashboard/data-widget/` — `FolderWidget`, `WorkflowWidget`, `CardsView`, `TableView`, `folder-source.ts`, `filter.ts`, `workflow-runner.ts`、`Card`/`Table`/`Workflow` config エディタ、共有 `config-parts/`。
- `app/dashboard/frontmatter-writeback.ts`, `frontmatter-cache.ts` — テーブルセルの書き戻し。
