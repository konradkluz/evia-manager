#!/bin/bash
# Verification of the buckets and application keys (EVM-084 AC2; SR-INFRA-02; architect 3, 4). Run in the IaC session after every
# change of the buckets or policies, with the REAL keys (docs/qa/EVM-084/ holds the output): it only asks and prints ok / FAIL lines
# (never a key, a response or a header value) and exits 1 on any FAIL.
#   - anonymous GET and list of every bucket -> 403
#   - register key: a PUT with If-None-Match works once (200), the second is 412, a PUT without it, GET, list and DELETE -> 403
#   - application keys: PutBucketPolicy, PutBucketVersioning, PutLifecycleConfiguration, PutObjectRetention, DeleteObjectVersion -> 403
#   - an object written by the media key carries x-amz-server-side-encryption (SSE-ONE)
# Requests are signed by curl (--aws-sigv4); the secret goes to curl on stdin, never into argv.
set -euo pipefail
set +x
umask 077

readonly SECRETS_DIR="${EVIA_SECRETS_DIR:-/etc/evia/secrets}"
: "${S3_ENDPOINT:?}" "${S3_REGION:?}" "${MEDIA_BUCKET:?}" "${DELETION_REGISTER_BUCKET:?}" "${DB_BACKUP_BUCKET:?}"
: "${MEDIA_S3_ACCESS_KEY_ID:?}" "${DELETION_REGISTER_S3_ACCESS_KEY_ID:?}" "${BACKUP_WRITER_ACCESS_KEY_ID:?}"
if [[ ! "$S3_ENDPOINT" =~ ^https://[a-z0-9.-]+$ && ! ( "${EVIA_RESTORE_TEST_MODE:-}" = 1 && "$S3_ENDPOINT" =~ ^http://127\.0\.0\.1:[0-9]+$ ) ]]; then
  echo "bucket-verify: S3_ENDPOINT" >&2
  exit 1
fi
failed=0

# code KEY-NAME METHOD PATH [curl args...] -> HTTP status; KEY-NAME is media, register, backup or anonymous.
code() {
  local who="$1" method="$2" path="$3" id="" file="" secret=""
  shift 3
  case "$who" in
    media) id="$MEDIA_S3_ACCESS_KEY_ID" file=media-s3-secret-access-key ;;
    register) id="$DELETION_REGISTER_S3_ACCESS_KEY_ID" file=deletion-register-s3-secret-access-key ;;
    backup) id="$BACKUP_WRITER_ACCESS_KEY_ID" file=backup-s3-secret-access-key ;;
  esac
  local args=(-sS --proto "=${S3_ENDPOINT%%://*}" --max-time 30 -o /dev/null -w '%{http_code}' -X "$method")
  if [ -n "$id" ]; then
    secret="$(< "$SECRETS_DIR/$file")"
    printf 'user = "%s:%s"\n' "$id" "$secret" | curl "${args[@]}" --aws-sigv4 "aws:amz:$S3_REGION:s3" --config - "$@" "$S3_ENDPOINT$path" 2> /dev/null || printf '000'
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

for bucket in "$MEDIA_BUCKET" "$DELETION_REGISTER_BUCKET" "$DB_BACKUP_BUCKET"; do
  expect 403 "anonymous list of $bucket" anonymous GET "/$bucket/"
  expect 403 "anonymous GET in $bucket" anonymous GET "/$bucket/anonymous-probe"
done

probe="verify-probes/$(date -u +%Y%m%dt%H%M%Sz)-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
body="$(mktemp)"
trap 'rm -f -- "$body"' EXIT
printf 'verify' > "$body"

entry="/$DELETION_REGISTER_BUCKET/$probe"
expect 200 "register: a new entry (If-None-Match) is accepted" register PUT "$entry" -H 'If-None-Match: *' --data-binary "@$body"
expect 412 "register: the second PUT with If-None-Match is refused" register PUT "$entry" -H 'If-None-Match: *' --data-binary "@$body"
expect 403 "register: an overwrite (PUT without If-None-Match) is AccessDenied" register PUT "$entry" --data-binary "@$body"
expect 403 "register: GET is AccessDenied" register GET "$entry"
expect 403 "register: list is AccessDenied" register GET "/$DELETION_REGISTER_BUCKET/?list-type=2"
expect 403 "register: DELETE is AccessDenied" register DELETE "$entry"

for who in media register backup; do
  case "$who" in media) bucket="$MEDIA_BUCKET" ;; register) bucket="$DELETION_REGISTER_BUCKET" ;; *) bucket="$DB_BACKUP_BUCKET" ;; esac
  expect 403 "$who key: PutBucketPolicy is AccessDenied" "$who" PUT "/$bucket?policy" --data-binary '{}'
  expect 403 "$who key: PutBucketVersioning is AccessDenied" "$who" PUT "/$bucket?versioning" --data-binary '<VersioningConfiguration/>'
  expect 403 "$who key: PutLifecycleConfiguration is AccessDenied" "$who" PUT "/$bucket?lifecycle" --data-binary '<LifecycleConfiguration/>'
  expect 403 "$who key: PutObjectRetention is AccessDenied" "$who" PUT "/$bucket/$probe?retention" --data-binary '<Retention/>'
  expect 403 "$who key: DeleteObjectVersion is AccessDenied" "$who" DELETE "/$bucket/$probe?versionId=verify"
done

expect 200 "media key: PutObject works" media PUT "/$MEDIA_BUCKET/$probe" --data-binary "@$body"
secret="$(< "$SECRETS_DIR/media-s3-secret-access-key")"
headers="$(printf 'user = "%s:%s"\n' "$MEDIA_S3_ACCESS_KEY_ID" "$secret" | curl -sS --proto "=${S3_ENDPOINT%%://*}" --max-time 30 -I --aws-sigv4 "aws:amz:$S3_REGION:s3" --config - "$S3_ENDPOINT/$MEDIA_BUCKET/$probe" 2> /dev/null || true)"
if grep -qi '^x-amz-server-side-encryption: *AES256' <<< "$headers"; then
  echo "ok: the media object is encrypted (SSE-ONE)"
else
  echo "FAIL: the media object has no x-amz-server-side-encryption header"
  failed=1
fi
exit "$failed"
