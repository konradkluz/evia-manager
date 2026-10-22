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
  description = "Hetzner server type of the staging VM, Arm64 only (Q1, 2026-10-21: cax11 recommended — 2 vCPU, 4 GB; cax21 — 4 vCPU, 8 GB, if ClamAV, PostgreSQL and the API do not fit in 4 GB)."
  type        = string
  validation {
    condition     = contains(["cax11", "cax21", "cax31", "cax41"], var.server_type)
    error_message = "Arm64 (CAX) server types only: cax11, cax21, cax31, cax41 — the images are linux/arm64."
  }
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
