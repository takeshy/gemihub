resource "google_storage_bucket" "gemihub_okf" {
  name                        = "${var.project_id}-gemihub-okf"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "cloud_run_okf_reader" {
  bucket = google_storage_bucket.gemihub_okf.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.cloud_run.email}"
}
