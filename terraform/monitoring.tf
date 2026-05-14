data "google_secret_manager_secret_version" "api_key" {
  secret  = "CASECOMP_API_KEY"
  project = var.project_id
}

# ── Cloud Scheduler ───────────────────────────────────────────

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

# ── Alerts ────────────────────────────────────────────────────

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
