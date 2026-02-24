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
resource "google_compute_url_map" "https" {
  name            = "gemini-hub-https"
  default_service = google_compute_backend_service.default.id
}

# Google-managed SSL certificate
resource "google_compute_managed_ssl_certificate" "default" {
  name = "gemihub-cert"

  managed {
    domains = [var.domain]
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.apis]
}

# HTTPS proxy
resource "google_compute_target_https_proxy" "default" {
  name             = "gemini-hub-https-proxy"
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.default.id]
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
