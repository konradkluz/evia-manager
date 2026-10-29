#!/bin/bash
# Bootstrap of the application secrets (EVM-007 AC7; ADR-0018 "Gdzie żyją sekrety"; SR-INFRA-05; SR-LOG-02). Installed ONLY
# in an IaC session at /usr/local/sbin/evia-init-secrets and run by the administrator with sudo:
#   evia-init-secrets           creates the MISSING files of /etc/evia/secrets; an existing file is never read for its
#                               value (except to derive a missing URL from its password), never overwritten
#   evia-init-secrets --check   prints only name, size, mode and owner of each file; never a content
# Directory 0700 root, files 0600 root. No value is ever printed or logged (stdout and stderr carry file names only).
# luks-pgdata.key (the key of the data volume, created by cloud-init) and any other file are never touched.
# Files (formats checked by apps/api/src/platform/config/config.ts):
#   postgres-password          superuser evia_owner of the PostgreSQL image (POSTGRES_PASSWORD_FILE)
#   evia-migrator-password     password of the role evia_migrator   } for `ALTER ROLE … PASSWORD` in the runbook;
#   evia-api-password          password of the role evia_api        } not in secrets.manifest.json (no service reads them)
#   database-url-migrator      postgresql://evia_migrator:<password>@postgres:5432/evia?sslmode=disable
#   database-url-app           postgresql://evia_api:<password>@postgres:5432/evia?sslmode=disable
#   cursor-key                 32 random bytes, base64url, 43 characters
#   field-encryption-keys      k1:<32 random bytes, base64url>   (list `id:key,…`; a rotation adds an entry by hand)
#   login-throttle-key         32 random bytes, base64url (separate secret, EVM-026)
# Files provided by hand in the IaC session (EVM-084; never generated, never read; --check reports MISSING until they exist):
#   media-s3-secret-access-key, deletion-register-s3-secret-access-key   S3 keys of the applications (both api)
#   media-worker-s3-secret-access-key                                     S3 key of the worker (read and delete in the media bucket; RR-42)
#   backup-s3-secret-access-key, pgbackrest-cipher-pass                  pgBackRest on PostgreSQL (key of backup-writer)
#   grafana-write-token  Grafana Cloud access policy token, write scopes only, with an expiry (EVM-085; reaches alloy only)
#   restore-reader-s3-secret-access-key, restore-orchestrator-s3-secret-access-key, media-backup-reader-s3-secret-access-key,
#   restore-hcloud-token, rclone-crypt-password, rclone-crypt-password2, restore-storagebox-password, media-copy-storagebox-password  root-only units of the restore test and the media copy
# Their copy lives in Bitwarden and the offline emergency set; none of them is a file of an application container except
# as the manifest says (secrets.manifest.json).
# Passwords are 32 random bytes in base64url (URL-safe, no escaping in the URLs). `postgres` is the service name on the
# Docker network evia-runtime (compose.infra.yaml); the traffic never leaves that bridge, hence sslmode=disable.
# A password file is the source of its URL: a missing URL is derived from the existing password; a missing password with an
# existing URL is taken from that URL (so the two never disagree). Every other missing file is generated.
# EVIA_ROOT (tests only) prefixes the paths, EVIA_EXPECTED_UID (tests only) replaces root as the owner.
set -euo pipefail
umask 077

readonly ROOT="${EVIA_ROOT:-}"
readonly OWNER_UID="${EVIA_EXPECTED_UID:-0}"
readonly DIR="$ROOT/etc/evia/secrets"
readonly MANIFEST="$ROOT/etc/evia/deploy-agent/secrets.manifest.json"
readonly DB_HOST="postgres"
readonly DB_PORT="5432"
readonly DB_NAME="evia"
readonly ROLE_MIGRATOR="evia_migrator"
readonly ROLE_API="evia_api"
readonly FILES=(postgres-password evia-migrator-password evia-api-password database-url-migrator database-url-app cursor-key field-encryption-keys login-throttle-key)
readonly EXTERNAL=(media-s3-secret-access-key media-worker-s3-secret-access-key deletion-register-s3-secret-access-key backup-s3-secret-access-key pgbackrest-cipher-pass restore-reader-s3-secret-access-key restore-orchestrator-s3-secret-access-key media-backup-reader-s3-secret-access-key restore-hcloud-token rclone-crypt-password rclone-crypt-password2 restore-storagebox-password media-copy-storagebox-password grafana-write-token)

log() { printf 'init-secrets: %s\n' "$1" >&2; }
fail() {
  log "REFUSED: $1"
  exit 1
}
owner_mode() { stat -c '%u %a' -- "$1"; }

# 32 random bytes as 43 characters of base64url without padding.
random_key() { head -c 32 /dev/urandom | base64 -w0 | tr '+/' '-_' | tr -d '='; }

[ "$#" -le 1 ] || fail "usage: evia-init-secrets [--check]"
mode="create"
if [ "$#" -eq 1 ]; then
  [ "$1" = "--check" ] || fail "usage: evia-init-secrets [--check]"
  mode="check"
fi

if [ ! -e "$DIR" ] && [ "$mode" = create ]; then install -d -m 0700 -- "$DIR"; fi
{ [ -d "$DIR" ] && [ ! -L "$DIR" ]; } || fail "$DIR is missing or not a directory"
[ "$(owner_mode "$DIR")" = "$OWNER_UID 700" ] || fail "$DIR must be 0700 root"

# Every existing file we are about to rely on must be a regular file, 0600 root; otherwise nothing is written.
for name in "${FILES[@]}" "${EXTERNAL[@]}"; do
  path="$DIR/$name"
  if [ -e "$path" ] || [ -L "$path" ]; then
    { [ -f "$path" ] && [ ! -L "$path" ]; } || fail "$name is not a regular file"
    [ "$(owner_mode "$path")" = "$OWNER_UID 600" ] || fail "$name must be 0600 root"
  fi
done

if [ "$mode" = check ]; then
  missing=0
  for name in "${FILES[@]}" "${EXTERNAL[@]}"; do
    path="$DIR/$name"
    if [ -f "$path" ]; then
      printf '%s size=%s mode=%s owner=%s\n' "$name" "$(stat -c '%s' -- "$path")" "$(stat -c '%a' -- "$path")" "$(stat -c '%u' -- "$path")"
    else
      printf '%s MISSING\n' "$name"
      missing=1
    fi
  done
  exit "$missing"
fi

# Writes a value (stdin) to a new file; an existing one is never replaced.
create() {
  local name="$1" tmp
  tmp="$(mktemp -- "$DIR/.new.XXXXXX")"
  cat > "$tmp"
  chmod 0600 -- "$tmp"
  if mv -n -- "$tmp" "$DIR/$name" && [ ! -e "$tmp" ]; then
    printf 'created: %s\n' "$name"
  else
    rm -f -- "$tmp"
    fail "$name appeared meanwhile"
  fi
}
exists() { [ -f "$DIR/$1" ]; }
url_of() { printf 'postgresql://%s:%s@%s:%s/%s?sslmode=disable' "$1" "$2" "$DB_HOST" "$DB_PORT" "$DB_NAME"; }
# The password inside an existing URL (no output of it except into the pipe of create).
password_in_url() { sed -n 's#^postgresql://[^:/@]*:\([A-Za-z0-9_-]*\)@.*#\1#p' -- "$DIR/$1"; }

# $1 password file, $2 URL file, $3 role
database_pair() {
  local password_file="$1" url_file="$2" role="$3" password
  if ! exists "$password_file"; then
    if exists "$url_file"; then
      password="$(password_in_url "$url_file")"
      [ "${#password}" -ge 32 ] || fail "$url_file has no password of the expected shape; fix it by hand"
      printf '%s' "$password" | create "$password_file"
    else
      random_key | tr -d '\n' | create "$password_file"
    fi
  fi
  if ! exists "$url_file"; then
    password="$(< "$DIR/$password_file")"
    url_of "$role" "$password" | create "$url_file"
  fi
}

exists postgres-password || random_key | create postgres-password
database_pair evia-migrator-password database-url-migrator "$ROLE_MIGRATOR"
database_pair evia-api-password database-url-app "$ROLE_API"
exists cursor-key || random_key | create cursor-key
exists field-encryption-keys || printf 'k1:%s' "$(random_key)" | create field-encryption-keys
exists login-throttle-key || random_key | create login-throttle-key

# Every file of the manifest of the services must exist (the manifest is installed later in the session: then only a note).
if [ -f "$MANIFEST" ]; then
  command -v jq > /dev/null || fail "jq is needed to read the manifest"
  for name in $(jq -r '.services[].files[]' "$MANIFEST" | sort -u); do
    [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]] || fail "manifest: file name"
    if [[ " ${EXTERNAL[*]} " == *" $name "* ]]; then
      [ -f "$DIR/$name" ] || log "provide $name by hand (IaC session); evia-init-secrets --check lists it as MISSING"
      continue
    fi
    { [ -f "$DIR/$name" ] && [ ! -L "$DIR/$name" ]; } || fail "the manifest needs $name, which this script does not create"
  done
else
  log "no secrets manifest yet; run evia-init-secrets --check after installing it"
fi
