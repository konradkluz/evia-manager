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

# What Konrad adds in OVH by hand (EVM-089 AC3): public values, no secrets. The names and the values come from Scaleway, never typed from memory.
output "dns_records" {
  description = "SPF, DKIM and DMARC of the domain as given by Scaleway TEM, and the status of its verification."
  value = {
    domain      = var.domain
    status      = scaleway_tem_domain.this.status
    spf_value   = scaleway_tem_domain.this.spf_value
    dkim_name   = scaleway_tem_domain.this.dkim_name
    dkim_config = scaleway_tem_domain.this.dkim_config
    dmarc_name  = scaleway_tem_domain.this.dmarc_name
  }
}
