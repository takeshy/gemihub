provider "google" {
  alias   = "shared"
  project = var.shared_project_id
  region  = var.region
}

data "google_compute_global_address" "shared" {
  provider = google.shared
  name     = var.load_balancer_address
}

locals {
  certificate_domains = toset([var.app_domain, var.site_domain])
}

resource "google_certificate_manager_dns_authorization" "app" {
  for_each = local.certificate_domains
  provider = google.shared
  name     = "omaiweb-${each.value == var.app_domain ? "app" : "shops"}"
  domain   = each.value
  type     = "PER_PROJECT_RECORD"
}

resource "google_dns_record_set" "validation" {
  for_each     = google_certificate_manager_dns_authorization.app
  project      = var.dns_project_id
  managed_zone = var.dns_zone
  name         = each.value.dns_resource_record[0].name
  type         = "CNAME"
  ttl          = 300
  rrdatas      = [each.value.dns_resource_record[0].data]
}

resource "google_certificate_manager_certificate" "app" {
  provider = google.shared
  name     = "omaiweb"
  managed {
    domains            = distinct([var.app_domain, var.site_domain, "*.${var.site_domain}"])
    dns_authorizations = [for auth in google_certificate_manager_dns_authorization.app : auth.id]
  }
  depends_on = [google_dns_record_set.validation]
}

resource "google_certificate_manager_certificate_map_entry" "app" {
  for_each     = toset(local.hosts)
  provider     = google.shared
  name         = "omaiweb-${each.value == var.app_domain ? "app" : "shops"}"
  map          = var.certificate_map
  hostname     = each.value
  certificates = [google_certificate_manager_certificate.app.id]
}

resource "google_dns_record_set" "app" {
  for_each     = toset(local.hosts)
  project      = var.dns_project_id
  managed_zone = var.dns_zone
  name         = "${each.value}."
  type         = "A"
  ttl          = 300
  rrdatas      = [data.google_compute_global_address.shared.address]
}
