# Scaleway Transactional Email domain of staging (EVM-007 AC5; ADR-0018 "DNS, TLS i poczta").
# Only the TEM domain object: the SPF, DKIM and DMARC records are set by Konrad in OVH by hand (no DNS token anywhere).
terraform {
  required_version = "~> 1.13.0"
  required_providers {
    scaleway = {
      source = "scaleway/scaleway"
    }
  }
}

variable "domain" {
  description = "Sending domain, e.g. staging.eviacharge.pl (never the apex domain)."
  type        = string
  validation {
    condition     = var.domain != "eviacharge.pl" && endswith(var.domain, ".eviacharge.pl")
    error_message = "TEM is configured for a subdomain of eviacharge.pl only; the apex domain stays unchanged."
  }
}

variable "project_id" {
  description = "Scaleway project of the environment (evia-staging)."
  type        = string
}

variable "region" {
  description = "Scaleway region of TEM (EU)."
  type        = string
  default     = "fr-par"
  validation {
    condition     = contains(["fr-par", "nl-ams", "pl-waw"], var.region)
    error_message = "EU regions only."
  }
}

resource "scaleway_tem_domain" "this" {
  name       = var.domain
  project_id = var.project_id
  region     = var.region
  accept_tos = true
}

output "domain_id" {
  value = scaleway_tem_domain.this.id
}
