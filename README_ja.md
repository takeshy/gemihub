# gemihub

[English](README.md) · [日本語](README_ja.md)

**お店の予約システムを、自分の言葉でつくる。**

個人商店・サロン向けの予約・店舗運営システムです。AIとの会話でお店に必要なページや機能を伝え、画面案を確認して仮公開し、内容を整えてからお客様に公開できます。

## 画面イメージ

**画面の編集：** 変更したい箇所をペンで囲んでAIに依頼し、プレビューで確認してから反映できます。

![変更したい箇所をペンで囲んだ、店主用の画面編集](public/manual/22-pen.jpg)

**お客様の予約：** メニュー・スタッフ・空き時間を選び、そのまま予約できます。

![メニュー・スタッフ・空き時間と予約内容を確認する、お客様の予約画面](public/manual/07-reservation.jpg)

---

## なにができるか

### 1. AIと一緒にお店をつくる・直す
- **会話でお店を構築：** 業種やほしい機能をチャットや音声で伝えるだけで、必要な画面構成を提案します。
- **ペンで囲んで部分修正：** プレビュー画面の気になる箇所をペンで囲み、言葉で指示してデザインや文言を調整できます。
- **お店のアシスタントに相談：** 現在の設定や予約状況、変更履歴をもとに、設定の確認や変更案の下書き作成を相談できます（テキスト・音声対応）。
- **画像生成・ブログ作成：** 店舗ページやメニューに使う画像のAI生成や、ブログ・お知らせ記事の作成・公開が行えます。

### 2. 予約受付・決済・スタッフ連携
- **柔軟な予約枠計算：** 営業時間・定休日・臨時休業・スタッフのシフト・メニューの所要時間から空き枠を自動で計算します（スタッフ指名・指名なしの両方に対応）。
- **Google カレンダー連携：** スタッフが自分の Google アカウントを連携すると、カレンダーの予定（FreeBusy）を考慮して重複予約を防ぎます。
- **PayPal 事前決済と自動返金：** 予約時の PayPal 決済と、キャンセル規定（何時間前なら何％返金など）に基づく自動返金に対応しています。

### 3. 日々の店舗運営と顧客管理（CRM）
- **予約・お問い合わせ管理：** 日付やスタッフ別の予約確認、お問い合わせへのメール返信と対応状況の管理ができます。
- **お客様カルテ（CRM）：** 来店履歴や利用金額の自動集計、スタッフ専用の顧客メモ・写真添付・画像ギャラリーを利用できます。
- **日本語・英語対応：** 管理画面・お客様向け画面・マニュアルを日本語と英語で切り替えられます。

---

## どういう仕組みか

```
[店主 / スタッフ / お客様]
         │
         ▼
   [ gemihub サーバー ] ── (AI提案・画像生成・音声対話) ──► [ Vertex AI (Gemini) ]
     │            │
     │            └── (セッション・排他ロック・一時状態) ─► [ Cloud Firestore ]
     │
     └── (台帳・記事・画像・仕様書・履歴の保存) ─────────► [ 店主の Google Sheets / Drive ]
```

- **AIは「設定」を提案し、安全な固定テンプレートで描画：**
  AIが任意のプログラムコードやHTMLを直接生成することはありません。検証済みの設定データ（JSON）として変更案を作り、店主がプレビューで差分を確認・承認したときだけ本番に反映されます。
- **データは店主自身の Google アカウントに保存：**
  予約台帳・顧客情報・メニュー・記事・設定は店主の **Google スプレッドシート** に、アップロード画像や仕様書（`spec.md`）・変更履歴（`history.md`）・オフライン閲覧用HTMLは店主の **Google ドライブ** に保存されます。データをサービス側に囲い込まず、スプレッドシートから直接確認・編集することもできます。
- **段階的な公開フロー：**
  「店主本人だけが見られる仮公開」→「画面のローカル編集・プレビュー」→「本番公開（サブドメインまたは独自ドメイン）」のステップで、安全にお店を公開できます。

---

## 環境構築（ローカルで動かす）

Node.js 24 以上が必要です。

### 1. デモモードで試す（Google / クラウド設定不要）

認証やクラウド接続なしで、インメモリデータを使ったサロンデモをすぐに試せます。

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

http://localhost:3000 を開き、**「サロンのデモを試す」** を選択してください。

- 開発サーバーで動かす場合は、別々のターミナルで `npm run dev`（APIサーバー）と `npm run dev:web`（Vite: http://localhost:5173）を実行します。
- 各画面のカタログをモックデータで確認する場合は `npm run storybook`（http://localhost:6005）を実行します。

### 2. Google / Vertex AI を接続して動かす

実際のAI生成や Google スプレッドシート・ドライブ連携を使う場合は、Google Cloud プロジェクトで以下の API を有効化し、Application Default Credentials（`gcloud auth application-default login`）を設定します。

- Vertex AI API / Cloud Firestore API
- Google Drive API / Google Sheets API / Gmail API / Google Calendar API

`.env` に以下の環境変数を設定して起動します（詳細は `.env.example` を参照）。

| 変数名 | 内容 |
| --- | --- |
| `DEMO_MODE=false` | デモモードを無効化し、実際の Google / AI 連携を使用 |
| `SESSION_SECRET` | 32文字以上のランダムな文字列（セッションとトークンの暗号化に使用） |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud プロジェクト ID |
| `GOOGLE_CLOUD_LOCATION` | Vertex AI のロケーション（例：`us-central1`） |
| `VERTEX_MODEL` | 使用する Gemini モデル ID |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth クライアントの認証情報（リダイレクトURI: `${APP_ORIGIN}/auth/google/callback`） |
| `APP_ORIGIN` | 管理画面のオリジン（ローカルでは `http://localhost:3000`） |

※ PayPal 決済を試す場合は、あわせて `PAYPAL_ENVIRONMENT=sandbox`、`PAYPAL_CLIENT_ID`、`PAYPAL_CLIENT_SECRET_FILE` を設定します。

---

## 詳細ドキュメント・テスト

- **画面付きマニュアル：** アプリ起動後に `/manual` を開くか、Storybook の「使い方」から参照できます。
- **仕様・インフラ構成：**
  - 詳細仕様：[docs/spec.md](docs/spec.md)（[English](docs/spec.en.md)）
  - システム構成ドキュメント：[docs/system/index.md](docs/system/index.md)
  - Terraform デプロイ手順：[infra/README_ja.md](infra/README_ja.md)（[English](infra/README.md)）
- **テストの実行：** `npm test`

## ライセンス

[MIT](LICENSE) © 2026 takeshy。サードパーティのライセンス表記は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
