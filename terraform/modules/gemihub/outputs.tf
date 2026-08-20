output "load_balancer_ip" {
  description = "Global static IP address for DNS A record"
  value       = google_compute_global_address.default.address
}

output "cloud_run_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_v2_service.app.uri
}

output "gemihub_okf_bucket" {
  description = "Private Cloud Storage bucket for managed GemiHub OKF releases"
  value       = google_storage_bucket.gemihub_okf.name
}

output "tenant_data_bucket" {
  description = "Private Cloud Storage bucket for organization project data"
  value       = google_storage_bucket.tenant_data.name
}

output "nameservers" {
  description = "Set these nameservers at your domain registrar (Onamae.com)"
  value       = var.manage_dns ? google_dns_managed_zone.primary[0].name_servers : []
}

# Legacy domain nameservers (60-day 301 redirect window).

output "cloud_run_service_account_email" {
  description = "Cloud Run service account email"
  value       = google_service_account.cloud_run.email
}
