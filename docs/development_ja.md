# 開発者向けメモ

[English](development.md) · [日本語](development_ja.md)

gemihub のコードを触る人向けの手順です。デモを動かすだけなら [README の環境構築](../README_ja.md#環境構築ローカルで動かす) を見てください。

## 開発サーバー

開発サーバーで動かす場合は、別々のターミナルで `npm run dev`（APIサーバー）と `npm run dev:web`（Vite: http://localhost:5173）を実行します。

## 修正後の画面レビュー

修正後の画面レビューには、ビルド済みのプレビュー（`npm run build`）とChromiumが必要です。`CHROMIUM`にインストール済みの実行ファイルを指定するか、`npx playwright install --with-deps chromium`で対応ブラウザーを用意します。本番用DockerにはChromiumと日本語フォントを含みます。`npm run check:visual-review`は実ブラウザーでの撮影と指摘・再修正の流れをテスト用AI応答で検証します。撮影用ブラウザーは認証情報を持たず、外部ネットワークへの要求を遮断し、読み込めない外部画像はレビュー時に明示します。

## Storybook

- 各画面のカタログをモックデータで確認する場合は `npm run storybook`（http://localhost:6005）を実行します。
- お問い合わせのカンバン・手動作成・添付・やりとり履歴は「運営 → 予約・お客様 → お問い合わせ」で確認できます。`npm run build` と `npm run build-storybook` の後、`npm run check:inquiry-workflow` で日英・PC／スマートフォンの操作とローカルAPIの保存・メールキューを検証します。`npm run capture:manual:inquiries` でマニュアル画像も更新できます。検証のメールはテスト用に置き換え、実送信しません。
- アクセス集計の表示例は「運営 → 予約・お客様 → お客様」の日別アクセス数・行動履歴と、「運営 → ブログ・お知らせ」の記事別PV・ユニークブラウザ数で確認できます。`npm run build-storybook` 後に `npm run capture:manual:access` で日英の画像を更新し、`npm run check:manual:access` で期間切替・全操作の履歴・画像拡大・PC/スマートフォン表示を確認できます。検証はモックで行い、本番APIへは送信しません。
- キャンセルと空き枠予約は「お客様の画面 → キャンセルとお得な空き枠」「運営 → 予約・お客様 → キャンセル枠の予約」の15状態で確認できます。キャンセル・取り消し・決済確認・返金再確認はモックで動作します。`npm run build-storybook` の後に `npm run check:storybook:transfers` で日本語・英語とPC・スマートフォン幅の操作を検証できます。必要に応じて `CHROMIUM` にインストール済みブラウザのパスを指定してください。

## マニュアル画像

キャンセルのマニュアル画像は、Storybookのビルド後に `npm run capture:manual:cancellations` で日英を生成できます。`npm run check:manual` で画像の参照先・日英の手順・画像の拡大・スマートフォン表示を確認できます。追加メニュー・電話番号でのお客様登録・PayPalの「要対応」の画像は `npm run capture:manual:guides` で生成し、`npm run check:manual:guides` で目的別の入口・関連リンク・画像をPC／スマートフォン幅で確認できます。

## アクセス集計と診断ログ

アクセス集計と診断ログは既存のFirestoreを使います。本番利用前に[配備手順](../infra/README_ja.md)のTTLとログ検索・記事集計用の索引を適用してください。集計対象は記録できた閲覧で、通信失敗や記録制限によって実際の閲覧より少なくなる場合があります。BigQueryや外部Analyticsのアカウントは不要です。

## Google / Vertex AI を接続して動かす

実際のAI生成や Firestore・Google ドライブ連携を使う場合は、Google Cloud プロジェクトで以下の API を有効化し、Application Default Credentials（`gcloud auth application-default login`）を設定します。

- Vertex AI API / Cloud Firestore API
- Google Drive API / Gmail API / Google Calendar API

`.env` に以下の環境変数を設定して起動します（詳細は `.env.example` を参照）。

| 変数名 | 内容 |
| --- | --- |
| `DEMO_MODE=false` | デモモードを無効化し、実際の Google / AI 連携を使用 |
| `SESSION_SECRET` | 32文字以上のランダムな文字列（セッションとトークンの暗号化に使用） |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud プロジェクト ID |
| `GOOGLE_CLOUD_LOCATION` | Vertex AI のロケーション（例：`us-central1`） |
| `VERTEX_MODEL` | 使用する Gemini モデル ID |
| `VERTEX_REVIEW_MODEL` | 初回テーマ確認用モデル（省略時は `VERTEX_MODEL` を独立した文脈で使用） |
| `VERTEX_DESIGN_MODEL` | テーマ・ページのHTML/CSS生成用モデル（省略時は `VERTEX_MODEL`） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth クライアントの認証情報（リダイレクトURI: `${APP_ORIGIN}/auth/google/callback`） |
| `APP_ORIGIN` | 管理画面のオリジン（ローカルでは `http://localhost:3000`） |
| `STOREFRONT_BUCKET` | 生成した公開ページを置く非公開の Cloud Storage バケット（Firestore 利用時は必須。インメモリのデモではメモリに保存）。作成手順は [infra/README_ja.md](../infra/README_ja.md#公開htmlのバケット配信) を参照 |

PayPal 決済を試す場合は、あわせて `PAYPAL_ENVIRONMENT=sandbox`、`PAYPAL_CLIENT_ID`、`PAYPAL_CLIENT_SECRET_FILE` を設定します。
