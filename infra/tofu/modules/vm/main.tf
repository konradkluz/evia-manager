# VM of one environment with its PostgreSQL data volume (EVM-007 AC1; ADR-0011, ADR-0018; SR-INFRA-01/05/14).
# user-data holds no secret (test: tools/repo-policy iac.test.ts): the LUKS key of the data volume and every application
# secret are generated on the VM into /etc/evia/secrets (0700, files 0600 root) or copied there over administrator SSH.
terraform {
  required_version = "~> 1.13.0"
  required_providers {
    hcloud = {
      source = "hetznercloud/hcloud"
    }
  }
}

variable "name" {
  description = "Environment prefix, e.g. evia-staging."
  type        = string
}

variable "server_type" {
  description = "Hetzner server type (decided by Konrad in the IaC session, Q1): Arm64 (Ampere, CAX) only — the release and infrastructure images are linux/arm64."
  type        = string
  validation {
    condition     = contains(["cax11", "cax21", "cax31", "cax41"], var.server_type)
    error_message = "Arm64 (CAX) server types only: cax11, cax21, cax31, cax41 — the images are linux/arm64."
  }
}

variable "location" {
  description = "Hetzner location (EU only)."
  type        = string
  validation {
    condition     = contains(["nbg1", "fsn1", "hel1"], var.location)
    error_message = "EU locations only (nbg1, fsn1, hel1)."
  }
}

variable "image" {
  description = "Operating system image by name; Hetzner resolves the name to the image of the architecture of the server type (arm for CAX)."
  type        = string
  default     = "debian-13"
}

variable "admin_user" {
  description = "Login of the administrator (SSH key only, no password)."
  type        = string
  default     = "evia-admin"
}

variable "admin_ssh_public_key" {
  description = "Public SSH key of the administrator (not a secret)."
  type        = string
}

variable "data_volume_size" {
  description = "Size of the PostgreSQL data volume in GB."
  type        = number
  default     = 10
}

variable "network_id" {
  description = "Private network of the environment."
  type        = string
}

variable "private_ip" {
  description = "Private IPv4 of the VM in the subnet."
  type        = string
  default     = "10.40.1.10"
}

variable "firewall_id" {
  description = "Firewall of the VM."
  type        = string
}

variable "docker_version" {
  description = "Exact docker-ce package version (Docker apt repository)."
  type        = string
}

variable "compose_plugin_version" {
  description = "Exact docker-compose-plugin package version — the V4 allow-list is reviewed on every change."
  type        = string
}

variable "containerd_version" {
  description = "Exact containerd.io package version."
  type        = string
}

resource "hcloud_ssh_key" "admin" {
  name       = "${var.name}-admin"
  public_key = var.admin_ssh_public_key
}

resource "hcloud_volume" "data" {
  name              = "${var.name}-pgdata"
  location          = var.location
  size              = var.data_volume_size
  delete_protection = true
}

resource "hcloud_server" "this" {
  name               = var.name
  server_type        = var.server_type
  location           = var.location
  image              = var.image
  ssh_keys           = [hcloud_ssh_key.admin.id]
  firewall_ids       = [var.firewall_id]
  delete_protection  = true
  rebuild_protection = true
  backups            = false

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  network {
    network_id = var.network_id
    ip         = var.private_ip
  }

  user_data = templatefile("${path.module}/templates/user-data.yaml.tftpl", {
    admin_user             = var.admin_user
    admin_ssh_public_key   = var.admin_ssh_public_key
    data_volume_id         = hcloud_volume.data.id
    docker_version         = var.docker_version
    compose_plugin_version = var.compose_plugin_version
    containerd_version     = var.containerd_version
  })

  lifecycle {
    # A new user-data must not silently replace the VM (data volume, certificates): changes go through a reviewed plan.
    ignore_changes = [user_data, ssh_keys, image]
  }
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.this.id
  automount = false
}

output "ipv4" {
  value = hcloud_server.this.ipv4_address
}

output "ipv6" {
  value = hcloud_server.this.ipv6_address
}

output "server_id" {
  value = hcloud_server.this.id
}
