# Deploy gemihub.net on the shared VM


The public brand is **gemihub**; the default management domain is **gemihub.net**, storefront suffix **shops.gemihub.net**, and Google OAuth callback **https://gemihub.net/auth/google/callback**. The former gemihub service is now **kiokuflow**, but retains its legacy VM runtime ID `gemihub`. This service registers as `gemihub-web`, uses a dedicated database `gemihub`, and creates cloud resources prefixed `gemihub-web`. Use `--app gemihub-web` to deploy this service. See [naming notes](../docs/branding.md).

[English](README.md) · [日本語](README_ja.md)

Add the gemihub.net booking service to the existing `shared-apps` VM (`geminihub-486523` / `asia-northeast1-b`). The VM and HTTPS load balancer are shared, while this service has its own runtime identity, Docker network, Firestore database, secrets, and image. This configuration does not create another VM or Cloud Run service.

These files implement configuration and operating procedures. Production deployment/publication is not complete until actual domains, OAuth client, and available models are configured and the plan has been reviewed and applied.

| Resources | Terraform owner |
| --- | --- |
| gemihub-web APIs, service accounts, Firestore, Secret Manager, Artifact Registry, DNS, certificates, build | This repository's `infra/` |
| Shared VM, additional runtime impersonation, IAP, backend, configuration bundle | Kakeratta `infra/shared-vm/` |
| Existing URL map and HTTPS frontend | kiokuflow `terraform/environments/prod/` |

Do not import the same VM or URL map into a second state. Preserve the existing Kakeratta/kiokuflow tfvars and state, merging only the additional app's outputs. These instructions assume sibling checkouts of `omaiweb`, `kakeratta`, and `gemihub` (kiokuflow), each with the corresponding integration changes.

## 1. Application resources

Use Terraform 1.7 or later and Google Cloud CLI. Operators need permissions for the resources in each project. Configure ADC for the Google provider and GCS backend, for example with `gcloud auth application-default login`.

```sh
cd /path/to/omaiweb
cp infra/backend.hcl.example infra/backend.hcl
cp infra/terraform.tfvars.example infra/terraform.tfvars
# Enter actual domains, existing DNS zone, OAuth client ID, and available models.
terraform -chdir=infra init -backend-config=backend.hcl
terraform -chdir=infra plan -out=gemihub-web.tfplan
terraform -chdir=infra apply gemihub-web.tfplan
```

Defaults are project `geminihub-486523` and a dedicated `gemihub` database. Existing databases remain unchanged; runtime Firestore access includes a database condition. Put the management host and storefront suffix within the specified existing Cloud DNS zone. Certificates and A records attach to the existing load balancer, using DNS authorization and [named Firestore database IAM conditions](https://cloud.google.com/firestore/native/docs/security/iam).

Initially leave `repository` empty to disable automatic deployment. Complete Google's OAuth consent for the GitHub/Cloud Build v2 connection separately before setting its resource name.

The GitHub repository is `takeshy/gemihub`. Select a Cloud Build repository with `remoteUri = https://github.com/takeshy/gemihub.git`; the current resource is `projects/geminihub-486523/locations/asia-northeast1/connections/gemini-hub-github/repositories/gemihub`. After a GitHub rename, check both `repository` and the trigger's repository reference. Git redirects alone do not verify automatic deployment. After pushing, check that a build for that commit SHA starts and succeeds, then verify the updated production page.

## 2. Secrets and OAuth

Terraform creates secret containers and access rules only. It does not generate, retrieve, or store secret values in state.

```sh
openssl rand -hex 32 | gcloud secrets versions add gemihub-web-session-secret \
  --project=geminihub-486523 --data-file=-
gcloud secrets versions add gemihub-web-google-client-secret \
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

`prepare-bundle.py` preserves private tfvars and adds registration plus `additional_bundle_object` in a managed block. It leaves the base `bundle_object` intact. The added backend is `shared-apps-gemihub-web`, port `8105`, network `172.28.4.0/24`. VM size is unchanged. The default container memory limit is `768m`; check actual available memory before applying.

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

Explicitly pass edited local tfvars to plan, then use the wrapper's `upload-vars` after applying to preserve them in private GCS. Future plans retain registration without the local tar file. If other additional apps are registered, include them in the registration JSON. Existing unmanaged `additional_*` variables require reconciliation rather than automatic overwrite.

Before installation, back up `/opt/shared-apps` and `/etc/nginx/nginx.conf` to a root-only location and compare the existing configuration and bundle. The installer starts only additional apps, restarts the shared broker, validates Nginx, and reloads it. Other running image versions are preserved. Existing `deploy.py` handles image recovery after startup failures, but does not roll back the entire initial configuration addition. Restore the backup for configuration errors.

Bundles are private GCS objects referenced by immutable object name in VM metadata. VM recovery applies both the base and additional bundles. The current manifest is backed up as a new Secret Manager version; configuration merging on restart retains current running image versions. Do not print or commit manifests or environment values from `docker inspect`.

## 5. Add HTTPS host routing

```sh
terraform -chdir=../omaiweb/infra output -json shared_lb_registration \
  > /tmp/gemihub-web-lb-registration.json
```

Merge `shared_vm_backends.gemihub-web` and `shared_vm_hosts.gemihub-web` into kiokuflow's existing private configuration, preserving kiokuflow/Kakeratta/Geo backends. Review/apply the plan in `terraform/environments/prod`. Existing rules are unchanged when no extension is configured. Custom storefront domains additionally require certificates, DNS, `shared_vm_hosts.gemihub-web`, and registration `hosts`; owner-side TXT verification alone does not update load-balancer routing.

Check that the certificate is `ACTIVE` and `shared-apps-gemihub-web` is healthy. Then verify management/storefront hosts, Google login, persistence after logging in again, and actual model calls. The shared TCP health check proves reachability only, not OAuth, Firestore, or Vertex connectivity.

## Continuous deployment and verification

After initial validation, configure `repository` and review/apply the plan to trigger Cloud Build on pushes to the chosen branch. `cloudbuild.yaml` builds an image, calls `deploy.py --app gemihub-web` over IAP, and saves the manifest in Secret Manager. The app uses container port `8080` for compatibility with the shared deployer.

```sh
cd /path/to/omaiweb
npm ci --ignore-scripts
npm run build
npm test
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra validate
terraform -chdir=infra test
```

Terraform tests use mock providers and do not apply cloud changes. Run shared-VM Python tests and kiokuflow host-rule tests in their own repositories too. Initial Docker builds, real GCP plan/apply, and production OAuth/DB/AI connectivity still need verification after actual domains and credentials are configured.


### PayPal Sandboxの追加設定

`paypal_client_id`を設定した場合だけ`gemihub-web-paypal-client-secret`を作成し、実行アカウントへの参照権限と、VM登録用の`PAYPAL_CLIENT_SECRET`参照を出力します。`paypal_environment`の初期値は`sandbox`です。既存環境は未設定のまま維持できます。

```bash
gcloud secrets versions add gemihub-web-paypal-client-secret --project=geminihub-486523 --data-file=/secure/path/paypal.secret
```

Secretの値をtfvarsや登録JSONに書かず、`paypal_secret_version`でバージョンを固定します。公開した店舗で事前決済を有効にする前に、購入者用Sandboxアカウントで支払い・キャンセル・返金を確認してください。デプロイしたコードと認証済みの決済確認は別の検証です。1つの受取アカウントを使用する実装で、店舗ごとの加盟店接続・分配は含みません。実行中の取引がある間は環境やアカウントを変更しないでください。共有VMの常駐プロセスが毎分の決済・返金復旧処理を実行します。

Google OAuth for gemihub.net reuses `projects/495062043717/secrets/google-client-id/versions/1` and `projects/495062043717/secrets/google-client-secret/versions/1`. Both enabled version numbers were checked without reading payloads. Terraform grants the service runtime access to these two secrets and exports versioned references for the shared deployer; credentials are not copied into this repository. To supply the client ID directly, set both `google_client_id_secret_ref` and `google_client_secret_ref` to null and configure the client ID and managed secret version.

For the existing gemihub.net deployment, set `manage_app_domain_dns_certificate = false` in private tfvars. Keep the existing apex DNS and certificate-map entry in kiokuflow state. This module then creates only the additional storefront DNS/TLS resources. Set it to true only when managing a fresh apex domain.


## Generated storefront storage

`google_storage_bucket.storefront` stores finished shop HTML and the CSS/images it refers to. Public access is prevented. Grant only bucket-scoped `storage.objectUser` (create, read and delete objects) to the runtime account. Provisional pages use the same private bucket, with the existing domain gateway enforcing authentication before reading an object. No DNS or load-balancer changes are required; this implementation does not expose the bucket directly through a public CDN.

Review/apply the bucket and IAM configuration first, update the shared VM registration with its `STOREFRONT_BUCKET` environment variable, then deploy the app. Code changes alone do not create these resources. In-memory stores use the local test storage implementation without GCS access.

Publication generates Japanese/English HTML for both shop hosts and `/s/{slug}` addresses. Built CSS and managed images (display size) are stored once per shop under content-hash names (`shops/{id}/assets/`) and served with long-lived caching; pages refer to them instead of embedding them. Commit the Firestore `storefrontRelease` reference only after all objects are uploaded. An interrupted upload preserves the previous release. Never embed session state, profiles or notification addresses. Regenerate on publication, operational settings saves and article updates. Unreadable images are left out rather than blocking the save. Shops without a release, or with one from an older generator (`storefrontRenderer`), are rebuilt by the background loop with exponential backoff; a first visit converts a shop without any release once.

Do not expire objects solely by age: an old release can still be active. The app keeps the current release and the two before it (`storefrontPrevious`), and deletes older releases' pages and any assets no kept release uses. `terraform test` verifies the private bucket, scoped IAM and runtime environment without provisioning resources.
