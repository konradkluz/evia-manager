#!/bin/bash
# Scenario "backup deleted from a taken-over VM" (EVM-084 AC5; ADR-0011; architect 6). Run by run.sh when the monthly timer
# asks for it (EVIA_RESTORE_SCENARIO=delete); installed ONLY in an IaC session at /usr/local/lib/evia/restore/scenario.sh.
#   scenario.sh delete STATE-FILE   fresh backup (otherwise nothing is deleted), the time T, then the key backup-writer of the
#                                   VM deletes the objects of the repository (versioned bucket: delete markers appear)
#   scenario.sh heal STATE-FILE     ALWAYS after the test: the previous versions are copied over the markers
#                                   (rclone --s3-version-at T), then `pgbackrest check` and `info`; a repository that is not
#                                   whole again is the event restore-repo-heal-failed and the metric ..._heal_failed
# The restore VM restores with `pgbackrest restore --repo-target-time=T` (the state of the repository before the deletion).
# The key backup-writer has GetObjectVersion but no DeleteObjectVersion, so the deletion is always reversible (SR-INFRA-07).
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

readonly SECRETS_DIR="${EVIA_SECRETS_DIR:-/etc/evia/secrets}"
readonly PGBACKREST_BIN="${EVIA_PGBACKREST_BIN:-/usr/local/sbin/evia-pgbackrest}"
readonly RCLONE_BIN="${EVIA_RCLONE_BIN:-rclone}"
readonly SCENARIO_PREFIX="pgbackrest"

if [ "$#" -ne 2 ] || [[ ! "$1" =~ ^(delete|heal)$ ]]; then die "usage: scenario.sh delete|heal STATE-FILE"; fi
action="$1"
state_file="$2"
: "${S3_ENDPOINT:?}" "${S3_REGION:?}" "${DB_BACKUP_BUCKET:?}" "${BACKUP_WRITER_ACCESS_KEY_ID:?}"
[[ "$DB_BACKUP_BUCKET" =~ ^[a-z0-9-]+$ && "$BACKUP_WRITER_ACCESS_KEY_ID" =~ ^[A-Za-z0-9]+$ ]] || die "configuration"

# rclone with the key of backup-writer; the secret only in the environment of that one process.
bk() {
  local secret
  secret="$(< "$SECRETS_DIR/backup-s3-secret-access-key")"
  RCLONE_CONFIG_BK_TYPE=s3 RCLONE_CONFIG_BK_PROVIDER=Scaleway RCLONE_CONFIG_BK_ENDPOINT="$S3_ENDPOINT" \
    RCLONE_CONFIG_BK_REGION="$S3_REGION" RCLONE_CONFIG_BK_ACCESS_KEY_ID="$BACKUP_WRITER_ACCESS_KEY_ID" \
    RCLONE_CONFIG_BK_SECRET_ACCESS_KEY="$secret" "$RCLONE_BIN" --config /dev/null "$@"
}
repo="bk:$DB_BACKUP_BUCKET/$SCENARIO_PREFIX"

case "$action" in
  delete)
    # Only after a fresh, successful backup: a failed one means no destructive step.
    if ! "$PGBACKREST_BIN" backup --type=incr > /dev/null; then
      event restore-scenario-aborted "reason=backup-failed"
      exit 1
    fi
    before="$(bk lsf -R --files-only "$repo" | sort)"
    [ -n "$before" ] || die "the repository is empty, nothing to test"
    T="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s\n' "$before" > "$state_file.files"
    printf '%s\n' "$T" > "$state_file"
    bk delete "$repo"
    event restore-scenario-deleted "objects=$(wc -l < "$state_file.files")" "repo_target_time=$T"
    ;;
  heal)
    [ -f "$state_file" ] || exit 0
    T="$(< "$state_file")"
    [[ "$T" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z$ ]] || die "state file"
    bk copy --s3-version-at "$T" "$repo" "$repo"
    after="$(bk lsf -R --files-only "$repo" | sort)"
    if [ "$after" = "$(< "$state_file.files")" ] && "$PGBACKREST_BIN" check > /dev/null && "$PGBACKREST_BIN" info > /dev/null; then
      metric_set evia_restore_repo_heal_failed 0
      event restore-repo-healed "repo_target_time=$T"
      rm -f -- "$state_file" "$state_file.files"
    else
      metric_set evia_restore_repo_heal_failed 1
      event restore-repo-heal-failed "repo_target_time=$T"
      exit 1
    fi
    ;;
esac
