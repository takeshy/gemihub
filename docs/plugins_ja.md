# プラグイン

GitHub Release からコミュニティプラグインをインストールして Gemini Hub を拡張できます。Obsidian + BRAT のパターンを参考にしています。

## 機能

- **GitHub Release インストール**: 公開 GitHub リポジトリからプラグインをインストール
- **信頼ベースの実行**: プラグインはホストアプリと同じ権限で実行されます。信頼できるプラグインのみインストールしてください
- **Drive ストレージ**: プラグインファイルとデータは Google Drive（`plugins/` フォルダ）に保存
- **IndexedDB キャッシュ**: プラグインアセットをクライアント側にキャッシュして高速ロード
- **即時有効/無効**: ページリロードなしでプラグインを切り替え
- **プラグイン API**: Gemini AI、Drive ファイル、プラグイン専用ストレージへのアクセス

## ユーザー向け

### プラグインのインストール

1. **設定 > プラグイン** を開く
2. GitHub リポジトリを入力（例: `owner/repo` または `https://github.com/owner/repo`）
3. **インストール** をクリック

最新の GitHub Release に `manifest.json` と `main.js` が含まれている必要があります。`styles.css` は任意です。

### プラグインの管理

| 操作 | 説明 |
|------|------|
| **有効/無効** | プラグイン横の電源アイコンで切り替え |
| **更新** | 更新アイコンをクリックして最新リリースを取得 |
| **アンインストール** | ゴミ箱アイコンをクリック（Drive 上の全プラグインデータを削除） |

### プラグインデータの保存場所

```
gemihub/
  plugins/
    {plugin-id}/
      manifest.json   ← プラグインメタデータ
      main.js          ← プラグインコード
      styles.css       ← プラグインスタイル（任意）
      data.json        ← プラグイン専用ストレージ
```

---

## プラグイン開発者向け

### プロジェクト構成

プラグインリリースには以下のアセットが必要です:

| ファイル | 必須 | 説明 |
|----------|------|------|
| `manifest.json` | はい | プラグインメタデータ |
| `main.js` | はい | プラグインエントリポイント（バンドル済み） |
| `styles.css` | いいえ | プラグインスタイル |

### manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "プラグインの説明",
  "author": "作者名"
}
```

`id` は一意である必要があり、Drive フォルダ名と IndexedDB キャッシュキーとして使用されます。

### main.js

esbuild（または同様のツール）で `react` と `react-dom` を external にしてビルドします。エントリポイントは `onload` メソッドを持つクラスをエクスポートする必要があります:

```javascript
class MyPlugin {
  onload(api) {
    // プラグインがロードされた時に呼ばれる
    // api を使ってビュー、コマンドの登録やホスト API の呼び出しを行う
  }

  onunload() {
    // プラグインが無効化またはアンインストールされた時に呼ばれる
    // イベントリスナー、タイマーなどをクリーンアップ
  }
}

module.exports = MyPlugin;
```

esbuild 設定例:

```javascript
require("esbuild").build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  external: ["react", "react-dom", "react-dom/client"],
  jsx: "automatic",
});
```

### プラグイン API

`onload` に渡される `api` オブジェクトが提供する機能:

#### 言語

```typescript
// 現在の言語設定（"en"、"ja" など）
const lang = api.language;
```

#### UI 登録

```typescript
// サイドバーまたはメインビューを登録
api.registerView({
  id: "my-view",
  name: "My View",
  location: "sidebar", // または "main"
  component: MyReactComponent, // props に { api } を受け取る
});

// チャット用スラッシュコマンドを登録
api.registerSlashCommand({
  name: "my-command",
  description: "何かを実行",
  execute: async (args) => {
    return "結果テキスト";
  },
});

// 設定タブを登録（設定 > プラグインの歯車アイコンから表示）
api.registerSettingsTab({
  component: MySettingsComponent, // props に { api } を受け取る
});
```

#### Gemini AI

```typescript
const response = await api.gemini.chat(
  [
    { role: "user", content: "こんにちは" },
  ],
  {
    model: "gemini-2.5-flash",        // 任意
    systemPrompt: "あなたは親切です",   // 任意
  }
);
// response はモデルのテキスト応答
```

#### Google Drive

```typescript
// ファイルを読み取り
const content = await api.drive.readFile(fileId);

// ファイルを名前で検索
const files = await api.drive.searchFiles("クエリ");

// フォルダ内のファイル一覧
const files = await api.drive.listFiles(folderId);

// ファイルを作成
const { id, name } = await api.drive.createFile("notes.md", "# メモ");

// ファイルを更新
await api.drive.updateFile(fileId, "新しい内容");
```

#### プラグインストレージ

各プラグインは Drive 上に専用の `data.json` を持ち、永続的なキーバリューストレージとして使用できます:

```typescript
// 値を取得
const value = await api.storage.get("myKey");

// 値を設定
await api.storage.set("myKey", { count: 42 });

// 保存された全データを取得
const all = await api.storage.getAll();
```

#### React

バージョン不一致を避けるため、ホストの React インスタンスを利用できます:

```typescript
const React = api.React;
const ReactDOM = api.ReactDOM;
```

### ビューコンポーネント

ビューコンポーネントは props に `{ api }` を受け取ります:

```tsx
function MyPanel({ api }) {
  const React = api.React;
  const [data, setData] = React.useState(null);

  React.useEffect(() => {
    api.storage.getAll().then(setData);
  }, []);

  return <div>{JSON.stringify(data)}</div>;
}
```

- **サイドバービュー** は右パネルのタブとして表示（チャット、ワークフローと並列）
- **メインビュー** はメインエリアのファイルエディタを置き換えて表示

### セキュリティ

- プラグインはホストアプリと同じ権限で実行されます（DOM、`fetch` 等へのフルアクセス）
- 信頼できるソースからのプラグインのみインストールしてください
- `require()` シムは `react`、`react-dom`、`react-dom/client` のみ提供
- プラグインコードはブラウザで実行され、サーバーでは実行されない

### 公開方法

1. プラグイン用の GitHub リポジトリを作成
2. `main.js` と `manifest.json`（任意で `styles.css`）をビルド
3. GitHub Release を作成し、ファイルをリリースアセットとして添付
4. ユーザーは設定 > プラグインで `owner/repo` を入力してインストール

アップデートを公開するには、バージョンタグを更新した新しいリリースを作成します。ユーザーは更新ボタンをクリックして最新版を取得できます。

---

## API ルート

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/plugins` | インストール済みプラグイン一覧 |
| POST | `/api/plugins` | プラグインインストール `{ repo }` |
| GET | `/api/plugins/:id?file=main.js` | プラグインファイル配信 |
| POST | `/api/plugins/:id` | アクション: `toggle`, `getData`, `setData`, `update`, `checkUpdate` |
| DELETE | `/api/plugins/:id` | プラグインアンインストール |
