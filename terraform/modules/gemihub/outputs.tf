output "load_balancer_ip" {
  description = "Global static IP address for DNS A record"
  value       = google_compute_global_address.default.address
}

output "cloud_run_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_v2_service.app.uri
}

output "nameservers" {
  description = "Set these nameservers at your domain registrar (Onamae.com)"
  value       = var.manage_dns ? google_dns_managed_zone.default[0].name_servers : []
}

output "cloud_run_service_account_email" {
  description = "Cloud Run service account email"
  value       = google_service_account.cloud_run.email
}
