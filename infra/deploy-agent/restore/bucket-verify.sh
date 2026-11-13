#!/bin/bash
# Verification of the buckets and application keys (EVM-084 AC2; SR-INFRA-02; architect 3, 4; security-engineer P5). Run in the IaC
# session after every change of the buckets or policies, with the REAL keys (docs/qa/EVM-084/ holds the output): it only asks and prints
# ok / FAIL lines (never a key, a response or a header value) and exits 1 on any FAIL.
#   - anonymous GET and list of every bucket -> 403
#   - register key: a PUT with If-None-Match works once (200), the second is 412, a PUT without it, GET, list and DELETE -> 403
#   - every key × every bucket -> 403: PutBucketPolicy, DeleteBucketPolicy, PutBucketVersioning, PutLifecycleConfiguration, PutBucketAcl,
#     PutBucketCors, PutObjectLockConfiguration, PutObjectRetention, PutObjectLegalHold, PutObjectAcl, DeleteObjectVersion (also with
#     x-amz-bypass-governance-retention), DeleteBucket (security-engineer F1)
#   - public ACL: PUT with x-amz-acl: public-read by media_app (media), media_worker (exports), backup_writer (db_backup) -> 403; a 2xx is
#     tolerated only if the anonymous GET of the object is 403, otherwise FAIL ... BLOCKER (F-ACL)
#   - media_worker in media: thumbnail.webp under media/verify-probes-<run>/ with If-None-Match: * -> 200, again -> 412, without the header
#     -> 403, `original` there -> 403 (F2: the resource media/*/thumbnail.webp matches the probe key)
#   - register: If-None-Match with an ETag instead of * must not be accepted (F3)
#   - the whole matrix key × bucket × area × {list, GET, PUT, DELETE} from bucket-matrix.tsv (generated from BUCKET_POLICIES in
#     tools/repo-policy): `allow` = any answer but 403, `deny` = exactly 403 — this proves that the constructs of the bucket policies
#     (implicit deny without any Deny statement, the condition Null on s3:if-none-match, the prefix of the orchestrator) mean at Scaleway
#     what the module assumes and that the project-wide permission sets do not open another bucket
#   - an object written by the media key carries x-amz-server-side-encryption (SSE-ONE)
# Requests are signed by curl (--aws-sigv4); the secret goes to curl on stdin, never into argv. The probes are objects under
# `verify-probes/` prefixes (they expire with the lifecycle of their buckets; under object lock they stay: see the last line of the output).
#   BUCKET_VERIFY_ONLY=admin runs only the per-key administrative probes (a subset re-run; fewer probe objects under lock).
set -euo pipefail
set +x
umask 077

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SECRETS_DIR="${EVIA_SECRETS_DIR:-/etc/evia/secrets}"
readonly MATRIX_FILE="${EVIA_BUCKET_MATRIX:-$SELF_DIR/bucket-matrix.tsv}"
: "${S3_ENDPOINT:?}" "${S3_REGION:?}"
if [[ ! "$S3_ENDPOINT" =~ ^https://[a-z0-9.-]+$ && ! ( "${EVIA_RESTORE_TEST_MODE:-}" = 1 && "$S3_ENDPOINT" =~ ^http://127\.0\.0\.1:[0-9]+$ ) ]]; then
  echo "bucket-verify: S3_ENDPOINT" >&2
  exit 1
fi
[ -r "$MATRIX_FILE" ] || {
  echo "bucket-verify: no matrix file" >&2
  exit 1
}

# The declarations of the matrix file: keys (id variable, secret file), buckets (variable), areas (prefix).
declare -A KEY_ID_VAR KEY_SECRET_FILE BUCKET_VAR AREA_PREFIX
KEYS=()
BUCKETS=()
while IFS=$'\t' read -r kind a b c _ _; do
  case "$kind" in
    key) KEY_ID_VAR[$a]="$b" KEY_SECRET_FILE[$a]="$c" KEYS+=("$a") ;;
    bucket) BUCKET_VAR[$a]="$b" BUCKETS+=("$a") ;;
    area) AREA_PREFIX[$a]="$b" ;;
    row | '' | '#'*) ;;
    *)
      echo "bucket-verify: unknown line in the matrix" >&2
      exit 1
      ;;
  esac
done < "$MATRIX_FILE"
declare -A BUCKET_NAME KEY_ID
for name in "${BUCKETS[@]}"; do
  variable="${BUCKET_VAR[$name]}"
  BUCKET_NAME[$name]="${!variable:?$variable}"
  [[ "${BUCKET_NAME[$name]}" =~ ^[a-z0-9-]+$ ]] || {
    echo "bucket-verify: bucket name" >&2
    exit 1
  }
done
for name in "${KEYS[@]}"; do
  variable="${KEY_ID_VAR[$name]}"
  KEY_ID[$name]="${!variable:?$variable}"
  [[ "${KEY_ID[$name]}" =~ ^[A-Za-z0-9]+$ ]] || {
    echo "bucket-verify: access key id" >&2
    exit 1
  }
done
failed=0

# code KEY-NAME METHOD PATH [curl args...] -> HTTP status; KEY-NAME is a key of the matrix file or anonymous.
code() {
  local who="$1" method="$2" path="$3" secret=""
  shift 3
  local args=(-sS --proto "=${S3_ENDPOINT%%://*}" --max-time 30 -o /dev/null -w '%{http_code}' -X "$method")
  if [ "$who" != anonymous ]; then
    secret="$(< "$SECRETS_DIR/${KEY_SECRET_FILE[$who]}")"
    printf 'user = "%s:%s"\n' "${KEY_ID[$who]}" "$secret" | curl "${args[@]}" --aws-sigv4 "aws:amz:$S3_REGION:s3" --config - "$@" "$S3_ENDPOINT$path" 2> /dev/null || printf '000'
  else
    curl "${args[@]}" "$@" "$S3_ENDPOINT$path" 2> /dev/null || printf '000'
  fi
}
expect() { # EXPECTED DESCRIPTION KEY-NAME METHOD PATH [curl args...]
  local expected="$1" description="$2" got
  shift 2
  got="$(code "$@")"
  if [ "$got" = "$expected" ]; then
    echo "ok: $description"
  else
    echo "FAIL: $description (expected $expected, got $got)"
    failed=1
  fi
}

only="${BUCKET_VERIFY_ONLY:-}"
case "$only" in
  '' | admin) ;;
  *)
    echo "bucket-verify: BUCKET_VERIFY_ONLY (admin or empty)" >&2
    exit 1
    ;;
esac

if [ -z "$only" ]; then
  for name in "${BUCKETS[@]}"; do
    bucket="${BUCKET_NAME[$name]}"
    expect 403 "anonymous list of $bucket" anonymous GET "/$bucket/"
    expect 403 "anonymous GET in $bucket" anonymous GET "/$bucket/anonymous-probe"
  done
fi

run_id="$(date -u +%Y%m%dt%H%M%Sz)-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
probe="verify-probes/$run_id"
body="$(mktemp)"
trap 'rm -f -- "$body"' EXIT
printf 'verify' > "$body"

register="${BUCKET_NAME[register]}"
entry="/$register/$probe"
if [ -z "$only" ]; then
  expect 200 "register: a new entry (If-None-Match) is accepted" register_writer PUT "$entry" -H 'If-None-Match: *' --data-binary "@$body"
  expect 412 "register: the second PUT with If-None-Match is refused" register_writer PUT "$entry" -H 'If-None-Match: *' --data-binary "@$body"
  expect 403 "register: an overwrite (PUT without If-None-Match) is AccessDenied" register_writer PUT "$entry" --data-binary "@$body"
  expect 403 "register: GET is AccessDenied" register_writer GET "$entry"
  expect 403 "register: list is AccessDenied" register_writer GET "/$register/?list-type=2"
  expect 403 "register: DELETE is AccessDenied" register_writer DELETE "$entry"
fi

# Real version ids for DeleteObjectVersion: one probe object per bucket written by a key that may write there; the id comes from
# x-amz-version-id ("null" where the bucket has no versioning). A 400 would prove nothing (validation runs before authorization).
declare -A VERSION_PATH VERSION_ID
put_version() { # BUCKET-NAME KEY PATH-IN-BUCKET [curl args...]
  local name="$1" who="$2" path="$3" out version secret
  shift 3
  secret="$(< "$SECRETS_DIR/${KEY_SECRET_FILE[$who]}")"
  out="$(printf 'user = "%s:%s"\n' "${KEY_ID[$who]}" "$secret" | curl -sS --proto "=${S3_ENDPOINT%%://*}" --max-time 30 -D - -o /dev/null -w 'status=%{http_code}' -X PUT --aws-sigv4 "aws:amz:$S3_REGION:s3" --config - "$@" --data-binary "@$body" "$S3_ENDPOINT/${BUCKET_NAME[$name]}/$path" 2> /dev/null || printf 'status=000')"
  if [[ "$out" != *status=200 ]]; then
    echo "FAIL: version probe: $who could not write the probe object in $name"
    failed=1
  fi
  version="$(tr -d '\r' <<< "$out" | sed -n 's/^[Xx]-[Aa]mz-[Vv]ersion-[Ii]d: *//p' | head -n 1)"
  [[ "$version" =~ ^[A-Za-z0-9._-]+$ ]] || version=null
  VERSION_PATH[$name]="$path"
  VERSION_ID[$name]="$version"
}
put_version media media_app "$probe"
put_version register register_writer "$probe-v" -H 'If-None-Match: *'
put_version exports media_worker "${AREA_PREFIX[any]}$run_id-v"
put_version db_backup backup_writer "${AREA_PREFIX[repo]}$run_id-v"

# A valid PutObjectLockConfiguration identical to the current lock of the bucket (a no-op if it were ever allowed): the module sets
# media GOVERNANCE 30 d and db_backup COMPLIANCE 37 d (infra/tofu/modules/object-storage/main.tf); register and exports have no lock.
lock_xml() { # MODE DAYS
  printf '<ObjectLockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention><Mode>%s</Mode><Days>%s</Days></DefaultRetention></Rule></ObjectLockConfiguration>' "$1" "$2"
}
declare -A LOCK_BODY LOCK_MD5
LOCK_BODY[media]="$(lock_xml GOVERNANCE 30)"
LOCK_BODY[db_backup]="$(lock_xml COMPLIANCE 37)"
LOCK_BODY[register]="$(lock_xml GOVERNANCE 30)"
LOCK_BODY[exports]="$(lock_xml GOVERNANCE 30)"
for name in "${BUCKETS[@]}"; do
  LOCK_MD5[$name]="$(printf '%s' "${LOCK_BODY[$name]}" | openssl dgst -md5 -binary | base64)"
done

# Administrative actions: refused for every key in every bucket (the bucket of its own and the others).
for who in "${KEYS[@]}"; do
  for name in "${BUCKETS[@]}"; do
    bucket="${BUCKET_NAME[$name]}"
    expect 403 "$who key: PutBucketPolicy in $name is AccessDenied" "$who" PUT "/$bucket?policy" --data-binary '{}'
    expect 403 "$who key: DeleteBucketPolicy in $name is AccessDenied" "$who" DELETE "/$bucket?policy"
    expect 403 "$who key: PutBucketAcl in $name is AccessDenied" "$who" PUT "/$bucket?acl" -H 'x-amz-acl: public-read' --data-binary ''
    expect 403 "$who key: PutBucketCors in $name is AccessDenied" "$who" PUT "/$bucket?cors" --data-binary '<CORSConfiguration/>'
    lock_description="$who key: PutObjectLockConfiguration in $name is AccessDenied"
    if [ "$name" = media ] || [ "$name" = db_backup ]; then
      expect 403 "$lock_description" "$who" PUT "/$bucket?object-lock" -H "Content-MD5: ${LOCK_MD5[$name]}" -H 'Content-Type: application/xml' --data-binary "${LOCK_BODY[$name]}"
    else
      # no object lock on this bucket: Scaleway may answer 400/409 before authorization; only 403 proves the policy, anything else is not a FAIL
      got="$(code "$who" PUT "/$bucket?object-lock" -H "Content-MD5: ${LOCK_MD5[$name]}" -H 'Content-Type: application/xml' --data-binary "${LOCK_BODY[$name]}")"
      if [ "$got" = 403 ]; then echo "ok: $lock_description"; else echo "inconclusive: $lock_description (bucket without object lock, got $got)"; fi
    fi
    expect 403 "$who key: PutObjectLegalHold in $name is AccessDenied" "$who" PUT "/$bucket/$probe?legal-hold" --data-binary '<LegalHold/>'
    expect 403 "$who key: PutObjectAcl in $name is AccessDenied" "$who" PUT "/$bucket/$probe?acl" -H 'x-amz-acl: public-read' --data-binary ''
    expect 403 "$who key: DeleteObjectVersion with bypass-governance in $name is AccessDenied" "$who" DELETE "/$bucket/${VERSION_PATH[$name]}?versionId=${VERSION_ID[$name]}" -H 'x-amz-bypass-governance-retention: true'
    expect 403 "$who key: PutBucketVersioning in $name is AccessDenied" "$who" PUT "/$bucket?versioning" --data-binary '<VersioningConfiguration/>'
    expect 403 "$who key: PutLifecycleConfiguration in $name is AccessDenied" "$who" PUT "/$bucket?lifecycle" --data-binary '<LifecycleConfiguration/>'
    expect 403 "$who key: PutObjectRetention in $name is AccessDenied" "$who" PUT "/$bucket/$probe?retention" --data-binary '<Retention/>'
    expect 403 "$who key: DeleteObjectVersion in $name is AccessDenied" "$who" DELETE "/$bucket/${VERSION_PATH[$name]}?versionId=${VERSION_ID[$name]}"
  done
done
if [ "$only" = admin ]; then
  echo "note: BUCKET_VERIFY_ONLY=admin: only the per-key administrative probes ran (matrix, anonymous, register, SSE, ACL, DeleteBucket skipped)"
  exit "$failed"
fi

# The matrix. The rows of one group come as put -> get -> delete on the same object, so an allowed GET after an allowed PUT
# is 200 and an allowed GET without one is 404; both are "anything but 403".
matrix_row() { # KEY BUCKET AREA OPERATION EXPECTED
  local who="$1" name="$2" area="$3" operation="$4" expected="$5" bucket path got description
  bucket="${BUCKET_NAME[$name]}"
  path="/$bucket/${AREA_PREFIX[$area]:-}$run_id-$who"
  description="matrix: $who × $name (area $area) × $operation expects $expected"
  [ "$area" != - ] || path="/$bucket/?list-type=2"
  case "$operation" in
    list | get) got="$(code "$who" GET "$path")" ;;
    put)
      if [ "$name" = register ]; then got="$(code "$who" PUT "$path" -H 'If-None-Match: *' --data-binary "@$body")"; else got="$(code "$who" PUT "$path" --data-binary "@$body")"; fi
      ;;
    delete) got="$(code "$who" DELETE "$path")" ;;
    *)
      echo "FAIL: matrix: unknown operation"
      failed=1
      return 0
      ;;
  esac
  if [ "$expected" = deny ] && [ "$got" = 403 ]; then
    echo "ok: $description ($got)"
  elif [ "$expected" = allow ] && [[ "$got" =~ ^(2[0-9][0-9]|404|412)$ ]]; then
    echo "ok: $description ($got)"
  else
    echo "FAIL: $description (observed $got)"
    failed=1
  fi
}
rows=0
while IFS=$'\t' read -r kind who name area operation expected; do
  [ "$kind" = row ] || continue
  matrix_row "$who" "$name" "$area" "$operation" "$expected"
  rows=$((rows + 1))
done < "$MATRIX_FILE"
expected_rows=$((${#KEYS[@]} * ${#BUCKETS[@]}))
if [ "$rows" -lt "$expected_rows" ]; then
  echo "FAIL: matrix: only $rows rows for ${#KEYS[@]} keys and ${#BUCKETS[@]} buckets"
  failed=1
fi

media="${BUCKET_NAME[media]}"
expect 200 "media key: PutObject works" media_app PUT "/$media/$probe" --data-binary "@$body"
secret="$(< "$SECRETS_DIR/${KEY_SECRET_FILE[media_app]}")"
headers="$(printf 'user = "%s:%s"\n' "${KEY_ID[media_app]}" "$secret" | curl -sS --proto "=${S3_ENDPOINT%%://*}" --max-time 30 -I --aws-sigv4 "aws:amz:$S3_REGION:s3" --config - "$S3_ENDPOINT/$media/$probe" 2> /dev/null || true)"
if grep -qi '^x-amz-server-side-encryption: *AES256' <<< "$headers"; then
  echo "ok: the media object is encrypted (SSE-ONE)"
else
  echo "FAIL: the media object has no x-amz-server-side-encryption header"
  failed=1
fi

# F3: a conditional write with an ETag (not *) is not a way to overwrite or probe the register: anything but 2xx.
got="$(code register_writer PUT "$entry" -H 'If-None-Match: "deadbeef"' --data-binary "@$body")"
if [[ "$got" =~ ^(4[0-9][0-9]|501)$ ]]; then
  echo "ok: register: PUT with If-None-Match of an ETag is not accepted ($got)"
else
  echo "FAIL: register: PUT with If-None-Match of an ETag (expected 4xx or 501, got $got)"
  failed=1
fi

# F2: the worker key writes thumbnail.webp once (add-only) and never `original`; the probe key matches media/*/thumbnail.webp.
thumb="/$media/media/verify-probes-$run_id/thumbnail.webp"
expect 200 "media_worker: thumbnail.webp with If-None-Match is accepted" media_worker PUT "$thumb" -H 'If-None-Match: *' --data-binary "@$body"
expect 412 "media_worker: the second thumbnail.webp with If-None-Match is refused" media_worker PUT "$thumb" -H 'If-None-Match: *' --data-binary "@$body"
expect 403 "media_worker: thumbnail.webp without If-None-Match is AccessDenied" media_worker PUT "$thumb" --data-binary "@$body"
expect 403 "media_worker: original with If-None-Match is AccessDenied" media_worker PUT "/$media/media/verify-probes-$run_id/original" -H 'If-None-Match: *' --data-binary "@$body"

# Public ACL: refused; if a store ignores the header and accepts the write, the object must not be readable anonymously (BLOCKER otherwise).
public_acl() { # KEY BUCKET-NAME OBJECT-PATH-IN-BUCKET
  local who="$1" name="$2" path="/${BUCKET_NAME[$2]}/$3" got anonymous
  got="$(code "$who" PUT "$path" -H 'x-amz-acl: public-read' --data-binary "@$body")"
  if [ "$got" = 403 ]; then
    echo "ok: public ACL: $who key in $name is AccessDenied"
  elif [[ "$got" =~ ^2[0-9][0-9]$ ]]; then
    anonymous="$(code anonymous GET "$path")"
    if [ "$anonymous" = 403 ]; then
      echo "ok: public ACL: $who key in $name accepted the write ($got), the anonymous GET is 403"
    else
      echo "FAIL: BLOCKER: public ACL: $who key in $name accepted the write ($got) and the anonymous GET is $anonymous"
      failed=1
    fi
  else
    echo "FAIL: public ACL: $who key in $name (expected 403, got $got)"
    failed=1
  fi
}
public_acl media_app media "${AREA_PREFIX[any]}$run_id-acl"
public_acl media_worker exports "${AREA_PREFIX[any]}$run_id-acl"
public_acl backup_writer db_backup "${AREA_PREFIX[repo]}$run_id-acl"

# DeleteBucket last: every bucket holds an object by now (the exports one is a probe that expires in a day), so a wrong Allow fails with
# BucketNotEmpty instead of removing a bucket.
expect 200 "exports: a probe object that keeps the bucket non-empty" media_worker PUT "/${BUCKET_NAME[exports]}/${AREA_PREFIX[any]}$run_id-keep" --data-binary "@$body"
for who in "${KEYS[@]}"; do
  for name in "${BUCKETS[@]}"; do
    expect 403 "$who key: DeleteBucket $name is AccessDenied" "$who" DELETE "/${BUCKET_NAME[$name]}"
  done
done
echo "note: probe objects left under object lock until retention ends: db_backup 4-5 (COMPLIANCE 37 d), media 4-5 (GOVERNANCE 30 d); no lock: exports 2-3 (expire in 1 d), register 3 (40 d)"
exit "$failed"
