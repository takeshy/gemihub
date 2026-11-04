mock_provider "google" {}
mock_provider "google" { alias = "shared" }
mock_provider "random" {}

variables {
  dns_project_id = "example-dns"
  dns_zone       = "gemihub-net"
  vertex_model   = "configured-text-model"
  image_model    = "configured-image-model"
  repository     = ""
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
    condition = (
      google_storage_bucket.storefront.public_access_prevention == "enforced" &&
      google_storage_bucket.storefront.uniform_bucket_level_access &&
      output.shared_vm_registration.additional_apps.gemihub-web.env.STOREFRONT_BUCKET == google_storage_bucket.storefront.name &&
      toset([for binding in google_storage_bucket_iam_member.storefront : binding.role]) == toset(["roles/storage.objectUser"])
    )
    error_message = "Published and provisional HTML must stay private and use bucket-scoped creator/viewer access."
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

run "reuse_existing_apex" {
  command = plan
  variables { manage_app_domain_dns_certificate = false }
  assert {
    condition     = keys(google_certificate_manager_dns_authorization.app) == ["shops.gemihub.net"] && keys(google_certificate_manager_certificate_map_entry.app) == ["*.shops.gemihub.net"] && keys(google_dns_record_set.app) == ["*.shops.gemihub.net"]
    error_message = "Never duplicate gemihub.net DNS or certificate-map entries already managed by kiokuflow."
  }
}

run "judge_access_and_admin" {
  command = plan
  variables {
    admin_emails       = ["admin@example.com"]
    openai_model       = "configured-openai-model"
    openai_image_model = "configured-openai-image-model"
  }
  assert {
    condition = (
      output.shared_vm_registration.additional_apps.gemihub-web.env.JUDGE_UNTIL == "2027-01-31T15:00:00Z" &&
      output.shared_vm_registration.additional_apps.gemihub-web.env.JUDGE_AI_LIMIT == "200" &&
      output.shared_vm_registration.additional_apps.gemihub-web.env.ADMIN_EMAILS == "admin@example.com" &&
      output.shared_vm_registration.additional_apps.gemihub-web.secrets.JUDGE_INVITE.name == "gemihub-web-judge-invite" &&
      output.shared_vm_registration.additional_apps.gemihub-web.secrets.ACCESS_PASSWORD.name == "gemihub-web-access-password" &&
      output.shared_vm_registration.additional_apps.gemihub-web.secrets.OPENAI_API_KEY.name == "gemihub-web-openai-api-key" &&
      !contains(keys(output.shared_vm_registration.additional_apps.gemihub-web.env), "JUDGE_INVITE") &&
      !contains(keys(output.shared_vm_registration.additional_apps.gemihub-web.env), "OPENAI_API_KEY")
    )
    error_message = "Judge access, the invitation password and the OpenAI key must arrive as versioned secrets."
  }
}

run "judge_access_disabled" {
  command = plan
  variables {
    enable_judge_access    = false
    enable_access_password = false
  }
  assert {
    condition = (
      !contains(keys(output.shared_vm_registration.additional_apps.gemihub-web.secrets), "JUDGE_INVITE") &&
      !contains(keys(output.shared_vm_registration.additional_apps.gemihub-web.secrets), "ACCESS_PASSWORD") &&
      !contains(keys(output.shared_vm_registration.additional_apps.gemihub-web.secrets), "OPENAI_API_KEY") &&
      !contains(keys(output.shared_vm_registration.additional_apps.gemihub-web.env), "JUDGE_UNTIL") &&
      length(random_id.judge_invite) == 0
    )
    error_message = "Disabled judge access and sign-up gating must not inject their settings."
  }
}
