resource "google_cloud_run_v2_service" "api" {
  for_each = toset(var.regions)
  name     = "casecomp-api"
  location = each.value

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

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.cloud_run_access,
    google_binary_authorization_policy.default,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = toset(var.regions)
  name     = google_cloud_run_v2_service.api[each.value].name
  location = each.value
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "site" {
  for_each = toset(var.regions)
  name     = "casecomp-site"
  location = each.value

  template {
    scaling {
      max_instance_count = 10
    }

    containers {
      image = "us-docker.pkg.dev/${var.project_id}/casecomp-site/app"

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

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [
    google_project_service.run,
    google_binary_authorization_policy.default,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "site_public" {
  for_each = toset(var.regions)
  name     = google_cloud_run_v2_service.site[each.value].name
  location = each.value
  role     = "roles/run.invoker"
  member   = "allUsers"
}
