# --- Primary domain DNS (gemihub.net) ---

resource "google_dns_managed_zone" "primary" {
  count = var.manage_dns ? 1 : 0

  name        = "gemihub-net"
  dns_name    = "${var.domain}."
  description = "DNS zone for ${var.domain}"

  depends_on = [google_project_service.apis]
}

resource "google_dns_record_set" "primary_a" {
  count = var.manage_dns ? 1 : 0

  name         = "${var.domain}."
  type         = "A"
  ttl          = 300
  managed_zone = google_dns_managed_zone.primary[0].name
  rrdatas      = [google_compute_global_address.default.address]
}

# Wildcard A record so slug subdomains (e.g. takeshy.gemihub.net) resolve
# to the same LB IP. Cloud Run identifies the account from the Host header.
resource "google_dns_record_set" "primary_wildcard_a" {
  count = var.manage_dns ? 1 : 0

  name         = "*.${var.domain}."
  type         = "A"
  ttl          = 300
  managed_zone = google_dns_managed_zone.primary[0].name
  rrdatas      = [google_compute_global_address.default.address]
}

# CNAME record for Certificate Manager DNS authorization
resource "google_dns_record_set" "primary_cert_validation" {
  count = var.manage_dns ? 1 : 0

  name         = google_certificate_manager_dns_authorization.primary.dns_resource_record[0].name
  type         = google_certificate_manager_dns_authorization.primary.dns_resource_record[0].type
  ttl          = 300
  managed_zone = google_dns_managed_zone.primary[0].name
  rrdatas      = [google_certificate_manager_dns_authorization.primary.dns_resource_record[0].data]
}

resource "google_dns_record_set" "primary_txt_verification" {
  count = var.manage_dns && var.google_site_verification_token != "" ? 1 : 0

  name         = "${var.domain}."
  type         = "TXT"
  ttl          = 300
  managed_zone = google_dns_managed_zone.primary[0].name
  rrdatas      = ["\"google-site-verification=${var.google_site_verification_token}\""]
}

# --- Legacy domain DNS (gemihub.online, 60-day 301 redirect window) ---
