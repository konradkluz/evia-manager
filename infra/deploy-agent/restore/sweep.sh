#!/bin/bash
# Sweeper of the project evia-restore-staging (EVM-084 AC4; ADR-0018; security-engineer P10). Installed ONLY in an IaC
# session at /usr/local/sbin/evia-restore-sweep and run every hour by evia-restore-sweep.timer. Deletes every resource
# older than 24 hours (age from the field `created`, UTC, strictly older): servers, volumes, images of type snapshot or
# backup, primary IPs and firewalls labelled evia-restore=staging — every type the orchestrator (run.sh) can create.
# Fail-closed: an API error, an unparsable date or a failed deletion is an event and exit code 1, never a silent skip.
# Every deletion is the event `restore-sweep-deleted`; delivery of the alert is EVM-085.
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

readonly MAX_AGE="${EVIA_SWEEP_MAX_AGE_SECONDS:-86400}"
failed=0
deleted=0

select_api
init_work
trap drop_work EXIT

# sweep KIND PATH KEY [QUERY]: lists all pages and deletes the old resources of one kind.
sweep() {
  local kind="$1" path="$2" key="$3" query="${4:-}" listing item id created age
  if ! listing="$(hc_list "$path" "$key" "$query")"; then
    event restore-sweep-failed "kind=$kind" "reason=list"
    failed=1
    return 0
  fi
  while IFS= read -r item; do
    [ -n "$item" ] || continue
    id="$(jq -r '.id | tostring' <<< "$item")"
    created="$(jq -r '.created // empty' <<< "$item")"
    if [[ ! "$id" =~ ^[0-9]+$ ]] || ! age="$(age_seconds "$created")"; then
      event restore-sweep-failed "kind=$kind" "reason=unreadable-resource" "id=$id"
      failed=1
      continue
    fi
    [ "$age" -gt "$MAX_AGE" ] || continue
    if hc_request DELETE "$path/$id" > /dev/null; then
      event restore-sweep-deleted "kind=$kind" "id=$id" "age_seconds=$age"
      deleted=$((deleted + 1))
    else
      event restore-sweep-failed "kind=$kind" "reason=delete" "id=$id"
      failed=1
    fi
  done <<< "$listing"
}

# Order: servers first, so volumes, addresses and firewalls are free to delete.
sweep servers /servers servers
sweep volumes /volumes volumes
sweep images /images images "type=snapshot"
sweep images /images images "type=backup"
sweep primary_ips /primary_ips primary_ips
sweep firewalls /firewalls firewalls "label_selector=$(label_selector)"

metric_set evia_restore_sweeper_last_run_timestamp_seconds "$(now_epoch)"
metric_set evia_restore_sweeper_last_run_failed "$failed"
metric_set evia_restore_sweeper_last_deleted "$deleted"
exit "$failed"
