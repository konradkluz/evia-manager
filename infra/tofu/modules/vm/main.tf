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

variable "work_volume_size" {
  description = "Size of the encrypted work volume in GB (EVM-084; RR-75, RR-76): one Hetzner Volume, two partitions - the films (15 GiB) and the scratch space of clamd (the rest, >= 2.5 GB). Given by the root; 20 is the planned value."
  type        = number
  validation {
    condition     = var.work_volume_size >= 20 && var.work_volume_size <= 100
    error_message = "Work volume 20-100 GB (15 GiB of films plus at least 2.5 GB of scratch space of clamd)."
  }
}

variable "clamav_uid_gid" {
  description = "uid:gid of the user of clamd in the pinned clamav/clamav-debian image (EVM-084 L8): the owner of the scratch space /var/lib/evia/clamav-scan (mode 0700). Read in the IaC session; no default."
  type        = string
  validation {
    condition     = can(regex("^[1-9][0-9]{0,5}:[1-9][0-9]{0,5}$", var.clamav_uid_gid))
    error_message = "uid:gid of the user of clamd, e.g. 100:101 (numbers only, not root)."
  }
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

variable "buildx_version" {
  description = "Exact docker-buildx-plugin package version (BuildKit build of the deploy-agent image on the VM)."
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

# EVM-084 (decision of Konrad 2026-11-12): the work volumes of the films and of the scan on a volume of their own, encrypted on the VM with an ephemeral key
# (docs/ops/runbooks/media-processor.md "Montaże dm-crypt"). Hetzner does not format it (no `format`): a file system made outside would be readable without the key.
resource "hcloud_volume" "work" {
  name              = "${var.name}-media-work"
  location          = var.location
  size              = var.work_volume_size
  delete_protection = true
  labels = {
    purpose = "media-work"
    env     = var.name
  }
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
    admin_user              = var.admin_user
    admin_ssh_public_key    = var.admin_ssh_public_key
    data_volume_id          = hcloud_volume.data.id
    work_volume_id          = hcloud_volume.work.id
    clamav_uid_gid          = var.clamav_uid_gid
    work_volumes_script_b64 = filebase64("${path.module}/templates/evia-work-volumes.sh")
    docker_version          = var.docker_version
    compose_plugin_version  = var.compose_plugin_version
    containerd_version      = var.containerd_version
    buildx_version          = var.buildx_version
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

resource "hcloud_volume_attachment" "work" {
  volume_id = hcloud_volume.work.id
  server_id = hcloud_server.this.id
  automount = false
}

output "work_volume_id" {
  description = "Id of the work volume (not a secret): the device of an existing VM is /dev/disk/by-id/scsi-0HC_Volume_<id> (runbook media-processor.md)."
  value       = hcloud_volume.work.id
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
