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
