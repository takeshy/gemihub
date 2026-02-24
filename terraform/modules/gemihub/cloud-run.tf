resource "google_cloud_run_v2_service" "app" {
  name                = "gemini-hub"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = false

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = 1
      max_instance_count = 3
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/gemini-hub:latest"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          memory = "2Gi"
          cpu    = "1"
        }
        cpu_idle = var.cpu_idle
      }

      env {
        name = "GOOGLE_CLIENT_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_client_id.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "GOOGLE_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_client_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "SESSION_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.session_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "GOOGLE_REDIRECT_URI"
        value = "https://${var.domain}/auth/google/callback"
      }

      dynamic "env" {
        for_each = var.root_folder_name != "gemihub" ? [var.root_folder_name] : []
        content {
          name  = "ROOT_FOLDER_NAME"
          value = env.value
        }
      }

      startup_probe {
        http_get {
          path = "/"
        }
        initial_delay_seconds = 5
        period_seconds        = 10
        failure_threshold     = 3
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.google_client_id,
    google_secret_manager_secret_version.google_client_secret,
    google_secret_manager_secret_version.session_secret,
    google_secret_manager_secret_iam_member.cloud_run_google_client_id,
    google_secret_manager_secret_iam_member.cloud_run_google_client_secret,
    google_secret_manager_secret_iam_member.cloud_run_session_secret,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.app.name
  location = google_cloud_run_v2_service.app.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
