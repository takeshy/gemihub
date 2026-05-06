# Secrets are created and versioned externally (e.g. gcloud CLI).
# Terraform only references them for Cloud Run env injection + IAM.

data "google_secret_manager_secret" "google_client_id" {
  secret_id = "google-client-id"
}

data "google_secret_manager_secret" "google_client_secret" {
  secret_id = "google-client-secret"
}

data "google_secret_manager_secret" "google_picker_api_key" {
  secret_id = "google-picker-api-key"
}

data "google_secret_manager_secret" "session_secret" {
  secret_id = "session-secret"
}

data "google_secret_manager_secret" "stripe_secret_key" {
  secret_id = "stripe-secret-key"
}

data "google_secret_manager_secret" "stripe_webhook_secret" {
  secret_id = "stripe-webhook-secret"
}

data "google_secret_manager_secret" "hubwork_admin_credentials" {
  secret_id = "hubwork-admin-credentials"
}

data "google_secret_manager_secret" "hubwork_admin_emails" {
  secret_id = "hubwork-admin-emails"
}

data "google_secret_manager_secret" "stripe_price_id_lite" {
  secret_id = "stripe-price-id-lite"
}

data "google_secret_manager_secret" "stripe_price_id_pro" {
  secret_id = "stripe-price-id-pro"
}
