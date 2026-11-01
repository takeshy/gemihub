# GemiHub 共有 VM への追加

既存の `shared-apps` VM（`geminihub-486523` / `asia-northeast1-b`）に omaiweb を追加します。VM と HTTPS ロードバランサーを共有し、omaiweb のランタイム ID・Docker ネットワーク・Firestore DB・秘密情報・イメージは分けます。新しい VM や Cloud Run は作成しません。

この構成は設定と手順の実装です。ドメイン、OAuth クライアント、利用可能なモデルを入力して plan を確認するまで、本番への適用・公開は完了していません。

| 管理対象 | Terraform の管理元 |
| --- | --- |
| omaiweb 用 API / SA / Firestore / Secret Manager / Artifact Registry / DNS / 証明書 / ビルド | このリポジトリの `infra/` |
| 共有 VM / 追加ランタイムの代理認証権限 / IAP / backend / 設定バンドル | Kakeratta の `infra/shared-vm/` |
| 既存の URL map / HTTPS フロントエンド | GemiHub の `terraform/environments/prod/` |

同じ VM や URL map を別の Terraform state に取り込まないでください。既存の Kakeratta / GemiHub の tfvars と state を使用し、追加アプリの出力だけをマージします。

以下の手順は、`omaiweb`・`kakeratta`・`gemihub` のチェックアウトが同じ親ディレクトリにある構成を想定します。各リポジトリで対応する変更を取り込んでから進めてください。

## 1. アプリ用リソース

Terraform 1.7 以上と Google Cloud CLI を使います。オペレーターには各プロジェクトの対象リソースを管理できる権限が必要です。

Google provider と GCS backend 用の ADC も設定してください（例：`gcloud auth application-default login`）。

```sh
cd /path/to/omaiweb
cp infra/backend.hcl.example infra/backend.hcl
cp infra/terraform.tfvars.example infra/terraform.tfvars
# 実際のドメイン、既存 DNS zone、OAuth client ID、利用可能なモデルを入力する
terraform -chdir=infra init -backend-config=backend.hcl
terraform -chdir=infra plan -out=omaiweb.tfplan
terraform -chdir=infra apply omaiweb.tfplan
```

既定の GCP プロジェクトは `geminihub-486523`、DB は専用の `omaiweb` です。既存 DB を変更せず、ランタイムの Firestore 権限にも DB 条件を付けます。管理ホストと店舗ホストの suffix は指定した1つの既存 Cloud DNS zone 内に用意してください。証明書と A レコードは既存の LB に接続します。DNS authorization と [名前付き Firestore DB の IAM 条件](https://cloud.google.com/firestore/native/docs/security/iam)を使います。

最初は `repository` を空にして自動デプロイを無効にしてください。GitHub と Cloud Build v2 の接続は、Google 側の OAuth 同意を別途完了してから resource name を設定します。

## 2. 秘密値と OAuth

Terraform は秘密値の入れ物とアクセス権だけを作り、値を生成・取得・state に保存しません。

```sh
openssl rand -hex 32 | gcloud secrets versions add omaiweb-session-secret \
  --project=geminihub-486523 --data-file=-
gcloud secrets versions add omaiweb-google-client-secret \
  --project=geminihub-486523 --data-file=/secure/path/google-client-secret.txt
```

プロジェクトを変更した場合はコマンドの指定も合わせます。初回 version は `1` を使います。既存 secret を再利用する場合は import と明示的な version 設定が必要です。`SESSION_SECRET` は保存済み OAuth token の暗号鍵なので、再デプロイ時も維持してください。

`terraform -chdir=infra output -raw oauth_redirect_uri` の URL を Google OAuth のウェブアプリ用クライアントに登録します。店主・顧客・スタッフの同意画面、テストユーザー、必要な Google の審査は別途設定します。

## 3. 初回イメージを用意する

共有 VM にまだ登録していないため、初回はデプロイを省略してビルドします。実際のプロジェクトを変更した場合は `--project` も変更します。

```sh
gcloud builds submit . --project=geminihub-486523 --region=asia-northeast1 \
  --config=cloudbuild.yaml \
  --service-account="$(terraform -chdir=infra output -raw build_account_resource)" \
  --gcs-source-staging-dir="gs://$(terraform -chdir=infra output -raw build_source_bucket)/source" \
  --substitutions="_IMAGE=$(terraform -chdir=infra output -raw bootstrap_image),_DEPLOY=false"
```

このコマンドを実行する人にはビルド SA の `iam.serviceAccounts.actAs` が必要です。ビルド SA 自身にはソース bucket の読取、対象 registry の書込、ログ、共有 VM の IAP / OS Login を付与します。共有 VM 側の権限は次のステップで有効になるため、初回ビルドは `_DEPLOY=false` が必須です。

## 4. 共有 VM に登録する

```sh
terraform -chdir=infra output -json shared_vm_registration \
  > /tmp/omaiweb-registration.json
cd ../kakeratta
python3 infra/terraform.py shared-vm fetch-vars
OMAIWEB_EXTENSION_OBJECT=$(python3 infra/shared-vm/prepare-bundle.py \
  --registration /tmp/omaiweb-registration.json \
  --output /tmp/omaiweb-extension.tar.gz \
  --tfvars infra/shared-vm/terraform.tfvars)
gcloud storage cp /tmp/omaiweb-extension.tar.gz \
  "gs://geminihub-486523-shared-apps/$OMAIWEB_EXTENSION_OBJECT"
```

`prepare-bundle.py` は既存の private `terraform.tfvars` を維持し、登録設定と `additional_bundle_object` を管理ブロックに追加します。既存の `bundle_object` は変えません。追加する backend は `shared-apps-omaiweb`、ポートは `8105`、ネットワークは `172.28.4.0/24` です。VM のサイズは自動では変えません。コンテナ上限の既定値は `768m` なので、適用前に実際の空きメモリを確認してください。

```sh
python3 infra/terraform.py shared-vm init
python3 infra/terraform.py shared-vm plan \
  -var-file="$PWD/infra/shared-vm/terraform.tfvars" -out=/tmp/additional.tfplan
python3 infra/terraform.py shared-vm apply /tmp/additional.tfplan
python3 infra/terraform.py shared-vm upload-vars
gcloud compute scp /tmp/omaiweb-extension.tar.gz shared-apps:/tmp/omaiweb-extension.tar.gz \
  --project=geminihub-486523 --zone=asia-northeast1-b --tunnel-through-iap
gcloud compute ssh shared-apps --project=geminihub-486523 \
  --zone=asia-northeast1-b --tunnel-through-iap \
  --command='sudo tar --no-same-owner -xzf /tmp/omaiweb-extension.tar.gz -C /opt/shared-apps && sudo bash /opt/shared-apps/install-additional.sh'
```

plan は編集済みのローカル tfvars を明示し、適用後に wrapper の `upload-vars` で private GCS に保存します。後日の plan でも登録を保持でき、ローカルの tar ファイルは不要になります。既に他の追加アプリを登録している場合は、それらの登録も JSON に含めてください。既存の管理外 `additional_*` 変数がある場合、ツールは自動で上書きせず、先に設定の統合を求めます。

インストール前に既存 VM の `/opt/shared-apps` と `/etc/nginx/nginx.conf` を root 限定の保存先へバックアップし、現在の Nginx 設定とバンドルを比較します。スクリプトは追加アプリだけを起動し、共有 broker を再起動して Nginx を検査・reload します。実行済みの他アプリのイメージは維持します。起動失敗時のイメージ復旧は既存 `deploy.py` を使いますが、初回の設定追加全体を自動で取り消すものではありません。設定エラー時は保存したバックアップで復旧してください。

バンドルは private GCS に置き、Terraform が VM metadata に不変のオブジェクト名の参照を設定します。新しい VM の復旧時にも元のベースバンドルと追加バンドルを適用します。現在の manifest は Secret Manager に新しい version としてバックアップし、再起動時の設定マージでは最新の実行イメージを維持します。manifest や `docker inspect` の環境変数は表示・コミットしないでください。

## 5. HTTPS のホスト振り分けを追加する

```sh
terraform -chdir=../omaiweb/infra output -json shared_lb_registration \
  > /tmp/omaiweb-lb-registration.json
```

GemiHub の既存 private 設定に、出力の `shared_vm_backends.omaiweb` と `shared_vm_hosts.omaiweb` を**マージ**します。既存の GemiHub / Kakeratta / Geo の backend 指定は残してください。`terraform/environments/prod` で plan を確認して apply します。追加設定がない状態の既存ホスト規則は変わりません。独自ドメインを店舗へ追加する場合は、そのドメインの証明書・DNS・`shared_vm_hosts.omaiweb`・登録の `hosts` も別途追加します。店主画面の TXT 確認だけでは LB の設定は増えません。

証明書が `ACTIVE`、`shared-apps-omaiweb` が healthy になったことを確認し、管理画面・店舗サブドメイン・Google ログイン・再ログイン後の永続化・実際のモデル呼出を確認します。共有 health check は TCP 到達性の確認であり、OAuth / Firestore / Vertex AI の疎通確認ではありません。

## 継続デプロイと検証

初回の検証後に `repository` を設定して plan / apply すると、指定ブランチの push から Cloud Build が実行されます。`cloudbuild.yaml` はイメージを作成して IAP 経由で `deploy.py --app omaiweb` を実行し、manifest を Secret Manager に保存します。アプリ内ポートは既存の共有デプロイヤーに合わせて `8080` です。

```sh
cd /path/to/omaiweb
npm ci --ignore-scripts
npm run build
npm test
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra validate
terraform -chdir=infra test
```

Terraform のテストはモックプロバイダーを使い、クラウドへ適用しません。共有 VM の Python テストと GemiHub のホスト規則テストも各リポジトリで実行します。実際の初回 Docker build、GCP plan / apply、OAuth / DB / AI の本番接続は、ドメイン等の設定後に別途確認が必要です。
