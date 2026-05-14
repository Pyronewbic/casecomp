locals {
  secrets = [
    "EBAY_CLIENT_ID",
    "EBAY_CLIENT_SECRET",
    "ANTHROPIC_API_KEY",
    "PSA_AUTH_TOKEN",
    "CASECOMP_API_KEY",
    "CASECOMP_SANDBOX_KEY",
    "RESEND_API_KEY",
    "CASECOMP_JWT_SECRET",
    "GOOGLE_OAUTH_CLIENT_ID",
  ]
}

resource "google_secret_manager_secret" "api_secrets" {
  for_each  = toset(local.secrets)
  secret_id = each.key

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_iam_member" "cloud_run_access" {
  for_each  = toset(local.secrets)
  secret_id = google_secret_manager_secret.api_secrets[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}
