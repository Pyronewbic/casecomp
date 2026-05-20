#!/usr/bin/env bash
set -euo pipefail

# GCP project migration script for casecomp infrastructure.
# Migrates from casecomp-495718 to a new project with $300 free trial credits.
# Run interactively — each section prompts before executing.

OLD_PROJECT="casecomp-495718"
OLD_PROJECT_NUMBER="129850122606"
OLD_IMAGE="gcr.io/${OLD_PROJECT}/casecomp-api"
OLD_STATE_BUCKET="casecomp-terraform-state"
DEPLOY_SA="casecomp-deploy"
REGIONS=("asia-south1" "us-central1")
SECRETS=(
  EBAY_CLIENT_ID EBAY_CLIENT_SECRET ANTHROPIC_API_KEY PSA_AUTH_TOKEN
  CASECOMP_API_KEY CASECOMP_SANDBOX_KEY RESEND_API_KEY CASECOMP_JWT_SECRET
  GOOGLE_OAUTH_CLIENT_ID CASECOMP_ADMIN_SUB TOGETHER_API_KEY
)
GITHUB_REPO="Pyronewbic/casecomp"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[x]${NC} $1"; exit 1; }

confirm() {
  echo ""
  warn "$1"
  read -rp "Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "Skipped."; return 1; }
}

# ── 0. Preflight ─────────────────────────────────────────────

echo "=== Casecomp GCP Project Migration ==="
echo ""
echo "Source:  ${OLD_PROJECT}"
echo "Regions: ${REGIONS[*]}"
echo "Secrets: ${#SECRETS[@]}"
echo ""

read -rp "Enter NEW project ID: " NEW_PROJECT
[[ -z "$NEW_PROJECT" ]] && err "Project ID required"
NEW_IMAGE="gcr.io/${NEW_PROJECT}/casecomp-api"
NEW_STATE_BUCKET="${NEW_PROJECT}-terraform-state"

echo ""
log "Target project: ${NEW_PROJECT}"
log "New image:      ${NEW_IMAGE}"
log "State bucket:   ${NEW_STATE_BUCKET}"

# ── 1. Create project & link billing ─────────────────────────

if confirm "Step 1: Create project and link billing"; then
  gcloud projects create "$NEW_PROJECT" --name="Casecomp" 2>/dev/null || \
    warn "Project may already exist, continuing..."

  echo ""
  echo "Available billing accounts:"
  gcloud billing accounts list --format="table(name, displayName, open)"
  echo ""
  read -rp "Enter billing account ID (e.g. 01XXXX-XXXXXX-XXXXXX): " BILLING_ID
  gcloud billing projects link "$NEW_PROJECT" --billing-account="$BILLING_ID"
  log "Project created and billing linked."
fi

gcloud config set project "$NEW_PROJECT"

# ── 2. Enable APIs ───────────────────────────────────────────

if confirm "Step 2: Enable required APIs"; then
  APIS=(
    run.googleapis.com
    compute.googleapis.com
    firestore.googleapis.com
    cloudbuild.googleapis.com
    binaryauthorization.googleapis.com
    containeranalysis.googleapis.com
    secretmanager.googleapis.com
    cloudscheduler.googleapis.com
    monitoring.googleapis.com
    iam.googleapis.com
    iamcredentials.googleapis.com
  )
  gcloud services enable "${APIS[@]}" --project="$NEW_PROJECT"
  log "APIs enabled."
fi

# ── 3. Terraform state bucket ────────────────────────────────

if confirm "Step 3: Create terraform state bucket"; then
  gsutil mb -p "$NEW_PROJECT" -l asia-south1 "gs://${NEW_STATE_BUCKET}" 2>/dev/null || \
    warn "Bucket may already exist"
  gsutil versioning set on "gs://${NEW_STATE_BUCKET}"
  log "State bucket ready: ${NEW_STATE_BUCKET}"
fi

# ── 4. Service account + Workload Identity for GitHub Actions ─

if confirm "Step 4: Create deploy service account + Workload Identity Federation"; then
  SA_EMAIL="${DEPLOY_SA}@${NEW_PROJECT}.iam.gserviceaccount.com"

  gcloud iam service-accounts create "$DEPLOY_SA" \
    --display-name="Casecomp Deploy" \
    --project="$NEW_PROJECT" 2>/dev/null || warn "SA may exist"

  SA_ROLES=(
    roles/run.admin
    roles/iam.serviceAccountUser
    roles/storage.admin
    roles/cloudbuild.builds.editor
    roles/secretmanager.secretAccessor
    roles/binaryauthorization.attestorsEditor
    roles/containeranalysis.notes.editor
    roles/monitoring.editor
    roles/cloudscheduler.admin
  )

  for role in "${SA_ROLES[@]}"; do
    gcloud projects add-iam-policy-binding "$NEW_PROJECT" \
      --member="serviceAccount:${SA_EMAIL}" \
      --role="$role" \
      --condition=None --quiet
  done

  gcloud iam workload-identity-pools create github-pool \
    --location=global \
    --display-name="GitHub Actions" \
    --project="$NEW_PROJECT" 2>/dev/null || warn "Pool may exist"

  NEW_PROJECT_NUMBER=$(gcloud projects describe "$NEW_PROJECT" --format='value(projectNumber)')

  gcloud iam workload-identity-pools providers create-oidc github-provider \
    --location=global \
    --workload-identity-pool=github-pool \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'" \
    --project="$NEW_PROJECT" 2>/dev/null || warn "Provider may exist"

  gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/projects/${NEW_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${GITHUB_REPO}" \
    --project="$NEW_PROJECT"

  WIF_PROVIDER="projects/${NEW_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
  log "Workload Identity Federation configured."
  log "WIF provider: ${WIF_PROVIDER}"
  log "Service account: ${SA_EMAIL}"
fi

# ── 5. Secrets ───────────────────────────────────────────────

if confirm "Step 5: Copy secrets from old project"; then
  for secret in "${SECRETS[@]}"; do
    VALUE=$(gcloud secrets versions access latest --secret="$secret" --project="$OLD_PROJECT" 2>/dev/null) || {
      warn "Could not read ${secret} from old project, skipping"
      continue
    }

    gcloud secrets create "$secret" --replication-policy=automatic --project="$NEW_PROJECT" 2>/dev/null || true
    echo -n "$VALUE" | gcloud secrets versions add "$secret" --data-file=- --project="$NEW_PROJECT"
    log "Copied: ${secret}"
  done

  COMPUTE_SA="${NEW_PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  for secret in "${SECRETS[@]}"; do
    gcloud secrets add-iam-policy-binding "$secret" \
      --member="serviceAccount:${COMPUTE_SA}" \
      --role="roles/secretmanager.secretAccessor" \
      --project="$NEW_PROJECT" --quiet
  done
  log "All secrets copied and IAM bound."
fi

# ── 6. Firestore ─────────────────────────────────────────────

if confirm "Step 6: Create Firestore database"; then
  gcloud firestore databases create \
    --location=asia-south1 \
    --type=firestore-native \
    --project="$NEW_PROJECT" 2>/dev/null || warn "Firestore may already exist"
  log "Firestore ready."

  if confirm "Export Firestore data from old project? (takes a few minutes)"; then
    EXPORT_BUCKET="gs://${OLD_PROJECT}-firestore-export"
    gsutil mb -p "$OLD_PROJECT" "$EXPORT_BUCKET" 2>/dev/null || true
    gcloud firestore export "$EXPORT_BUCKET/migration-$(date +%Y%m%d)" --project="$OLD_PROJECT"

    IMPORT_BUCKET="gs://${NEW_PROJECT}-firestore-import"
    gsutil mb -p "$NEW_PROJECT" "$IMPORT_BUCKET" 2>/dev/null || true
    gsutil -m cp -r "${EXPORT_BUCKET}/migration-$(date +%Y%m%d)/**" "${IMPORT_BUCKET}/migration/"
    gcloud firestore import "${IMPORT_BUCKET}/migration/" --project="$NEW_PROJECT"
    log "Firestore data imported."
  fi
fi

# ── 7. Container image ──────────────────────────────────────

if confirm "Step 7: Copy container image to new project"; then
  LATEST_DIGEST=$(gcloud container images describe "${OLD_IMAGE}:latest" \
    --format='value(image_summary.digest)' --project="$OLD_PROJECT")

  docker pull "${OLD_IMAGE}@${LATEST_DIGEST}"
  docker tag "${OLD_IMAGE}@${LATEST_DIGEST}" "${NEW_IMAGE}:latest"
  docker push "${NEW_IMAGE}:latest"
  log "Image pushed: ${NEW_IMAGE}:latest"
fi

# ── 8. Update terraform config ───────────────────────────────

if confirm "Step 8: Update terraform files for new project"; then
  cd terraform/

  sed -i.bak "s|${OLD_PROJECT}|${NEW_PROJECT}|g" variables.tf
  sed -i.bak "s|${OLD_STATE_BUCKET}|${NEW_STATE_BUCKET}|g" main.tf
  sed -i.bak "s|${OLD_PROJECT}|${NEW_PROJECT}|g" secrets.tf
  sed -i.bak "s|${OLD_PROJECT}|${NEW_PROJECT}|g" firestore.tf

  rm -f *.bak

  warn "Remove import blocks from secrets.tf and firestore.tf — they reference old resource IDs."
  warn "Review all .tf files before running terraform init."

  cd ..
  log "Terraform files updated. Run:"
  echo "  cd terraform"
  echo "  terraform init -reconfigure"
  echo "  terraform plan -var 'alert_email=YOUR_EMAIL'"
  echo "  terraform apply -var 'alert_email=YOUR_EMAIL'"
fi

# ── 9. Update GitHub Actions ─────────────────────────────────

if confirm "Step 9: Update GitHub Actions workflows"; then
  NEW_PROJECT_NUMBER=$(gcloud projects describe "$NEW_PROJECT" --format='value(projectNumber)')
  WIF_PROVIDER="projects/${NEW_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
  SA_EMAIL="${DEPLOY_SA}@${NEW_PROJECT}.iam.gserviceaccount.com"

  for wf in .github/workflows/deploy.yml .github/workflows/terraform.yml .github/workflows/base-image.yml; do
    if [[ -f "$wf" ]]; then
      sed -i.bak "s|${OLD_PROJECT}|${NEW_PROJECT}|g" "$wf"
      sed -i.bak "s|projects/${OLD_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider|${WIF_PROVIDER}|g" "$wf"
      sed -i.bak "s|${DEPLOY_SA}@${OLD_PROJECT}.iam.gserviceaccount.com|${SA_EMAIL}|g" "$wf"
      rm -f "${wf}.bak"
      log "Updated: ${wf}"
    fi
  done

  log "GitHub Actions workflows updated."
fi

# ── 10. DNS cutover ──────────────────────────────────────────

echo ""
warn "Step 10: DNS cutover (manual)"
echo "  After terraform apply creates the new LB, get the new IP:"
echo "    gcloud compute addresses describe cardscrapebot-ip --global --project=${NEW_PROJECT}"
echo ""
echo "  Update Cloudflare DNS:"
echo "    api.casecomp.xyz  → new IP (A record, proxied)"
echo "    casecomp.xyz      → new IP (A record, proxied)"
echo ""
echo "  Wait for SSL certificates to provision (~15 min)."

# ── Summary ──────────────────────────────────────────────────

echo ""
echo "=== Migration Summary ==="
echo "Old: ${OLD_PROJECT} (${OLD_PROJECT_NUMBER})"
echo "New: ${NEW_PROJECT}"
echo ""
echo "Remaining manual steps:"
echo "  1. Remove import blocks from terraform (secrets.tf, firestore.tf)"
echo "  2. terraform init -reconfigure && terraform plan && terraform apply"
echo "  3. Verify Cloud Run services are healthy"
echo "  4. Update Cloudflare DNS to new LB IP"
echo "  5. Wait for managed SSL certs"
echo "  6. Update Google OAuth redirect URIs in Google Cloud Console"
echo "  7. Verify GitHub Actions deploy works (push to main)"
echo "  8. Decommission old project when stable"
