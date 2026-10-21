# Bootstrap of an environment (EVM-007 AC1; ADR-0018 IaC; plan P12): the private, versioned Scaleway bucket for the
# OpenTofu state of infra/tofu/staging. Its own state is local, encrypted, and lives outside the repository
# (../.evia-iac/, passed by the iac container) — the chicken-and-egg step of the first IaC session only.
# Credentials come from the environment of the iac container (SCW_*), never from a file in the repository.
terraform {
  required_version = "~> 1.13.0"

  required_providers {
    scaleway = {
      source  = "scaleway/scaleway"
      version = "2.87.0"
    }
  }

  # Local state outside the repository (the iac container mounts ../.evia-iac/state at /iac/state).
  backend "local" {
    path = "/iac/state/bootstrap.tfstate"
  }

  # State and plan encrypted, enforced (security-engineer B; SR-INFRA-14): an unencrypted state is refused.
  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }
    state {
      method   = method.aes_gcm.state
      enforced = true
    }
    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}

provider "scaleway" {
  region     = var.region
  project_id = var.project_id
}

variable "state_passphrase" {
  description = "Passphrase of the state encryption (from the iac container environment; Konrad's password manager)."
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "Scaleway project of the environment (evia-staging)."
  type        = string
}

variable "region" {
  description = "Scaleway region of the state bucket (EU)."
  type        = string
  default     = "pl-waw"
  validation {
    condition     = contains(["fr-par", "nl-ams", "pl-waw"], var.region)
    error_message = "EU regions only."
  }
}

variable "state_bucket" {
  description = "Name of the state bucket (globally unique)."
  type        = string
}

resource "scaleway_object_bucket" "state" {
  name          = var.state_bucket
  region        = var.region
  project_id    = var.project_id
  force_destroy = false

  versioning {
    enabled = true
  }

  tags = {
    purpose = "opentofu-state"
  }
}

resource "scaleway_object_bucket_acl" "state" {
  bucket = scaleway_object_bucket.state.id
  region = var.region
  acl    = "private"
}

output "state_bucket" {
  value = scaleway_object_bucket.state.name
}
