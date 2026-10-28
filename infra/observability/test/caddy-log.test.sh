#!/bin/sh
# The access log of the edge Caddy with the REAL snippet text (EVM-085 AC6, AC7a; security-engineer A11; SR-LOG-02).
# Runs in the Caddy image of infra-images.json (service caddy-log-test, no network but loopback): extracts the snippet
# `(access_log)` and the global `log default` block (the error log, http.log.error) from infra/runtime/Caddyfile, serves a test
# site with them in front of a DEAD upstream (so that 502 entries of the error log are produced), sends requests carrying a synthetic
# token in the path, query, header, cookie and body, and checks the WHOLE output (stdout and stderr). A positive control proves the
# test is not vacuous: the same requests against a plain `log` and the default error log DO leak the token.
set -eu

CADDYFILE=/src/infra/runtime/Caddyfile
TOKEN="SyntheticTokenAAAAAAAAAAAAAAAAAAAAAAAAAAA_-"
WORK=/tmp/caddy-log-test
mkdir -p "$WORK" /tmp/config /tmp/data
export XDG_CONFIG_HOME=/tmp/config XDG_DATA_HOME=/tmp/data
# The image binary carries the file capability NET_BIND_SERVICE, which the hardened service (all capabilities dropped) cannot exec;
# a copy on tmpfs has no file capabilities, and the test ports are unprivileged anyway.
cp /usr/bin/caddy "$WORK/caddy"
caddy() { "$WORK/caddy" "$@"; }

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# The snippet: from the line "(access_log) {" to the closing "}" in column 0.
awk '/^\(access_log\) \{/ {on=1} on {print} on && /^\}/ {exit}' "$CADDYFILE" > "$WORK/snippet.caddy"
[ -s "$WORK/snippet.caddy" ] || fail "snippet (access_log) not found in the Caddyfile"
# The default logger of the global options: from "<tab>log default {" to its closing "<tab>}".
awk '/^\tlog default \{/ {on=1} on {print} on && /^\t\}/ {exit}' "$CADDYFILE" > "$WORK/errorlog.caddy"
[ -s "$WORK/errorlog.caddy" ] || fail "the global block 'log default' not found in the Caddyfile"

serve() { # serve NAME PORT CONFIG
  caddy run --config "$3" --adapter caddyfile > "$WORK/$1.out" 2>&1 &
  echo $! > "$WORK/$1.pid"
  i=0
  while ! wget -q -O /dev/null "http://127.0.0.1:$2/ping" 2> /dev/null; do
    i=$((i + 1))
    [ "$i" -lt 50 ] || fail "caddy $1 did not start: $(cat "$WORK/$1.out")"
    sleep 0.2
  done
}

requests() { # requests PORT
  base="http://127.0.0.1:$1"
  wget -q -O /dev/null --header "X-CSRF-Token: $TOKEN" --header "Cookie: session=$TOKEN" --header "Authorization: Bearer $TOKEN" \
    --header "Referer: $base/#$TOKEN" "$base/work-orders?token=$TOKEN&x=1" || true
  wget -q -O /dev/null --post-data "token=$TOKEN" --header "X-CSRF-Token: $TOKEN" "$base/api/v1/auth/activation/check?t=$TOKEN" || true
  wget -q -O /dev/null "$base/api/v1/auth/activation/$TOKEN" || true
  sleep 0.5
}

# 1. The real snippet.
{
  printf '{\n\tadmin off\n'
  cat "$WORK/errorlog.caddy"
  printf '}\n\n'
  cat "$WORK/snippet.caddy"
  printf '\n:18080 {\n\tbind 127.0.0.1\n\timport access_log\n\trespond /ping "pong" 200\n\treverse_proxy 127.0.0.1:1\n}\n'
} > "$WORK/Caddyfile.filtered"
caddy validate --config "$WORK/Caddyfile.filtered" --adapter caddyfile > "$WORK/validate.out" 2>&1 || fail "validate: $(cat "$WORK/validate.out")"
# The whole production Caddyfile stays valid with the snippet imported (the upstream snippet of deploy.sh replaced by a stub).
sed 's#import /etc/caddy/upstream.caddy#respond "stub" 200#' "$CADDYFILE" > "$WORK/Caddyfile.full"
grep -q 'import access_log' "$WORK/Caddyfile.full" || fail "the site does not import access_log"
caddy validate --config "$WORK/Caddyfile.full" --adapter caddyfile > "$WORK/validate-full.out" 2>&1 || fail "validate (full): $(cat "$WORK/validate-full.out")"
serve filtered 18080 "$WORK/Caddyfile.filtered"
requests 18080
LOG="$WORK/filtered.out"

grep -q '"msg":"handled request"' "$LOG" || fail "no access log entry"
grep -q '"level":"error"' "$LOG" || fail "the dead upstream produced no error log entry (the test would prove nothing): $(cat "$LOG")"
grep -q '"logger":"http.log.error' "$LOG" || fail "no entry of http.log.error"
[ "$(grep -c '"uri":"/work-orders"' "$LOG")" -ge 2 ] || fail "the access AND the error entry should carry the path without the query: $(grep work-orders "$LOG")"
grep -q '"uri":"/work-orders"' "$LOG" || fail "the path is missing or the query is not cut: $(grep work-orders "$LOG")"
if grep -q "$TOKEN" "$LOG"; then fail "the synthetic token is in the log"; fi
for word in 'X-Csrf-Token' 'Cookie' 'Authorization' 'Referer' 'user_agent' 'User-Agent'; do
  if grep -qi "$word" "$LOG"; then fail "the log carries $word"; fi
done
if grep -q 'activation' "$LOG"; then fail "an activation request was logged: $(grep activation "$LOG")"; fi
if grep -q '"remote_port"' "$LOG"; then fail "the port is logged"; fi
if grep -q "\"tls\":" "$LOG"; then fail "TLS details in the log: $(grep -m2 tls "$LOG")"; fi
# Every entry with an address (the access AND the error ones) carries it masked to /24.
[ "$(grep -c '"remote_ip":"127.0.0.0"' "$LOG")" -eq "$(grep -c '"remote_ip"' "$LOG")" ] || fail "remote_ip is not masked to /24: $(grep -o '"remote_ip":"[^"]*"' "$LOG" | head -3)"
grep -q '"client_ip":"127.0.0.0"' "$LOG" || fail "client_ip is not masked to /24"
if grep -v '^[[:space:]]*#' "$CADDYFILE" | grep -q 'log_credentials'; then fail "log_credentials in the Caddyfile"; fi
kill "$(cat "$WORK/filtered.pid")" 2> /dev/null || true

# 2. The positive control: a plain log leaks the token (the test can fail).
printf ':18081 {\n\tbind 127.0.0.1\n\tlog {\n\t\toutput stdout\n\t\tformat json\n\t}\n\trespond /ping "pong" 200\n\treverse_proxy 127.0.0.1:1\n}\n' > "$WORK/Caddyfile.plain"
serve plain 18081 "$WORK/Caddyfile.plain"
requests 18081
grep -q "$TOKEN" "$WORK/plain.out" || fail "positive control: the plain log does not contain the token, the test proves nothing"
# ... in the ERROR entry as well (the unfiltered default logger), the gap the filtered run above must not have.
grep '"level":"error"' "$WORK/plain.out" | grep -q "$TOKEN" || fail "positive control: the unfiltered error log does not contain the token"
kill "$(cat "$WORK/plain.pid")" 2> /dev/null || true

echo "OK: access and error log without token, headers, query, port; addresses masked; activation not logged; positive control leaks"
