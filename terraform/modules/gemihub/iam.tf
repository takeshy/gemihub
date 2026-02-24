resource "google_service_account" "cloud_run" {
  account_id   = "gemini-hub-run"
  display_name = "Gemini Hub IDE Cloud Run"

  depends_on = [google_project_service.apis]
}

# Grant Cloud Run SA access to read secrets
resource "google_secret_manager_secret_iam_member" "cloud_run_google_client_id" {
  secret_id = google_secret_manager_secret.google_client_id.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_google_client_secret" {
  secret_id = google_secret_manager_secret.google_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_session_secret" {
  secret_id = google_secret_manager_secret.session_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Cloud Build SA permissions
# NOTE: The Cloud Build default SA is created asynchronously after the API is enabled.
# These bindings depend on the API being fully ready.
locals {
  cloud_build_sa = "serviceAccount:${var.project_number}@cloudbuild.gserviceaccount.com"
}

resource "google_project_iam_member" "cloudbuild_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = local.cloud_build_sa

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "cloudbuild_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = local.cloud_build_sa

  depends_on = [google_project_service.apis]
}
