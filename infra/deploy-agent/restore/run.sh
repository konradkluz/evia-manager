#!/bin/bash
# Orchestrator of the restore test (EVM-084 AC3, AC5; ADR-0018 "Test odtworzenia"; SR-INFRA-05/07; security-engineer P5-P10,
# architect 9, 10). Installed ONLY in an IaC session at /usr/local/sbin/evia-restore-test and run by evia-restore-test.timer
# (monthly, with the scenario "backup deleted from a taken-over VM") and by hand. Not in GitHub Actions; the token of the project
# evia-restore-staging lives only on the staging VM (RR-NOC-T3-1).
# One run: lock (flock) -> refusal when the project has ANY server -> a firewall without inbound rules (created for this run, label
# evia-restore=staging) -> a signed PUT of the result (TTL <= 2 h, unique key, once) -> a server in the EU with the firewall attached in
# the create request, without SSH (cloud-init disables sshd and the password, a dead-man shutdown) -> wait until it powers off (hard
# limit) -> the result is read with a signed GET, validated against a strict schema (size limit, whitelist of fields, types) and
# written to last.json atomically -> the server and the firewall are deleted ALWAYS (trap on EXIT, INT, TERM), also after an error.
# The root password Hetzner returns, the user-data and the signed URLs are never printed or logged (SR-LOG-02).
set -euo pipefail
set +x

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

readonly CONFIG_FILE="${EVIA_RESTORE_CONFIG:-/etc/evia/restore/restore.conf}"
readonly SECRETS_DIR="${EVIA_SECRETS_DIR:-/etc/evia/secrets}"
readonly POLL_SECONDS="${EVIA_RESTORE_POLL_SECONDS:-30}"
readonly MAX_WAIT_SECONDS="${EVIA_RESTORE_MAX_WAIT_SECONDS:-14400}"
readonly DEADMAN_MINUTES="${EVIA_RESTORE_DEADMAN_MINUTES:-300}"
readonly PRESIGN_TTL=7200
readonly RESULT_MAX_BYTES=16384

# --- configuration (no secret: names, ids, endpoints) ---------------------------------------------------------------------
set -a
# shellcheck source=/dev/null
[ -r "$CONFIG_FILE" ] && . "$CONFIG_FILE"
set +a
: "${RESTORE_IMAGE:?}" "${RESTORE_SERVER_TYPE:?}" "${RESTORE_LOCATION:?}" "${S3_ENDPOINT:?}" "${S3_REGION:?}" "${DB_BACKUP_BUCKET:?}"
: "${DELETION_REGISTER_BUCKET:?}" "${RESTORE_READER_ACCESS_KEY_ID:?}" "${RESTORE_ORCH_ACCESS_KEY_ID:?}" "${STORAGEBOX_HOST:?}" "${STORAGEBOX_RESTORE_USER:?}"
STANZA="${PGBACKREST_STANZA:-evia}"
[[ "$RESTORE_IMAGE" =~ ^[0-9]+$ ]] || die "RESTORE_IMAGE must be an image id"
[[ "$RESTORE_SERVER_TYPE" =~ ^[a-z0-9]+$ ]] || die "RESTORE_SERVER_TYPE"
location_allowed "$RESTORE_LOCATION" || die "RESTORE_LOCATION is not an allowed EU location"
[[ "$S3_ENDPOINT" =~ ^https://[a-z0-9.-]+$ || ( "${EVIA_RESTORE_TEST_MODE:-}" = 1 && "$S3_ENDPOINT" =~ ^http://127\.0\.0\.1:[0-9]+$ ) ]] || die "S3_ENDPOINT"
[[ "$S3_REGION" =~ ^[a-z0-9-]+$ && "$DB_BACKUP_BUCKET" =~ ^[a-z0-9-]+$ && "$DELETION_REGISTER_BUCKET" =~ ^[a-z0-9-]+$ ]] || die "configuration"
[[ "$RESTORE_READER_ACCESS_KEY_ID" =~ ^[A-Za-z0-9]+$ && "$RESTORE_ORCH_ACCESS_KEY_ID" =~ ^[A-Za-z0-9]+$ ]] || die "access key id"
[[ "$STORAGEBOX_HOST" =~ ^[a-z0-9.-]+$ && "$STORAGEBOX_RESTORE_USER" =~ ^[a-z0-9-]+$ ]] || die "Storage Box"
readonly S3_HOSTPORT="${S3_ENDPOINT#*://}"
readonly S3_SCHEME="${S3_ENDPOINT%%://*}"

select_api
init_work
SERVER_ID=""
FIREWALL_ID=""
RUN_ID=""
SCENARIO_STATE=""
cleanup_failed=0

# --- cleanup: ALWAYS, also after an error or a signal ---------------------------------------------------------------------
delete_resource() { # KIND PATH-PREFIX ID
  hc_request DELETE "$2/$3" > /dev/null || {
    log "cleanup: $1 $3 not deleted (the sweeper will)"
    return 1
  }
}
cleanup() {
  local rc=$? id attempt
  trap - EXIT INT TERM
  set +e
  if [ -n "$RUN_ID" ]; then
    # By label as well: a resource whose create answer was lost (timeout) is found by its run label.
    while IFS= read -r id; do
      [ -n "$id" ] && { delete_resource server /servers "$id" || cleanup_failed=1; }
    done < <(hc_list /servers servers "label_selector=evia-run%3D$RUN_ID" | jq -r '.id')
  fi
  if [ -n "$SERVER_ID" ]; then delete_resource server /servers "$SERVER_ID" > /dev/null 2>&1; fi
  # The firewall can be deleted only when the server is gone (deleting a server is asynchronous).
  if [ -n "$RUN_ID" ]; then
    while IFS= read -r id; do
      for attempt in 1 2 3 4 5 6 7 8 9 10; do
        hc_request DELETE "/firewalls/$id" > /dev/null 2>&1 && break
        [ "$attempt" -lt 10 ] && sleep "$POLL_SECONDS" || cleanup_failed=1
      done
    done < <(hc_list /firewalls firewalls "label_selector=evia-run%3D$RUN_ID" | jq -r '.id')
  fi
  if [ -n "$SCENARIO_STATE" ]; then
    "$SELF_DIR/scenario.sh" heal "$SCENARIO_STATE" || cleanup_failed=1
  fi
  if [ "$cleanup_failed" -ne 0 ]; then
    event restore-test-cleanup-failed "run_id=${RUN_ID:-none}"
    [ "$rc" -ne 0 ] || rc=1
  fi
  if [ "$rc" -ne 0 ]; then
    metric_set evia_restore_test_last_run_failed 1
    event restore-test-failed "run_id=${RUN_ID:-none}"
  fi
  drop_work
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# --- lock and refusal of a second VM --------------------------------------------------------------------------------------
install -d -m 0700 -- "$STATE_DIR"
exec 9> "$STATE_DIR/run.lock"
flock -n 9 || {
  event restore-test-refused "reason=locked"
  exit 75
}
existing="$(hc_list /servers servers | jq -r '.id' | head -n 1)" || die "cannot list servers (fail-closed)"
if [ -n "$existing" ]; then
  event restore-test-refused "reason=server-exists"
  die "the project already has a server; no second VM"
fi

RUN_ID="$(date -u +%Y%m%dt%H%M%Sz)-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
readonly RESULT_KEY="restore-results/$RUN_ID.json"
event restore-test-started "run_id=$RUN_ID"

# --- the result object: signed PUT (once) for the VM, signed GET for the orchestrator -------------------------------------
presign() { # METHOD [if-none-match]
  S3_PRESIGN_SCHEME="$S3_SCHEME" S3_SECRET_FILE="$SECRETS_DIR/restore-orchestrator-s3-secret-access-key" "$SELF_DIR/s3-presign.sh" "$1" "$S3_HOSTPORT" \
    "/$DB_BACKUP_BUCKET/$RESULT_KEY" "$PRESIGN_TTL" "$RESTORE_ORCH_ACCESS_KEY_ID" "$S3_REGION" "${2:-}"
}
PUT_URL="$(presign PUT if-none-match)"
GET_URL="$(presign GET)"

# --- scenario "backup deleted from a taken-over VM" (monthly) -------------------------------------------------------------
REPO_TARGET_TIME=""
if [ "${EVIA_RESTORE_SCENARIO:-}" = delete ]; then
  SCENARIO_STATE="$WORK/scenario.state"
  "$SELF_DIR/scenario.sh" delete "$SCENARIO_STATE"
  REPO_TARGET_TIME="$(< "$SCENARIO_STATE")"
fi
TARGET_TIME="${EVIA_RESTORE_TARGET_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
[[ "$TARGET_TIME" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z$ ]] || die "target time"

# --- firewall without inbound rules (created for this run) ----------------------------------------------------------------
jq -n --arg name "evia-restore-$RUN_ID" --arg run "$RUN_ID" '
  {name: $name, labels: {"evia-restore": "staging", "evia-run": $run},
   rules: ([{p: "tcp", port: "443"}, {p: "tcp", port: "53"}, {p: "udp", port: "53"}, {p: "udp", port: "123"}, {p: "tcp", port: "23"}]
     | map({direction: "out", protocol: .p, port: .port, destination_ips: ["0.0.0.0/0", "::/0"]}))}' > "$WORK/firewall.json"
FIREWALL_ID="$(hc_request POST /firewalls "$WORK/firewall.json" | jq -r '.firewall.id | tostring')"
[[ "$FIREWALL_ID" =~ ^[0-9]+$ ]] || die "firewall create answer"

# --- user-data: read keys, decryption passwords and the signed PUT only; no Hetzner token, no write keys ------------------
b64() { base64 -w0; }
secret_entry() { # NAME -> write_files entry with the secret
  printf '  - path: /etc/evia-restore/secrets/%s\n    permissions: "0600"\n    encoding: b64\n    content: %s\n' "$1" "$(b64 < "$SECRETS_DIR/$1")"
}
{
  printf '#cloud-config\nssh_pwauth: false\ndisable_root: true\nusers: []\n'
  printf 'bootcmd:\n  - sed -i "s#http://#https://#g" /etc/apt/sources.list.d/*.sources\n'
  printf 'write_files:\n'
  printf '  - path: /etc/evia-restore/env\n    permissions: "0600"\n    encoding: b64\n    content: %s\n' "$(
    {
      printf "RUN_ID='%s'\nTARGET_TIME='%s'\nREPO_TARGET_TIME='%s'\nSTANZA='%s'\n" "$RUN_ID" "$TARGET_TIME" "$REPO_TARGET_TIME" "$STANZA"
      printf "S3_ENDPOINT='%s'\nS3_REGION='%s'\nDB_BACKUP_BUCKET='%s'\nDELETION_REGISTER_BUCKET='%s'\n" "$S3_ENDPOINT" "$S3_REGION" "$DB_BACKUP_BUCKET" "$DELETION_REGISTER_BUCKET"
      printf "RESTORE_READER_ACCESS_KEY_ID='%s'\nSTORAGEBOX_HOST='%s'\nSTORAGEBOX_RESTORE_USER='%s'\n" "$RESTORE_READER_ACCESS_KEY_ID" "$STORAGEBOX_HOST" "$STORAGEBOX_RESTORE_USER"
      printf "STORAGEBOX_SFTP_PORT='%s'\nSTORAGEBOX_MEDIA_PATH='%s'\nPG_MAJOR='%s'\nPGBACKREST_VERSION='%s'\n" "${STORAGEBOX_SFTP_PORT:-23}" "${STORAGEBOX_MEDIA_PATH:-media}" "${PG_MAJOR:-18}" "${PGBACKREST_VERSION:-2.60.0-1.pgdg13+1}"
      printf "RESULT_PUT_URL='%s'\n" "$PUT_URL"
    } | b64
  )"
  for name in restore-reader-s3-secret-access-key pgbackrest-cipher-pass rclone-crypt-password rclone-crypt-password2 restore-storagebox-password; do
    secret_entry "$name"
  done
  printf '  - path: /etc/evia-restore/known_hosts\n    permissions: "0644"\n    encoding: b64\n    content: %s\n' "$(b64 < "${STORAGEBOX_KNOWN_HOSTS:-/etc/evia/restore/storagebox_known_hosts}")"
  printf '  - path: /usr/local/sbin/evia-restore-vm\n    permissions: "0700"\n    encoding: b64\n    content: %s\n' "$(b64 < "$SELF_DIR/vm-restore.sh")"
  # dead-man switch first (when the orchestrator dies), then sshd and the password off, then the test
  printf 'runcmd:\n  - [shutdown, -h, "+%s"]\n  - [systemctl, disable, --now, ssh.service, ssh.socket]\n  - [passwd, -l, root]\n  - [/usr/local/sbin/evia-restore-vm]\n' "$DEADMAN_MINUTES"
} > "$WORK/user-data.yaml"
[ "$(wc -c < "$WORK/user-data.yaml")" -le 32768 ] || die "user-data above 32 KiB"

jq -n --arg name "evia-restore-$RUN_ID" --arg run "$RUN_ID" --arg type "$RESTORE_SERVER_TYPE" --arg location "$RESTORE_LOCATION" \
  --argjson image "$RESTORE_IMAGE" --argjson firewall "$FIREWALL_ID" --rawfile userdata "$WORK/user-data.yaml" '
  {name: $name, server_type: $type, image: $image, location: $location, user_data: $userdata,
   labels: {"evia-restore": "staging", "evia-run": $run}, firewalls: [{firewall: $firewall}],
   public_net: {enable_ipv4: true, enable_ipv6: true}, start_after_create: true, automount: false}' > "$WORK/server.json"
# Only the id is taken from the answer: it also carries root_password, which is never read, logged or stored.
SERVER_ID="$(hc_request POST /servers "$WORK/server.json" | jq -r '.server.id | tostring')"
[[ "$SERVER_ID" =~ ^[0-9]+$ ]] || die "server create answer"
rm -f -- "$WORK/user-data.yaml" "$WORK/server.json"
event restore-test-vm-created "run_id=$RUN_ID" "server_id=$SERVER_ID"

# --- wait until the VM powers itself off (hard limit) ---------------------------------------------------------------------
deadline=$((SECONDS + MAX_WAIT_SECONDS))
status=""
while [ "$SECONDS" -lt "$deadline" ]; do
  status="$(hc_request GET "/servers/$SERVER_ID" | jq -r '.server.status')" || status="unknown"
  [ "$status" = off ] && break
  sleep "$POLL_SECONDS"
done
if [ "$status" != off ]; then
  event restore-test-timeout "run_id=$RUN_ID"
  die "the VM did not power off within ${MAX_WAIT_SECONDS}s"
fi

# --- the result: untrusted input ------------------------------------------------------------------------------------------
case "$S3_SCHEME" in https) proto="https" ;; *) proto="http" ;; esac
code="$(curl -sS --proto "=$proto" --max-time 60 --max-filesize "$RESULT_MAX_BYTES" -o "$WORK/result.json" -w '%{http_code}' "$GET_URL" 2> /dev/null)" || code="000"
[ "$code" = 200 ] || die "no result object (status $code)"
[ "$(wc -c < "$WORK/result.json")" -le "$RESULT_MAX_BYTES" ] || die "result above ${RESULT_MAX_BYTES} bytes"
iso='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$'
if ! jq -e --arg run "$RUN_ID" --arg iso "$iso" '
  def count: type == "number" and . >= 0 and . == floor;
  type == "object"
  and ((keys - ["runId","status","stage","startedAt","finishedAt","targetTime","restoredTo","rpoSeconds","dbTables","dbRows","mediaFiles","mediaSampleVerified","deletionRegisterEntries"]) | length == 0)
  and .runId == $run and (.status | IN("ok","failed")) and (.stage | type == "string" and test("^[a-z]{1,16}$"))
  and (.startedAt | type == "string" and test($iso)) and (.finishedAt | type == "string" and test($iso))
  and (.targetTime | type == "string" and test($iso)) and (.restoredTo | type == "string" and test($iso))
  and (.rpoSeconds | count) and (.dbTables | count) and (.dbRows | count) and (.mediaFiles | count)
  and (.mediaSampleVerified | count) and (.deletionRegisterEntries | count)' "$WORK/result.json" > /dev/null; then
  die "the result does not match the schema (rejected)"
fi
jq -c --arg accepted "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg scenario "${EVIA_RESTORE_SCENARIO:-none}" '. + {acceptedAt: $accepted, scenario: $scenario}' "$WORK/result.json" > "$WORK/last.json"
mv -f -- "$WORK/last.json" "$STATE_DIR/last.json"
if [ "$(jq -r '.status' "$STATE_DIR/last.json")" != ok ]; then
  die "the VM reported a failed restore at stage $(jq -r '.stage' "$STATE_DIR/last.json")"
fi
metric_set evia_restore_test_last_success_timestamp_seconds "$(now_epoch)"
metric_set evia_restore_test_last_run_failed 0
metric_set evia_restore_test_last_rpo_seconds "$(jq -r '.rpoSeconds' "$STATE_DIR/last.json")"
event restore-test-finished "run_id=$RUN_ID"
