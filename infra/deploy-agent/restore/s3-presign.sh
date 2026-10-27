#!/bin/bash
# Presigned S3 URL (AWS Signature Version 4, query string) for the restore test (EVM-084 AC3; security-engineer P5, P9):
# the result of the test is written by the temporary VM with ONE signed PUT and read back by the orchestrator with a signed GET.
#   s3-presign.sh METHOD HOST PATH EXPIRES ACCESS-KEY-ID REGION [if-none-match]
# The secret is read from the file in S3_SECRET_FILE, never from argv or the environment of a child. With `if-none-match`
# the header If-None-Match: * is signed: a second PUT to the same URL is refused by the bucket (412), so the URL works once.
# HMAC is computed here from openssl sha256 over stdin, so the key never appears in a command line.
# The lifetime is limited to S3_PRESIGN_MAX_EXPIRES (default 7200 s = 2 h). EVIA_PRESIGN_DATE (test mode only) fixes the time.
set -euo pipefail
set +x

hex2bin() {
  local hex="$1" index
  for ((index = 0; index < ${#hex}; index += 2)); do printf '%b' "\\x${hex:index:2}"; done
}
sha256_hex() { openssl dgst -sha256 -binary | od -An -vtx1 | tr -d ' \n'; }

# hmac_hex KEY-HEX MESSAGE: HMAC-SHA256 as hex (block size 64 bytes; keys here are at most 44 bytes).
hmac_hex() {
  local key="$1" message="$2" index byte byte_hex ipad="" opad="" inner
  while [ "${#key}" -lt 128 ]; do key="${key}00"; done
  for ((index = 0; index < 128; index += 2)); do
    byte=$((16#${key:index:2}))
    printf -v byte_hex '%02x' $((byte ^ 0x36))
    ipad+="$byte_hex"
    printf -v byte_hex '%02x' $((byte ^ 0x5c))
    opad+="$byte_hex"
  done
  inner="$({ hex2bin "$ipad"; printf '%s' "$message"; } | sha256_hex)"
  { hex2bin "$opad"; hex2bin "$inner"; } | sha256_hex
}

if [ "$#" -lt 6 ] || [ "$#" -gt 7 ]; then
  echo "usage: s3-presign.sh METHOD HOST PATH EXPIRES ACCESS-KEY-ID REGION [if-none-match]" >&2
  exit 1
fi
method="$1" host="$2" path="$3" expires="$4" access_key="$5" region="$6" conditional="${7:-}"
[[ "$method" =~ ^(GET|PUT)$ ]] || { echo "presign: method" >&2; exit 1; }
[[ "$host" =~ ^[a-z0-9.-]+(:[0-9]{1,5})?$ ]] || { echo "presign: host" >&2; exit 1; }
[[ "$path" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "presign: path" >&2; exit 1; }
[[ "$access_key" =~ ^[A-Za-z0-9]+$ ]] || { echo "presign: access key id" >&2; exit 1; }
[[ "$region" =~ ^[a-z0-9-]+$ ]] || { echo "presign: region" >&2; exit 1; }
if [[ ! "$expires" =~ ^[0-9]+$ ]] || [ "$expires" -lt 1 ] || [ "$expires" -gt "${S3_PRESIGN_MAX_EXPIRES:-7200}" ]; then
  echo "presign: lifetime above the limit" >&2
  exit 1
fi
[ -z "$conditional" ] || [ "$conditional" = if-none-match ] || { echo "presign: option" >&2; exit 1; }
if [ -z "${S3_SECRET_FILE:-}" ] || [ ! -r "$S3_SECRET_FILE" ]; then
  echo "presign: no secret file" >&2
  exit 1
fi

# https always; http only in test mode (the stand-in of S3 on the loopback)
scheme="https"
if [ "${EVIA_RESTORE_TEST_MODE:-}" = 1 ] && [ "${S3_PRESIGN_SCHEME:-}" = http ]; then scheme="http"; fi

if [ "${EVIA_RESTORE_TEST_MODE:-}" = 1 ] && [ -n "${EVIA_PRESIGN_DATE:-}" ]; then
  stamp="$EVIA_PRESIGN_DATE"
else
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
fi
day="${stamp%%T*}"
scope="$day/$region/s3/aws4_request"

signed_headers="host"
canonical_headers="host:$host"$'\n'
if [ -n "$conditional" ]; then
  signed_headers="host;if-none-match"
  canonical_headers+="if-none-match:*"$'\n'
fi
credential="${access_key}%2F${day}%2F${region}%2Fs3%2Faws4_request"
query="X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${credential}&X-Amz-Date=${stamp}&X-Amz-Expires=${expires}&X-Amz-SignedHeaders=${signed_headers//;/%3B}"

canonical="$method"$'\n'"$path"$'\n'"$query"$'\n'"$canonical_headers"$'\n'"$signed_headers"$'\n'"UNSIGNED-PAYLOAD"
to_sign="AWS4-HMAC-SHA256"$'\n'"$stamp"$'\n'"$scope"$'\n'"$(printf '%s' "$canonical" | sha256_hex)"

secret="$(< "$S3_SECRET_FILE")"
key="$(printf '%s' "AWS4$secret" | od -An -vtx1 | tr -d ' \n')"
secret=""
for part in "$day" "$region" s3 aws4_request; do key="$(hmac_hex "$key" "$part")"; done
signature="$(hmac_hex "$key" "$to_sign")"
printf '%s://%s%s?%s&X-Amz-Signature=%s\n' "$scheme" "$host" "$path" "$query" "$signature"
