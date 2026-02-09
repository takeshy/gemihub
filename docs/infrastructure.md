# Infrastructure

Google Cloud deployment managed by Terraform.

## Architecture Overview

```
                    ┌─────────────────┐
                    │  gemihub.online   │
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
                                 └──────────┬─────────┘
                                            │
                                 ┌──────────▼─────────┐
                                 │  Serverless NEG     │
                                 └──────────┬─────────┘
                                            │
                                 ┌──────────▼─────────┐
                                 │  Cloud Run          │
                                 │  (gemini-hub)       │
                                 │  Node.js 22 / SSR   │
                                 │  port 8080          │
                                 └─────────────────────┘
```

## Services Used

| Service | Purpose |
|---------|---------|
| **Cloud Run** | Node.js SSR application hosting (scale to zero) |
| **Artifact Registry** | Docker image repository |
| **Secret Manager** | OAuth credentials, session secret |
| **Compute Engine** | Global HTTPS Load Balancer, static IP, managed SSL |
| **Cloud DNS** | DNS zone management |
| **Cloud Build** | CI/CD pipeline (build & deploy on push) |
| **IAM** | Service accounts and permissions |

## Terraform Structure

```
terraform/
  main.tf              # Provider configuration
  variables.tf         # Input variables
  terraform.tfvars     # Variable values (git-ignored, contains secrets)
  outputs.tf           # Output values (LB IP, Cloud Run URL, nameservers)
  apis.tf              # GCP API enablement
  artifact-registry.tf # Docker image repository
  secrets.tf           # Secret Manager secrets
  iam.tf               # Service accounts and IAM bindings
  cloud-run.tf         # Cloud Run service
  networking.tf        # Load Balancer (IP, NEG, backend, URL map, SSL, proxies, forwarding rules)
  dns.tf               # Cloud DNS managed zone and A record
  cloud-build.tf       # Cloud Build trigger (reference only, created via gcloud)
```

## Environment Variables (Cloud Run)

| Variable | Source |
|----------|--------|
| `GOOGLE_CLIENT_ID` | Secret Manager |
| `GOOGLE_CLIENT_SECRET` | Secret Manager |
| `SESSION_SECRET` | Secret Manager |
| `GOOGLE_REDIRECT_URI` | Set directly (`https://<domain>/auth/google/callback`) |
| `NODE_ENV` | Set in Dockerfile: `production` |
| `PORT` | Set in Dockerfile: `8080` |

## Cloud Run Configuration

| Setting | Value |
|---------|-------|
| CPU | 1 vCPU (idle when no requests) |
| Memory | 512 Mi |
| Min instances | 0 (scale to zero) |
| Max instances | 3 |
| Port | 8080 |
| Ingress | All traffic |
| Auth | Public (allUsers) |

## Service Accounts

| Account | Purpose |
|---------|---------|
| `gemini-hub-run` | Cloud Run runtime (reads secrets) |
| `gemini-hub-build` | Cloud Build trigger (builds images, deploys to Cloud Run) |

## Networking

- **Static IP**: Global external IP for the load balancer
- **HTTP (port 80)**: 301 redirect to HTTPS
- **HTTPS (port 443)**: Google-managed SSL certificate, terminates TLS at the load balancer
- **Serverless NEG**: Routes traffic from the load balancer to Cloud Run

## DNS

Managed by Google Cloud DNS. Nameservers configured at the domain registrar.

## CI/CD (Cloud Build)

The `cloudbuild.yaml` in the project root defines the pipeline:

1. **Build** Docker image (tagged with `$COMMIT_SHA` and `latest`)
2. **Push** to Artifact Registry
3. **Deploy** to Cloud Run with `gcloud run deploy`

The trigger runs automatically on push to the `main` branch (including PR merges). The GitHub connection uses a 2nd-gen Cloud Build repository link.

## Docker

Multi-stage Dockerfile (`node:22-slim`):

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

# Create terraform.tfvars with secrets, then:
cd terraform
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
gcloud compute ssl-certificates describe gemini-hub-cert --global \
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
| Cloud Run (scale to zero) | ~$0 idle |
| Global HTTPS Load Balancer | ~$18-20 |
| Cloud DNS | ~$0.20 |
| Artifact Registry | ~$0.10/GB |
| Secret Manager | negligible |
| Cloud Build | 120 free min/day |
| **Total** | **~$20-25/month** |
