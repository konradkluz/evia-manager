#!/bin/bash
# Verification of the buckets and application keys (EVM-084 AC2; SR-INFRA-02; architect 3, 4; security-engineer P5). Run in the IaC
# session after every change of the buckets or policies, with the REAL keys (docs/qa/EVM-084/ holds the output): it only asks and prints
# ok / FAIL lines (never a key, a response or a header value) and exits 1 on any FAIL.
#   - anonymous GET and list of every bucket -> 403
#   - register key: a PUT with If-None-Match works once (200), the second is 412, a PUT without it, GET, list and DELETE -> 403
#   - every key: PutBucketPolicy, PutBucketVersioning, PutLifecycleConfiguration, PutObjectRetention, DeleteObjectVersion -> 403
#   - the whole matrix key × bucket × area × {list, GET, PUT, DELETE} from bucket-matrix.tsv (generated from BUCKET_POLICIES in
#     tools/repo-policy): `allow` = any answer but 403, `deny` = exactly 403 — this proves that the constructs of the bucket policies
#     (NotAction, the wildcard s3:PutBucket*, the condition on s3:if-none-match, the prefix of the orchestrator) mean at Scaleway
#     what the module assumes and that the project-wide permission sets do not open another bucket
#   - an object written by the media key carries x-amz-server-side-encryption (SSE-ONE)
# Requests are signed by curl (--aws-sigv4); the secret goes to curl on stdin, never into argv. The probes are objects under
# `verify-probes/` prefixes (they expire with the lifecycle of their buckets).
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

for name in "${BUCKETS[@]}"; do
  bucket="${BUCKET_NAME[$name]}"
  expect 403 "anonymous list of $bucket" anonymous GET "/$bucket/"
  expect 403 "anonymous GET in $bucket" anonymous GET "/$bucket/anonymous-probe"
done

run_id="$(date -u +%Y%m%dt%H%M%Sz)-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
probe="verify-probes/$run_id"
body="$(mktemp)"
trap 'rm -f -- "$body"' EXIT
printf 'verify' > "$body"

register="${BUCKET_NAME[register]}"
entry="/$register/$probe"
expect 200 "register: a new entry (If-None-Match) is accepted" register_writer PUT "$entry" -H 'If-None-Match: *' --data-binary "@$body"
expect 412 "register: the second PUT with If-None-Match is refused" register_writer PUT "$entry" -H 'If-None-Match: *' --data-binary "@$body"
expect 403 "register: an overwrite (PUT without If-None-Match) is AccessDenied" register_writer PUT "$entry" --data-binary "@$body"
expect 403 "register: GET is AccessDenied" register_writer GET "$entry"
expect 403 "register: list is AccessDenied" register_writer GET "/$register/?list-type=2"
expect 403 "register: DELETE is AccessDenied" register_writer DELETE "$entry"

# Administrative actions: refused for every key in every bucket (the bucket of its own and the others).
for who in "${KEYS[@]}"; do
  for name in "${BUCKETS[@]}"; do
    bucket="${BUCKET_NAME[$name]}"
    expect 403 "$who key: PutBucketPolicy in $name is AccessDenied" "$who" PUT "/$bucket?policy" --data-binary '{}'
    expect 403 "$who key: PutBucketVersioning in $name is AccessDenied" "$who" PUT "/$bucket?versioning" --data-binary '<VersioningConfiguration/>'
    expect 403 "$who key: PutLifecycleConfiguration in $name is AccessDenied" "$who" PUT "/$bucket?lifecycle" --data-binary '<LifecycleConfiguration/>'
    expect 403 "$who key: PutObjectRetention in $name is AccessDenied" "$who" PUT "/$bucket/$probe?retention" --data-binary '<Retention/>'
    expect 403 "$who key: DeleteObjectVersion in $name is AccessDenied" "$who" DELETE "/$bucket/$probe?versionId=verify"
  done
done

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
exit "$failed"
