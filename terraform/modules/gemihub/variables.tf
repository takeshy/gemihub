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

# Legacy domain in 60-day 301 redirect window. Empty disables all legacy
# resources (DNS zone, records, cert, cert map entries).
# TODO(2026-06-25): remove this variable and the legacy_* resources after the
# 60-day overlap window ends.
variable "legacy_domain" {
  description = "Legacy domain in 301-redirect window. Empty disables legacy resources."
  type        = string
  default     = ""
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

variable "hubwork_review_slugs" {
  description = "Account slugs that bypass Stripe and receive a granted Pro account. Used for Google OAuth verification review."
  type        = list(string)
  default     = []
}

variable "hubwork_stripe_allowed_slugs" {
  description = "Account slugs allowed to proceed to Stripe checkout for new Pro subscriptions. Any other slug returns a 'currently unavailable' response."
  type        = list(string)
  default     = []
}

