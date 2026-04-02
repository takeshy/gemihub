resource "google_service_account" "cloud_run" {
  account_id   = "gemini-hub-run"
  display_name = "Gemini Hub IDE Cloud Run"

  depends_on = [google_project_service.apis]
}

# Grant Cloud Run SA access to read secrets
resource "google_secret_manager_secret_iam_member" "cloud_run_google_client_id" {
  secret_id = data.google_secret_manager_secret.google_client_id.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_google_client_secret" {
  secret_id = data.google_secret_manager_secret.google_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_session_secret" {
  secret_id = data.google_secret_manager_secret.session_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Grant Cloud Run SA access to Firestore
resource "google_project_iam_member" "cloud_run_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Grant Cloud Run SA access to Certificate Manager
resource "google_project_iam_member" "cloud_run_cert_manager" {
  project = var.project_id
  role    = "roles/certificatemanager.editor"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Grant Cloud Run SA access to update URL maps (for custom domain routing)
resource "google_project_iam_member" "cloud_run_compute_url_map" {
  project = var.project_id
  role    = "roles/compute.loadBalancerAdmin"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_stripe_secret_key" {
  secret_id = data.google_secret_manager_secret.stripe_secret_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_stripe_webhook_secret" {
  secret_id = data.google_secret_manager_secret.stripe_webhook_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_hubwork_admin_credentials" {
  secret_id = data.google_secret_manager_secret.hubwork_admin_credentials.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_hubwork_admin_emails" {
  secret_id = data.google_secret_manager_secret.hubwork_admin_emails.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_stripe_price_id_lite" {
  secret_id = data.google_secret_manager_secret.stripe_price_id_lite.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_stripe_price_id_pro" {
  secret_id = data.google_secret_manager_secret.stripe_price_id_pro.id
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
