resource "google_secret_manager_secret" "google_client_id" {
  secret_id = "google-client-id"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "google_client_id" {
  secret      = google_secret_manager_secret.google_client_id.id
  secret_data = var.google_client_id
}

resource "google_secret_manager_secret" "google_client_secret" {
  secret_id = "google-client-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "google_client_secret" {
  secret      = google_secret_manager_secret.google_client_secret.id
  secret_data = var.google_client_secret
}

resource "google_secret_manager_secret" "session_secret" {
  secret_id = "session-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "session_secret" {
  secret      = google_secret_manager_secret.session_secret.id
  secret_data = var.session_secret
}

# --- Hubwork secrets (conditional) ---

resource "google_secret_manager_secret" "stripe_secret_key" {
  count     = var.hubwork_enabled ? 1 : 0
  secret_id = "stripe-secret-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "stripe_secret_key" {
  count       = var.hubwork_enabled ? 1 : 0
  secret      = google_secret_manager_secret.stripe_secret_key[0].id
  secret_data = var.stripe_secret_key
}

resource "google_secret_manager_secret" "stripe_webhook_secret" {
  count     = var.hubwork_enabled ? 1 : 0
  secret_id = "stripe-webhook-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "stripe_webhook_secret" {
  count       = var.hubwork_enabled ? 1 : 0
  secret      = google_secret_manager_secret.stripe_webhook_secret[0].id
  secret_data = var.stripe_webhook_secret
}

resource "google_secret_manager_secret" "hubwork_admin_credentials" {
  count     = var.hubwork_enabled ? 1 : 0
  secret_id = "hubwork-admin-credentials"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "hubwork_admin_credentials" {
  count       = var.hubwork_enabled ? 1 : 0
  secret      = google_secret_manager_secret.hubwork_admin_credentials[0].id
  secret_data = var.hubwork_admin_credentials
}
