output "shared_vm_registration" {
  description = "Pass this JSON to Kakeratta's prepare-bundle.py. Contains settings and secret references only, never secret payloads."
  value = {
    additional_build_accounts = [google_service_account.build.email]
    additional_apps = {
      omaiweb = {
        account       = google_service_account.runtime.email
        project       = var.project_id
        network_index = 4
        port          = 8105
        memory        = var.memory
        image         = local.image
        hosts         = local.hosts
        env = {
          NODE_ENV              = "production"
          DEMO_MODE             = "false"
          PORT                  = "8080"
          APP_ORIGIN            = "https://${var.app_domain}"
          SITE_DOMAIN           = var.site_domain
          GOOGLE_CLOUD_PROJECT  = var.project_id
          FIRESTORE_DATABASE_ID = google_firestore_database.app.name
          GOOGLE_CLOUD_LOCATION = var.vertex_location
          VERTEX_MODEL          = var.vertex_model
          GEMINI_MODEL          = var.vertex_model
          GEMINI_IMAGE_MODEL    = var.image_model
          VERTEX_IMAGE_LOCATION = var.image_location
          GOOGLE_CLIENT_ID      = var.google_client_id
        }
        secrets = {
          SESSION_SECRET       = { project = var.project_id, name = google_secret_manager_secret.app["omaiweb-session-secret"].secret_id, version = var.session_secret_version }
          GOOGLE_CLIENT_SECRET = { project = var.project_id, name = google_secret_manager_secret.app["omaiweb-google-client-secret"].secret_id, version = var.oauth_secret_version }
        }
      }
    }
  }
}

output "shared_lb_registration" {
  description = "Merge into GemiHub's existing shared-vm.auto.tfvars; preserve all existing entries."
  value = {
    shared_vm_backends = { omaiweb = "https://www.googleapis.com/compute/v1/projects/${var.shared_project_id}/global/backendServices/shared-apps-omaiweb" }
    shared_vm_hosts    = { omaiweb = local.hosts }
  }
}

output "oauth_redirect_uri" { value = "https://${var.app_domain}/auth/google/callback" }
output "build_account" { value = google_service_account.build.email }
output "build_account_resource" { value = google_service_account.build.id }
output "bootstrap_image" { value = local.image }
output "build_source_bucket" { value = google_storage_bucket.build_source.name }
