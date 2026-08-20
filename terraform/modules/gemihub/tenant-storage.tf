resource "google_storage_bucket" "tenant_data" {
  name                        = "${var.project_id}-gemihub-tenants"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  depends_on = [google_project_service.apis]
}

# The application enforces organization/project ACLs before constructing an
# object path. Cloud Run is the only principal that reads and mutates tenant
# objects in this private bucket.
resource "google_storage_bucket_iam_member" "cloud_run_tenant_object_admin" {
  bucket = google_storage_bucket.tenant_data.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloud_run.email}"
}
