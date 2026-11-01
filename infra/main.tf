locals {
  apis = toset([
    "aiplatform.googleapis.com", "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com", "firestore.googleapis.com",
    "secretmanager.googleapis.com", "iam.googleapis.com", "storage.googleapis.com",
    "iamcredentials.googleapis.com", "drive.googleapis.com",
    "sheets.googleapis.com", "gmail.googleapis.com", "calendar-json.googleapis.com",
  ])
  image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/omaiweb:bootstrap"
  hosts = distinct([var.app_domain, "*.${var.site_domain}"])
}

resource "google_project_service" "app" {
  for_each           = local.apis
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "runtime" {
  account_id   = "omaiweb-run"
  display_name = "omaiweb shared VM runtime"
  depends_on   = [google_project_service.app]
}

resource "google_service_account" "build" {
  account_id   = "omaiweb-build"
  display_name = "omaiweb build and IAP deployment"
  depends_on   = [google_project_service.app]
}

resource "google_firestore_database" "app" {
  project                 = var.project_id
  name                    = var.database_id
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  concurrency_mode        = "PESSIMISTIC"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.app]
  lifecycle { prevent_destroy = true }
}

resource "google_project_iam_member" "database" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
  condition {
    title       = "omaiweb_database_only"
    description = "Only omaiweb's named Firestore database."
    expression  = "resource.name == 'projects/${var.project_id}/databases/${var.database_id}'"
  }
}

resource "google_project_iam_member" "vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret" "app" {
  for_each  = toset(["omaiweb-session-secret", "omaiweb-google-client-secret"])
  project   = var.project_id
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.app]
  lifecycle { prevent_destroy = true }
}

resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each  = google_secret_manager_secret.app
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_artifact_registry_repository" "app" {
  project       = var.project_id
  location      = var.region
  repository_id = "omaiweb"
  format        = "DOCKER"
  depends_on    = [google_project_service.app]
}

resource "google_artifact_registry_repository_iam_member" "build" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.app.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.build.email}"
}

resource "google_project_iam_member" "build_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.build.email}"
}

resource "google_storage_bucket" "build_source" {
  project                     = var.project_id
  name                        = "${var.project_id}-omaiweb-build-source"
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  depends_on                  = [google_project_service.app]
  lifecycle_rule {
    condition { age = 7 }
    action { type = "Delete" }
  }
}

resource "google_storage_bucket_iam_member" "build_source" {
  bucket = google_storage_bucket.build_source.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.build.email}"
}

resource "google_cloudbuild_trigger" "deploy" {
  count           = var.repository == "" ? 0 : 1
  project         = var.project_id
  location        = var.region
  name            = "omaiweb-main-deploy"
  service_account = google_service_account.build.id
  filename        = "cloudbuild.yaml"
  repository_event_config {
    repository = var.repository
    push { branch = var.deploy_branch }
  }
  substitutions = {
    _IMAGE          = "${var.region}-docker.pkg.dev/${var.project_id}/omaiweb/omaiweb:$${COMMIT_SHA}"
    _SHARED_PROJECT = var.shared_project_id
  }
  depends_on = [google_artifact_registry_repository_iam_member.build, google_project_iam_member.build_logs]
}
