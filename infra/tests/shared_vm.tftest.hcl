mock_provider "google" {}
mock_provider "google" { alias = "shared" }

variables {
  app_domain       = "omaiweb.example.com"
  site_domain      = "shops.omaiweb.example.com"
  dns_project_id   = "example-dns"
  dns_zone         = "example-com"
  google_client_id = "example.apps.googleusercontent.com"
  vertex_model     = "configured-text-model"
  image_model      = "configured-image-model"
}

run "isolated_runtime" {
  command = plan
  assert {
    condition     = google_firestore_database.app.name == "omaiweb" && google_firestore_database.app.delete_protection_state == "DELETE_PROTECTION_ENABLED"
    error_message = "Existing databases must remain separate and the new DB must be protected."
  }
  assert {
    condition     = length(google_cloudbuild_trigger.deploy) == 0
    error_message = "Automatic deployment needs an explicitly connected repository."
  }
  assert {
    condition     = output.shared_vm_registration.additional_apps.omaiweb.env.PORT == "8080" && output.shared_vm_registration.additional_apps.omaiweb.port == 8105
    error_message = "Container and host port registration must match the shared deployment contract."
  }
  assert {
    condition     = !contains(keys(output.shared_vm_registration.additional_apps.omaiweb.env), "SESSION_SECRET") && output.shared_vm_registration.additional_apps.omaiweb.secrets.SESSION_SECRET.version == "1"
    error_message = "Runtime registration must use versioned secret references."
  }
  assert {
    condition     = toset(output.shared_lb_registration.shared_vm_hosts.omaiweb) == toset(["omaiweb.example.com", "*.shops.omaiweb.example.com"])
    error_message = "Both management and wildcard storefront traffic need explicit host routing."
  }
}
