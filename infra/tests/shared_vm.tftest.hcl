mock_provider "google" {}
mock_provider "google" { alias = "shared" }

variables {
  dns_project_id = "example-dns"
  dns_zone       = "gemihub-net"
  vertex_model   = "configured-text-model"
  image_model    = "configured-image-model"
}

run "isolated_runtime" {
  command = plan
  assert {
    condition     = keys(output.shared_vm_registration.additional_apps) == ["gemihub-web"] && !contains(keys(output.shared_lb_registration.shared_vm_backends), "gemihub")
    error_message = "The web builder must not take over kiokuflow's legacy gemihub runtime or default backend."
  }
  assert {
    condition     = output.oauth_redirect_uri == "https://gemihub.net/auth/google/callback" && output.shared_vm_registration.additional_apps.gemihub-web.env.APP_ORIGIN == "https://gemihub.net"
    error_message = "The public origin and OAuth callback must match the registered gemihub.net client."
  }
  assert {
    condition     = google_firestore_database.app.name == "gemihub" && google_firestore_database.app.delete_protection_state == "DELETE_PROTECTION_ENABLED"
    error_message = "Existing databases must remain separate and the new DB must be protected."
  }
  assert {
    condition     = length(google_cloudbuild_trigger.deploy) == 0
    error_message = "Automatic deployment needs an explicitly connected repository."
  }
  assert {
    condition     = output.shared_vm_registration.additional_apps.gemihub-web.env.PORT == "8080" && output.shared_vm_registration.additional_apps.gemihub-web.port == 8105
    error_message = "Container and host port registration must match the shared deployment contract."
  }
  assert {
    condition     = !contains(keys(output.shared_vm_registration.additional_apps.gemihub-web.env), "SESSION_SECRET") && output.shared_vm_registration.additional_apps.gemihub-web.secrets.SESSION_SECRET.version == "1"
    error_message = "Runtime registration must use versioned secret references."
  }
  assert {
    condition     = toset(output.shared_lb_registration.shared_vm_hosts.gemihub-web) == toset(["gemihub.net", "*.shops.gemihub.net"])
    error_message = "Both management and wildcard storefront traffic need explicit host routing."
  }
}

run "existing_oauth_secrets" {
  command = plan
  assert {
    condition = (
      output.shared_vm_registration.additional_apps.gemihub-web.secrets.GOOGLE_CLIENT_ID.project == "495062043717" &&
      output.shared_vm_registration.additional_apps.gemihub-web.secrets.GOOGLE_CLIENT_ID.name == "google-client-id" &&
      output.shared_vm_registration.additional_apps.gemihub-web.secrets.GOOGLE_CLIENT_ID.version == "1" &&
      output.shared_vm_registration.additional_apps.gemihub-web.secrets.GOOGLE_CLIENT_SECRET.name == "google-client-secret" &&
      !contains(keys(output.shared_vm_registration.additional_apps.gemihub-web.env), "GOOGLE_CLIENT_ID")
    )
    error_message = "Use the existing versioned OAuth secret references, not literal credentials."
  }
}

run "explicit_oauth_credentials" {
  command = plan
  variables {
    google_client_id_secret_ref = null
    google_client_secret_ref    = null
    google_client_id            = "configured.apps.googleusercontent.com"
  }
  assert {
    condition = (
      output.shared_vm_registration.additional_apps.gemihub-web.env.GOOGLE_CLIENT_ID == "configured.apps.googleusercontent.com" &&
      output.shared_vm_registration.additional_apps.gemihub-web.secrets.GOOGLE_CLIENT_SECRET.name == "gemihub-web-google-client-secret"
    )
    error_message = "Explicit OAuth credentials must be supported when references are disabled."
  }
}
