# Object Storage of staging (EVM-084 AC1, AC2; ADR-0009, ADR-0011; SR-INFRA-02/03/07, SR-PRIV-04): three private,
# versioned, encrypted buckets in pl-waw — media, the deletion register (the application key may only add entries) and
# the pgBackRest repository with object lock. Object lock is set at creation (Scaleway cannot add it later); dropping it
# from the media bucket needs an ADR. IAM of Scaleway works per project, so every bucket carries a policy with the
# explicit principals, a Deny of the privileged actions for every application key and a Deny for the applications that
# have no business in the bucket. The IaC application is in every policy (otherwise the session locks itself out).
# API keys are NOT created here: a secret in the state would be a leak path (TM-64); keys are created by hand in the IaC
# session, copied to /etc/evia/secrets and Bitwarden, never printed (docs/ops/runbooks/restore.md). Policies as data are
# checked by tools/repo-policy (bucketProblems); the first apply is an IaC session with Konrad (new paid resources).
terraform {
  required_providers {
    scaleway = {
      source = "scaleway/scaleway"
    }
  }
}

variable "project_id" {
  description = "Scaleway project evia-staging (the keys of the applications are limited to it)."
  type        = string
}

variable "region" {
  description = "Scaleway region of the buckets: pl-waw only (ADR-0009, ADR-0011, SR-PRIV-04); fr-par stays for TEM."
  type        = string
  default     = "pl-waw"
  validation {
    condition     = contains(["pl-waw"], var.region)
    error_message = "Personal data stays in pl-waw (ADR-0009, ADR-0011)."
  }
}

variable "panel_origin" {
  description = "The exact origin of the web panel allowed to PUT media with a presigned URL (https, no wildcard)."
  type        = string
  validation {
    condition     = startswith(var.panel_origin, "https://") && !strcontains(var.panel_origin, "*") && !endswith(var.panel_origin, "/")
    error_message = "Exactly one https origin without a wildcard and a trailing slash."
  }
}

variable "iac_application_id" {
  description = "Scaleway IAM application of the IaC session; it is in every bucket policy so the session keeps its access."
  type        = string
}

locals {
  media_bucket     = "evia-staging-media"
  register_bucket  = "evia-staging-deletion-register"
  db_backup_bucket = "evia-staging-db-backup"

  # Permission sets limit the product; the project-wide reach is narrowed by the bucket policies below.
  apps = {
    media_app = ["ObjectStorageObjectsRead", "ObjectStorageObjectsWrite", "ObjectStorageObjectsDelete", "ObjectStorageBucketsRead"]
    # EVM-068: the worker also writes the derivatives (Write); what it may write is narrowed by the bucket policy of the media bucket (TM-76).
    media_worker         = ["ObjectStorageObjectsRead", "ObjectStorageObjectsWrite", "ObjectStorageObjectsDelete", "ObjectStorageBucketsRead"]
    register_writer      = ["ObjectStorageObjectsWrite"]
    backup_writer        = ["ObjectStorageObjectsRead", "ObjectStorageObjectsWrite", "ObjectStorageObjectsDelete", "ObjectStorageBucketsRead"]
    media_backup_reader  = ["ObjectStorageObjectsRead", "ObjectStorageBucketsRead"]
    restore_reader       = ["ObjectStorageObjectsRead", "ObjectStorageBucketsRead"]
    restore_orchestrator = ["ObjectStorageObjectsRead", "ObjectStorageObjectsWrite"]
  }
  app_principals = { for name, app in scaleway_iam_application.app : name => "application_id:${app.id}" }
  iac_principal  = "application_id:${var.iac_application_id}"

  # Never granted to a key that runs on the VM (security-engineer P4, architect 4).
  privileged_actions = [
    "s3:PutBucket*",
    "s3:DeleteBucket*",
    "s3:PutLifecycleConfiguration",
    "s3:PutObjectLockConfiguration",
    "s3:PutObjectRetention",
    "s3:PutObjectLegalHold",
    "s3:PutObjectAcl",
    "s3:BypassGovernanceRetention",
    "s3:DeleteObjectVersion",
  ]

  media_allow = {
    media_app           = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts", "s3:ListBucket"]
    media_worker        = ["s3:GetObject", "s3:DeleteObject", "s3:ListBucket"]
    media_backup_reader = ["s3:ListBucket", "s3:GetObject"]
  }
  # EVM-068 (TM-76): the key of the worker may PutObject ONLY the two names of the derivatives (the originals are `.../original`), and only conditionally
  # (If-None-Match: *, add-only); PutObject is therefore not in the list above but in its own statements of the media policy.
  derivative_object_names = ["thumbnail.webp", "preview.webp"]
  register_allow = {
    register_writer = ["s3:PutObject"]
    restore_reader  = ["s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket", "s3:ListBucketVersions"]
  }
  db_backup_allow = {
    backup_writer  = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts", "s3:ListBucket", "s3:ListBucketVersions"]
    restore_reader = ["s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket", "s3:ListBucketVersions"]
  }
  # The signing key of the restore-test result: only its own prefix (security-engineer P5).
  restore_results_prefix  = "restore-results/"
  restore_results_actions = ["s3:PutObject", "s3:GetObject"]
}

resource "scaleway_iam_application" "app" {
  for_each    = local.apps
  name        = "evia-staging-${replace(each.key, "_", "-")}"
  description = "EVM-084: ${each.key} (object storage of staging)"
}

resource "scaleway_iam_policy" "app" {
  for_each       = local.apps
  name           = "evia-staging-${replace(each.key, "_", "-")}"
  application_id = scaleway_iam_application.app[each.key].id
  rule {
    project_ids          = [var.project_id]
    permission_set_names = each.value
  }
}

# --- Media -------------------------------------------------------------------------------------------------------

resource "scaleway_object_bucket" "media" {
  name                = local.media_bucket
  region              = var.region
  project_id          = var.project_id
  force_destroy       = false
  object_lock_enabled = true

  versioning {
    enabled = true
  }

  cors_rule {
    allowed_origins = [var.panel_origin]
    allowed_methods = ["PUT"]
    allowed_headers = ["Content-Type", "Content-MD5", "x-amz-checksum-sha256"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    id                                     = "abort-incomplete-multipart"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 7
  }

  lifecycle_rule {
    id      = "noncurrent-versions"
    enabled = true
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  # RR-51: there is no `quarantine/` rule on purpose. The application keeps a quarantined file under its `media/…` key (EVM-044 decision 2),
  # so a prefix rule would never match; the 30 days are enforced by the retention job (a delete marker) and `noncurrent-versions` above
  # removes the bytes about 30 days later.

  tags = {
    purpose = "media"
  }
}

# SSE-ONE (AES256 managed by Scaleway) before any object exists: older objects stay unencrypted.
resource "scaleway_object_bucket_server_side_encryption_configuration" "media" {
  bucket = scaleway_object_bucket.media.name
  region = var.region
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "scaleway_object_bucket_lock_configuration" "media" {
  bucket = scaleway_object_bucket.media.name
  region = var.region
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = 30
    }
  }
}

resource "scaleway_object_bucket_acl" "media" {
  bucket = scaleway_object_bucket.media.name
  region = var.region
  acl    = "private"
}

# --- Deletion register (SR-PRIV-04) --------------------------------------------------------------------------------

resource "scaleway_object_bucket" "register" {
  name          = local.register_bucket
  region        = var.region
  project_id    = var.project_id
  force_destroy = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    id      = "register-retention"
    enabled = true
    expiration {
      days = 40
    }
    noncurrent_version_expiration {
      noncurrent_days = 40
    }
  }

  tags = {
    purpose = "deletion-register"
  }
}

resource "scaleway_object_bucket_server_side_encryption_configuration" "register" {
  bucket = scaleway_object_bucket.register.name
  region = var.region
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "scaleway_object_bucket_acl" "register" {
  bucket = scaleway_object_bucket.register.name
  region = var.region
  acl    = "private"
}

# --- pgBackRest repository -----------------------------------------------------------------------------------------

resource "scaleway_object_bucket" "db_backup" {
  name                = local.db_backup_bucket
  region              = var.region
  project_id          = var.project_id
  force_destroy       = false
  object_lock_enabled = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    id                                     = "abort-incomplete-multipart"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 7
  }

  lifecycle_rule {
    id      = "noncurrent-versions"
    enabled = true
    noncurrent_version_expiration {
      noncurrent_days = 37
    }
  }

  lifecycle_rule {
    id      = "restore-results"
    enabled = true
    prefix  = "restore-results/"
    expiration {
      days = 40
    }
  }

  tags = {
    purpose = "pgbackrest"
  }
}

resource "scaleway_object_bucket_server_side_encryption_configuration" "db_backup" {
  bucket = scaleway_object_bucket.db_backup.name
  region = var.region
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# COMPLIANCE cannot be shortened or removed by anybody: the bucket lives at least 37 days after the first object (RR-NOC-T3-6).
resource "scaleway_object_bucket_lock_configuration" "db_backup" {
  bucket = scaleway_object_bucket.db_backup.name
  region = var.region
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 37
    }
  }
}

resource "scaleway_object_bucket_acl" "db_backup" {
  bucket = scaleway_object_bucket.db_backup.name
  region = var.region
  acl    = "private"
}

# --- Bucket policies -----------------------------------------------------------------------------------------------
# Per bucket: Allow the IaC application; Allow each principal of <bucket>_allow; Deny the privileged actions for every
# application; Deny everything outside its list for each listed application; Deny everything for the other applications.
# No Allow for "*" and no public ACL (the buckets are acl = "private").

resource "scaleway_object_bucket_policy" "media" {
  bucket = scaleway_object_bucket.media.name
  region = var.region
  policy = jsonencode({
    Version = "2023-04-17"
    Id      = "evia-staging-media"
    Statement = concat(
      [{
        Sid       = "AllowIac"
        Effect    = "Allow"
        Principal = { SCW = local.iac_principal }
        Action    = ["s3:*"]
        Resource  = [scaleway_object_bucket.media.name, "${scaleway_object_bucket.media.name}/*"]
      }],
      [for app, actions in local.media_allow : {
        Sid       = "Allow-${app}"
        Effect    = "Allow"
        Principal = { SCW = local.app_principals[app] }
        Action    = actions
        Resource  = [scaleway_object_bucket.media.name, "${scaleway_object_bucket.media.name}/*"]
      }],
      [for app, actions in local.media_allow : {
        Sid       = "DenyOutsideList-${app}"
        Effect    = "Deny"
        Principal = { SCW = local.app_principals[app] }
        # the worker's PutObject is decided by the three statements below, not blanket-denied here
        NotAction = app == "media_worker" ? concat(actions, ["s3:PutObject"]) : actions
        Resource  = [scaleway_object_bucket.media.name, "${scaleway_object_bucket.media.name}/*"]
      }],
      # EVM-068: the derivatives. Allow on the two names only; Deny without If-None-Match (add-only: an object that exists is never replaced); Deny on the
      # originals whatever the header says (the pattern of restore_results_prefix: narrow Allow + Deny of the protected area).
      [{
        Sid       = "AllowWorkerDerivatives"
        Effect    = "Allow"
        Principal = { SCW = local.app_principals["media_worker"] }
        Action    = ["s3:PutObject"]
        Resource  = [for name in local.derivative_object_names : "${scaleway_object_bucket.media.name}/media/*/${name}"]
      }],
      [{
        Sid       = "DenyWorkerOverwrite"
        Effect    = "Deny"
        Principal = { SCW = local.app_principals["media_worker"] }
        Action    = ["s3:PutObject"]
        Resource  = ["${scaleway_object_bucket.media.name}/*"]
        Condition = { Null = { "s3:if-none-match" = "true" } }
      }],
      [{
        Sid       = "DenyWorkerOriginals"
        Effect    = "Deny"
        Principal = { SCW = local.app_principals["media_worker"] }
        Action    = ["s3:PutObject"]
        Resource  = ["${scaleway_object_bucket.media.name}/media/*/original"]
      }],
      [{
        Sid       = "DenyPrivilegedForApplications"
        Effect    = "Deny"
        Principal = { SCW = values(local.app_principals) }
        Action    = local.privileged_actions
        Resource  = [scaleway_object_bucket.media.name, "${scaleway_object_bucket.media.name}/*"]
      }],
      [{
        Sid       = "DenyOtherApplications"
        Effect    = "Deny"
        Principal = { SCW = [for app in setsubtract(keys(local.apps), keys(local.media_allow)) : local.app_principals[app]] }
        Action    = ["s3:*"]
        Resource  = [scaleway_object_bucket.media.name, "${scaleway_object_bucket.media.name}/*"]
      }],
    )
  })
}

resource "scaleway_object_bucket_policy" "register" {
  bucket = scaleway_object_bucket.register.name
  region = var.region
  policy = jsonencode({
    Version = "2023-04-17"
    Id      = "evia-staging-deletion-register"
    Statement = concat(
      [{
        Sid       = "AllowIac"
        Effect    = "Allow"
        Principal = { SCW = local.iac_principal }
        Action    = ["s3:*"]
        Resource  = [scaleway_object_bucket.register.name, "${scaleway_object_bucket.register.name}/*"]
      }],
      [for app, actions in local.register_allow : {
        Sid       = "Allow-${app}"
        Effect    = "Allow"
        Principal = { SCW = local.app_principals[app] }
        Action    = actions
        Resource  = [scaleway_object_bucket.register.name, "${scaleway_object_bucket.register.name}/*"]
      }],
      [for app, actions in local.register_allow : {
        Sid       = "DenyOutsideList-${app}"
        Effect    = "Deny"
        Principal = { SCW = local.app_principals[app] }
        NotAction = actions
        Resource  = [scaleway_object_bucket.register.name, "${scaleway_object_bucket.register.name}/*"]
      }],
      # Add-only: a PutObject without If-None-Match would overwrite an entry (the IAM permission set alone allows it).
      [{
        Sid       = "DenyOverwriteByRegisterWriter"
        Effect    = "Deny"
        Principal = { SCW = local.app_principals["register_writer"] }
        Action    = ["s3:PutObject"]
        Resource  = ["${scaleway_object_bucket.register.name}/*"]
        Condition = { Null = { "s3:if-none-match" = "true" } }
      }],
      [{
        Sid       = "DenyPrivilegedForApplications"
        Effect    = "Deny"
        Principal = { SCW = values(local.app_principals) }
        Action    = local.privileged_actions
        Resource  = [scaleway_object_bucket.register.name, "${scaleway_object_bucket.register.name}/*"]
      }],
      [{
        Sid       = "DenyOtherApplications"
        Effect    = "Deny"
        Principal = { SCW = [for app in setsubtract(keys(local.apps), keys(local.register_allow)) : local.app_principals[app]] }
        Action    = ["s3:*"]
        Resource  = [scaleway_object_bucket.register.name, "${scaleway_object_bucket.register.name}/*"]
      }],
    )
  })
}

resource "scaleway_object_bucket_policy" "db_backup" {
  bucket = scaleway_object_bucket.db_backup.name
  region = var.region
  policy = jsonencode({
    Version = "2023-04-17"
    Id      = "evia-staging-db-backup"
    Statement = concat(
      [{
        Sid       = "AllowIac"
        Effect    = "Allow"
        Principal = { SCW = local.iac_principal }
        Action    = ["s3:*"]
        Resource  = [scaleway_object_bucket.db_backup.name, "${scaleway_object_bucket.db_backup.name}/*"]
      }],
      [for app, actions in local.db_backup_allow : {
        Sid       = "Allow-${app}"
        Effect    = "Allow"
        Principal = { SCW = local.app_principals[app] }
        Action    = actions
        Resource  = [scaleway_object_bucket.db_backup.name, "${scaleway_object_bucket.db_backup.name}/*"]
      }],
      [for app, actions in local.db_backup_allow : {
        Sid       = "DenyOutsideList-${app}"
        Effect    = "Deny"
        Principal = { SCW = local.app_principals[app] }
        NotAction = actions
        Resource  = [scaleway_object_bucket.db_backup.name, "${scaleway_object_bucket.db_backup.name}/*"]
      }],
      [{
        Sid       = "AllowRestoreResults"
        Effect    = "Allow"
        Principal = { SCW = local.app_principals["restore_orchestrator"] }
        Action    = local.restore_results_actions
        Resource  = ["${scaleway_object_bucket.db_backup.name}/${local.restore_results_prefix}*"]
      }],
      [{
        Sid       = "DenyOrchestratorOutsideResults"
        Effect    = "Deny"
        Principal = { SCW = local.app_principals["restore_orchestrator"] }
        Action    = ["s3:*"]
        Resource  = [scaleway_object_bucket.db_backup.name, "${scaleway_object_bucket.db_backup.name}/pgbackrest/*"]
      }],
      [{
        Sid       = "DenyPrivilegedForApplications"
        Effect    = "Deny"
        Principal = { SCW = values(local.app_principals) }
        Action    = local.privileged_actions
        Resource  = [scaleway_object_bucket.db_backup.name, "${scaleway_object_bucket.db_backup.name}/*"]
      }],
      [{
        Sid       = "DenyOtherApplications"
        Effect    = "Deny"
        Principal = { SCW = [for app in setsubtract(keys(local.apps), concat(keys(local.db_backup_allow), ["restore_orchestrator"])) : local.app_principals[app]] }
        Action    = ["s3:*"]
        Resource  = [scaleway_object_bucket.db_backup.name, "${scaleway_object_bucket.db_backup.name}/*"]
      }],
    )
  })
}

output "application_ids" {
  description = "Scaleway IAM applications (not secrets): API keys are created by hand in the IaC session."
  value       = { for name, app in scaleway_iam_application.app : name => app.id }
}

output "buckets" {
  description = "Bucket names for the runtime configuration (MEDIA_BUCKET, DELETION_REGISTER_BUCKET, the pgBackRest repository)."
  value = {
    media     = scaleway_object_bucket.media.name
    register  = scaleway_object_bucket.register.name
    db_backup = scaleway_object_bucket.db_backup.name
  }
}
