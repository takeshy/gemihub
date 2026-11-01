# Add omaiweb to the shared GemiHub VM

[English](README.md) · [日本語](README_ja.md)

Add omaiweb to the existing `shared-apps` VM (`geminihub-486523` / `asia-northeast1-b`). The VM and HTTPS load balancer are shared, while omaiweb has its own runtime identity, Docker network, Firestore database, secrets, and image. This configuration does not create another VM or Cloud Run service.

These files implement configuration and operating procedures. Production deployment/publication is not complete until actual domains, OAuth client, and available models are configured and the plan has been reviewed and applied.

| Resources | Terraform owner |
| --- | --- |
| omaiweb APIs, service accounts, Firestore, Secret Manager, Artifact Registry, DNS, certificates, build | This repository's `infra/` |
| Shared VM, additional runtime impersonation, IAP, backend, configuration bundle | Kakeratta `infra/shared-vm/` |
| Existing URL map and HTTPS frontend | GemiHub `terraform/environments/prod/` |

Do not import the same VM or URL map into a second state. Preserve the existing Kakeratta/GemiHub tfvars and state, merging only the additional app's outputs. These instructions assume sibling checkouts of `omaiweb`, `kakeratta`, and `gemihub`, each with the corresponding integration changes.

## 1. Application resources

Use Terraform 1.7 or later and Google Cloud CLI. Operators need permissions for the resources in each project. Configure ADC for the Google provider and GCS backend, for example with `gcloud auth application-default login`.

```sh
cd /path/to/omaiweb
cp infra/backend.hcl.example infra/backend.hcl
cp infra/terraform.tfvars.example infra/terraform.tfvars
# Enter actual domains, existing DNS zone, OAuth client ID, and available models.
terraform -chdir=infra init -backend-config=backend.hcl
terraform -chdir=infra plan -out=omaiweb.tfplan
terraform -chdir=infra apply omaiweb.tfplan
```

Defaults are project `geminihub-486523` and a dedicated `omaiweb` database. Existing databases remain unchanged; runtime Firestore access includes a database condition. Put the management host and storefront suffix within the specified existing Cloud DNS zone. Certificates and A records attach to the existing load balancer, using DNS authorization and [named Firestore database IAM conditions](https://cloud.google.com/firestore/native/docs/security/iam).

Initially leave `repository` empty to disable automatic deployment. Complete Google's OAuth consent for the GitHub/Cloud Build v2 connection separately before setting its resource name.

## 2. Secrets and OAuth

Terraform creates secret containers and access rules only. It does not generate, retrieve, or store secret values in state.

```sh
openssl rand -hex 32 | gcloud secrets versions add omaiweb-session-secret \
  --project=geminihub-486523 --data-file=-
gcloud secrets versions add omaiweb-google-client-secret \
  --project=geminihub-486523 --data-file=/secure/path/google-client-secret.txt
```

Adjust project flags if needed. Initial versions use `1`. Reusing existing secrets requires imports and explicit version configuration. Keep `SESSION_SECRET` stable across redeployments because it encrypts saved OAuth tokens.

Register the URL from `terraform -chdir=infra output -raw oauth_redirect_uri` on the Google OAuth web application client. Configure consent, test users, and required Google review for owners, customers, and staff separately.

## 3. Build the initial image

The app is not registered on the shared VM yet, so skip deployment on the first build. Adjust `--project` if needed.

```sh
gcloud builds submit . --project=geminihub-486523 --region=asia-northeast1 \
  --config=cloudbuild.yaml \
  --service-account="$(terraform -chdir=infra output -raw build_account_resource)" \
  --gcs-source-staging-dir="gs://$(terraform -chdir=infra output -raw build_source_bucket)/source" \
  --substitutions="_IMAGE=$(terraform -chdir=infra output -raw bootstrap_image),_DEPLOY=false"
```

The caller needs `iam.serviceAccounts.actAs` on the build account. The build account receives source-bucket read, registry write, logging, and shared-VM IAP/OS Login permissions. VM-side permissions become effective in the next step, so `_DEPLOY=false` is required for the bootstrap build.

## 4. Register on the shared VM

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

`prepare-bundle.py` preserves private tfvars and adds registration plus `additional_bundle_object` in a managed block. It leaves the base `bundle_object` intact. The added backend is `shared-apps-omaiweb`, port `8105`, network `172.28.4.0/24`. VM size is unchanged. The default container memory limit is `768m`; check actual available memory before applying.

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

Explicitly pass edited local tfvars to plan, then use the wrapper's `upload-vars` after applying to preserve them in private GCS. Future plans retain registration without the local tar file. If other additional apps are registered, include them in the registration JSON. Existing unmanaged `additional_*` variables require reconciliation rather than automatic overwrite.

Before installation, back up `/opt/shared-apps` and `/etc/nginx/nginx.conf` to a root-only location and compare the existing configuration and bundle. The installer starts only additional apps, restarts the shared broker, validates Nginx, and reloads it. Other running image versions are preserved. Existing `deploy.py` handles image recovery after startup failures, but does not roll back the entire initial configuration addition. Restore the backup for configuration errors.

Bundles are private GCS objects referenced by immutable object name in VM metadata. VM recovery applies both the base and additional bundles. The current manifest is backed up as a new Secret Manager version; configuration merging on restart retains current running image versions. Do not print or commit manifests or environment values from `docker inspect`.

## 5. Add HTTPS host routing

```sh
terraform -chdir=../omaiweb/infra output -json shared_lb_registration \
  > /tmp/omaiweb-lb-registration.json
```

Merge `shared_vm_backends.omaiweb` and `shared_vm_hosts.omaiweb` into GemiHub's existing private configuration, preserving GemiHub/Kakeratta/Geo backends. Review/apply the plan in `terraform/environments/prod`. Existing rules are unchanged when no extension is configured. Custom storefront domains additionally require certificates, DNS, `shared_vm_hosts.omaiweb`, and registration `hosts`; owner-side TXT verification alone does not update load-balancer routing.

Check that the certificate is `ACTIVE` and `shared-apps-omaiweb` is healthy. Then verify management/storefront hosts, Google login, persistence after logging in again, and actual model calls. The shared TCP health check proves reachability only, not OAuth, Firestore, or Vertex connectivity.

## Continuous deployment and verification

After initial validation, configure `repository` and review/apply the plan to trigger Cloud Build on pushes to the chosen branch. `cloudbuild.yaml` builds an image, calls `deploy.py --app omaiweb` over IAP, and saves the manifest in Secret Manager. The app uses container port `8080` for compatibility with the shared deployer.

```sh
cd /path/to/omaiweb
npm ci --ignore-scripts
npm run build
npm test
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra validate
terraform -chdir=infra test
```

Terraform tests use mock providers and do not apply cloud changes. Run shared-VM Python tests and GemiHub host-rule tests in their own repositories too. Initial Docker builds, real GCP plan/apply, and production OAuth/DB/AI connectivity still need verification after actual domains and credentials are configured.


### PayPal Sandboxの追加設定

`paypal_client_id`を設定した場合だけ`omaiweb-paypal-client-secret`を作成し、実行アカウントへの参照権限と、VM登録用の`PAYPAL_CLIENT_SECRET`参照を出力します。`paypal_environment`の初期値は`sandbox`です。既存環境は未設定のまま維持できます。

```bash
gcloud secrets versions add omaiweb-paypal-client-secret --project=geminihub-486523 --data-file=/secure/path/paypal.secret
```

Secretの値をtfvarsや登録JSONに書かず、`paypal_secret_version`でバージョンを固定します。公開した店舗で事前決済を有効にする前に、購入者用Sandboxアカウントで支払い・キャンセル・返金を確認してください。デプロイしたコードと認証済みの決済確認は別の検証です。1つの受取アカウントを使用する実装で、店舗ごとの加盟店接続・分配は含みません。実行中の取引がある間は環境やアカウントを変更しないでください。共有VMの常駐プロセスが毎分の決済・返金復旧処理を実行します。
