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
            secret  = data.google_secret_manager_secret.google_client_id.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "GOOGLE_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.google_client_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "SESSION_SECRET"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.session_secret.secret_id
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

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "HUBWORK_LB_IP"
        value = google_compute_global_address.default.address
      }

      env {
        name  = "GEMIHUB_MAIN_DOMAIN"
        value = var.domain
      }

      env {
        name = "STRIPE_SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.stripe_secret_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "STRIPE_WEBHOOK_SECRET"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.stripe_webhook_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "HUBWORK_ADMIN_CREDENTIALS"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.hubwork_admin_credentials.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "STRIPE_PRICE_ID_LITE"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.stripe_price_id_lite.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "STRIPE_PRICE_ID_PRO"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.stripe_price_id_pro.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "HUBWORK_ADMIN_EMAILS"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.hubwork_admin_emails.secret_id
            version = "latest"
          }
        }
      }

      dynamic "env" {
        for_each = length(var.hubwork_review_slugs) > 0 ? [join(",", var.hubwork_review_slugs)] : []
        content {
          name  = "HUBWORK_REVIEW_SLUGS"
          value = env.value
        }
      }

      dynamic "env" {
        for_each = length(var.hubwork_stripe_allowed_slugs) > 0 ? [join(",", var.hubwork_stripe_allowed_slugs)] : []
        content {
          name  = "HUBWORK_STRIPE_ALLOWED_SLUGS"
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
    ignore_changes = [template[0].containers[0].image, scaling]
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.cloud_run_google_client_id,
    google_secret_manager_secret_iam_member.cloud_run_google_client_secret,
    google_secret_manager_secret_iam_member.cloud_run_session_secret,
    google_secret_manager_secret_iam_member.cloud_run_stripe_secret_key,
    google_secret_manager_secret_iam_member.cloud_run_stripe_webhook_secret,
    google_secret_manager_secret_iam_member.cloud_run_hubwork_admin_credentials,
    google_secret_manager_secret_iam_member.cloud_run_hubwork_admin_emails,
    google_secret_manager_secret_iam_member.cloud_run_stripe_price_id_lite,
    google_secret_manager_secret_iam_member.cloud_run_stripe_price_id_pro,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.app.name
  location = google_cloud_run_v2_service.app.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
