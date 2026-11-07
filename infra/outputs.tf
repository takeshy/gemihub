locals {
  oauth_client_secret = var.google_client_secret_ref != null ? var.google_client_secret_ref : { project = var.project_id, name = google_secret_manager_secret.app["gemihub-web-google-client-secret"].secret_id, version = var.oauth_secret_version }
}

output "shared_vm_registration" {
  description = "Pass this JSON to Kakeratta's prepare-bundle.py. Contains settings and secret references only, never secret payloads."
  value = {
    additional_build_accounts = [google_service_account.build.email]
    additional_apps = {
      gemihub-web = {
        account       = google_service_account.runtime.email
        project       = var.project_id
        network_index = 4
        port          = 8105
        memory        = var.memory
        image         = local.image
        hosts         = local.hosts
        env = merge({
          NODE_ENV                                                        = "production"
          DEMO_MODE                                                       = "false"
          PORT                                                            = "8080"
          APP_ORIGIN                                                      = "https://${var.app_domain}"
          SITE_DOMAIN                                                     = var.site_domain
          STOREFRONT_BUCKET                                               = google_storage_bucket.storefront.name
          GOOGLE_CLOUD_PROJECT                                            = var.project_id
          FIRESTORE_DATABASE_ID                                           = google_firestore_database.app.name
          GOOGLE_CLOUD_LOCATION                                           = var.vertex_location
          VERTEX_MODEL                                                    = var.vertex_model
          VERTEX_REVIEW_MODEL                                             = var.vertex_review_model
          GEMINI_MODEL                                                    = var.vertex_model
          GEMINI_IMAGE_MODEL                                              = var.image_model
          VERTEX_IMAGE_LOCATION                                           = var.image_location
          PAYPAL_CLIENT_ID                                                = var.paypal_client_id
          PAYPAL_ENVIRONMENT                                              = var.paypal_environment
          ADMIN_EMAILS                                                    = join(",", var.admin_emails)
          OPENAI_MODEL                                                    = var.openai_model
          OPENAI_REVIEW_MODEL                                             = var.openai_review_model
          OPENAI_IMAGE_MODEL                                              = var.openai_image_model
          VERTEX_LIVE_MODEL                                               = var.live_model
          VERTEX_LIVE_LOCATION                                            = var.live_location
          }, var.google_client_id_secret_ref == null ? { GOOGLE_CLIENT_ID = var.google_client_id } : {}, var.twilio_account_sid != "" ? {
          TWILIO_ACCOUNT_SID                                              = var.twilio_account_sid
          } : {}, var.enable_judge_access ? {
          JUDGE_UNTIL                                                     = var.judge_until
          JUDGE_AI_LIMIT                                                  = tostring(var.judge_ai_limit)
        } : {})
        secrets = merge({
          SESSION_SECRET                                                  = { project = var.project_id, name = google_secret_manager_secret.app["gemihub-web-session-secret"].secret_id, version = var.session_secret_version }
          GOOGLE_CLIENT_SECRET                                            = local.oauth_client_secret
          }, var.google_client_id_secret_ref != null ? { GOOGLE_CLIENT_ID = var.google_client_id_secret_ref } : {}, var.paypal_client_id != "" ? {
          PAYPAL_CLIENT_SECRET                                            = { project = var.project_id, name = google_secret_manager_secret.app["gemihub-web-paypal-client-secret"].secret_id, version = var.paypal_secret_version }
          } : {}, var.enable_access_password ? {
          ACCESS_PASSWORD = { project = var.project_id, name = google_secret_manager_secret.app["gemihub-web-access-password"].secret_id, version = var.access_password_version }
          } : {}, var.openai_model != "" ? {
          OPENAI_API_KEY = { project = var.project_id, name = google_secret_manager_secret.app["gemihub-web-openai-api-key"].secret_id, version = var.openai_api_key_version }
          } : {}, var.twilio_account_sid != "" ? {
          TWILIO_AUTH_TOKEN = { project = var.project_id, name = google_secret_manager_secret.app["gemihub-web-twilio-auth-token"].secret_id, version = var.twilio_token_secret_version }
          } : {}, var.enable_judge_access ? {
          JUDGE_INVITE = { project = var.project_id, name = google_secret_manager_secret.judge_invite[0].secret_id, version = google_secret_manager_secret_version.judge_invite[0].version }
        } : {})
      }
    }
  }
  precondition {
    condition     = var.google_client_id_secret_ref != null || var.google_client_id != ""
    error_message = "Configure a Google client ID or an existing Secret Manager reference."
  }
}

output "shared_lb_registration" {
  description = "Merge into kiokuflow's existing shared-vm.auto.tfvars; preserve all existing entries."
  value = {
    shared_vm_backends = { gemihub-web = "https://www.googleapis.com/compute/v1/projects/${var.shared_project_id}/global/backendServices/shared-apps-gemihub-web" }
    shared_vm_hosts    = { gemihub-web = local.hosts }
  }
}

output "judge_url" {
  description = "Shared invitation URL for hackathon judges. Put it only in the submission's testing instructions."
  value       = var.enable_judge_access ? "https://${var.app_domain}/judge/${random_id.judge_invite[0].hex}?lang=en" : null
  sensitive   = true
}

output "oauth_redirect_uri" { value = "https://${var.app_domain}/auth/google/callback" }
output "build_account" { value = google_service_account.build.email }
output "build_account_resource" { value = google_service_account.build.id }
output "bootstrap_image" { value = local.image }
output "build_source_bucket" { value = google_storage_bucket.build_source.name }
output "storefront_bucket" { value = google_storage_bucket.storefront.name }
