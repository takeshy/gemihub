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

data "google_secret_manager_secret" "stripe_price_id_lite" {
  secret_id = "stripe-price-id-lite"
}

# Plan rename (pro → business): the Cloud Run env vars are now
# STRIPE_PRICE_ID_BUSINESS{,_USD} but keep reading these existing Secret
# Manager secrets. Creating properly-named replacement secrets (and dropping
# these) is a Phase 6 infra task.
data "google_secret_manager_secret" "stripe_price_id_business" {
  secret_id = "stripe-price-id-business"
}

data "google_secret_manager_secret" "stripe_price_id_vertex_topup" {
  secret_id = "stripe-price-id-vertex-topup"
}

data "google_secret_manager_secret" "stripe_price_id_storage_addon" {
  secret_id = "stripe-price-id-storage-addon"
}

data "google_secret_manager_secret" "stripe_price_id_lite_usd" {
  secret_id = "stripe-price-id-lite-usd"
}

# The hubwork-admin-credentials / hubwork-admin-emails secrets are no longer
# read: /hubwork/admin was folded into /admin/enterprise, which authorizes on
# SUPER_ADMIN_EMAILS. The secrets themselves are left in Secret Manager for
# manual cleanup.
