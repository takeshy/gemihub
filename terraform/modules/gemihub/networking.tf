# Static global IP
resource "google_compute_global_address" "default" {
  name = "gemini-hub-ip"

  depends_on = [google_project_service.apis]
}

# Serverless NEG → Cloud Run
resource "google_compute_region_network_endpoint_group" "cloud_run" {
  name                  = "gemini-hub-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.app.name
  }

  depends_on = [google_project_service.apis]
}

# Backend service
resource "google_compute_backend_service" "default" {
  name                  = "gemini-hub-backend"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.cloud_run.id
  }

  enable_cdn = true

  cdn_policy {
    cache_mode                   = "USE_ORIGIN_HEADERS"
    signed_url_cache_max_age_sec = 0
  }
}

# HTTPS URL map
# All Host headers fall through to the default service; SNI-based cert
# selection in the HTTPS proxy's certificate map handles per-domain certs.
resource "google_compute_url_map" "https" {
  name            = "gemini-hub-https"
  default_service = google_compute_backend_service.default.id
}

# --- Certificate Manager (supports dynamic custom domain certs) ---

resource "google_certificate_manager_certificate_map" "default" {
  name = "gemihub-map"

  depends_on = [google_project_service.apis]
}

# --- Primary domain (gemihub.net) certificates ---

resource "google_certificate_manager_dns_authorization" "primary" {
  name   = "gemihub-net-dns-auth"
  domain = var.domain

  depends_on = [google_project_service.apis]
}

resource "google_certificate_manager_certificate" "primary_main" {
  name = "gemihub-net-main-cert"

  managed {
    domains            = [var.domain]
    dns_authorizations = [google_certificate_manager_dns_authorization.primary.id]
  }

  depends_on = [google_project_service.apis]
}

resource "google_certificate_manager_certificate_map_entry" "primary_main" {
  name         = "gemihub-net-main-entry"
  map          = google_certificate_manager_certificate_map.default.name
  hostname     = var.domain
  certificates = [google_certificate_manager_certificate.primary_main.id]
}

# Wildcard certificate for slug subdomains (*.gemihub.net).
# The DNS authorization for the apex covers the wildcard without needing a
# separate authorization record.
resource "google_certificate_manager_certificate" "primary_wildcard" {
  name = "gemihub-net-wildcard-cert"

  managed {
    domains            = ["*.${var.domain}"]
    dns_authorizations = [google_certificate_manager_dns_authorization.primary.id]
  }

  depends_on = [google_project_service.apis]
}

resource "google_certificate_manager_certificate_map_entry" "primary_wildcard" {
  name         = "gemihub-net-wildcard-entry"
  map          = google_certificate_manager_certificate_map.default.name
  hostname     = "*.${var.domain}"
  certificates = [google_certificate_manager_certificate.primary_wildcard.id]
}

# --- Legacy domain (gemihub.online) certificates, 60-day 301 redirect window ---
# TODO(2026-06-25): remove these resources together with the legacy_domain
# variable and the moved blocks below.

resource "google_certificate_manager_dns_authorization" "legacy" {
  count = var.legacy_domain != "" ? 1 : 0

  name   = "gemihub-dns-auth"
  domain = var.legacy_domain

  depends_on = [google_project_service.apis]
}

resource "google_certificate_manager_certificate" "legacy_main" {
  count = var.legacy_domain != "" ? 1 : 0

  name = "gemihub-main-cert"

  managed {
    domains            = [var.legacy_domain]
    dns_authorizations = [google_certificate_manager_dns_authorization.legacy[0].id]
  }

  depends_on = [google_project_service.apis]
}

resource "google_certificate_manager_certificate_map_entry" "legacy_main" {
  count = var.legacy_domain != "" ? 1 : 0

  name         = "gemihub-main-entry"
  map          = google_certificate_manager_certificate_map.default.name
  hostname     = var.legacy_domain
  certificates = [google_certificate_manager_certificate.legacy_main[0].id]
}

resource "google_certificate_manager_certificate" "legacy_wildcard" {
  count = var.legacy_domain != "" ? 1 : 0

  name = "gemihub-wildcard-cert"

  managed {
    domains            = ["*.${var.legacy_domain}"]
    dns_authorizations = [google_certificate_manager_dns_authorization.legacy[0].id]
  }

  depends_on = [google_project_service.apis]
}

resource "google_certificate_manager_certificate_map_entry" "legacy_wildcard" {
  count = var.legacy_domain != "" ? 1 : 0

  name         = "gemihub-wildcard-entry"
  map          = google_certificate_manager_certificate_map.default.name
  hostname     = "*.${var.legacy_domain}"
  certificates = [google_certificate_manager_certificate.legacy_wildcard[0].id]
}

# --- State migrations (rename existing .online resources to legacy_*) ---
# The original main/wildcard cert resources had no count; the new legacy_* are
# count-gated on var.legacy_domain. Each `to` therefore needs an explicit `[0]`
# so terraform recognises the move instead of destroying + recreating.
# TODO(2026-06-25): drop these moved blocks with the legacy resources.

moved {
  from = google_certificate_manager_dns_authorization.main
  to   = google_certificate_manager_dns_authorization.legacy[0]
}

moved {
  from = google_certificate_manager_certificate.main
  to   = google_certificate_manager_certificate.legacy_main[0]
}

moved {
  from = google_certificate_manager_certificate_map_entry.main
  to   = google_certificate_manager_certificate_map_entry.legacy_main[0]
}

moved {
  from = google_certificate_manager_certificate.wildcard
  to   = google_certificate_manager_certificate.legacy_wildcard[0]
}

moved {
  from = google_certificate_manager_certificate_map_entry.wildcard
  to   = google_certificate_manager_certificate_map_entry.legacy_wildcard[0]
}

# HTTPS proxy (uses Certificate Map for dynamic custom domain certs)
resource "google_compute_target_https_proxy" "default" {
  name            = "gemini-hub-https-proxy"
  url_map         = google_compute_url_map.https.id
  certificate_map = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.default.id}"
}

# HTTPS forwarding rule (port 443)
resource "google_compute_global_forwarding_rule" "https" {
  name                  = "gemini-hub-https-rule"
  target                = google_compute_target_https_proxy.default.id
  port_range            = "443"
  ip_address            = google_compute_global_address.default.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# --- HTTP → HTTPS redirect ---

resource "google_compute_url_map" "http_redirect" {
  name = "gemini-hub-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }

  depends_on = [google_project_service.apis]
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "gemini-hub-http-proxy"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  name                  = "gemini-hub-http-rule"
  target                = google_compute_target_http_proxy.redirect.id
  port_range            = "80"
  ip_address            = google_compute_global_address.default.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
