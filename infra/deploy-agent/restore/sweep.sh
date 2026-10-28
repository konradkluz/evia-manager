#!/bin/bash
# Sweeper of the project evia-restore-staging (EVM-084 AC4; ADR-0018; security-engineer P10). Installed ONLY in an IaC
# session at /usr/local/sbin/evia-restore-sweep and run every hour by evia-restore-sweep.timer. Deletes every resource
# older than 24 hours (age from the field `created`, UTC, strictly older): servers and firewalls labelled evia-restore=staging,
# volumes, images of type snapshot or backup and primary IPs — every type the orchestrator (run.sh) can create.
# Guard BEFORE any deletion (a token of another project must never make this script destructive; CWE-284):
#   1. the sentinel: a firewall labelled evia-project=evia-restore-staging must exist (created in the IaC session in this project only);
#   2. no foreign resource: every server and every volume of the project carries evia-restore=staging.
# Otherwise the event `restore-sweep-refused` (reason no-sentinel or foreign-resource), the metric ..._last_run_failed 1, exit code 1,
# and nothing is deleted. Fail-closed: an API error, an unparsable date or a failed deletion is an event and exit code 1.
# Every deletion is the event `restore-sweep-deleted`; delivery of the alert is EVM-085.
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

readonly MAX_AGE="${EVIA_SWEEP_MAX_AGE_SECONDS:-86400}"
readonly SENTINEL_SELECTOR='evia-project%3Devia-restore-staging'
failed=0
deleted=0

select_api
init_work
trap drop_work EXIT

# refuse KEY=VALUE...: the guard failed — nothing was deleted.
refuse() {
  event restore-sweep-refused "$@"
  metric_set evia_restore_sweeper_last_run_timestamp_seconds "$(now_epoch)"
  metric_set evia_restore_sweeper_last_run_failed 1
  metric_set evia_restore_sweeper_last_deleted 0
  exit 1
}

# guard: the project is the project of the restore test (sentinel) and holds nothing foreign (servers, volumes).
guard() {
  local sentinel kind foreign
  sentinel="$(hc_list /firewalls firewalls "label_selector=$SENTINEL_SELECTOR" | jq -r '.id' | sed -n 1p)" || refuse "reason=list" "kind=sentinel"
  [ -n "$sentinel" ] || refuse "reason=no-sentinel"
  for kind in servers volumes; do
    foreign="$(hc_list "/$kind" "$kind" | jq -r --arg key "$LABEL_KEY" --arg value "$LABEL_VALUE" 'select((.labels // {})[$key] != $value) | .id' | sed -n 1p)" ||
      refuse "reason=list" "kind=$kind"
    [ -z "$foreign" ] || refuse "reason=foreign-resource" "kind=$kind" "id=$foreign"
  done
}

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

guard

# Order: servers first, so volumes, addresses and firewalls are free to delete.
sweep servers /servers servers "label_selector=$(label_selector)"
sweep volumes /volumes volumes
sweep images /images images "type=snapshot"
sweep images /images images "type=backup"
sweep primary_ips /primary_ips primary_ips
sweep firewalls /firewalls firewalls "label_selector=$(label_selector)"

metric_set evia_restore_sweeper_last_run_timestamp_seconds "$(now_epoch)"
metric_set evia_restore_sweeper_last_run_failed "$failed"
metric_set evia_restore_sweeper_last_deleted "$deleted"
exit "$failed"
