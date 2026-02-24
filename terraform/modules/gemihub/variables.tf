variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "project_number" {
  description = "GCP project number"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run and Artifact Registry"
  type        = string
  default     = "asia-northeast1"
}

variable "domain" {
  description = "Custom domain for the application"
  type        = string
}

variable "google_client_id" {
  description = "Google OAuth client ID"
  type        = string
  sensitive   = true
}

variable "google_client_secret" {
  description = "Google OAuth client secret"
  type        = string
  sensitive   = true
}

variable "session_secret" {
  description = "Session encryption secret"
  type        = string
  sensitive   = true
}

variable "google_site_verification_token" {
  description = "Google site verification token (without the 'google-site-verification=' prefix). Empty disables TXT record."
  type        = string
  default     = ""
}

variable "manage_dns" {
  description = "Whether to create a Cloud DNS zone and records for the domain"
  type        = bool
  default     = true
}

variable "manage_bigquery_views" {
  description = "Whether to create BigQuery views (requires log table to exist)"
  type        = bool
  default     = true
}

variable "cpu_idle" {
  description = "Whether to deallocate CPU when no requests are being processed"
  type        = bool
  default     = true
}

variable "root_folder_name" {
  description = "Google Drive root folder name for the application"
  type        = string
  default     = "gemihub"
}

