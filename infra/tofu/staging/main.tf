# Staging in the EU (EVM-007 AC1; ADR-0011, ADR-0018): network, firewall, VM with the data volume, TEM domain.
# Run only in the iac container in an IaC session (docker compose -f compose.iac.yaml run --rm iac …); CI runs only
# tofu fmt -check, tofu validate without a backend and Trivy (iac-check). Credentials (HCLOUD_TOKEN, SCW_*, the S3 keys
# of the state backend, the state passphrase) come from the mounted file outside the repository, never from this code.
terraform {
  required_version = "~> 1.13.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "1.70.0"
    }
    scaleway = {
      source  = "scaleway/scaleway"
      version = "2.87.0"
    }
  }

  # Remote state in the bucket created by ../bootstrap (Scaleway Object Storage, S3 API); bucket and keys are passed at
  # init time (-backend-config from the iac container), never written here.
  backend "s3" {
    key                         = "staging/terraform.tfstate"
    region                      = "pl-waw"
    endpoints                   = { s3 = "https://s3.pl-waw.scw.cloud" }
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
    use_lockfile                = true
  }

  # State and plan encrypted, enforced (security-engineer B; SR-INFRA-14).
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

provider "hcloud" {}

provider "scaleway" {
  region     = "fr-par"
  project_id = var.scaleway_project_id
}

# Object Storage in pl-waw (ADR-0009, ADR-0011); the default provider (fr-par) stays for TEM.
provider "scaleway" {
  alias      = "waw"
  region     = "pl-waw"
  project_id = var.scaleway_project_id
}

locals {
  name = "evia-staging"
}

module "network" {
  source = "../modules/network"
  name   = local.name
}

module "firewall" {
  source           = "../modules/firewall"
  name             = local.name
  admin_ssh_cidrs  = var.admin_ssh_cidrs
  storagebox_cidrs = var.storagebox_cidrs
}

module "vm" {
  source                 = "../modules/vm"
  name                   = local.name
  server_type            = var.server_type
  location               = var.location
  admin_ssh_public_key   = var.admin_ssh_public_key
  data_volume_size       = 10
  network_id             = module.network.network_id
  firewall_id            = module.firewall.firewall_id
  docker_version         = "5:29.9.2-1~debian.13~trixie"
  containerd_version     = "2.4.2-3~debian.13~trixie"
  compose_plugin_version = "5.6.0-1~debian.13~trixie"
  buildx_version         = "0.38.1-1~debian.13~trixie"
  depends_on             = [module.network]
}

module "tem" {
  source     = "../modules/tem"
  domain     = "staging.eviacharge.pl"
  project_id = var.scaleway_project_id
  region     = "fr-par"
}

# EVM-084: buckets, IAM applications and bucket policies. Inactive until the IaC session (new paid resources, apply with Konrad).
module "object_storage" {
  source             = "../modules/object-storage"
  providers          = { scaleway = scaleway.waw }
  project_id         = var.scaleway_project_id
  region             = "pl-waw"
  panel_origin       = var.panel_origin
  iac_application_id = var.iac_application_id
}

output "ipv4" {
  description = "Public IPv4 for the A record (set by Konrad in OVH)."
  value       = module.vm.ipv4
}

output "ipv6" {
  description = "Public IPv6 for the AAAA record (set by Konrad in OVH)."
  value       = module.vm.ipv6
}

output "object_storage_buckets" {
  description = "Bucket names for the runtime configuration."
  value       = module.object_storage.buckets
}

output "object_storage_application_ids" {
  description = "Scaleway IAM applications of the buckets (not secrets); API keys are created by hand in the IaC session."
  value       = module.object_storage.application_ids
}
