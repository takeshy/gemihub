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

# DNS authorization for certificate validation
resource "google_certificate_manager_dns_authorization" "main" {
  name   = "gemihub-dns-auth"
  domain = var.domain

  depends_on = [google_project_service.apis]
}

# Main domain certificate (Google-managed, DNS-authorized)
resource "google_certificate_manager_certificate" "main" {
  name = "gemihub-main-cert"

  managed {
    domains            = [var.domain]
    dns_authorizations = [google_certificate_manager_dns_authorization.main.id]
  }

  depends_on = [google_project_service.apis]
}

# Certificate map entry for main domain
resource "google_certificate_manager_certificate_map_entry" "main" {
  name         = "gemihub-main-entry"
  map          = google_certificate_manager_certificate_map.default.name
  hostname     = var.domain
  certificates = [google_certificate_manager_certificate.main.id]
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
