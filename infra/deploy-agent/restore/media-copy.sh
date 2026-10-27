#!/bin/bash
# Copy of the media to the Storage Box (EVM-084 AC2; ADR-0009, ADR-0011; security-engineer P8). Installed ONLY in an IaC session at
# /usr/local/sbin/evia-media-copy and run daily by evia-media-copy.timer. Source: the bucket of the media with the separate READ key
# media-backup-reader (not the key of the application). Target: rclone crypt (filename_encryption=standard, two passwords from
# secret files) over SFTP to the Storage Box subaccount, host key pinned (known_hosts), limited to its directory. `rclone copy`
# never deletes on the target: a deletion in the bucket does not propagate; the history is the snapshots of the Storage Box,
# managed outside the VM. Secrets reach only the environment of the rclone processes, never argv or the log.
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

readonly SECRETS_DIR="${EVIA_SECRETS_DIR:-/etc/evia/secrets}"
readonly RCLONE_BIN="${EVIA_RCLONE_BIN:-rclone}"
: "${S3_ENDPOINT:?}" "${S3_REGION:?}" "${MEDIA_BUCKET:?}" "${MEDIA_BACKUP_READER_ACCESS_KEY_ID:?}" "${STORAGEBOX_HOST:?}" "${STORAGEBOX_COPY_USER:?}"
[[ "$MEDIA_BUCKET" =~ ^[a-z0-9-]+$ && "$MEDIA_BACKUP_READER_ACCESS_KEY_ID" =~ ^[A-Za-z0-9]+$ && "$STORAGEBOX_HOST" =~ ^[a-z0-9.-]+$ ]] || die "configuration"

secret() { tr -d '\n' < "$SECRETS_DIR/$1"; }
obscure() { secret "$1" | "$RCLONE_BIN" obscure -; }

copy_media() {
  local reader_secret box_pass crypt_one crypt_two
  reader_secret="$(secret media-backup-reader-s3-secret-access-key)"
  box_pass="$(obscure media-copy-storagebox-password)"
  crypt_one="$(obscure rclone-crypt-password)"
  crypt_two="$(obscure rclone-crypt-password2)"
  RCLONE_CONFIG_SRC_TYPE=s3 RCLONE_CONFIG_SRC_PROVIDER=Scaleway RCLONE_CONFIG_SRC_ENDPOINT="$S3_ENDPOINT" RCLONE_CONFIG_SRC_REGION="$S3_REGION" \
    RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$MEDIA_BACKUP_READER_ACCESS_KEY_ID" RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$reader_secret" \
    RCLONE_CONFIG_BOX_TYPE=sftp RCLONE_CONFIG_BOX_HOST="$STORAGEBOX_HOST" RCLONE_CONFIG_BOX_PORT="${STORAGEBOX_SFTP_PORT:-23}" \
    RCLONE_CONFIG_BOX_USER="$STORAGEBOX_COPY_USER" RCLONE_CONFIG_BOX_PASS="$box_pass" \
    RCLONE_CONFIG_BOX_KNOWN_HOSTS_FILE="${STORAGEBOX_KNOWN_HOSTS:-/etc/evia/media-copy/storagebox_known_hosts}" \
    RCLONE_CONFIG_MEDIA_TYPE=crypt RCLONE_CONFIG_MEDIA_REMOTE="box:${STORAGEBOX_MEDIA_PATH:-media}" RCLONE_CONFIG_MEDIA_FILENAME_ENCRYPTION=standard \
    RCLONE_CONFIG_MEDIA_PASSWORD="$crypt_one" RCLONE_CONFIG_MEDIA_PASSWORD2="$crypt_two" \
    "$RCLONE_BIN" --config /dev/null copy --checksum "src:$MEDIA_BUCKET" media:
}

if copy_media; then
  metric_set evia_media_copy_last_success_timestamp_seconds "$(now_epoch)"
  metric_set evia_media_copy_last_failed 0
  event media-copy-succeeded
else
  metric_set evia_media_copy_last_failed 1
  event media-copy-failed
  exit 1
fi
