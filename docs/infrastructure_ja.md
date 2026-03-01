# インフラストラクチャ

Terraform で管理する Google Cloud デプロイ構成。

## アーキテクチャ概要

```
                    ┌─────────────────┐
                    │  <your-domain>   │
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
                                 │  (EXTERNAL_MANAGED) │
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
| **Cloud Run** | Node.js SSR アプリケーションホスティング |
| **Artifact Registry** | Docker イメージリポジトリ |
| **Secret Manager** | OAuth 認証情報、セッションシークレット |
| **Compute Engine** | グローバル外部 Application Load Balancer（`EXTERNAL_MANAGED`）、静的 IP、マネージド SSL |
| **Cloud DNS** | DNS ゾーン管理（A レコード + TXT 検証） |
| **Cloud Build** | CI/CD パイプライン（push 時にビルド＆デプロイ） |
| **IAM** | サービスアカウントと権限管理 |
| **BigQuery** | API リクエストログストレージ（90 日保持） |
| **Cloud Logging** | Cloud Run から BigQuery へのログシンク |

## Terraform 構成

```
terraform/
  environments/
    prod/main.tf       # 本番環境エントリポイント
    stg/main.tf        # ステージング環境エントリポイント
  modules/
    gemihub/
      main.tf          # プロバイダ設定（google ~> 6.0）
      variables.tf     # 入力変数
      outputs.tf       # 出力値（LB IP、Cloud Run URL、ネームサーバー）
      apis.tf          # GCP API 有効化（10 API）
      artifact-registry.tf # Docker イメージリポジトリ
      secrets.tf       # Secret Manager シークレット
      iam.tf           # サービスアカウントと IAM バインディング
      cloud-run.tf     # Cloud Run サービス
      networking.tf    # ロードバランサー（IP、NEG、バックエンド、URL マップ、SSL、プロキシ、転送ルール）
      dns.tf           # Cloud DNS マネージドゾーン、A レコード、オプションの TXT 検証レコード
      bigquery-logging.tf  # Cloud Logging → BigQuery パイプライン
      bigquery-views.tf    # BigQuery ビュー定義
      cloud-build.tf   # Cloud Build トリガー（参照用、Cloud Console で作成）
  terraform.tfvars     # 変数値（git-ignored、シークレット含む）
```

## 環境変数（Cloud Run）

| 変数 | ソース |
|------|--------|
| `GOOGLE_CLIENT_ID` | Secret Manager |
| `GOOGLE_CLIENT_SECRET` | Secret Manager |
| `SESSION_SECRET` | Secret Manager |
| `GOOGLE_REDIRECT_URI` | 直接設定（`https://<domain>/auth/google/callback`） |
| `ROOT_FOLDER_NAME` | `root_folder_name` がデフォルトの `"gemihub"` と異なる場合に条件付きで設定 |
| `NODE_ENV` | Dockerfile で設定: `production` |
| `PORT` | Dockerfile で設定: `8080` |

## Cloud Run 設定

| 設定 | 値 |
|------|------|
| CPU | 1 vCPU（リクエストがない間は `cpu_idle = true` でアイドル） |
| メモリ | 2 Gi |
| 最小インスタンス数 | 1 |
| 最大インスタンス数 | 3 |
| ポート | 8080 |
| Ingress | 内部 + Cloud Load Balancing（`INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`） |
| 認証 | パブリック（allUsers） |
| 削除保護 | 無効 |
| スタートアッププローブ | HTTP GET `/`、初期遅延 5秒、間隔 10秒、失敗閾値 3 |

## サービスアカウント

| アカウント | 用途 |
|---------|------|
| `gemini-hub-run` | Cloud Run 実行用（Secret Manager からシークレット読み取り） |
| Cloud Build デフォルト SA（`<project-number>@cloudbuild.gserviceaccount.com`） | Cloud Build（イメージビルド、Cloud Run デプロイ）。`roles/run.admin` と `roles/iam.serviceAccountUser` を付与。 |

## 有効化される API

Terraform により以下の GCP API が有効化されます：

- `run.googleapis.com`
- `artifactregistry.googleapis.com`
- `secretmanager.googleapis.com`
- `cloudbuild.googleapis.com`
- `compute.googleapis.com`
- `iam.googleapis.com`
- `cloudresourcemanager.googleapis.com`
- `dns.googleapis.com`
- `bigquery.googleapis.com`
- `logging.googleapis.com`

## ネットワーク

- **静的 IP**: ロードバランサー用のグローバル外部 IP
- **ロードバランシングスキーム**: `EXTERNAL_MANAGED`（外部 Application Load Balancer）
- **HTTP (port 80)**: `MOVED_PERMANENTLY_DEFAULT` による HTTPS への 301 リダイレクト
- **HTTPS (port 443)**: Google マネージド SSL 証明書（`gemihub-cert`）、ロードバランサーで TLS 終端
- **サーバーレス NEG**: ロードバランサーから Cloud Run へトラフィックをルーティング
- **CDN**: Cloud CDN 有効（`USE_ORIGIN_HEADERS` キャッシュモード、オリジンの Cache-Control ヘッダーを尊重）
- **Cloud Run ingress**: `run.app` への直接パブリックアクセスはブロック、トラフィックはロードバランサー経由のみ

## DNS

Google Cloud DNS で管理。ゾーンには以下を含む：

- **A レコード**: ドメインをグローバル静的 IP に向ける
- **TXT レコード**: Google サイト検証（デフォルトでは無効、`google_site_verification_token` に検証トークンを設定して有効化）

ドメインレジストラでネームサーバーの設定が必要。

## CI/CD（Cloud Build）

プロジェクトルートの `cloudbuild.yaml` でパイプラインを定義：

1. Docker イメージを**ビルド**（`$COMMIT_SHA` と `latest` タグ）
2. Artifact Registry に**プッシュ**
3. `gcloud run deploy` で Cloud Run に**デプロイ**

トリガーは `main` ブランチへの push で自動実行（PR マージも含む）。GitHub 接続は 2nd-gen Cloud Build リポジトリリンクを使用。

> **注意:** Cloud Build トリガーは Cloud Console から手動で作成（GitHub OAuth 接続が必要）。`cloud-build.tf` はリソース定義を参照用として含む。

> **注意:** Cloud Run のコンテナイメージは Cloud Build がデプロイごとに更新するため、Terraform の `lifecycle.ignore_changes` で管理対象外としている。イメージの変更は `cloudbuild.yaml` 経由のみで行うこと。

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
gcloud compute ssl-certificates describe gemihub-cert --global \
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
| Cloud Run（最小 1 インスタンス） | ~$5-10 |
| グローバル HTTPS ロードバランサー | ~$18-20 |
| Cloud DNS | ~$0.20 |
| Artifact Registry | ~$0.10/GB |
| Secret Manager | ほぼ無料 |
| Cloud Build | 120分/日 無料 |
| **合計** | **~$20-25/月** |
