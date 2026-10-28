# Hetzner Cloud firewall of the VM (EVM-007 AC1; SR-INFRA-01, ADR-0018; security-engineer A1, P9).
# Inbound: 80/443 from anywhere (HTTP-01 challenge and HTTPS); 22 only from var.admin_ssh_cidrs (empty by default —
# opened for an IaC session and closed again with an empty list). Outbound: any `out` rule makes Hetzner drop the rest,
# so only 443/tcp (images, packages, GitHub API, ACME), 53/udp+tcp (DNS) and 123/udp (NTP) leave the VM.
# EVM-084: the SFTP port of the Storage Box (23/tcp, the media copy) only to var.storagebox_cidrs (empty by default = no rule).
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

variable "admin_ssh_cidrs" {
  description = "Administrator source addresses for SSH (port 22) during an IaC session; empty = port 22 closed."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for cidr in var.admin_ssh_cidrs : can(cidrhost(cidr, 0))])
    error_message = "admin_ssh_cidrs must contain CIDR ranges only."
  }
  validation {
    condition     = !anytrue([for cidr in var.admin_ssh_cidrs : contains(["0.0.0.0/0", "::/0"], cidr)])
    error_message = "SSH is never open to the whole internet."
  }
}

variable "storagebox_cidrs" {
  description = "Addresses of the Hetzner Storage Box (SFTP, port 23, the daily media copy of EVM-084); empty = no rule, so no copy."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for cidr in var.storagebox_cidrs : can(cidrhost(cidr, 0))])
    error_message = "storagebox_cidrs must contain CIDR ranges only."
  }
  validation {
    condition     = !anytrue([for cidr in var.storagebox_cidrs : contains(["0.0.0.0/0", "::/0"], cidr)])
    error_message = "The SFTP port is never open to the whole internet."
  }
}

locals {
  anywhere = ["0.0.0.0/0", "::/0"]
  outbound = [
    { protocol = "tcp", port = "443", description = "HTTPS (registries, packages, GitHub API, ACME)" },
    { protocol = "tcp", port = "53", description = "DNS over TCP" },
    { protocol = "udp", port = "53", description = "DNS" },
    { protocol = "udp", port = "123", description = "NTP" },
  ]
}

resource "hcloud_firewall" "this" {
  name = "${var.name}-fw"

  rule {
    description = "HTTP (ACME HTTP-01, redirect to HTTPS)"
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = local.anywhere
  }

  rule {
    description = "HTTPS"
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = local.anywhere
  }

  dynamic "rule" {
    for_each = length(var.admin_ssh_cidrs) > 0 ? [var.admin_ssh_cidrs] : []
    content {
      description = "SSH of the administrator (IaC session only)"
      direction   = "in"
      protocol    = "tcp"
      port        = "22"
      source_ips  = rule.value
    }
  }

  dynamic "rule" {
    for_each = length(var.storagebox_cidrs) > 0 ? [var.storagebox_cidrs] : []
    content {
      description     = "SFTP to the Storage Box (media copy)"
      direction       = "out"
      protocol        = "tcp"
      port            = "23"
      destination_ips = rule.value
    }
  }

  dynamic "rule" {
    for_each = local.outbound
    content {
      description     = rule.value.description
      direction       = "out"
      protocol        = rule.value.protocol
      port            = rule.value.port
      destination_ips = local.anywhere
    }
  }
}

output "firewall_id" {
  value = hcloud_firewall.this.id
}
