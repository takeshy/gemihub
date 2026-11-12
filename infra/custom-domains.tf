variable "custom_domains" {
  description = "Storefront hostnames with ownership verified in the app, and their existing Cloud DNS zones. Apply both shared registration outputs after adding a domain."
  type = map(object({
    dns_project_id = string
    dns_zone       = string
  }))
  default = {}
  validation {
    condition = alltrue([for host in keys(var.custom_domains) :
      length(host) <= 253 && can(regex("^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}$", host)) &&
      host != var.app_domain && host != var.site_domain && !endswith(host, ".${var.site_domain}")
    ])
    error_message = "Custom domains must be lowercase hostnames outside the existing management/storefront suffix."
  }
}

locals {
  custom_domain_names = { for host in keys(var.custom_domains) : host => "gemihub-web-custom-${substr(sha256(host), 0, 12)}" }
}

resource "google_certificate_manager_dns_authorization" "custom" {
  for_each = var.custom_domains
  provider = google.shared
  name     = local.custom_domain_names[each.key]
  domain   = each.key
  type     = "PER_PROJECT_RECORD"
}

resource "google_dns_record_set" "custom_validation" {
  for_each     = var.custom_domains
  project      = each.value.dns_project_id
  managed_zone = each.value.dns_zone
  name         = google_certificate_manager_dns_authorization.custom[each.key].dns_resource_record[0].name
  type         = "CNAME"
  ttl          = 300
  rrdatas      = [google_certificate_manager_dns_authorization.custom[each.key].dns_resource_record[0].data]
}

resource "google_certificate_manager_certificate" "custom" {
  for_each = var.custom_domains
  provider = google.shared
  name     = local.custom_domain_names[each.key]
  managed {
    domains            = [each.key]
    dns_authorizations = [google_certificate_manager_dns_authorization.custom[each.key].id]
  }
  depends_on = [google_dns_record_set.custom_validation]
}

resource "google_certificate_manager_certificate_map_entry" "custom" {
  for_each     = var.custom_domains
  provider     = google.shared
  name         = local.custom_domain_names[each.key]
  map          = var.certificate_map
  hostname     = each.key
  certificates = [google_certificate_manager_certificate.custom[each.key].id]
}

resource "google_dns_record_set" "custom" {
  for_each     = var.custom_domains
  project      = each.value.dns_project_id
  managed_zone = each.value.dns_zone
  name         = "${each.key}."
  type         = "A"
  ttl          = 300
  rrdatas      = [data.google_compute_global_address.shared.address]
}
