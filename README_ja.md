# Gemini Hub IDE

Google Gemini AI と Google Drive を統合したセルフホスト型 Web アプリケーションです。ビジュアルワークフロー、AIチャット、リッチエディタによるDriveファイル管理など、あらゆる機能を一つの画面で利用できます。

[English README](./README.md)

## 機能一覧

- **AIチャット** — Geminiモデルとのストリーミング会話、Function Calling、思考表示、画像生成、ファイル添付、メッセージごとのモデル/ツール切替
- **スラッシュコマンド & オートコンプリート** — ユーザー定義の`/コマンド`、テンプレート変数（`{content}`, `{selection}`）、`@ファイル`メンション、コマンドごとのモデル/ツール設定
- **ビジュアルワークフローエディタ** — ドラッグ&ドロップのノードベースワークフロービルダー（React Flow）、YAML入出力、SSEによるリアルタイム実行
- **AIワークフロー生成** — 自然言語でワークフローの作成・修正をAIに依頼（ストリーミング生成・思考表示・ビジュアルプレビュー・差分表示・繰り返し改善）
- **Google Drive連携** — すべてのデータ（ワークフロー、チャット履歴、設定、変更履歴）を自分のGoogle Driveに保存
- **リッチMarkdownエディタ** — wysimark-liteによるWYSIWYGファイル作成・編集
- **RAG（検索拡張生成）** — DriveファイルをGemini File Searchに同期し、コンテキストを考慮したAI応答を実現
- **MCP（Model Context Protocol）** — 外部MCPサーバーをAIチャットのツールとして接続
- **暗号化** — チャット履歴・ワークフローログのハイブリッド暗号化（RSA + AES）に対応
- **変更履歴** — unified diff形式によるワークフロー・Driveファイルの変更追跡
- **オフラインキャッシュ & 同期** — IndexedDBベースのファイルキャッシュとmd5ハッシュ比較によるデバイス間Push/Pull同期。一時ファイルステージングにより保存を高速化（APIコール数: 約9→1-2）
- **マルチモデル対応** — Gemini 3, 2.5, Flash, Pro, Lite, Gemma。有料/無料プラン別モデルリスト
- **画像生成** — Gemini 2.5 Flash Image / 3 Pro Image モデルで画像を生成
- **多言語対応** — 英語・日本語UI

## アーキテクチャ

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React 19, React Router 7, Tailwind CSS v4, React Flow |
| バックエンド | React Router サーバー（SSR + APIルート） |
| AI | Google Gemini API (`@google/genai`) |
| ストレージ | Google Drive API |
| 認証 | Google OAuth 2.0 → セッションCookie |
| エディタ | wysimark-lite（Slateベース WYSIWYG） |

### プロジェクト構成

```
app/
├── routes/           # ページ & APIエンドポイント
│   ├── _index.tsx              # IDEダッシュボード
│   ├── settings.tsx            # 設定（6タブUI）
│   ├── api.chat.tsx            # チャットSSEストリーミング
│   ├── api.chat.history.tsx    # チャット履歴CRUD
│   ├── api.drive.files.tsx     # Driveファイル操作
│   ├── api.drive.tree.tsx      # Driveファイルツリー
│   ├── api.drive.temp.tsx      # 一時ファイル保存/適用/削除
│   ├── api.drive.upload.tsx    # ファイルアップロード
│   ├── api.sync.tsx            # Push/Pull同期
│   ├── api.workflow.*.tsx      # ワークフロー実行 & AI生成
│   ├── api.settings.*.tsx      # 設定API群
│   ├── auth.*.tsx              # OAuthログイン/ログアウト/コールバック
│   └── ...
├── services/         # サーバーサイドビジネスロジック
│   ├── gemini-chat.server.ts    # Geminiストリーミングクライアント
│   ├── gemini.server.ts         # Geminiコアクライアント
│   ├── google-drive.server.ts   # Drive API操作
│   ├── google-auth.server.ts    # OAuth 2.0
│   ├── chat-history.server.ts   # チャットCRUD（Drive）
│   ├── user-settings.server.ts  # 設定CRUD（Drive）
│   ├── drive-tools.server.ts    # Drive Function Callingツール
│   ├── mcp-client.server.ts     # MCPプロトコルクライアント
│   ├── mcp-tools.server.ts      # MCP → Gemini統合
│   ├── file-search.server.ts    # RAG / File Search
│   ├── crypto.server.ts         # ハイブリッド暗号化
│   ├── edit-history.server.ts   # diff形式の変更履歴
│   ├── workflow-history.server.ts # ワークフロー実行ログ
│   ├── sync-meta.server.ts      # Push/Pull同期メタデータ
│   ├── temp-file.server.ts      # 一時ファイルステージング
│   ├── execution-store.server.ts # ワークフロー実行状態
│   ├── indexeddb-cache.ts       # ブラウザ側IndexedDBキャッシュ
│   └── session.server.ts       # セッション管理
├── hooks/            # Reactフック
│   ├── useFileWithCache.ts    # キャッシュ優先ファイル読み書き
│   ├── useSync.ts             # Push/Pull同期ロジック
│   ├── useAutocomplete.ts     # スラッシュコマンド & @ファイル オートコンプリート
│   ├── useWorkflowExecution.ts # SSE経由ワークフロー実行
│   ├── useFileUpload.ts       # ファイルアップロード処理
│   └── useApplySettings.ts   # 設定適用
├── components/       # Reactコンポーネント
│   ├── chat/             # チャットUI（メッセージ、入力、オートコンプリートポップアップ）
│   ├── editor/           # Markdownエディタラッパー
│   ├── flow/             # ワークフローキャンバス（Mermaidプレビュー）
│   ├── execution/        # ワークフロー実行パネル、プロンプトモーダル
│   ├── ide/              # IDEレイアウト、同期UI、ダイアログ、ファイルツリー
│   └── settings/         # CommandsTab、TempFilesDialog
├── contexts/         # Reactコンテキスト
│   └── EditorContext.tsx  # エディタ共有状態（ファイル内容、選択範囲、ファイル一覧）
├── i18n/             # 多言語対応
│   ├── translations.ts   # TranslationStringsインターフェース + en/ja翻訳
│   └── context.tsx        # I18nProvider + useI18nフック
├── types/            # TypeScript型定義
│   ├── settings.ts       # 設定、モデル、MCP、RAG、暗号化、スラッシュコマンド
│   └── chat.ts           # メッセージ、ストリーミング、履歴
├── utils/            # ワークフローユーティリティ
│   ├── workflow-to-mermaid.ts       # ワークフロー → Mermaid図
│   ├── workflow-node-summary.ts     # ノードプロパティサマリー
│   ├── workflow-node-properties.ts  # ノードプロパティ取得/設定
│   └── workflow-connections.ts      # ノード接続管理
└── engine/           # ワークフロー実行エンジン
    ├── parser.ts         # YAML → AST
    ├── executor.ts       # ノードタイプごとのハンドラ実行
    └── handlers/         # ノードタイプハンドラ（variable, if, while, command, drive, http, mcp, prompt, ...）
```

## はじめかた

### 前提条件

- Node.js 22以上
- Google Cloudプロジェクト（下記手順で設定）
- Gemini APIキー

### 1. Google Cloud の設定

[Google Cloud Console](https://console.cloud.google.com/) で以下を行います。

#### プロジェクト作成
1. 左上「プロジェクトを選択」→「新しいプロジェクト」→ 名前を付けて作成

#### Google Drive API を有効化
1. 「APIとサービス」→「ライブラリ」
2. "Google Drive API" を検索して「有効にする」

#### OAuth 同意画面の設定
1. 「APIとサービス」→「OAuth 同意画面」
2. User Type: **外部** を選択
3. アプリ名（例: Gemini Hub）、ユーザーサポートメール、デベロッパー連絡先を入力
4. スコープ追加: `https://www.googleapis.com/auth/drive`
5. テストユーザーに自分のGmailアドレスを追加（公開前は自分しかアクセスできません）

#### OAuth 認証情報の作成
1. 「APIとサービス」→「認証情報」→「＋認証情報を作成」→「OAuthクライアントID」
2. アプリケーションの種類: **ウェブアプリケーション**
3. 名前: 任意（例: Gemini Hub Local）
4. **承認済みリダイレクトURI** に追加: `http://localhost:5170/auth/google/callback`
5. 作成後、**クライアントID** と **クライアントシークレット** をメモ

### 2. Gemini APIキーの取得

1. [Google AI Studio](https://aistudio.google.com/) にアクセス
2. 左メニュー「APIキー」→「APIキーを作成」
3. キーをメモ（あとでアプリの設定画面から入力します）

### 3. クローンとインストール

```bash
git clone <repository-url>
cd gemini-hub
npm install
```

### 4. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:5170/auth/google/callback
SESSION_SECRET=<ランダム文字列>
```

`SESSION_SECRET` の生成:

```bash
ruby -rsecurerandom -e 'puts SecureRandom.hex(32)'
# または
openssl rand -hex 32
```

### 5. 開発サーバーを起動

```bash
npm run dev
```

### 6. 初回セットアップ

1. ブラウザで `http://localhost:5170` を開く
2. 「Sign in with Google」をクリック → Googleアカウントで認証
3. 右上の歯車アイコン（Settings）をクリック
4. **General** タブで Gemini API Key を入力して Save

チャット、ワークフロー作成、ファイル編集が使えるようになります。

> **Note:** 開発サーバーのポートは `vite.config.ts` で `5170` に設定されています。変更する場合は、設定ファイルと `.env` のリダイレクトURI、Google Cloud Consoleの承認済みリダイレクトURIも合わせて更新してください。

## 本番環境

### ビルド

```bash
npm run build
npm run start
```

### Docker

```bash
docker build -t gemini-hub .
docker run -p 8080:8080 \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -e GOOGLE_REDIRECT_URI=https://your-domain/auth/google/callback \
  -e SESSION_SECRET=... \
  gemini-hub
```

## 設定

すべての設定はGoogle Driveのルートフォルダ（`gemini-hub/`）内の `settings.json` に保存されます。

| タブ | 設定内容 |
|------|---------|
| **General** | APIキー、有料/無料プラン、デフォルトモデル、システムプロンプト、チャット履歴保存、言語（en/ja）、フォントサイズ、一時ファイル管理 |
| **MCP Servers** | 外部MCPサーバーの追加・削除、接続テスト、サーバーごとの有効/無効切替 |
| **RAG** | 有効/無効、Top-K、複数RAG設定の管理、DriveファイルのFile Search同期 |
| **Encryption** | RSA鍵ペアの生成、チャット履歴・ワークフローログの暗号化切替 |
| **Edit History** | 有効/無効、保持ポリシー（日数/件数）、diffコンテキスト行数、プルーン/統計 |
| **Commands** | スラッシュコマンドの作成・編集・削除、プロンプトテンプレート、コマンドごとのモデル/ツール設定 |

## スラッシュコマンド

**Commands** 設定タブでカスタムスラッシュコマンドを定義できます。各コマンドには以下を設定可能です：

- **プロンプトテンプレート** — `{content}`（現在のファイル内容）、`{selection}`（選択テキスト）、`@ファイル名`（Driveファイル内容）のプレースホルダーに対応
- **モデル指定** — コマンドごとに使用するモデルを指定
- **ツール設定** — 検索設定、Driveツールモード、MCPサーバーの有効/無効をコマンドごとに制御

チャット入力欄で `/` を入力するとオートコンプリートが表示されコマンドを選択できます。`@` を入力するとファイルメンションを挿入できます。

## AIツール（Function Calling）

チャット中、GeminiはFunction Callingを通じて以下のツールを使用できます。ツールの有効/無効はチャット入力欄のツールバーからメッセージごとに制御できます。

### Driveツール

Google Drive上のファイルを読み書きする組み込みツールです。「Drive Tools」設定（`all` / `noSearch` / `none`）で制御します。

| ツール | 説明 |
|--------|------|
| `read_drive_file` | ファイルIDでファイル内容を読み取り |
| `search_drive_files` | フォルダを指定して名前またはコンテンツでファイルを検索（Google Drive API の `fullText contains` / `name contains`） |
| `list_drive_files` | フォルダ内のファイルとサブフォルダを一覧表示 |
| `create_drive_file` | 新規ファイルを作成 |
| `update_drive_file` | 既存ファイルの内容を更新（変更履歴の追跡付き） |

### Gemini組み込みツール

| ツール | 説明 |
|--------|------|
| Google検索 | Gemini組み込みの `googleSearch` ツールによるWeb検索。RAGと排他利用。 |
| RAG（File Search） | Gemini File Searchに同期されたファイルを使った検索拡張生成。`topK` 設定可。 |

### MCPツール（動的）

設定済みMCPサーバーから動的に検出されるツールです。各ツールは `mcp_{サーバー名}_{ツール名}` として登録され、JSON-RPC 2.0（HTTP経由）で実行されます。MCPサーバーは設定画面で管理します。

## データ保存先

すべてのデータはGoogle Driveの `gemini-hub/` フォルダ配下に保存されます:

```
gemini-hub/
├── settings.json        # ユーザー設定
├── workflows/           # ワークフローYAMLファイル
│   └── _sync-meta.json  # Push/Pull同期メタデータ
├── chats/               # チャット履歴JSONファイル
├── edit-history/        # 編集スナップショットとdiff履歴
└── __TEMP__/            # ステージング済み一時ファイル（Push時に適用）
```

### ブラウザキャッシュ & 同期

ファイルはブラウザのIndexedDBにキャッシュされ、即座に表示されます。同期システムはmd5ハッシュ比較で変更を検出します:

- **キャッシュ優先読み込み** — IndexedDBから即座にファイルを表示し、バックグラウンドでDriveのmd5Checksumと照合
- **一時ファイルステージング** — ファイル保存時はまずDrive上の `__TEMP__/` フォルダに書き込み（APIコール1-2回）、Push時に実ファイルへ適用
- **Push** — ステージング済みの一時ファイルを実Driveファイルに適用し、リモート同期メタデータ（`_sync-meta.json`）を更新。その後、残りのローカル変更をプッシュ
- **Pull** — リモートで変更されたファイルをローカルキャッシュにダウンロード。ステージング済みの一時ファイルは保持され、次回Push時に適用
- **コンフリクト解決** — ローカルとリモートの両方が変更された場合、ファイルごとに「ローカルを保持」または「リモートを保持」を選択

ヘッダーの同期ステータスバーでPush/Pull待ちの件数を確認でき、手動同期操作が可能です。一時ファイルはGeneral設定タブから管理（ダウンロード・削除）できます。

## ライセンス

MIT
