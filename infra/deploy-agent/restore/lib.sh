#!/bin/bash
# Shared functions of the restore test and the sweeper (EVM-084 AC3, AC4; ADR-0018 "Test odtworzenia"; SR-INFRA-05/07;
# security-engineer P6, P9, P10). Sourced by run.sh and sweep.sh; installed in an IaC session next to them. Nothing here
# prints a token, a response body, user-data or a signed URL: the log carries names, ids and status codes only (SR-LOG-02).
# The API of Hetzner is reached ONLY at the exact address below with https; the address can be replaced only in test mode
# (EVIA_RESTORE_TEST_MODE=1) and only by http://127.0.0.1:<port>/v1. No redirect is ever followed, so the token cannot leave.
set +x
umask 077

readonly HCLOUD_API_DEFAULT='https://api.hetzner.cloud/v1'
readonly STATE_DIR="${EVIA_RESTORE_STATE:-/var/lib/evia/restore}"
readonly METRICS_DIR="${EVIA_METRICS_DIR:-/var/lib/evia/metrics}"
readonly HCLOUD_TOKEN_FILE="${HCLOUD_TOKEN_FILE:-/etc/evia/secrets/restore-hcloud-token}"
readonly LABEL_KEY="evia-restore"
readonly LABEL_VALUE="staging"
# EU locations only (SR-INFRA-01)
readonly LOCATIONS_ALLOWED=(fsn1 nbg1 hel1)

# The label selector (URL-encoded) of the resources of the test and the EU-location check.
label_selector() { printf '%s%%3D%s' "$LABEL_KEY" "$LABEL_VALUE"; }
location_allowed() { [[ " ${LOCATIONS_ALLOWED[*]} " == *" $1 "* ]]; }

log() { printf '%s evia-restore: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >&2; }
die() {
  log "REFUSED: $1"
  exit 1
}

# Epoch seconds; the clock is injected only in test mode.
now_epoch() {
  if [ "${EVIA_RESTORE_TEST_MODE:-}" = 1 ] && [ -n "${EVIA_RESTORE_NOW:-}" ]; then
    date -u -d "$EVIA_RESTORE_NOW" +%s
  else
    date -u +%s
  fi
}

# Transport of the API: https for the real address, http only for loopback in test mode.
API_BASE="$HCLOUD_API_DEFAULT"
API_PROTO="https"
select_api() {
  local requested="${HCLOUD_API:-$HCLOUD_API_DEFAULT}"
  if [ "$requested" = "$HCLOUD_API_DEFAULT" ]; then
    return 0
  fi
  if [ "${EVIA_RESTORE_TEST_MODE:-}" = 1 ] && [[ "$requested" =~ ^http://127\.0\.0\.1:[0-9]{2,5}/v1$ ]]; then
    API_BASE="$requested"
    API_PROTO="http"
    return 0
  fi
  die "HCLOUD_API is not allowed (only $HCLOUD_API_DEFAULT; http://127.0.0.1 only in test mode)"
}

WORK=""
init_work() {
  install -d -m 0700 -- "$STATE_DIR"
  WORK="$(mktemp -d -- "$STATE_DIR/work.XXXXXX")"
}
drop_work() {
  [ -z "$WORK" ] || rm -rf -- "$WORK"
}

# hc_request METHOD PATH [BODY-FILE] -> body on stdout; return 1 on any status other than 2xx (the body is never logged).
# The token goes to curl on stdin as a config (never in argv); no -L; both timeouts bounded.
hc_request() {
  local method="$1" path="$2" body="${3:-}" out code token
  [ -r "$HCLOUD_TOKEN_FILE" ] || die "no token file"
  token="$(< "$HCLOUD_TOKEN_FILE")"
  out="$(mktemp -- "$WORK/response.XXXXXX")"
  local args=(-sS --proto "=$API_PROTO" --connect-timeout 10 --max-time 60 -X "$method" -o "$out" -w '%{http_code}' --config -)
  if [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' --data-binary "@$body"); fi
  code="$(printf 'header = "Authorization: Bearer %s"\n' "$token" | curl "${args[@]}" "$API_BASE$path" 2> /dev/null)" || code="000"
  token=""
  if [[ ! "$code" =~ ^2[0-9][0-9]$ ]]; then
    log "api $method ${path%%\?*} -> $code"
    rm -f -- "$out"
    return 1
  fi
  cat -- "$out"
  rm -f -- "$out"
}

# hc_list PATH KEY [QUERY] -> one compact JSON object per line, all pages (meta.pagination.next_page).
hc_list() {
  local path="$1" key="$2" query="${3:-}" page=1 response next sep='?'
  [[ "$path" == *\?* ]] && sep='&'
  [ -z "$query" ] || query="${query}&"
  local guard=0
  while [ -n "$page" ]; do
    guard=$((guard + 1))
    [ "$guard" -le 200 ] || return 1
    response="$(hc_request GET "${path}${sep}${query}page=${page}&per_page=50")" || return 1
    jq -c --arg key "$key" '.[$key][]?' <<< "$response" || return 1
    next="$(jq -r '.meta.pagination.next_page // empty' <<< "$response")" || return 1
    [[ -z "$next" || "$next" =~ ^[0-9]+$ ]] || return 1
    page="$next"
  done
}

# event NAME [key=value ...]: one JSON line in events.jsonl (local event, delivery of the alert is EVM-085).
event() {
  local name="$1" line pair
  shift
  install -d -m 0700 -- "$STATE_DIR"
  line="$(jq -cn --arg event "$name" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{ts: $ts, event: $event}')"
  for pair in "$@"; do
    line="$(jq -c --arg key "${pair%%=*}" --arg value "${pair#*=}" '. + {($key): $value}' <<< "$line")"
  done
  printf '%s\n' "$line" >> "$STATE_DIR/events.jsonl"
  log "event $name"
}

# metric_set NAME VALUE: the textfile of the node exporter (metric names agreed with EVM-085 in docs/ops/runbooks/restore.md).
metric_set() {
  local name="$1" value="$2" state="$STATE_DIR/metrics.state"
  [[ "$name" =~ ^evia_[a-z_]+$ && "$value" =~ ^[0-9]+$ ]] || die "metric"
  install -d -m 0700 -- "$STATE_DIR"
  install -d -m 0755 -- "$METRICS_DIR"
  touch -- "$state"
  { grep -v "^$name " "$state" || true; printf '%s %s\n' "$name" "$value"; } | sort > "$state.new"
  mv -f -- "$state.new" "$state"
  install -m 0644 -- "$state" "$METRICS_DIR/evia_restore.prom.new"
  mv -f -- "$METRICS_DIR/evia_restore.prom.new" "$METRICS_DIR/evia_restore.prom"
}

# age_seconds CREATED -> seconds since the ISO timestamp from the field `created`, in UTC; fails on an unparsable value.
age_seconds() {
  local created="$1" since
  [[ "$created" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$ ]] || return 1
  since="$(date -u -d "$created" +%s)" || return 1
  echo $(($(now_epoch) - since))
}
