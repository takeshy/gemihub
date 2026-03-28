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

# --- Hubwork (paid plan) ---

variable "hubwork_enabled" {
  description = "Whether to provision Hubwork resources (Stripe secrets, admin credentials)"
  type        = bool
  default     = false
}

variable "stripe_secret_key" {
  description = "Stripe API secret key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook signing secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_price_id_lite" {
  description = "Stripe Price ID for the Lite plan (¥300/month)"
  type        = string
  default     = ""
}

variable "stripe_price_id_pro" {
  description = "Stripe Price ID for the Pro plan (¥2,000/month)"
  type        = string
  default     = ""
}

variable "hubwork_admin_credentials" {
  description = "Basic auth credentials for admin panel (user:password)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "hubwork_admin_emails" {
  description = "Comma-separated admin emails for admin panel access"
  type        = string
  default     = "takesy.morito@gmail.com"
}
