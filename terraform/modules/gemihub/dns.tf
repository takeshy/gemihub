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
# TODO(2026-06-25): remove these resources together with the legacy_domain
# variable and the moved blocks below.

resource "google_dns_managed_zone" "legacy" {
  count = var.manage_dns && var.legacy_domain != "" ? 1 : 0

  name        = "gemihub-online"
  dns_name    = "${var.legacy_domain}."
  description = "DNS zone for ${var.legacy_domain} (legacy, 301-redirected)"

  depends_on = [google_project_service.apis]
}

resource "google_dns_record_set" "legacy_a" {
  count = var.manage_dns && var.legacy_domain != "" ? 1 : 0

  name         = "${var.legacy_domain}."
  type         = "A"
  ttl          = 300
  managed_zone = google_dns_managed_zone.legacy[0].name
  rrdatas      = [google_compute_global_address.default.address]
}

resource "google_dns_record_set" "legacy_wildcard_a" {
  count = var.manage_dns && var.legacy_domain != "" ? 1 : 0

  name         = "*.${var.legacy_domain}."
  type         = "A"
  ttl          = 300
  managed_zone = google_dns_managed_zone.legacy[0].name
  rrdatas      = [google_compute_global_address.default.address]
}

resource "google_dns_record_set" "legacy_cert_validation" {
  count = var.manage_dns && var.legacy_domain != "" ? 1 : 0

  name         = google_certificate_manager_dns_authorization.legacy[0].dns_resource_record[0].name
  type         = google_certificate_manager_dns_authorization.legacy[0].dns_resource_record[0].type
  ttl          = 300
  managed_zone = google_dns_managed_zone.legacy[0].name
  rrdatas      = [google_certificate_manager_dns_authorization.legacy[0].dns_resource_record[0].data]
}

# --- State migrations (rename existing .online resources to legacy_*) ---
# The existing default/a/wildcard_a/cert_validation resources used to map to
# `.online`. Now `.online` lives at legacy_* and `.net` lives at primary_*.
# The old txt_verification record is intentionally not moved — applying this
# plan will destroy the .online TXT record (Search Console verification on
# .online is lost; .net needs a fresh property).
# TODO(2026-06-25): drop these moved blocks together with the legacy resources.

moved {
  from = google_dns_managed_zone.default
  to   = google_dns_managed_zone.legacy
}

moved {
  from = google_dns_record_set.a
  to   = google_dns_record_set.legacy_a
}

moved {
  from = google_dns_record_set.wildcard_a
  to   = google_dns_record_set.legacy_wildcard_a
}

moved {
  from = google_dns_record_set.cert_validation
  to   = google_dns_record_set.legacy_cert_validation
}
