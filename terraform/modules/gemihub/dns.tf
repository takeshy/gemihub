resource "google_dns_managed_zone" "default" {
  count = var.manage_dns ? 1 : 0

  name        = "gemihub-online"
  dns_name    = "${var.domain}."
  description = "DNS zone for ${var.domain}"

  depends_on = [google_project_service.apis]
}

resource "google_dns_record_set" "a" {
  count = var.manage_dns ? 1 : 0

  name         = "${var.domain}."
  type         = "A"
  ttl          = 300
  managed_zone = google_dns_managed_zone.default[0].name
  rrdatas      = [google_compute_global_address.default.address]
}

# Wildcard A record so slug subdomains (e.g. takeshy.gemihub.online) resolve
# to the same LB IP. Cloud Run identifies the account from the Host header.
resource "google_dns_record_set" "wildcard_a" {
  count = var.manage_dns ? 1 : 0

  name         = "*.${var.domain}."
  type         = "A"
  ttl          = 300
  managed_zone = google_dns_managed_zone.default[0].name
  rrdatas      = [google_compute_global_address.default.address]
}

# CNAME record for Certificate Manager DNS authorization
resource "google_dns_record_set" "cert_validation" {
  count = var.manage_dns ? 1 : 0

  name         = google_certificate_manager_dns_authorization.main.dns_resource_record[0].name
  type         = google_certificate_manager_dns_authorization.main.dns_resource_record[0].type
  ttl          = 300
  managed_zone = google_dns_managed_zone.default[0].name
  rrdatas      = [google_certificate_manager_dns_authorization.main.dns_resource_record[0].data]
}

resource "google_dns_record_set" "txt_verification" {
  count = var.manage_dns && var.google_site_verification_token != "" ? 1 : 0

  name         = "${var.domain}."
  type         = "TXT"
  ttl          = 300
  managed_zone = google_dns_managed_zone.default[0].name
  rrdatas      = ["\"google-site-verification=${var.google_site_verification_token}\""]
}
