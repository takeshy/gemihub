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

variable "manage_firestore_indexes" {
  description = "Whether to manage the Firestore indexes required by the organization features (requires an existing Firestore database)."
  type        = bool
  default     = false
}

variable "firestore_database_id" {
  description = "Firestore database the app uses (matches FIRESTORE_DATABASE_ID; \"(default)\" when unset)."
  type        = string
  default     = "(default)"
}

variable "super_admin_emails" {
  description = "Service administrators: access to /admin/enterprise and cross-organization operations. Empty disables the console entirely."
  type        = list(string)
  default     = []
}

variable "gcs_bucket_name" {
  description = "Bucket holding organization project files. Empty makes provisioning fall back to gemihub-{orgId}, which will not exist."
  type        = string
  default     = ""
}

variable "default_tenant_region" {
  description = "Region for organization tenants (Vertex AI location; GCS bucket lives wherever it was created)."
  type        = string
  default     = ""
}
