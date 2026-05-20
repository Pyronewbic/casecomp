resource "google_artifact_registry_repository" "casecomp_api" {
  location      = "us"
  repository_id = "casecomp-api"
  format        = "DOCKER"
  description   = "casecomp API container images"

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }

  depends_on = [google_project_service.artifactregistry]
}

resource "google_artifact_registry_repository" "casecomp_node24" {
  location      = "us"
  repository_id = "casecomp-node24"
  format        = "DOCKER"
  description   = "casecomp Node.js 24 base image"

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  depends_on = [google_project_service.artifactregistry]
}

resource "google_artifact_registry_repository_iam_member" "api_deploy" {
  repository = google_artifact_registry_repository.casecomp_api.name
  location   = google_artifact_registry_repository.casecomp_api.location
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:casecomp-deploy@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_artifact_registry_repository_iam_member" "api_cloudbuild" {
  repository = google_artifact_registry_repository.casecomp_api.name
  location   = google_artifact_registry_repository.casecomp_api.location
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_project.current.number}@cloudbuild.gserviceaccount.com"
}

resource "google_artifact_registry_repository_iam_member" "node24_deploy" {
  repository = google_artifact_registry_repository.casecomp_node24.name
  location   = google_artifact_registry_repository.casecomp_node24.location
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:casecomp-deploy@${var.project_id}.iam.gserviceaccount.com"
}
