# インフラストラクチャ

Terraform で管理する Google Cloud デプロイ構成。

## アーキテクチャ概要

```
                    ┌─────────────────┐
                    │  gemihub.online   │
                    │  (Cloud DNS)     │
                    └────────┬────────┘
                             │ A レコード
                    ┌────────▼────────┐
                    │  グローバル静的  │
                    │  IP アドレス     │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     ┌────────▼────────┐         ┌──────────▼─────────┐
     │  HTTP (port 80) │         │  HTTPS (port 443)  │
     │  転送ルール     │         │  転送ルール        │
     └────────┬────────┘         └──────────┬─────────┘
              │                             │
     ┌────────▼────────┐         ┌──────────▼─────────┐
     │  HTTP プロキシ   │         │  HTTPS プロキシ    │
     │  (301 リダイレクト)│        │  (マネージド SSL)  │
     └─────────────────┘         └──────────┬─────────┘
                                            │
                                 ┌──────────▼─────────┐
                                 │  URL マップ         │
                                 └──────────┬─────────┘
                                            │
                                 ┌──────────▼─────────┐
                                 │  バックエンドサービス│
                                 └──────────┬─────────┘
                                            │
                                 ┌──────────▼─────────┐
                                 │  サーバーレス NEG   │
                                 └──────────┬─────────┘
                                            │
                                 ┌──────────▼─────────┐
                                 │  Cloud Run          │
                                 │  (gemini-hub)       │
                                 │  Node.js 22 / SSR   │
                                 │  port 8080          │
                                 └─────────────────────┘
```

## 使用サービス

| サービス | 用途 |
|---------|------|
| **Cloud Run** | Node.js SSR アプリケーションホスティング（ゼロスケール対応） |
| **Artifact Registry** | Docker イメージリポジトリ |
| **Secret Manager** | OAuth 認証情報、セッションシークレット |
| **Compute Engine** | グローバル HTTPS ロードバランサー、静的 IP、マネージド SSL |
| **Cloud DNS** | DNS ゾーン管理 |
| **Cloud Build** | CI/CD パイプライン（push 時にビルド＆デプロイ） |
| **IAM** | サービスアカウントと権限管理 |

## Terraform 構成

```
terraform/
  main.tf              # プロバイダ設定
  variables.tf         # 入力変数
  terraform.tfvars     # 変数値（git-ignored、シークレット含む）
  outputs.tf           # 出力値（LB IP、Cloud Run URL、ネームサーバー）
  apis.tf              # GCP API 有効化
  artifact-registry.tf # Docker イメージリポジトリ
  secrets.tf           # Secret Manager シークレット
  iam.tf               # サービスアカウントと IAM バインディング
  cloud-run.tf         # Cloud Run サービス
  networking.tf        # ロードバランサー（IP、NEG、バックエンド、URL マップ、SSL、プロキシ、転送ルール）
  dns.tf               # Cloud DNS マネージドゾーンと A レコード
  cloud-build.tf       # Cloud Build トリガー（参照用、gcloud で作成）
```

## 環境変数（Cloud Run）

| 変数 | ソース |
|------|--------|
| `GOOGLE_CLIENT_ID` | Secret Manager |
| `GOOGLE_CLIENT_SECRET` | Secret Manager |
| `SESSION_SECRET` | Secret Manager |
| `GOOGLE_REDIRECT_URI` | 直接設定（`https://<domain>/auth/google/callback`） |
| `NODE_ENV` | Dockerfile で設定: `production` |
| `PORT` | Dockerfile で設定: `8080` |

## Cloud Run 設定

| 設定 | 値 |
|------|------|
| CPU | 1 vCPU（リクエストがない間はアイドル） |
| メモリ | 512 Mi |
| 最小インスタンス数 | 0（ゼロスケール） |
| 最大インスタンス数 | 3 |
| ポート | 8080 |
| Ingress | 全トラフィック |
| 認証 | パブリック（allUsers） |

## サービスアカウント

| アカウント | 用途 |
|---------|------|
| `gemini-hub-run` | Cloud Run 実行用（シークレット読み取り） |
| `gemini-hub-build` | Cloud Build トリガー（イメージビルド、Cloud Run デプロイ） |

## ネットワーク

- **静的 IP**: ロードバランサー用のグローバル外部 IP
- **HTTP (port 80)**: HTTPS への 301 リダイレクト
- **HTTPS (port 443)**: Google マネージド SSL 証明書、ロードバランサーで TLS 終端
- **サーバーレス NEG**: ロードバランサーから Cloud Run へトラフィックをルーティング

## DNS

Google Cloud DNS で管理。ドメインレジストラでネームサーバーを設定。

## CI/CD（Cloud Build）

プロジェクトルートの `cloudbuild.yaml` でパイプラインを定義：

1. Docker イメージを**ビルド**（`$COMMIT_SHA` と `latest` タグ）
2. Artifact Registry に**プッシュ**
3. `gcloud run deploy` で Cloud Run に**デプロイ**

トリガーは `main` ブランチへの push で自動実行（PR マージも含む）。GitHub 接続は 2nd-gen Cloud Build リポジトリリンクを使用。

## Docker

マルチステージ Dockerfile（`node:22-slim`）：

1. 全依存関係をインストール（`npm ci`）
2. 本番依存関係のみインストール（`npm ci --omit=dev`）
3. アプリをビルド（`npm run build`）
4. 最終イメージ: 本番依存関係 + ビルド成果物のみ

## 手動オペレーション

### 初回セットアップ

```bash
# 認証
gcloud auth login
gcloud auth application-default login

# terraform.tfvars にシークレットを設定してから:
cd terraform
terraform init
terraform apply
```

### 手動ビルド＆デプロイ

```bash
# Cloud Build でイメージをビルド＆プッシュ
gcloud builds submit \
  --region=asia-northeast1 \
  --tag=<artifact-registry-image-path>:latest

# Cloud Run を新しいイメージで更新
gcloud run deploy gemini-hub \
  --image=<artifact-registry-image-path>:latest \
  --region=asia-northeast1
```

### 状態確認

```bash
# SSL 証明書
gcloud compute ssl-certificates describe gemini-hub-cert --global \
  --format="table(managed.status,managed.domainStatus)"

# Cloud Run サービス
gcloud run services describe gemini-hub --region=asia-northeast1 --format="value(status.url)"

# Terraform 出力
cd terraform && terraform output
```

### シークレットの更新

Secret Manager でシークレットバージョンを更新しても、Cloud Run は自動的に新しい値を取得**しません**。再デプロイで適用：

```bash
gcloud run services update gemini-hub --region=asia-northeast1
```

## コスト見積もり（低トラフィック時）

| サービス | 月額コスト |
|---------|-----------|
| Cloud Run（ゼロスケール） | アイドル時 ~$0 |
| グローバル HTTPS ロードバランサー | ~$18-20 |
| Cloud DNS | ~$0.20 |
| Artifact Registry | ~$0.10/GB |
| Secret Manager | ほぼ無料 |
| Cloud Build | 120分/日 無料 |
| **合計** | **~$20-25/月** |
