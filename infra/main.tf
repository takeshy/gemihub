locals {
  apis = toset([
    "aiplatform.googleapis.com", "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com", "firestore.googleapis.com",
    "secretmanager.googleapis.com", "iam.googleapis.com", "storage.googleapis.com",
    "iamcredentials.googleapis.com", "drive.googleapis.com",
    "gmail.googleapis.com", "calendar-json.googleapis.com",
  ])
  image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/gemihub-web:bootstrap"
  hosts = distinct(concat([var.app_domain, "*.${var.site_domain}"], keys(var.custom_domains)))
}

resource "google_project_service" "app" {
  for_each           = local.apis
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "runtime" {
  account_id   = "gemihub-web-run"
  display_name = "gemihub.net booking service runtime"
  depends_on   = [google_project_service.app]
}

resource "google_service_account" "build" {
  account_id   = "gemihub-web-build"
  display_name = "gemihub.net booking service build and deployment"
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
    title       = "gemihub-web_database_only"
    description = "Only gemihub-web's named Firestore database."
    expression  = "resource.name == 'projects/${var.project_id}/databases/${var.database_id}'"
  }
}

# TTL deletion can lag; application queries independently enforce the same 90-day window.
resource "google_firestore_field" "shop_log_expiry" {
  project    = var.project_id
  database   = google_firestore_database.app.name
  collection = "gemihub_log_events"
  field      = "expiresAt"
  ttl_config {}
  index_config {}
}

resource "google_firestore_index" "customer_activity" {
  project     = var.project_id
  database    = google_firestore_database.app.name
  collection  = "gemihub_log_events"
  query_scope = "COLLECTION"
  fields {
    field_path = "customerKey"
    order      = "ASCENDING"
  }
  fields {
    field_path = "at"
    order      = "DESCENDING"
  }
}

locals {
  # Every optional equality/array filter combination followed by the timestamp range/order.
  # Mask 1 (customerKey alone) is already managed by customer_activity above.
  log_search_indexes = {
    for mask in range(2, 16) : tostring(mask) => [
      for bit, field in ["customerKey", "kind", "ok", "references"] : field
      if floor(mask / pow(2, bit)) % 2 == 1
    ]
  }
}

resource "google_firestore_index" "log_search" {
  for_each    = local.log_search_indexes
  project     = var.project_id
  database    = google_firestore_database.app.name
  collection  = "gemihub_log_events"
  query_scope = "COLLECTION"
  dynamic "fields" {
    for_each = each.value
    content {
      field_path   = fields.value
      order        = fields.value == "references" ? null : "ASCENDING"
      array_config = fields.value == "references" ? "CONTAINS" : null
    }
  }
  fields {
    field_path = "at"
    order      = "DESCENDING"
  }
}

resource "google_firestore_field" "article_visitor_expiry" {
  project    = var.project_id
  database   = google_firestore_database.app.name
  collection = "gemihub_article_visitors"
  field      = "expiresAt"
  ttl_config {}
  index_config {}
}

resource "google_firestore_field" "daily_visitor_expiry" {
  project    = var.project_id
  database   = google_firestore_database.app.name
  collection = "gemihub_daily_visitors"
  field      = "expiresAt"
  ttl_config {}
  index_config {}
}

resource "google_firestore_index" "post_views" {
  project     = var.project_id
  database    = google_firestore_database.app.name
  collection  = "gemihub_log_events"
  query_scope = "COLLECTION"
  fields {
    field_path = "postId"
    order      = "ASCENDING"
  }
  fields {
    field_path = "at"
    order      = "ASCENDING"
  }
}

resource "google_project_iam_member" "vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret" "app" {
  for_each = toset(concat(
    ["gemihub-web-session-secret", "gemihub-web-google-client-secret"],
    var.paypal_client_id != "" ? ["gemihub-web-paypal-client-secret"] : [],
    var.enable_access_password ? ["gemihub-web-access-password"] : [],
    var.openai_model != "" ? ["gemihub-web-openai-api-key"] : [],
    var.twilio_account_sid != "" ? ["gemihub-web-twilio-auth-token"] : [],
  ))
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

# The judge invitation is generated here so its URL can be printed for the submission form.
resource "random_id" "judge_invite" {
  count       = var.enable_judge_access ? 1 : 0
  byte_length = 32
}

resource "google_secret_manager_secret" "judge_invite" {
  count     = var.enable_judge_access ? 1 : 0
  project   = var.project_id
  secret_id = "gemihub-web-judge-invite"
  replication {
    auto {}
  }
  depends_on = [google_project_service.app]
}

resource "google_secret_manager_secret_version" "judge_invite" {
  count       = var.enable_judge_access ? 1 : 0
  secret      = google_secret_manager_secret.judge_invite[0].id
  secret_data = random_id.judge_invite[0].hex
}

resource "google_secret_manager_secret_iam_member" "judge_invite" {
  count     = var.enable_judge_access ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.judge_invite[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# Reference the configured OAuth secrets without copying payloads.
resource "google_secret_manager_secret_iam_member" "google_oauth" {
  for_each = { for key, ref in {
    client_id     = var.google_client_id_secret_ref
    client_secret = var.google_client_secret_ref
  } : key => ref if ref != null }
  project   = each.value.project
  secret_id = each.value.name
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_artifact_registry_repository" "app" {
  project       = var.project_id
  location      = var.region
  repository_id = "gemihub-web"
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
  name                        = "${var.project_id}-gemihub-web-build-source"
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

# Generated storefront HTML stays private: the existing authenticated gateway selects a release.
resource "google_storage_bucket" "storefront" {
  project                     = var.project_id
  name                        = "${var.project_id}-gemihub-web-storefront"
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  depends_on                  = [google_project_service.app]
  lifecycle { prevent_destroy = true }
}

resource "google_storage_bucket_iam_member" "storefront" {
  # Create, read and delete objects (old releases are pruned); no bucket IAM or settings changes.
  for_each = toset(["roles/storage.objectUser"])
  bucket   = google_storage_bucket.storefront.name
  role     = each.value
  member   = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_cloudbuild_trigger" "deploy" {
  count           = var.repository == "" ? 0 : 1
  project         = var.project_id
  location        = var.region
  name            = "gemihub-web-main-deploy"
  service_account = google_service_account.build.id
  filename        = "cloudbuild.yaml"
  repository_event_config {
    repository = var.repository
    push { branch = var.deploy_branch }
  }
  substitutions = {
    _IMAGE          = "${var.region}-docker.pkg.dev/${var.project_id}/gemihub-web/gemihub-web:$${COMMIT_SHA}"
    _SHARED_PROJECT = var.shared_project_id
  }
  depends_on = [google_artifact_registry_repository_iam_member.build, google_project_iam_member.build_logs]
}
