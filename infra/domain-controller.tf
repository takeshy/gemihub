# The web runtime never receives permissions to administer the shared frontend.
resource "google_service_account" "domains" {
  account_id   = "gemihub-web-domains"
  display_name = "Verified storefront domain controller"
}

resource "google_project_iam_custom_role" "domain_certificates" {
  project = var.shared_project_id
  role_id = "gemihubDomainCertificates"
  title   = "GemiHub storefront certificates"
  permissions = [
    "certificatemanager.dnsauthorizations.create", "certificatemanager.dnsauthorizations.get", "certificatemanager.dnsauthorizations.use",
    "certificatemanager.certs.create", "certificatemanager.certs.get", "certificatemanager.certs.use",
    "certificatemanager.certmapentries.create", "certificatemanager.certmapentries.get",
    "certificatemanager.operations.get",
  ]
}
resource "google_project_iam_member" "domain_certificates" {
  project = var.shared_project_id
  role    = google_project_iam_custom_role.domain_certificates.name
  member  = "serviceAccount:${google_service_account.domains.email}"
}
resource "google_project_iam_custom_role" "domain_routing" {
  project     = var.shared_project_id
  role_id     = "gemihubDomainRouting"
  title       = "GemiHub shared frontend host routing"
  permissions = ["compute.urlMaps.get", "compute.urlMaps.update", "compute.backendServices.use"]
}
resource "google_project_iam_member" "domain_routing" {
  project = var.shared_project_id
  role    = google_project_iam_custom_role.domain_routing.name
  member  = "serviceAccount:${google_service_account.domains.email}"
  condition {
    title      = "gemihub_domain_url_map_only"
    expression = "resource.name == 'projects/${var.shared_project_id}/global/urlMaps/gemini-hub-https'"
  }
}
resource "google_project_iam_member" "domain_database" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.domains.email}"
  condition {
    title      = "gemihub_domains_database_only"
    expression = "resource.name == 'projects/${var.project_id}/databases/${var.database_id}'"
  }
}
resource "google_storage_bucket_iam_member" "domain_registry" {
  bucket = google_storage_bucket.storefront.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.domains.email}"
  condition {
    title      = "gemihub_domain_registry_only"
    expression = "resource.name == 'projects/_/buckets/${google_storage_bucket.storefront.name}/objects/routing/custom-domains.json'"
  }
}
resource "google_service_account_iam_member" "domain_controller_identity" {
  service_account_id = google_service_account.domains.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:shared-apps@${var.shared_project_id}.iam.gserviceaccount.com"
}
resource "google_storage_bucket_object" "domain_registry" {
  bucket       = google_storage_bucket.storefront.name
  name         = "routing/custom-domains.json"
  content      = jsonencode({ hosts = [], managedHosts = [] })
  content_type = "application/json"
  lifecycle { ignore_changes = [content] }
}
output "domain_controller_config" {
  value = {
    project         = var.shared_project_id
    database        = var.database_id
    databaseProject = var.project_id
    account         = google_service_account.domains.email
    bucket          = google_storage_bucket.storefront.name
    map             = var.certificate_map
    urlMap          = "gemini-hub-https"
    address         = data.google_compute_global_address.shared.address
    port            = 8105
  }
}

resource "google_project_iam_member" "domain_backend_use" {
  project = var.shared_project_id
  role    = google_project_iam_custom_role.domain_routing.name
  member  = "serviceAccount:${google_service_account.domains.email}"
  condition {
    title      = "gemihub_domains_existing_backends_only"
    expression = "resource.name.startsWith('projects/${var.shared_project_id}/global/backendServices/shared-apps-')"
  }
}
