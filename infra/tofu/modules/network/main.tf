# Private network of one environment (EVM-007 AC1; ADR-0011, ADR-0018). EU network zone only.
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

variable "ip_range" {
  description = "Private IPv4 range of the network (RFC 1918)."
  type        = string
  default     = "10.40.0.0/16"
}

variable "subnet_range" {
  description = "Private IPv4 range of the subnet of the VMs."
  type        = string
  default     = "10.40.1.0/24"
}

resource "hcloud_network" "this" {
  name     = "${var.name}-net"
  ip_range = var.ip_range
}

resource "hcloud_network_subnet" "vms" {
  network_id   = hcloud_network.this.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = var.subnet_range
}

output "network_id" {
  value = hcloud_network.this.id
}

output "subnet_id" {
  value = hcloud_network_subnet.vms.id
}
