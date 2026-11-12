# kiokuflow 共有 VM への追加


公開名は **gemihub**、管理ドメインは **gemihub.net**、店舗suffixは **shops.gemihub.net**、Google OAuthコールバックは **https://gemihub.net/auth/google/callback** です。旧gemihubは **kiokuflow** になりましたが、VM内部ID `gemihub` を維持しています。この予約サービスはVM ID `gemihub-web`、専用DB `gemihub`、クラウドリソースのプレフィックス `gemihub-web` を使います。配置は `--app gemihub-web` です。[名前の使い分け](../docs/branding.md)を参照してください。

[English](README.md) · [日本語](README_ja.md)

既存の `shared-apps` VM（`geminihub-486523` / `asia-northeast1-b`）に gemihub.net の予約サービスを追加します。VM と HTTPS ロードバランサーを共有し、gemihub-web のランタイム ID・Docker ネットワーク・Firestore DB・秘密情報・イメージは分けます。新しい VM や Cloud Run は作成しません。

この構成は設定と手順の実装です。ドメイン、OAuth クライアント、利用可能なモデルを入力して plan を確認するまで、本番への適用・公開は完了していません。

Firestoreロックは、5分間更新されなければ期限切れになります。実行中の処理は1分ごとに期限を延長し、期限切れのロックは次の操作がトランザクションで置き換えます。起動時の一括削除やFirestore TTLポリシーは不要で、複数インスタンスでも同じDBを使えます。Storeへの書き込みは同じトランザクション内でロック所有権を確認し、ロックを失った旧プロセスが後から新しいデータを上書きすることを防ぎます。通常の終了時は、引き続き処理完了とロック解放を待ちます。

予約・決済確認、設定・ファイル同期、メール配送は別のロックで独立に進めます。Driveの応答待ちで決済確定・返金を止めず、PayPalの応答待ちでもファイル同期を進めます。公開設定が変わる場合だけ、最後のDB保存で予約ロックを短く取得します。店舗初期化は関係するロックを取得してから店舗をアーカイブします。

| 管理対象 | Terraform の管理元 |
| --- | --- |
| gemihub-web 用 API / SA / Firestore / Secret Manager / Artifact Registry / DNS / 証明書 / ビルド | このリポジトリの `infra/` |
| 共有 VM / 追加ランタイムの代理認証権限 / IAP / backend / 設定バンドル | Kakeratta の `infra/shared-vm/` |
| 既存の URL map / HTTPS フロントエンド | kiokuflow の `terraform/environments/prod/` |

同じ VM や URL map を別の Terraform state に取り込まないでください。既存の Kakeratta / kiokuflow の tfvars と state を使用し、追加アプリの出力だけをマージします。

以下の手順は、`gemihub`・`kakeratta`・`kiokuflow` のチェックアウトが同じ親ディレクトリにある構成を想定します。ローカルのチェックアウト名が異なる場合はパスを読み替えてください。各リポジトリで対応する変更を取り込んでから進めてください。

## 1. アプリ用リソース

Terraform 1.7 以上と Google Cloud CLI を使います。オペレーターには各プロジェクトの対象リソースを管理できる権限が必要です。

Google provider と GCS backend 用の ADC も設定してください（例：`gcloud auth application-default login`）。

```sh
cd /path/to/gemihub
cp infra/backend.hcl.example infra/backend.hcl
cp infra/terraform.tfvars.example infra/terraform.tfvars
# 実際のドメイン、既存 DNS zone、OAuth client ID、利用可能なモデルを入力する
terraform -chdir=infra init -backend-config=backend.hcl
terraform -chdir=infra plan -out=gemihub-web.tfplan
terraform -chdir=infra apply gemihub-web.tfplan
```

既定の GCP プロジェクトは `geminihub-486523`、DB は専用の `gemihub` です。既存 DB を変更せず、ランタイムの Firestore 権限にも DB 条件を付けます。管理ホストと店舗ホストの suffix は指定した1つの既存 Cloud DNS zone 内に用意してください。証明書と A レコードは既存の LB に接続します。DNS authorization と [名前付き Firestore DB の IAM 条件](https://cloud.google.com/firestore/native/docs/security/iam)を使います。

最初は `repository` を空にして自動デプロイを無効にしてください。GitHub と Cloud Build v2 の接続は、Google 側の OAuth 同意を別途完了してから resource name を設定します。

## 2. 秘密値と OAuth

Terraform は秘密値の入れ物とアクセス権だけを作り、値を生成・取得・state に保存しません。

```sh
openssl rand -hex 32 | gcloud secrets versions add gemihub-web-session-secret \
  --project=geminihub-486523 --data-file=-
gcloud secrets versions add gemihub-web-google-client-secret \
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

Cloud BuildのSSH鍵には10分の有効期限を設定し、成功・失敗どちらでもEXITトラップで、そのビルドが作成した公開鍵だけをビルドSAのOS Loginプロファイルから削除します。これにより、一時鍵の蓄積による32 KiB上限を防ぎます。旧方式の鍵で上限に達した場合は、ビルドSA自身のプロファイルを確認し、使われていないビルド由来の鍵だけを整理します。POSIXプロファイルや別アカウントの鍵は削除しません。[GoogleのOS Loginトラブルシューティング](https://docs.cloud.google.com/compute/docs/troubleshooting/troubleshoot-os-login#os_login_profile_size_limit_exceeded)を参照してください。

## 4. 共有 VM に登録する

```sh
terraform -chdir=infra output -json shared_vm_registration \
  > /tmp/gemihub-web-registration.json
cd ../kakeratta
python3 infra/terraform.py shared-vm fetch-vars
GEMIHUB_EXTENSION_OBJECT=$(python3 infra/shared-vm/prepare-bundle.py \
  --registration /tmp/gemihub-web-registration.json \
  --output /tmp/gemihub-web-extension.tar.gz \
  --tfvars infra/shared-vm/terraform.tfvars)
gcloud storage cp /tmp/gemihub-web-extension.tar.gz \
  "gs://geminihub-486523-shared-apps/$GEMIHUB_EXTENSION_OBJECT"
```

`prepare-bundle.py` は既存の private `terraform.tfvars` を維持し、登録設定と `additional_bundle_object` を管理ブロックに追加します。既存の `bundle_object` は変えません。追加する backend は `shared-apps-gemihub-web`、ポートは `8105`、ネットワークは `172.28.4.0/24` です。VM のサイズは自動では変えません。コンテナ上限の既定値は `768m` なので、適用前に実際の空きメモリを確認してください。

```sh
python3 infra/terraform.py shared-vm init
python3 infra/terraform.py shared-vm plan \
  -var-file="$PWD/infra/shared-vm/terraform.tfvars" -out=/tmp/additional.tfplan
python3 infra/terraform.py shared-vm apply /tmp/additional.tfplan
python3 infra/terraform.py shared-vm upload-vars
gcloud compute scp /tmp/gemihub-web-extension.tar.gz shared-apps:/tmp/gemihub-web-extension.tar.gz \
  --project=geminihub-486523 --zone=asia-northeast1-b --tunnel-through-iap
gcloud compute ssh shared-apps --project=geminihub-486523 \
  --zone=asia-northeast1-b --tunnel-through-iap \
  --command='sudo tar --no-same-owner -xzf /tmp/gemihub-web-extension.tar.gz -C /opt/shared-apps && sudo bash /opt/shared-apps/install-additional.sh'
```

plan は編集済みのローカル tfvars を明示し、適用後に wrapper の `upload-vars` で private GCS に保存します。後日の plan でも登録を保持でき、ローカルの tar ファイルは不要になります。既に他の追加アプリを登録している場合は、それらの登録も JSON に含めてください。既存の管理外 `additional_*` 変数がある場合、ツールは自動で上書きせず、先に設定の統合を求めます。

インストール前に既存 VM の `/opt/shared-apps` と `/etc/nginx/nginx.conf` を root 限定の保存先へバックアップし、現在の Nginx 設定とバンドルを比較します。スクリプトは追加アプリだけを起動し、共有 broker を再起動して Nginx を検査・reload します。実行済みの他アプリのイメージは維持します。起動失敗時のイメージ復旧は既存 `deploy.py` を使いますが、初回の設定追加全体を自動で取り消すものではありません。設定エラー時は保存したバックアップで復旧してください。

バンドルは private GCS に置き、Terraform が VM metadata に不変のオブジェクト名の参照を設定します。新しい VM の復旧時にも元のベースバンドルと追加バンドルを適用します。現在の manifest は Secret Manager に新しい version としてバックアップし、再起動時の設定マージでは最新の実行イメージを維持します。manifest や `docker inspect` の環境変数は表示・コミットしないでください。

## 5. HTTPS のホスト振り分けを追加する

```sh
terraform -chdir=../gemihub/infra output -json shared_lb_registration \
  > /tmp/gemihub-web-lb-registration.json
```

kiokuflow の既存 private 設定に、出力の `shared_vm_backends.gemihub-web` と `shared_vm_hosts.gemihub-web` を**マージ**します。既存の kiokuflow / Kakeratta / Geo の backend 指定は残してください。`terraform/environments/prod` で plan を確認して apply します。追加設定がない状態の既存ホスト規則は変わりません。一般ユーザーの独自ドメインは、下記の専用コントローラーが接続します。

証明書が `ACTIVE`、`shared-apps-gemihub-web` が healthy になったことを確認し、管理画面・店舗サブドメイン・Google ログイン・再ログイン後の永続化・実際のモデル呼出を確認します。共有 health check は TCP 到達性の確認であり、OAuth / Firestore / Vertex AI の疎通確認ではありません。

### 店舗の独自ドメインの自動接続

店主が任意の取得済みドメインを登録し、表示された TXT・A と、所有権確認後の証明書認証用 CNAME を自分の DNS に追加します。1分ごとの専用コントローラーが証明書を発行し、既存 URL map の店舗ホスト規則と専用 Nginx include だけを更新します。実際の HTTPS 接続で店舗 ID が一致するまで公開 URL は従来のものを維持します。一般ユーザーのドメインを tfvars に追加する必要はありません。

初回はこの state の専用 SA・限定 IAM・ドメイン一覧オブジェクトを apply し、kiokuflow 側の `storefront_domain_registry_bucket` に `storefront_bucket` の出力を設定します。kiokuflow の Terraform も同じ一覧を読み、後日の apply で自動接続ドメインを消さない構成です。

```sh
terraform -chdir=infra output -json domain_controller_config > /tmp/gemihub-domains.json
# domain-controller.py / install-domain-controller.sh / この設定 JSON を VM の一時ディレクトリへ転送
sudo bash /path/to/install-domain-controller.sh /path/to/source /path/to/gemihub-domains.json
```

VM 再作成時にもこの初期設定を復元します。既存 VM では Kakeratta のコード・コンテナ・登録バンドルを変更せず、専用 timer と Nginx reload だけで動作します。通常の gemihub 配信は稼働中イメージからコントローラーを更新します。コントローラーは専用 SA を代理認証し、ウェブ実行アカウントには共有フロントエンドの管理権限を付与しません。DNS プロバイダーの変更権限も不要です。状態は `domainConnection` として店舗データと分け、確認用トークンの世代が一致するものだけを表示します。解除・店舗アーカイブ・未確認ドメインは配信対象から外します。

運営者自身が管理する既存 Cloud DNS zone にレコードを作成する場合だけ、任意の `custom_domains = { "reserve.example.com" = { dns_project_id = "example-dns-project", dns_zone = "example-com" } }` を使えます。例えば `nail.takeshy.work` のレコードは takeshy.work 環境の既存ゾーンを使い、このアプリの state が追加レコードを管理します。ゾーン自体や既存レコードを別 state に取り込まず、所有権 TXT は維持します。

## 継続デプロイと検証

初回の検証後に `repository` を設定して plan / apply すると、指定ブランチの push から Cloud Build が実行されます。`cloudbuild.yaml` はイメージを作成して IAP 経由で `deploy.py --app gemihub-web` を実行し、manifest を Secret Manager に保存します。アプリ内ポートは既存の共有デプロイヤーに合わせて `8080` です。

`infra/deploy-vm.sh` はSSHの接続先情報を保存する場所を準備し、配信前に認証を確認します。SSH接続の失敗（終了コード255）では確認だけを最大3回試し、配信処理は1回だけ実行します。鍵はビルドごとに作成し、有効期限を10分に設定して終了時に削除します。配信処理自体が失敗した場合は再実行せず、失敗として報告します。

配信後は `deploy-gemihub.py` がHTTP 200とコンテナの再起動がないことを確認してからmanifestを保存し、このサービスの古い未使用イメージを整理します。現在の版・配信直前の版・いずれかのコンテナが参照するイメージを残します。配信前や正常起動を確認できない場合は削除しません。他アプリのイメージ・コンテナ・ボリュームには触れず、共有の配信ロックで別の配信との競合を防ぎます。共有VMのディスクは30GBのままとし、配信成功後の整理で戻し先を確保しながら容量を維持します。

GitHubリポジトリは `takeshy/gemihub` です。Cloud Buildの接続先は `remoteUri = https://github.com/takeshy/gemihub.git` の登録を選びます。現在の登録名は `projects/geminihub-486523/locations/asia-northeast1/connections/gemini-hub-github/repositories/gemihub` です。リポジトリ名を変更した場合は、Gitの転送だけに頼らず、`repository` とトリガーの参照先も確認してください。push後は、そのコミットSHAのビルドが起動・成功したことと、本番の画面が更新されたことを確認します。

```sh
cd /path/to/gemihub
npm ci --ignore-scripts
npm run build
npm test
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra validate
terraform -chdir=infra test
```

Terraform のテストはモックプロバイダーを使い、クラウドへ適用しません。共有 VM の Python テストと kiokuflow のホスト規則テストも各リポジトリで実行します。実際の初回 Docker build、GCP plan / apply、OAuth / DB / AI の本番接続は、ドメイン等の設定後に別途確認が必要です。

Google OAuthは `projects/495062043717/secrets/google-client-id/versions/1` と `projects/495062043717/secrets/google-client-secret/versions/1` を参照します。有効バージョン番号のみ確認済みで、秘密値は取得・コピーしません。Terraformはこの2つの既存シークレットに実行アカウントの参照権限を設定し、共有デプロイヤーへバージョン固定の参照を出力します。従来の認証情報を使う場合は両方の `*_secret_ref` をnullにして、既存Client IDと従来のsecretバージョンを指定できます。

既存の `gemihub.net` のDNS・証明書・certificate-map entryはkiokuflow側のstateに残します。初回配置のprivate tfvarsに `manage_app_domain_dns_certificate = false` を設定してください。このモジュールは店舗用の追加DNS/TLSだけを作り、apexの同じリソースを重複作成しません。新規ドメインを一から管理する場合だけtrueにします。


## 公開HTMLのバケット配信

`google_storage_bucket.storefront` は店舗の完成HTMLと、そのHTMLが参照するCSS・画像を置く専用バケットです。一般公開を禁止し、実行用サービスアカウントだけにバケット単位の `storage.objectUser`（オブジェクトの作成・読み取り・削除）を付与します。仮公開も同じバケットへ保存しますが、オブジェクトへ直接アクセスさせず、既存ドメインのアプリが本人確認を行ってから返します。ロードバランサーや公開DNSの変更は不要です。CDNからバケットを直接公開する構成にはしていません。

適用順は、Terraformの変更内容を確認してバケットとIAMを作成し、`shared_vm_registration` の更新された環境変数 `STOREFRONT_BUCKET` を共有VMへ登録し、その後アプリをデプロイします。バケットの作成や登録はコードの変更だけでは完了しません。ローカルのインメモリStoreでは、外部のGCSに接続せず専用のメモリ実装を使います。

公開時には、日英と店舗ドメイン用・`/s/{slug}`用のHTMLを生成します。ビルド済みの共通CSSと管理画像（表示用サイズ）は、中身のハッシュ名で店舗ごとに1回だけ保存し（`shops/{id}/assets/`）、長期キャッシュ付きで配信します。HTMLには埋め込まず参照します。全オブジェクトの保存後にFirestoreの `storefrontRelease` を切り替えます。アップロードに失敗したら以前の公開版を維持します。HTMLにセッション・会員情報・通知先メールは保存しません。運用中の公開・設定保存・記事更新では再生成し、読めない画像は保存を止めずに省きます。公開版がない店舗や、古い生成処理（`storefrontRenderer`）の公開版は、裏の定期処理が間隔を空けながら作り直します。公開版が一つもない店舗は、最初の閲覧でも一度だけ変換します。

現行版が古い場合でも消さないよう、日数だけによるライフサイクル削除は設定しません。アプリは現行版と直前の2版（`storefrontPrevious`）を残し、それより古い版のHTMLと、残した版が使っていないCSS・画像を削除します。`terraform test` はリソースを実際に作らず、非公開バケットとIAM・環境変数の構成を確認します。

### 既存の共有VMへ追加するとき

既にgemihub-webが動いている共有VMでは、次の順で進めます。

1. `terraform -chdir=infra plan` でバケット・IAM・登録設定の差分を確認してapplyします。`shared_vm_registration` の `env` に `STOREFRONT_BUCKET` が増えます。前回の登録以降に追加された他の環境変数も同時に反映されます。
2. 手順4のコマンドで登録設定を出力し、バンドルを作り直します。`fetch-vars` は手元に `infra/shared-vm/terraform.tfvars` があると上書きを拒否します。その場合は `gcloud storage cat gs://takeshy-work-kakeratta-terraform/vars/shared-vm/terraform.tfvars | diff - infra/shared-vm/terraform.tfvars` で保存版と比べ、同じならそのまま進め、違うなら手元の変更を確認してから `--force` を付けます。
3. `prepare-bundle.py` が出力したオブジェクト名で、バンドルを `gs://geminihub-486523-shared-apps/` へ先にアップロードします。VMのメタデータはこのファイルを指すため、applyより前に置いてください。
4. 共有VMのplanは、`google_compute_instance.apps` のメタデータ `shared-additional-bundle` の変更1件（`0 to add, 1 to change, 0 to destroy`）が正常です。VMの再作成や他アプリの変更が含まれる場合は適用しないでください。適用後に `upload-vars` で tfvars を保存します。
5. バンドルをVMへ転送して `install-additional.sh` を実行します。`gemihub-web ready` とNginxの設定検査の成功が表示されれば完了です。実行中のイメージは変わらず、新しい環境変数はこの時点では使われません。
6. アプリをデプロイします。

デプロイ後は次を確認します。

- 既存店舗は、最初の閲覧か60秒ごとの定期処理で公開版が作られます。店舗ページが表示され、`gcloud storage ls gs://geminihub-486523-gemihub-web-storefront/shops/` に店舗ごとのファイルがあること。
- ページのHTMLが `/_assets/` のCSS・画像を参照し、それらが200を返すこと。
- `?pane=reserve`・`?pane=mine`・`?pane=contact` の操作画面で、ログイン・予約・お問い合わせが従来どおり動くこと。
- 保存に失敗した店舗はアプリのログに `Storefront <店舗ID>: background release failed` と出ます。再試行は30秒から最大1時間まで間隔を空けて行います。


店舗ログは既存Firestore DBを使います。CRMの行動履歴を利用する前に、`main.tf` の `gemihub_log_events.expiresAt` TTLと、`customerKey`・`at`降順の複合索引を適用してください。新規バケットやOAuthスコープは不要です。TTL削除待ちでもアプリの検索は90日より前を除外します。

アクセス集計には追加の `postId`・`at` 索引と、`gemihub_article_visitors.expiresAt`・`gemihub_daily_visitors.expiresAt` のTTLも必要です。画面を利用する前に適用してください。BigQueryや外部Analyticsのアカウントは不要です。

ログの絞り込み検索には `log_search` の複合索引（種類・成否・顧客・照合IDの組み合わせと日時降順）も適用してください。顧客だけの検索は既存の `customer_activity` 索引を使います。

閲覧の記録上限は店舗ごとに1分1200件、ブラウザIDなしはその内数で1分240件です。この2枠を超えたイベントは200・`ignored: true`で除外し、集計やエラーログには加えません。画面のアクセス数は記録できた閲覧の集計です。
