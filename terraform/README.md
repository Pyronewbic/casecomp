# Terraform — Casecomp Infrastructure

GCP infrastructure for Casecomp. State is stored in a GCS bucket (`casecomp-terraform-state`).

## Resources

| Resource | Purpose |
|----------|---------|
| Cloud Run `casecomp-api` | API + admin (/admin) + consumer dashboard (/dashboard), asia-south1, scales to 20 |
| Cloud Run `casecomp-site` | Frontend SSR (TanStack Start), scales to 10 instances |
| Firestore | Grade logs, drops, webhooks, alerts, caches, api-keys, price-history, error-logs |
| HTTPS Load Balancer | Global IP (`34.107.143.136`), URL map routes by host |
| Cloud CDN | Caches static assets from frontend Cloud Run |
| SSL Certificates | GCP managed cert for `api.casecomp.xyz`; Cloudflare handles `casecomp.xyz` SSL |
| GCS Bucket `casecomp-site` | (Legacy) Static site bucket, replaced by Cloud Run SSR |
| Secret Manager | EBAY_CLIENT_ID/SECRET, ANTHROPIC_API_KEY, PSA_AUTH_TOKEN, CASECOMP_API_KEY, CASECOMP_SANDBOX_KEY |
| Cloud Monitoring | Log-based metric on `[ERROR]`, error + uptime alerts → email |
| APIs enabled | Cloud Run, Compute, Firestore, Cloud Build, Secret Manager, Monitoring |

## Routing

Same LB IP (`34.107.143.136`), routed by hostname:
- `casecomp.xyz` / `www.casecomp.xyz` → Cloudflare (SSL) → GCP LB → Cloud Run `casecomp-site` (CDN enabled)
- `api.casecomp.xyz` → GCP LB (managed SSL) → Cloud Run `casecomp-api`

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `project_id` | `casecomp-495718` | GCP project |
| `region` | `asia-south1` | Deploy region |
| `api_domain` | `api.casecomp.xyz` | API SSL cert domain |
| `site_domain` | `casecomp.xyz` | Frontend SSL cert domain |
| `container_image` | `gcr.io/casecomp-495718/casecomp-api` | API Docker image |
| `alert_email` | *(sensitive, in terraform.tfvars)* | Monitoring alert recipient |

## Usage

```bash
terraform init          # first time — downloads providers, connects to GCS backend
terraform plan          # preview changes
terraform apply         # apply changes
```

## Importing existing resources

If resources were created manually (outside Terraform), import them before applying:

```bash
terraform import google_cloud_run_v2_service.api \
  "projects/casecomp-495718/locations/asia-south1/services/casecomp-api"

terraform import google_cloud_run_v2_service.site \
  "projects/casecomp-495718/locations/asia-south1/services/casecomp-site"
```

## Files

| File | Content |
|------|---------|
| `main.tf` | All resource definitions |
| `variables.tf` | Input variables with defaults |
| `terraform.tfvars` | Sensitive values (gitignored) |
| `.terraform.lock.hcl` | Provider version lock |
