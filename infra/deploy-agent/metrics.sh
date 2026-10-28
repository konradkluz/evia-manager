#!/bin/bash
# Metrics of the deployment channel for the node exporter textfile collector (EVM-085 AC2; security-engineer A10; RR-24).
# Root script, installed ONLY in an IaC session at /usr/local/sbin/evia-metrics and run every minute by evia-metrics.timer.
# It reads files written by the verifier (UNTRUSTED: state.json, result.json, registry.json) and by the IaC session
# (expiries.json: names and dates, no values) and writes ONE file, /var/lib/evia/metrics/evia_agent.prom, atomically
# (tmp + mv in the same directory). Every value is validated before it is written (CWE-74, CWE-117: a newline or a brace in
# a commit must not inject a series): a failed check writes NOTHING (fail-closed; the old file stays, its timestamps age and the
# heartbeat alert fires). Labels come from closed sets: `commit` is 40 hex, `token` is a name of the form [a-z0-9-]+ from expiries.json
# or the fixed name github-pat — never a value or a part of a secret. The script never connects to Grafana and reads nothing
# from it (RR-24); the only network call is GET /rate_limit of the GitHub API with the PAT of the agent (a header file, never
# the command line), whose response headers are parsed in memory and never logged. No eval.
set -euo pipefail
umask 022

readonly ROOT="${EVIA_ROOT:-}"
readonly STATE_FILE="$ROOT/var/lib/evia/agent/state/state.json"
readonly RESULT_FILE="$ROOT/var/lib/evia/agent/out/result.json"
readonly REGISTRY_FILE="$ROOT/var/lib/evia/registry/registry.json"
readonly EXPIRIES_FILE="$ROOT/etc/evia/deploy-agent/expiries.json"
readonly PAT_FILE="$ROOT/etc/evia/secrets/github-pat"
readonly OUT_DIR="$ROOT/var/lib/evia/metrics"
readonly OUT_FILE="$OUT_DIR/evia_agent.prom"
readonly MISMATCH_DIR="$ROOT/var/lib/evia/metrics-state"
readonly MISMATCH_FILE="$MISMATCH_DIR/head-mismatch"
readonly MAX_BYTES=1048576
readonly ISO_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$'
readonly DAY_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
readonly SHA_RE='^[0-9a-f]{40}$'
readonly NAME_RE='^[a-z0-9-]{1,63}$'

log() { printf '%s metrics: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >&2; }
fail() {
  log "REFUSED: $1 (the metrics file was not written)"
  exit 1
}

# read_json FILE: the content of a JSON file within the size limit; empty output when the file does not exist.
read_json() {
  [ -f "$1" ] || return 0
  [ "$(stat -c %s -- "$1")" -le "$MAX_BYTES" ] || fail "$(basename -- "$1") too large"
  jq -e . -- "$1" > /dev/null 2>&1 || fail "$(basename -- "$1") is not JSON"
  cat -- "$1"
}

# epoch ISO: seconds since the epoch of a validated UTC timestamp (or a validated day, midnight UTC).
epoch() {
  local value="$1"
  [[ "$value" =~ $ISO_RE || "$value" =~ $DAY_RE ]] || fail "unexpected timestamp format"
  date -u -d "$value" +%s 2> /dev/null || fail "unreadable timestamp"
}

now="$(date -u +%s)"
[[ "$now" =~ ^[0-9]+$ ]] || fail "clock"

state="$(read_json "$STATE_FILE")"
result="$(read_json "$RESULT_FILE")"
registry="$(read_json "$REGISTRY_FILE")"
expiries="$(read_json "$EXPIRIES_FILE")"

lines=()
add() { lines+=("$1"); }

# 1. Heartbeat: the last cycle of the verifier that did not reject (state.json, written by the verifier).
if [ -n "$state" ]; then
  last_success="$(jq -r '.lastSuccess | if type == "string" then . else "" end' <<< "$state")"
  if [ -n "$last_success" ]; then
    last_success_epoch="$(epoch "$last_success")"
    add "evia_deploy_agent_last_success_timestamp_seconds $last_success_epoch"
  fi
fi

# 2. Gate V0: the last decision is a rejection with a reason that starts with v0-blocked.
v0=0
if [ -n "$result" ]; then
  decision="$(jq -r '.decision | if type == "string" then . else "" end' <<< "$result")"
  case "$decision" in deploy | rollback | none | reject) ;; *) fail "decision" ;; esac
  if [ "$decision" = reject ] && jq -e '[.reasons[]? | strings | select(startswith("v0-blocked"))] | length > 0' <<< "$result" > /dev/null; then
    v0=1
  fi
fi
add "evia_deploy_agent_v0_blocked $v0"

# 3. The deployed commit and the mismatch with HEAD of main (the time since which they differ).
deployed=""
if [ -n "$registry" ]; then
  deployed="$(jq -r '.entries | if type == "array" and length > 0 then (.[-1].commit | if type == "string" then . else "" end) else "" end' <<< "$registry")"
  if [ -n "$deployed" ]; then
    [[ "$deployed" =~ $SHA_RE ]] || fail "deployed commit"
    add "evia_deploy_agent_deployed_info{commit=\"$deployed\"} 1"
  fi
fi
head=""
if [ -n "$result" ]; then
  head="$(jq -r '.head | if type == "string" then . else "" end' <<< "$result")"
  if [ -n "$head" ]; then
    [[ "$head" =~ $SHA_RE ]] || fail "head commit"
  fi
fi
mismatch_since=0
if [ -n "$deployed" ] && [ -n "$head" ]; then
  if [ "$head" = "$deployed" ]; then
    rm -f -- "$MISMATCH_FILE"
  else
    install -d -m 0700 -- "$MISMATCH_DIR"
    if [ -f "$MISMATCH_FILE" ] && read -r stored_head stored_since < "$MISMATCH_FILE" && [ "$stored_head" = "$head" ] && [[ "$stored_since" =~ ^[0-9]+$ ]]; then
      mismatch_since=$((now - stored_since))
    else
      printf '%s %s\n' "$head" "$now" > "$MISMATCH_FILE.tmp"
      mv -f -- "$MISMATCH_FILE.tmp" "$MISMATCH_FILE"
    fi
  fi
elif [ -f "$MISMATCH_FILE" ] && read -r _ stored_since < "$MISMATCH_FILE" && [[ "$stored_since" =~ ^[0-9]+$ ]]; then
  mismatch_since=$((now - stored_since))
fi
[ "$mismatch_since" -ge 0 ] || mismatch_since=0
add "evia_deploy_agent_main_head_mismatch_since_seconds $mismatch_since"

# 4. Expiry of tokens and keys: names and dates from expiries.json; the PAT itself from the header of GitHub (it wins).
declare -A expiry=()
if [ -n "$expiries" ]; then
  jq -e 'type == "object" and (.tokens | type == "array")' <<< "$expiries" > /dev/null || fail "expiries schema"
  while IFS=$'\t' read -r name day; do
    [[ "$name" =~ $NAME_RE ]] || fail "token name"
    [[ "$day" =~ $DAY_RE ]] || fail "token date"
    expiry["$name"]="$(epoch "$day")"
  done < <(jq -r '.tokens[] | [(.name | if type == "string" then . else "" end), (.expires | if type == "string" then . else "" end)] | @tsv' <<< "$expiries")
fi

# 5. GitHub: the remaining API limit and the expiry of the PAT (GET /rate_limit does not count against the limit).
pat=""
[ ! -f "$PAT_FILE" ] || pat="$(tr -d '\n\r' < "$PAT_FILE")"
if [ -n "$pat" ] && command -v curl > /dev/null 2>&1; then
  [[ "$pat" =~ ^[A-Za-z0-9_]{20,255}$ ]] || fail "unexpected form of the PAT"
  headers=""
  if headers="$(printf 'header = "Authorization: Bearer %s"\n' "$pat" |
    curl --silent --show-error --fail --max-time 20 --proto '=https' --tlsv1.2 --dump-header - --output /dev/null \
      --config - --header 'Accept: application/vnd.github+json' --header 'X-GitHub-Api-Version: 2022-11-28' \
      'https://api.github.com/rate_limit' 2> /dev/null)"; then
    remaining="$(tr -d '\r' <<< "$headers" | sed -n 's/^[Xx]-[Rr]ate[Ll]imit-[Rr]emaining: \([0-9]\{1,9\}\)$/\1/p' | head -n 1)"
    if [ -n "$remaining" ]; then
      add "evia_github_rate_limit_remaining $remaining"
    fi
    pat_expiry="$(tr -d '\r' <<< "$headers" | sed -n 's/^[Gg]ithub-[Aa]uthentication-[Tt]oken-[Ee]xpiration: \([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\} [0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}\) UTC$/\1/p' | head -n 1)"
    if [ -n "$pat_expiry" ]; then
      expiry["github-pat"]="$(date -u -d "$pat_expiry" +%s)"
    fi
  fi
fi
for name in "${!expiry[@]}"; do
  add "evia_token_expiry_timestamp_seconds{token=\"$name\"} ${expiry[$name]}"
done

# Write: tmp + mv in the same directory (atomic), 0644 in a 0755 directory; the lines are sorted for a stable file.
install -d -m 0755 -- "$OUT_DIR"
{
  printf '# Metrics of the deployment channel (evia-metrics, EVM-085); values validated, no secrets.\n'
  printf '%s\n' "${lines[@]}" | sort
} > "$OUT_FILE.tmp"
chmod 0644 -- "$OUT_FILE.tmp"
mv -f -- "$OUT_FILE.tmp" "$OUT_FILE"
