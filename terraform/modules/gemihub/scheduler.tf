# Cloud Scheduler for Hubwork scheduled workflows.
# Calls the main Cloud Run's /hubwork/api/workflow/scheduled endpoint every minute.

resource "google_service_account" "hubwork_scheduler" {
  account_id   = "hubwork-scheduler"
  display_name = "Hubwork Scheduler"

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.hubwork_scheduler.email}"
}

resource "google_cloud_scheduler_job" "hubwork" {
  name      = "hubwork-scheduled-workflows"
  region    = var.region
  schedule  = "* * * * *"
  time_zone = "UTC"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.app.uri}/hubwork/api/workflow/scheduled"

    oidc_token {
      service_account_email = google_service_account.hubwork_scheduler.email
      audience              = google_cloud_run_v2_service.app.uri
    }
  }

  retry_config {
    retry_count = 0
  }

  depends_on = [google_project_service.apis]
}
