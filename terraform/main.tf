terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = "casecomp-terraform-state"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── APIs ──────────────────────────────────────────────────────

resource "google_project_service" "compute" {
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "firestore" {
  service            = "firestore.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "cloudbuild" {
  service            = "cloudbuild.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "binaryauthorization" {
  service            = "binaryauthorization.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "containeranalysis" {
  service            = "containeranalysis.googleapis.com"
  disable_on_destroy = false
}

# ── Binary Authorization ──────────────────────────────────────

resource "google_binary_authorization_policy" "default" {
  global_policy_evaluation_mode = "ENABLE"

  default_admission_rule {
    evaluation_mode  = "ALWAYS_ALLOW"
    enforcement_mode = "DRYRUN_AUDIT_LOG_ONLY"
  }

  depends_on = [google_project_service.binaryauthorization]
}

# ── Firestore ─────────────────────────────────────────────────

resource "google_firestore_database" "default" {
  name                    = "(default)"
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  concurrency_mode        = "PESSIMISTIC"
  delete_protection_state = "DELETE_PROTECTION_DISABLED"

  depends_on = [google_project_service.firestore]
}

# ── Secret Manager ────────────────────────────────────────────

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

locals {
  secrets = [
    "EBAY_CLIENT_ID",
    "EBAY_CLIENT_SECRET",
    "ANTHROPIC_API_KEY",
    "PSA_AUTH_TOKEN",
    "CASECOMP_API_KEY",
    "CASECOMP_SANDBOX_KEY",
    "RESEND_API_KEY",
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

data "google_project" "current" {
  project_id = var.project_id
}

# ── Cloud Run ─────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "api" {
  name     = "casecomp-api"
  location = var.region

  template {
    scaling {
      max_instance_count = 20
    }

    containers {
      image = var.container_image

      ports {
        container_port = 3000
      }

      env {
        name  = "API_PORT"
        value = "3000"
      }

      dynamic "env" {
        for_each = toset(local.secrets)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.api_secrets[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      resources {
        limits = {
          cpu    = "2000m"
          memory = "1Gi"
        }
      }
    }
  }

  binary_authorization {
    use_default = true
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.cloud_run_access,
    google_binary_authorization_policy.default,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── Static Site (GCS) ────────────────────────────────────────

resource "google_storage_bucket" "site" {
  name          = "casecomp-site"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true

  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }
}

resource "google_storage_bucket_iam_member" "site_public" {
  bucket = google_storage_bucket.site.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# ── Load Balancer ─────────────────────────────────────────────

resource "google_compute_global_address" "api_ip" {
  name = "cardscrapebot-ip"

  depends_on = [google_project_service.compute]
}

resource "google_compute_region_network_endpoint_group" "api_neg" {
  name                  = "casecomp-api-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.api.name
  }
}

resource "google_compute_backend_service" "api_backend" {
  name = "cardscrapebot-backend"

  backend {
    group = google_compute_region_network_endpoint_group.api_neg.id
  }
}

resource "google_cloud_run_v2_service" "site" {
  name     = "casecomp-site"
  location = var.region

  template {
    scaling {
      max_instance_count = 10
    }

    containers {
      image = "gcr.io/${var.project_id}/casecomp-site"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1000m"
          memory = "512Mi"
        }
      }
    }
  }

  binary_authorization {
    use_default = true
  }

  depends_on = [
    google_project_service.run,
    google_binary_authorization_policy.default,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "site_public" {
  name     = google_cloud_run_v2_service.site.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_compute_region_network_endpoint_group" "site_neg" {
  name                  = "casecomp-site-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.site.name
  }
}

resource "google_compute_backend_service" "site_backend" {
  name       = "casecomp-site-backend"
  enable_cdn = true

  cdn_policy {
    cache_mode                   = "CACHE_ALL_STATIC"
    default_ttl                  = 3600
    max_ttl                      = 86400
    signed_url_cache_max_age_sec = 0
  }

  backend {
    group = google_compute_region_network_endpoint_group.site_neg.id
  }
}

resource "google_compute_url_map" "api_urlmap" {
  name            = "cardscrapebot-urlmap"
  default_service = google_compute_backend_service.site_backend.id

  host_rule {
    hosts        = [var.api_domain]
    path_matcher = "api"
  }

  host_rule {
    hosts        = [var.site_domain, "www.${var.site_domain}"]
    path_matcher = "site"
  }

  path_matcher {
    name            = "api"
    default_service = google_compute_backend_service.api_backend.id
  }

  path_matcher {
    name            = "site"
    default_service = google_compute_backend_service.site_backend.id
  }
}

resource "google_compute_managed_ssl_certificate" "api_cert" {
  name = "cardscrapebot-cert-v2"

  managed {
    domains = [var.api_domain]
  }
}

resource "google_compute_managed_ssl_certificate" "site_cert" {
  name = "casecomp-site-cert"

  managed {
    domains = [var.site_domain, "www.${var.site_domain}"]
  }
}

resource "google_compute_target_https_proxy" "api_proxy" {
  name    = "cardscrapebot-https-proxy"
  url_map = google_compute_url_map.api_urlmap.id
  ssl_certificates = [
    google_compute_managed_ssl_certificate.api_cert.id,
    google_compute_managed_ssl_certificate.site_cert.id,
  ]
}

resource "google_compute_global_forwarding_rule" "api_https" {
  name       = "cardscrapebot-https-rule"
  target     = google_compute_target_https_proxy.api_proxy.id
  ip_address = google_compute_global_address.api_ip.id
  port_range = "443"
}

# ── Monitoring ────────────────────────────────────────────────

# ── Cloud Scheduler ───────────────────────────────────────────

resource "google_project_service" "scheduler" {
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

data "google_secret_manager_secret_version" "api_key" {
  secret  = "CASECOMP_API_KEY"
  project = var.project_id
}

resource "google_cloud_scheduler_job" "track_prices" {
  name             = "casecomp-track-prices"
  description      = "Record sold comps for tracked cards every 6 hours"
  schedule         = "0 */6 * * *"
  time_zone        = "Asia/Kolkata"
  attempt_deadline = "120s"

  http_target {
    http_method = "POST"
    uri         = "https://${var.api_domain}/api/track-prices"
    headers = {
      "Content-Type"  = "application/json"
      "Authorization" = "Bearer ${data.google_secret_manager_secret_version.api_key.secret_data}"
    }
    body = base64encode("{}")
  }

  depends_on = [google_project_service.scheduler]
}

resource "google_cloud_scheduler_job" "check_alerts" {
  name             = "casecomp-check-alerts"
  description      = "Check price and arbitrage alerts every 6 hours"
  schedule         = "30 */6 * * *"
  time_zone        = "Asia/Kolkata"
  attempt_deadline = "120s"

  http_target {
    http_method = "POST"
    uri         = "https://${var.api_domain}/api/check-alerts"
    headers = {
      "Content-Type"  = "application/json"
      "Authorization" = "Bearer ${data.google_secret_manager_secret_version.api_key.secret_data}"
    }
    body = base64encode("{}")
  }

  depends_on = [google_project_service.scheduler]
}

# ── Monitoring ────────────────────────────────────────────────

resource "google_project_service" "monitoring" {
  service            = "monitoring.googleapis.com"
  disable_on_destroy = false
}

resource "google_monitoring_notification_channel" "email" {
  display_name = "Casecomp Alerts"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_logging_metric" "api_errors" {
  name   = "cardscrapebot-errors"
  filter = "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"casecomp-api\" textPayload=~\"\\[ERROR\\]\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "api_error_alert" {
  display_name = "Casecomp API Errors"
  combiner     = "OR"

  conditions {
    display_name = "Error rate > 5 in 5 minutes"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.api_errors.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "0s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_uptime_check_config" "api_uptime" {
  display_name = "Casecomp API Health"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/api/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.api_domain
    }
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_alert_policy" "api_uptime_alert" {
  display_name = "Casecomp API Down"
  combiner     = "OR"

  conditions {
    display_name = "Health check failing"

    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.api_uptime.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.project_id"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.monitoring]
}

# ── Outputs ───────────────────────────────────────────────────

output "cloud_run_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "lb_ip" {
  value = google_compute_global_address.api_ip.address
}

output "api_url" {
  value = "https://${var.api_domain}"
}
