variable "project_id" {
  type    = string
  default = "geminihub-486523"
}

variable "region" {
  type    = string
  default = "asia-northeast1"
}

variable "app_domain" {
  description = "gemihub management hostname, without scheme or path."
  default     = "gemihub.net"
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\\.[a-z]{2,}$", var.app_domain))
    error_message = "app_domain must be a lowercase DNS hostname."
  }
}

variable "site_domain" {
  description = "Storefront suffix; wildcard DNS and certificate are created for this hostname."
  default     = "shops.gemihub.net"
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\\.[a-z]{2,}$", var.site_domain))
    error_message = "site_domain must be a lowercase DNS hostname."
  }
}

variable "dns_project_id" {
  description = "Project owning the existing Cloud DNS zone."
  type        = string
}

variable "dns_zone" {
  description = "Existing Cloud DNS managed zone containing both hostnames."
  type        = string
}

variable "google_client_id" {
  description = "Explicit OAuth client ID, used only when google_client_id_secret_ref is null."
  type        = string
  default     = ""
}

variable "vertex_model" {
  description = "Explicit text model available to this project."
  type        = string
}

variable "image_model" {
  description = "Explicit image model available to this project."
  type        = string
}

variable "vertex_location" {
  type    = string
  default = "global"
}

variable "image_location" {
  type    = string
  default = "global"
}

variable "database_id" {
  description = "Dedicated database; never import or repurpose kiokuflow's database."
  type        = string
  default     = "gemihub"
  validation {
    condition     = var.database_id != "(default)"
    error_message = "Use a named database to keep existing application data separate."
  }
}

variable "shared_project_id" {
  type    = string
  default = "geminihub-486523"
}

variable "certificate_map" {
  type    = string
  default = "gemihub-map"
}

variable "load_balancer_address" {
  type    = string
  default = "gemini-hub-ip"
}

variable "repository" {
  description = "Optional existing Cloud Build v2 repository resource name; empty disables automatic deployment. GitHub installation/consent is configured separately."
  type        = string
  default     = ""
}

variable "deploy_branch" {
  type    = string
  default = "^main$"
}

variable "memory" {
  description = "Container memory cap on the shared VM; review host headroom before installation."
  type        = string
  default     = "768m"
}

variable "session_secret_version" {
  description = "Pin versions after creating the initial Secret Manager payloads. Keep the session key stable."
  type        = string
  default     = "1"
}

variable "oauth_secret_version" {
  type    = string
  default = "1"
}

variable "paypal_client_id" {
  description = "Optional PayPal client ID for the server's receiving account. Empty disables credential provisioning."
  type        = string
  default     = ""
}

variable "paypal_environment" {
  type    = string
  default = "sandbox"
  validation {
    condition     = contains(["sandbox", "live"], var.paypal_environment)
    error_message = "Use sandbox or live."
  }
}

variable "paypal_secret_version" {
  description = "Pinned version of gemihub-web-paypal-client-secret; the payload is managed outside Terraform."
  type        = string
  default     = "1"
}

variable "google_client_id_secret_ref" {
  description = "Existing Google OAuth client ID secret. Set null to use google_client_id."
  type = object({
    project = string
    name    = string
    version = string
  })
  default = {
    project = "495062043717"
    name    = "google-client-id"
    version = "1"
  }
}

variable "google_client_secret_ref" {
  description = "Existing Google OAuth client secret. Set null to use gemihub-web-google-client-secret."
  type = object({
    project = string
    name    = string
    version = string
  })
  default = {
    project = "495062043717"
    name    = "google-client-secret"
    version = "1"
  }
}
