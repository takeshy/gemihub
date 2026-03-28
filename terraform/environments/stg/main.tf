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
  description = "Google site verification token"
  type        = string
  default     = ""
}

# --- Hubwork (paid plan) ---

variable "hubwork_enabled" {
  type    = bool
  default = false
}

variable "stripe_secret_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "stripe_webhook_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "stripe_price_id_lite" {
  type    = string
  default = ""
}

variable "stripe_price_id_pro" {
  type    = string
  default = ""
}

variable "hubwork_admin_credentials" {
  type      = string
  sensitive = true
  default   = ""
}

variable "hubwork_admin_emails" {
  type    = string
  default = "takesy.morito@gmail.com"
}

# --------------- Module ---------------

module "gemihub" {
  source = "../../modules/gemihub"

  project_id                     = var.project_id
  project_number                 = var.project_number
  region                         = var.region
  domain                         = var.domain
  google_client_id               = var.google_client_id
  google_client_secret           = var.google_client_secret
  session_secret                 = var.session_secret
  google_site_verification_token = var.google_site_verification_token
  manage_bigquery_views          = false
  root_folder_name               = "gemihub"

  # Hubwork
  hubwork_enabled           = var.hubwork_enabled
  stripe_secret_key         = var.stripe_secret_key
  stripe_webhook_secret     = var.stripe_webhook_secret
  stripe_price_id_lite      = var.stripe_price_id_lite
  stripe_price_id_pro       = var.stripe_price_id_pro
  hubwork_admin_credentials = var.hubwork_admin_credentials
  hubwork_admin_emails      = var.hubwork_admin_emails
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

output "nameservers" {
  description = "Set these nameservers at your domain registrar"
  value       = module.gemihub.nameservers
}
