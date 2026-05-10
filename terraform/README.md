# Terraform — Casecomp Infrastructure

GCP infrastructure for the Casecomp API. State is stored in a GCS bucket (`casecomp-terraform-state`).

## Resources

| Resource | Purpose |
|----------|---------|
| Cloud Run (`cardscrapebot`) | API + dashboard, asia-south1, scales to 20 instances |
| Firestore | Grade logs, drops, webhooks, alerts, all caches |
| HTTPS Load Balancer | Global IP, managed SSL cert, URL map, backend service |
| Secret Manager | EBAY_CLIENT_ID/SECRET, ANTHROPIC_API_KEY, PSA_AUTH_TOKEN, CASECOMP_API_KEY |
| Cloud Monitoring | Log-based metric on `[ERROR]`, email alert on >5 errors/5min |
| APIs enabled | Cloud Run, Compute, Firestore, Cloud Build, Secret Manager, Monitoring |

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `project_id` | `casecomp-495718` | GCP project |
| `region` | `asia-south1` | Deploy region |
| `domain` | `api.casecomp.xyz` | SSL cert domain |
| `container_image` | `gcr.io/casecomp-495718/cardscrapebot` | Docker image |
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
  "projects/casecomp-495718/locations/asia-south1/services/cardscrapebot"
```

## Files

| File | Content |
|------|---------|
| `main.tf` | All resource definitions |
| `variables.tf` | Input variables with defaults |
| `terraform.tfvars` | Sensitive values (gitignored) |
| `.terraform.lock.hcl` | Provider version lock |
