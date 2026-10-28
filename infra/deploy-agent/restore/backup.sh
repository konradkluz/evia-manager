#!/bin/bash
# Scheduled backup of the database (EVM-084 AC1; ADR-0011). Installed ONLY in an IaC session at /usr/local/sbin/evia-backup and
# run by evia-backup-full.timer (weekly) and evia-backup-diff.timer (daily): `evia-backup full|diff|incr`.
# pgBackRest backs up (encrypted, to the bucket evia-staging-db-backup, outside the VM) and checks the archive. A failed backup is a
# local event (backup-failed) and the metric evia_backup_last_failed 1; the alert reaches Konrad with EVM-085.
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

readonly PGBACKREST_BIN="${EVIA_PGBACKREST_BIN:-/usr/local/sbin/evia-pgbackrest}"
if [ "$#" -ne 1 ] || [[ ! "$1" =~ ^(full|diff|incr)$ ]]; then die "usage: evia-backup full|diff|incr"; fi
kind="$1"

if "$PGBACKREST_BIN" backup --type="$kind" > /dev/null && "$PGBACKREST_BIN" check > /dev/null; then
  metric_set evia_backup_last_success_timestamp_seconds "$(now_epoch)"
  metric_set evia_backup_last_failed 0
  event backup-succeeded "type=$kind"
else
  metric_set evia_backup_last_failure_timestamp_seconds "$(now_epoch)"
  metric_set evia_backup_last_failed 1
  event backup-failed "type=$kind"
  exit 1
fi
