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

variable "scaleway_organization_id" {
  description = "Scaleway organization of the project evia-staging (IAM applications and policies are organization resources)."
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.scaleway_organization_id))
    error_message = "scaleway_organization_id must be the UUID of the Scaleway organization."
  }
}

variable "server_type" {
  description = "Hetzner server type of the staging VM, Arm64 only (Q1, 2026-10-21: cax11 recommended — 2 vCPU, 4 GB; cax21 — 4 vCPU, 8 GB, if ClamAV, PostgreSQL and the API do not fit in 4 GB)."
  type        = string
  validation {
    condition     = contains(["cax11", "cax21", "cax31", "cax41"], var.server_type)
    error_message = "Arm64 (CAX) server types only: cax11, cax21, cax31, cax41 — the images are linux/arm64."
  }
}

variable "clamav_uid_gid" {
  description = "uid:gid of the user of clamd in the pinned clamav/clamav-debian image (EVM-084 L8; read in the IaC session, see docs/ops/runbooks/media-processor.md)."
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

variable "storagebox_cidrs" {
  description = "Addresses of the Hetzner Storage Box for the SFTP port 23 of the media copy (EVM-084); empty = the port stays closed. Given in the IaC session."
  type        = list(string)
  default     = []
}

variable "panel_origin" {
  description = "Exact https origin of the web panel allowed to PUT media with a presigned URL (CORS); recommended https://staging.eviacharge.pl (EVM-084 D6)."
  type        = string
}

variable "iac_application_id" {
  description = "Scaleway IAM application of the IaC session; kept in every bucket policy so the session is never locked out."
  type        = string
}
