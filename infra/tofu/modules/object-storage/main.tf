# Object Storage of staging (EVM-084 AC1, AC2; ADR-0009, ADR-0011; SR-INFRA-02/03/07, SR-PRIV-04): four private,
# encrypted buckets in pl-waw — media, the deletion register (the application key may only add entries), the pgBackRest
# repository with object lock (these three versioned) and the ZIP exports of EVM-052 (no lock, no versions, one day of
# life: a copy of originals with GPS that must really disappear). Object lock is set at creation (Scaleway cannot add it
# later); dropping it from the media bucket needs an ADR. IAM of Scaleway works per project, so every bucket carries a policy with the
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
  exports_bucket   = "evia-staging-exports"

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

  media_allow = {
    media_app           = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts", "s3:ListBucket"]
    media_worker        = ["s3:GetObject", "s3:DeleteObject", "s3:ListBucket"]
    media_backup_reader = ["s3:ListBucket", "s3:GetObject"]
  }
  # EVM-068 (TM-76): the key of the worker may PutObject ONLY the two names of the derivatives (the originals are `.../original`), and only conditionally
  # (If-None-Match: *, add-only); PutObject is therefore not in the list above but in its own statements of the media policy.
  derivative_object_names = ["thumbnail.webp", "preview.webp", "preview.mp4"]
  register_allow = {
    register_writer = ["s3:PutObject"]
    restore_reader  = ["s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket", "s3:ListBucketVersions"]
  }
  # EVM-052: the code uses the credentials of the process for both media buckets, so the existing keys are split by the bucket policies (no new key):
  # the API only signs a link (GetObject; ListBucket makes an expired object a 404), the worker builds (multipart = PutObject), checks and removes.
  # No If-None-Match condition here: UploadPart of a multipart upload carries no such header (the code sends it on CompleteMultipartUpload only).
  exports_allow = {
    media_app    = ["s3:GetObject", "s3:ListBucket"]
    media_worker = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts", "s3:ListBucket"]
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

# --- ZIP exports (EVM-052) -----------------------------------------------------------------------------------------
# NOT the media bucket: its 30 days of lock would keep originals with GPS after an "erasure". No lock and no versioning, so the lifecycle
# really removes the object; the retention job of the application deletes it at 24 h, the one-day rule is the second line (Scaleway evaluates
# a lifecycle rule once a day, so an object may stay up to about 48 h without the job). No CORS: the browser follows a signed link (an anchor).

resource "scaleway_object_bucket" "exports" {
  name          = local.exports_bucket
  region        = var.region
  project_id    = var.project_id
  force_destroy = false

  lifecycle_rule {
    id                                     = "abort-incomplete-multipart"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 1
  }

  lifecycle_rule {
    id      = "exports-expire"
    enabled = true
    expiration {
      days = 1
    }
  }

  tags = {
    purpose = "media-exports"
  }
}

resource "scaleway_object_bucket_server_side_encryption_configuration" "exports" {
  bucket = scaleway_object_bucket.exports.name
  region = var.region
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "scaleway_object_bucket_acl" "exports" {
  bucket = scaleway_object_bucket.exports.name
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
# Scaleway semantics (Version 2023-04-17; https://www.scaleway.com/en/docs/object-storage/api-cli/bucket-policy/ and
# .../combining-iam-and-object-storage/): a principal needs an IAM permission AND, once a bucket has a policy, an explicit Allow in
# that policy; every action not explicitly allowed is denied and "Deny statements are therefore useless". Elements: Version, Id,
# Statement, Sid, Principal, Action, Effect, Resource, Condition - NO NotAction/NotPrincipal (the API answers `Missing required field
# Action`), and at most 10 statements per policy (`Bucket Policy can have up to 10 statements`).
# So each policy holds only Allow statements: the IaC application (s3:*, so the session is never locked out) and each principal of
# <bucket>_allow with exactly its list. The former Deny statements (privileged actions, outside the list, other applications, the
# restore orchestrator in pgbackrest/, the originals for the worker) are implicit: no list holds a privileged action, no application
# outside the lists or prefixes is allowed. ASSUMPTION confirmed by bucket-verify.sh (step A6): implicit deny holds even though the IAM
# permission sets of the project are broader (every cell of bucket-matrix.tsv, the administrative actions and anonymous access -> 403).
# Conditional writes (add-only) are written as an Allow with the documented condition `Null` on `s3:if-none-match` = "false" (header
# present), https://www.scaleway.com/en/docs/object-storage/api-cli/using-conditional-writes/ .
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
      # EVM-068: the derivatives. The ONLY PutObject of the worker: the two/three names, and only with If-None-Match (add-only: an object that exists is
      # never replaced). The originals (`.../original`) match no Allow, so they stay denied (the former DenyWorkerOriginals is implicit).
      [{
        Sid       = "AllowWorkerDerivatives"
        Effect    = "Allow"
        Principal = { SCW = local.app_principals["media_worker"] }
        Action    = ["s3:PutObject"]
        Resource  = [for name in local.derivative_object_names : "${scaleway_object_bucket.media.name}/media/*/${name}"]
        Condition = { Null = { "s3:if-none-match" = "false" } }
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
      # Add-only: the writer's PutObject is allowed only with If-None-Match (a PutObject without it would overwrite an entry).
      [{
        Sid       = "AllowRegisterWriterConditionalPut"
        Effect    = "Allow"
        Principal = { SCW = local.app_principals["register_writer"] }
        Action    = local.register_allow["register_writer"]
        Resource  = ["${scaleway_object_bucket.register.name}/*"]
        Condition = { Null = { "s3:if-none-match" = "false" } }
      }],
      [for app, actions in local.register_allow : {
        Sid       = "Allow-${app}"
        Effect    = "Allow"
        Principal = { SCW = local.app_principals[app] }
        Action    = actions
        Resource  = [scaleway_object_bucket.register.name, "${scaleway_object_bucket.register.name}/*"]
      } if app != "register_writer"],
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
      # The orchestrator reaches only its own prefix; the repository (pgbackrest/) matches no Allow for it (the former Deny is implicit).
      [{
        Sid       = "AllowRestoreResults"
        Effect    = "Allow"
        Principal = { SCW = local.app_principals["restore_orchestrator"] }
        Action    = local.restore_results_actions
        Resource  = ["${scaleway_object_bucket.db_backup.name}/${local.restore_results_prefix}*"]
      }],
    )
  })
}

resource "scaleway_object_bucket_policy" "exports" {
  bucket = scaleway_object_bucket.exports.name
  region = var.region
  policy = jsonencode({
    Version = "2023-04-17"
    Id      = "evia-staging-exports"
    Statement = concat(
      [{
        Sid       = "AllowIac"
        Effect    = "Allow"
        Principal = { SCW = local.iac_principal }
        Action    = ["s3:*"]
        Resource  = [scaleway_object_bucket.exports.name, "${scaleway_object_bucket.exports.name}/*"]
      }],
      [for app, actions in local.exports_allow : {
        Sid       = "Allow-${app}"
        Effect    = "Allow"
        Principal = { SCW = local.app_principals[app] }
        Action    = actions
        Resource  = [scaleway_object_bucket.exports.name, "${scaleway_object_bucket.exports.name}/*"]
      }],
    )
  })
}

output "application_ids" {
  description = "Scaleway IAM applications (not secrets): API keys are created by hand in the IaC session."
  value       = { for name, app in scaleway_iam_application.app : name => app.id }
}

output "buckets" {
  description = "Bucket names for the runtime configuration (MEDIA_BUCKET, DELETION_REGISTER_BUCKET, MEDIA_EXPORT_BUCKET, the pgBackRest repository)."
  value = {
    media     = scaleway_object_bucket.media.name
    register  = scaleway_object_bucket.register.name
    db_backup = scaleway_object_bucket.db_backup.name
    exports   = scaleway_object_bucket.exports.name
  }
}
