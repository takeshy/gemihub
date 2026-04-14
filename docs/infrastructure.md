# Infrastructure

Google Cloud deployment managed by Terraform.

## Architecture Overview

```
                    ┌─────────────────┐
                    │  <your-domain>   │
                    │  (Cloud DNS)     │
                    └────────┬────────┘
                             │ A record
                    ┌────────▼────────┐
                    │  Global Static  │
                    │  IP Address     │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     ┌────────▼────────┐         ┌──────────▼─────────┐
     │  HTTP (port 80) │         │  HTTPS (port 443)  │
     │  Forwarding Rule│         │  Forwarding Rule   │
     └────────┬────────┘         └──────────┬─────────┘
              │                             │
     ┌────────▼────────┐         ┌──────────▼─────────┐
     │  HTTP Proxy     │         │  HTTPS Proxy       │
     │  (301 redirect) │         │  (Managed SSL Cert)│
     └─────────────────┘         └──────────┬─────────┘
                                            │
                                 ┌──────────▼─────────┐
                                 │  URL Map            │
                                 └──────────┬─────────┘
                                            │
                                 ┌──────────▼─────────┐
                                 │  Backend Service    │
                                 │  (EXTERNAL_MANAGED) │
                                 └──────────┬─────────┘
                                            │
                                 ┌──────────▼─────────┐
                                 │  Serverless NEG     │
                                 └──────────┬─────────┘
                                            │
                                 ┌──────────▼─────────┐
                                 │  Cloud Run          │
                                 │  (gemini-hub)       │
                                 │  Node.js 24 / SSR   │
                                 │  port 8080          │
                                 └─────────────────────┘
```

## Services Used

| Service | Purpose |
|---------|---------|
| **Cloud Run** | Node.js SSR application hosting |
| **Artifact Registry** | Docker image repository |
| **Secret Manager** | OAuth credentials, session secret, Hubwork secrets |
| **Compute Engine** | Global external Application Load Balancer (`EXTERNAL_MANAGED`), static IP, managed SSL |
| **Cloud DNS** | DNS zone management (A record + TXT verification) |
| **Cloud Build** | CI/CD pipeline (build & deploy on push) |
| **IAM** | Service accounts and permissions |
| **BigQuery** | API request log storage (90-day retention) |
| **Cloud Logging** | Log sink from Cloud Run to BigQuery |

## Terraform Structure

```
terraform/
  environments/
    prod/main.tf       # Production environment entry point
    stg/main.tf        # Staging environment entry point
  modules/
    gemihub/
      main.tf          # Provider configuration (google ~> 6.0)
      variables.tf     # Input variables
      outputs.tf       # Output values (LB IP, Cloud Run URL, nameservers)
      apis.tf          # GCP API enablement (10 APIs)
      artifact-registry.tf # Docker image repository
      secrets.tf       # Secret Manager data references
      iam.tf           # Service accounts and IAM bindings
      cloud-run.tf     # Cloud Run service
      networking.tf    # Load Balancer (IP, NEG, backend, URL map, SSL, proxies, forwarding rules)
      dns.tf           # Cloud DNS managed zone, A record, optional TXT verification record
      bigquery-logging.tf  # Cloud Logging → BigQuery pipeline
      bigquery-views.tf    # BigQuery view definitions
      cloud-build.tf   # Cloud Build trigger (reference only, created via Cloud Console)
  terraform.tfvars     # Variable values (git-ignored, non-secret config only)
```

## Environment Variables (Cloud Run)

| Variable | Source |
|----------|--------|
| `GOOGLE_CLIENT_ID` | Secret Manager |
| `GOOGLE_CLIENT_SECRET` | Secret Manager |
| `SESSION_SECRET` | Secret Manager |
| `GOOGLE_REDIRECT_URI` | Set directly (`https://<domain>/auth/google/callback`) |
| `GCP_PROJECT_ID` | Set directly (project ID) |
| `ROOT_FOLDER_NAME` | Conditionally set when `root_folder_name` differs from default `"gemihub"` |
| `STRIPE_SECRET_KEY` | Secret Manager |
| `STRIPE_WEBHOOK_SECRET` | Secret Manager |
| `STRIPE_PRICE_ID_LITE` | Secret Manager |
| `STRIPE_PRICE_ID_PRO` | Secret Manager |
| `HUBWORK_ADMIN_CREDENTIALS` | Secret Manager (`user:password` format, enables Basic Auth for admin panel) |
| `HUBWORK_ADMIN_EMAILS` | Secret Manager (comma-separated admin emails for OAuth check) |
| `NODE_ENV` | Set in Dockerfile: `production` |
| `PORT` | Set in Dockerfile: `8080` |

## Cloud Run Configuration

| Setting | Value |
|---------|-------|
| CPU | 1 vCPU (idle when no requests via `cpu_idle = true`) |
| Memory | 2 Gi |
| Min instances | 1 |
| Max instances | 3 |
| Port | 8080 |
| Ingress | Internal + Cloud Load Balancing (`INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`) |
| Auth | Public (allUsers) |
| Deletion protection | Disabled |
| Startup probe | HTTP GET `/`, 5s initial delay, 10s period, 3 failure threshold |

## Service Accounts

| Account | Purpose |
|---------|---------|
| `gemini-hub-run` | Cloud Run runtime (reads secrets from Secret Manager) |
| Default Cloud Build SA (`<project-number>@cloudbuild.gserviceaccount.com`) | Cloud Build (builds images, deploys to Cloud Run). Granted `roles/run.admin` and `roles/iam.serviceAccountUser`. |

## Enabled APIs

The following GCP APIs are enabled via Terraform:

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

## Networking

- **Static IP**: Global external IP for the load balancer
- **Load Balancing Scheme**: `EXTERNAL_MANAGED` (external Application Load Balancer)
- **HTTP (port 80)**: 301 redirect to HTTPS via `MOVED_PERMANENTLY_DEFAULT`
- **HTTPS (port 443)**: Google-managed SSL certificate (`gemihub-cert`), terminates TLS at the load balancer
- **Serverless NEG**: Routes traffic from the load balancer to Cloud Run
- **CDN**: Cloud CDN enabled with `USE_ORIGIN_HEADERS` cache mode (respects origin Cache-Control headers)
- **Cloud Run ingress**: Direct public `run.app` access is blocked; traffic must come via the load balancer

## DNS

Managed by Google Cloud DNS. The zone contains:

- **A record**: Points the domain to the global static IP
- **TXT record**: Google site verification (disabled by default; set `google_site_verification_token` to your verification token to enable)

Nameservers must be configured at the domain registrar.

## CI/CD (Cloud Build)

The `cloudbuild.yaml` in the project root defines the pipeline:

1. **Build** Docker image (tagged with `$COMMIT_SHA` and `latest`)
2. **Push** to Artifact Registry
3. **Deploy** to Cloud Run with `gcloud run deploy`

The trigger runs automatically on push to the `main` branch (including PR merges). The GitHub connection uses a 2nd-gen Cloud Build repository link.

> **Note:** The Cloud Build trigger is created manually via Cloud Console (GitHub OAuth connection required). The `cloud-build.tf` file contains the resource definition as reference only.

> **Note:** Cloud Run のコンテナイメージは Cloud Build がデプロイごとに更新するため、Terraform の `lifecycle.ignore_changes` で管理対象外としている。イメージの変更は `cloudbuild.yaml` 経由のみで行うこと。

## Docker

Multi-stage Dockerfile (`node:24-slim`):

1. Install all dependencies (`npm ci`)
2. Install production dependencies only (`npm ci --omit=dev`)
3. Build the app (`npm run build`)
4. Final image: production deps + build output only

## Manual Operations

### Initial setup

```bash
# Authenticate
gcloud auth login
gcloud auth application-default login

# Create secrets in Secret Manager (9 total)
gcloud secrets create google-client-id --replication-policy=automatic
gcloud secrets versions add google-client-id --data-file=-
# Repeat for: google-client-secret, session-secret,
# stripe-secret-key, stripe-webhook-secret,
# stripe-price-id-lite, stripe-price-id-pro,
# hubwork-admin-credentials (user:password format),
# hubwork-admin-emails (comma-separated emails)

# Create terraform.tfvars with non-secret config, then:
cd terraform/environments/prod
terraform init
terraform apply
```

### Build and deploy manually

```bash
# Build and push image via Cloud Build
gcloud builds submit \
  --region=asia-northeast1 \
  --tag=<artifact-registry-image-path>:latest

# Update Cloud Run to use the new image
gcloud run deploy gemini-hub \
  --image=<artifact-registry-image-path>:latest \
  --region=asia-northeast1
```

### Check status

```bash
# SSL certificate
gcloud compute ssl-certificates describe gemihub-cert --global \
  --format="table(managed.status,managed.domainStatus)"

# Cloud Run service
gcloud run services describe gemini-hub --region=asia-northeast1 --format="value(status.url)"

# Terraform outputs
cd terraform && terraform output
```

### Update secrets

After updating a secret version in Secret Manager, Cloud Run does **not** automatically pick up the new value. Redeploy to apply:

```bash
gcloud run services update gemini-hub --region=asia-northeast1
```

## Cost Estimate (Low Traffic)

| Service | Monthly Cost |
|---------|-------------|
| Cloud Run (min 1 instance) | ~$5-10 |
| Global HTTPS Load Balancer | ~$18-20 |
| Cloud DNS | ~$0.20 |
| Artifact Registry | ~$0.10/GB |
| Secret Manager | negligible |
| Cloud Build | 120 free min/day |
| **Total** | **~$20-25/month** |
