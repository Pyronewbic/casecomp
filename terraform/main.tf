terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
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
    "ANTHROPIC_HAIKU_KEY",
    "PSA_AUTH_TOKEN",
    "CASECOMP_API_KEY",
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
  name     = "cardscrapebot"
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

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.cloud_run_access,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── Load Balancer ─────────────────────────────────────────────

resource "google_compute_global_address" "api_ip" {
  name = "cardscrapebot-ip"

  depends_on = [google_project_service.compute]
}

resource "google_compute_region_network_endpoint_group" "api_neg" {
  name                  = "cardscrapebot-neg"
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

resource "google_compute_url_map" "api_urlmap" {
  name            = "cardscrapebot-urlmap"
  default_service = google_compute_backend_service.api_backend.id
}

resource "google_compute_managed_ssl_certificate" "api_cert" {
  name = "cardscrapebot-cert"

  managed {
    domains = [var.domain]
  }
}

resource "google_compute_target_https_proxy" "api_proxy" {
  name             = "cardscrapebot-https-proxy"
  url_map          = google_compute_url_map.api_urlmap.id
  ssl_certificates = [google_compute_managed_ssl_certificate.api_cert.id]
}

resource "google_compute_global_forwarding_rule" "api_https" {
  name       = "cardscrapebot-https-rule"
  target     = google_compute_target_https_proxy.api_proxy.id
  ip_address = google_compute_global_address.api_ip.id
  port_range = "443"
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
  filter = "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"cardscrapebot\" textPayload=~\"\\[ERROR\\]\""

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

# ── Outputs ───────────────────────────────────────────────────

output "cloud_run_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "lb_ip" {
  value = google_compute_global_address.api_ip.address
}

output "api_url" {
  value = "https://${var.domain}"
}
