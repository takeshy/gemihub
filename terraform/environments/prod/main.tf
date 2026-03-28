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
  description = "Whether to provision Hubwork resources"
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
  description = "Comma-separated admin emails"
  type        = string
  default     = "takesy.morito@gmail.com"
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
  cpu_idle                       = false

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
