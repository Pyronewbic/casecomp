# Terraform — Casecomp Infrastructure

GCP infrastructure for Casecomp. State stored in GCS (`casecomp-terraform-state`). CI: plan on PR, auto-apply on merge, `workflow_dispatch` for manual re-runs.

## Multi-region

Both Cloud Run services deploy to asia-south1 and us-central1. The global HTTPS LB auto geo-routes to the nearest region. Terraform uses `for_each` over `var.regions`.

## Resources

| Resource | Purpose |
|----------|---------|
| Cloud Run `casecomp-api` | API server, 2 regions, scales to 20 per region |
| Cloud Run `casecomp-site` | Frontend SSR (TanStack Start), 2 regions, scales to 10 |
| Firestore | Grade logs, drops, webhooks, alerts, caches, api-keys, price-history, error-logs (asia-south1 only) |
| HTTPS Load Balancer | Global IP, URL map routes by host, serverless NEGs in both regions |
| Cloud CDN | Caches static assets from frontend Cloud Run |
| SSL Certificates | GCP managed certs for `api.casecomp.xyz` and `casecomp.xyz` |
| Secret Manager | EBAY_CLIENT_ID/SECRET, ANTHROPIC_API_KEY, PSA_AUTH_TOKEN, CASECOMP_API_KEY, CASECOMP_SANDBOX_KEY, RESEND_API_KEY (auto-replicated) |
| Binary Authorization | ENFORCED policy on both Cloud Run services |
| Cloud Monitoring | Log-based error metric, error + uptime alerts |
| Cloud Scheduler | track-prices + check-alerts every 6h |

## Routing

Global LB IP, routed by hostname:
- `casecomp.xyz` → Cloudflare (SSL) → GCP LB → Cloud Run `casecomp-site` (CDN enabled)
- `api.casecomp.xyz` → GCP LB (managed SSL) → Cloud Run `casecomp-api`

Both backends have NEGs in asia-south1 and us-central1. LB routes to nearest.

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `project_id` | `casecomp-495718` | GCP project |
| `region` | `asia-south1` | Primary region (Firestore, Scheduler) |
| `regions` | `["asia-south1", "us-central1"]` | Cloud Run deploy regions |
| `api_domain` | `api.casecomp.xyz` | API SSL cert domain |
| `site_domain` | `casecomp.xyz` | Frontend SSL cert domain |
| `container_image` | `gcr.io/casecomp-495718/casecomp-api` | API Docker image |
| `alert_email` | *(sensitive, in terraform.tfvars / GitHub secret)* | Monitoring alert recipient |

## Usage

```bash
terraform init          # first time — providers + GCS backend
terraform plan          # preview changes
terraform apply         # apply changes
```

CI handles plan (PR comment) and apply (on merge) via `.github/workflows/terraform.yml`.

## Files

| File | Content |
|------|---------|
| `main.tf` | All resource definitions |
| `variables.tf` | Input variables with defaults |
| `terraform.tfvars` | Sensitive values (gitignored) |
| `.terraform.lock.hcl` | Provider version lock |
