# Variables of staging (EVM-007 AC1). No default looks like a production value (architect 23): the server type (Q1),
# the administrator addresses (Q2) and key are given in ../.evia-iac/staging.tfvars in the IaC session.

variable "state_passphrase" {
  description = "Passphrase of the state encryption (from the iac container environment)."
  type        = string
  sensitive   = true
}

variable "scaleway_project_id" {
  description = "Scaleway project evia-staging."
  type        = string
}

variable "server_type" {
  description = "Hetzner server type of the staging VM (Q1: CX33 recommended, CX23 per ADR-0011)."
  type        = string
}

variable "location" {
  description = "Hetzner location of the staging VM (EU)."
  type        = string
}

variable "admin_ssh_public_key" {
  description = "Public SSH key of the administrator."
  type        = string
}

variable "admin_ssh_cidrs" {
  description = "Administrator addresses for SSH during an IaC session; empty = port 22 closed (Q2)."
  type        = list(string)
  default     = []
}
