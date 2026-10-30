#!/bin/bash
# The log pipeline in a real Alloy (EVM-085 AC1, AC5, AC7b; architect 4; security-engineer A8, A9). Runs in the Alloy image of
# infra-images.json (service alloy-tests, loopback only): the REAL pipeline.alloy gets synthetic entries over loki.source.api and
# the output of loki.echo (Alloy's log) and /metrics are checked. A second, bare path (no pipeline) is the positive control:
# the same lines DO leak there, so the redaction is not vacuous.
set -u

readonly TOKEN="SyntheticTokenAAAAAAAAAAAAAAAAAAAAAAAAAAA_-"
readonly WORK=/tmp/alloy-test
mkdir -p "$WORK/cfg" "$WORK/data"
cp /src/infra/observability/alloy/pipeline.alloy "$WORK/cfg/pipeline.alloy"
cp /src/infra/observability/test/alloy-test-wiring.alloy "$WORK/cfg/wiring.alloy"
failures=0

fail() {
  echo "FAIL: $1" >&2
  failures=$((failures + 1))
}

# http METHOD PORT PATH [BODY]: a minimal HTTP client over /dev/tcp (the image has neither curl nor wget); prints the body.
http() {
  local method="$1" port="$2" path="$3" body="${4:-}"
  exec 3<> "/dev/tcp/127.0.0.1/$port" || return 1
  printf '%s %s HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: %s\r\n\r\n%s' \
    "$method" "$path" "${#body}" "$body" >&3
  cat <&3
  exec 3<&-
}

jesc() { sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# push PORT LABELS_JSON LINE
push() {
  local line
  line="$(printf '%s' "$3" | jesc)"
  http POST "$1" /loki/api/v1/push "{\"streams\":[{\"stream\":$2,\"values\":[[\"$(date +%s)000000000\",\"$line\"]]}]}" > /dev/null
}

cd "$WORK/cfg" && /bin/alloy run "$WORK/cfg" --server.http.listen-addr=127.0.0.1:12345 --storage.path="$WORK/data" --disable-reporting > "$WORK/alloy.log" 2>&1 &
ALLOY_PID=$!
i=0
until http GET 12345 /-/ready 2> /dev/null | grep -q "Alloy is ready"; do
  i=$((i + 1))
  if [ "$i" -gt 100 ]; then
    echo "FAIL: Alloy did not start" >&2
    head -30 "$WORK/alloy.log" >&2
    exit 1
  fi
  sleep 0.2
done

OUT() { grep 'component_id=loki.echo.out' "$WORK/alloy.log" || true; }

# --- 1. The allow-list: only the allowed services pass; the rest is dropped by default.
push 3100 '{"compose_service":"api"}' '{"level":"info","msg":"PASS-api"}'
push 3100 '{"compose_service":"worker"}' '{"level":"info","msg":"PASS-worker"}'
push 3100 '{"compose_service":"caddy"}' '{"msg":"PASS-caddy"}'
push 3100 '{"compose_service":"web"}' 'PASS-web plain line, not JSON'
push 3100 '{"unit":"evia-deploy-agent.service"}' 'PASS-unit deploy agent'
push 3100 '{"unit":"evia-restore-test.service"}' 'PASS-unit restore'
for service in postgres clamd freshclam migrate alloy unknown; do
  push 3100 "{\"compose_service\":\"$service\"}" "DROP-compose-$service DETAIL: Key (email)=(someone@example.test) already exists"
done
for unit in ssh.service sudo.service docker.service systemd-logind.service evia-unknown.service "evia-deploy-agent.service.evil"; do
  push 3100 "{\"unit\":\"$unit\"}" "DROP-unit-$unit"
done
# an anchored rule: a service that only CONTAINS an allowed name does not pass
push 3100 '{"compose_service":"apiextra"}' 'DROP-anchored-apiextra'
push 3100 '{"compose_service":"xapi"}' 'DROP-anchored-xapi'
sleep 2
for ok in PASS-api PASS-worker PASS-caddy PASS-web PASS-unit; do
  OUT | grep -q "$ok" || fail "allowed entry missing: $ok"
done
OUT | grep -q 'DROP-' && fail "a dropped service reached the output: $(OUT | grep -o 'DROP-[A-Za-z0-9.:-]*' | sort -u | tr '\n' ' ')"
OUT | grep 'PASS-api' | grep -qF 'service=\"api\"' || fail "service label is not set from the compose service"
OUT | grep 'PASS-unit deploy' | grep -qF 'service=\"evia-deploy-agent\"' || fail "service label is not set from the unit"
OUT | grep 'PASS-api' | grep -qF 'level=\"info\"' || fail "level label missing"
OUT | grep 'PASS-api' | grep -q 'compose_service' && fail "compose_service label was not dropped"

# --- 2. Redaction, with the positive control on the bare path (port 3101, no pipeline).
read -r -d '' SECRETS_LINE << EOF
{"level":"error","msg":"POST /api/v1/auth/activation/$TOKEN failed t=$TOKEN link https://staging.example.test/#$TOKEN eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4fwpM token Bearer abc123.def-456 ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 https://s3.example.test/k?X-Amz-Signature=deadbeef01&X-Amz-Credential=credA%2F1&X-Amz-Security-Token=sesstokB mail a.b@example.test ip 203.0.113.77 and 2001:db8:abcd:1234:5678::1","env":"prod"}
EOF
push 3100 '{"compose_service":"api"}' "$SECRETS_LINE"
push 3101 '{"compose_service":"api"}' "$SECRETS_LINE"
sleep 2
clean="$(OUT)"
for secret in "$TOKEN" 'SflKxwRJSMeKKF2QT4fwpM' 'abc123.def-456' 'ghp_ABCDEF' 'github_pat_ABCDEF' 'deadbeef01' 'credA' 'sesstokB' 'a.b@example.test' '203.0.113.77' '2001:db8:abcd:1234'; do
  if printf '%s' "$clean" | grep -q "$secret"; then fail "redaction missed: $secret"; fi
  grep 'component_id=loki.echo.raw' "$WORK/alloy.log" | grep -q "$secret" || fail "positive control: $secret is not visible on the bare path"
done
printf '%s' "$clean" | grep -q 'activation/REDACTED' || fail "activation path not redacted"
printf '%s' "$clean" | grep -q '203.0.113.0' || fail "IPv4 not masked to /24"
printf '%s' "$clean" | grep -q '2001:db8:abcd::' || fail "IPv6 not masked to /48"
printf '%s' "$clean" | grep 'REDACTED' | grep -qF 'env=\"prod\"' && fail "env from the line became a label"

# --- 3. Security alerts: counted by closed-list alertCode, anything else as `other`; only from api and worker.
for _ in 1 2; do push 3100 '{"compose_service":"api"}' '{"level":"error","alert":"security","alertCode":"account_locked","msg":"security alert"}'; done
push 3100 '{"compose_service":"api"}' '{"level":"error","alert":"security","alertCode":"login_failure_spike"}'
push 3100 '{"compose_service":"api"}' '{"level":"error","alert":"security","alertCode":"mass_download"}'
push 3100 '{"compose_service":"worker"}' '{"level":"error","alert":"security","alertCode":"user@example.test"}'
push 3100 '{"compose_service":"web"}' '{"level":"error","alert":"security","alertCode":"account_locked"}'
push 3100 '{"compose_service":"api"}' '{"level":"info","alert":"other-kind","alertCode":"account_locked"}'
sleep 2
metrics="$(http GET 12345 /metrics)"
series() { printf '%s\n' "$metrics" | grep '^loki_process_custom_security_alerts_total' ; }
series | grep 'alertCode="account_locked"' | grep -q ' 2$' || fail "account_locked is not counted exactly twice: $(series | tr '\n' ';')"
series | grep 'alertCode="login_failure_spike"' | grep -q ' 1$' || fail "login_failure_spike is not counted once"
series | grep 'alertCode="mass_download"' | grep -q ' 1$' || fail "mass_download is not counted once"
series | grep 'alertCode="other"' | grep -q ' 1$' || fail "an unknown code is not counted as other"
series | grep -q 'example.test' && fail "a free value became a metric label"
series | grep -q 'service="web"' && fail "an alert from the web service was counted"
series | grep -q 'user@' && fail "user data in a metric"

# --- 4. The rate limit drops the excess of a flooding service.
# One request with 400 lines: the limiter sees them at once, so the result does not depend on the speed of the client.
values=""
for n in $(seq 1 400); do values="$values[\"$(date +%s)000000000\",\"FLOOD-$n\"],"; done
http POST 3100 /loki/api/v1/push "{\"streams\":[{\"stream\":{\"compose_service\":\"caddy\"},\"values\":[${values%,}]}]}" > /dev/null
sleep 2
passed="$(OUT | grep -c 'FLOOD-' || true)"
[ "$passed" -lt 400 ] || fail "the rate limit dropped nothing ($passed of 400 passed)"
[ "$passed" -gt 0 ] || fail "the rate limit dropped everything"

# --- 5. The configuration of the VM (sources.alloy + sinks.alloy + the same pipeline.alloy) is valid and formatted.
mkdir -p "$WORK/vm" "$WORK/tok"
cp /src/infra/observability/alloy/*.alloy "$WORK/vm/"
printf 'synthetic-write-token' > "$WORK/tok/token"
if ! (cd "$WORK/vm" && GRAFANA_WRITE_TOKEN_FILE="$WORK/tok/token" GRAFANA_LOKI_URL=https://loki.example.test/loki/api/v1/push GRAFANA_LOKI_USER=1   GRAFANA_PROM_URL=https://prom.example.test/api/prom/push GRAFANA_PROM_USER=2 /bin/alloy validate "$WORK/vm" > "$WORK/validate-vm.out" 2>&1); then
  fail "the VM configuration is not valid: $(head -12 "$WORK/validate-vm.out")"
fi
for file in pipeline sources sinks; do
  /bin/alloy fmt "/src/infra/observability/alloy/$file.alloy" | cmp -s - "/src/infra/observability/alloy/$file.alloy" || fail "$file.alloy is not formatted (alloy fmt)"
done

kill "$ALLOY_PID" 2> /dev/null || true
if [ -n "${SHOW_OUT:-}" ]; then OUT | head -8; grep component_id=loki.echo.raw "$WORK/alloy.log" | head -2; fi
if [ "$failures" -ne 0 ]; then
  echo "$failures failure(s); log tail:" >&2
  tail -25 "$WORK/alloy.log" >&2
  exit 1
fi
echo "OK: allow-list, redaction (with positive control), alert counters and rate limit"
