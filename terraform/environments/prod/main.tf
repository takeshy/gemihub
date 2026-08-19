terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# --------------- Variables (pass-through) ---------------

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "project_number" {
  description = "GCP project number"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "asia-northeast1"
}

variable "domain" {
  description = "Custom domain for the application"
  type        = string
}

variable "google_site_verification_token" {
  description = "Google site verification token"
  type        = string
  default     = ""
}

variable "hubwork_review_slugs" {
  description = "Account slugs that bypass Stripe and receive a granted Pro account."
  type        = list(string)
  default     = []
}

variable "manage_firestore_indexes" {
  description = "Whether to manage the Firestore indexes required by the organization features."
  type        = bool
  default     = false
}

variable "firestore_database_id" {
  description = "Firestore database the app uses (matches FIRESTORE_DATABASE_ID)."
  type        = string
  default     = "(default)"
}

# --------------- Module ---------------

module "gemihub" {
  source = "../../modules/gemihub"

  project_id                     = var.project_id
  project_number                 = var.project_number
  region                         = var.region
  domain                         = var.domain
  google_site_verification_token = var.google_site_verification_token
  cpu_idle                       = false
  hubwork_review_slugs           = var.hubwork_review_slugs
  hubwork_stripe_allowed_slugs   = ["takeshy"]
  manage_firestore_indexes       = var.manage_firestore_indexes
  firestore_database_id          = var.firestore_database_id
}

# --------------- Outputs ---------------

output "load_balancer_ip" {
  description = "Global static IP address for DNS A record"
  value       = module.gemihub.load_balancer_ip
}

output "cloud_run_url" {
  description = "Cloud Run service URL"
  value       = module.gemihub.cloud_run_url
}

output "gemihub_okf_bucket" {
  description = "Private Cloud Storage bucket for managed GemiHub OKF releases"
  value       = module.gemihub.gemihub_okf_bucket
}

output "nameservers" {
  description = "Set these nameservers at your domain registrar"
  value       = module.gemihub.nameservers
}
