#!/bin/bash
# The restore test ON the temporary VM (EVM-084 AC3, AC5, AC6; ADR-0011, ADR-0018; security-engineer P5, P9). Delivered by run.sh in
# the user-data (cloud-init) as /usr/local/sbin/evia-restore-vm. The VM has no inbound ports, no SSH, only read keys; it restores
# the database (pgBackRest) to the NAMED restore point that the orchestrator created on staging and archived (a time target "now"
# cannot be reached: the archive holds no commit later than the last one), lists the media copy (rclone crypt on the Storage Box,
# read-only account), counts the entries of the deletion register, writes ONE result without data (times, RPO, control numbers) with
# the signed PUT and powers off. A failure also ends with a result (status failed, the stage) and the power-off; the orchestrator
# deletes the VM anyway.
# Secrets are files of /etc/evia-restore/secrets (0600). The database stage writes the repository secrets to the pgBackRest include
# file (0640 root:postgres; the VM is deleted after the test): the server started for the recovery calls `pgbackrest archive-get`
# (restore_command) by itself and must be able to decrypt the WAL. Nothing secret reaches argv or the log.
# RPO (definition, the same in docs/ops/runbooks/restore.md): the time from the creation of the restore point on staging to the
# confirmation by `pgbackrest check` that the point lies in the archive (the delay of the archive); the VM computes it from the
# two instants the orchestrator passes in.
# The script is also sourced by the tests (the main part runs only when it is executed); test mode (EVIA_RESTORE_TEST_MODE=1)
# lets the database stage run without root, with a posix repository and other paths — never set on the VM.
set -uo pipefail
set +x
umask 077

ENV_FILE=/etc/evia-restore/env
SECRETS=/etc/evia-restore/secrets
PGDATA_DIR=/var/lib/evia-restore/pgdata
PGBACKREST_DIR=/etc/pgbackrest
SPOOL_DIR=/var/spool/pgbackrest
PG_LOG=/var/lib/evia-restore/postgresql.log
SOCKET_DIR=/tmp
RESULT=/run/evia-restore-result.json
AS_POSTGRES=(runuser -u postgres --)
TEST_MODE=0
if [ "${EVIA_RESTORE_TEST_MODE:-}" = 1 ]; then
  TEST_MODE=1
  ENV_FILE="${EVIA_VM_ENV_FILE:-$ENV_FILE}"
  SECRETS="${EVIA_VM_SECRETS:-$SECRETS}"
  PGDATA_DIR="${EVIA_VM_PGDATA:-$PGDATA_DIR}"
  PGBACKREST_DIR="${EVIA_VM_PGBACKREST_DIR:-$PGBACKREST_DIR}"
  SPOOL_DIR="${EVIA_VM_SPOOL:-$SPOOL_DIR}"
  PG_LOG="${EVIA_VM_PG_LOG:-$PG_LOG}"
  SOCKET_DIR="${EVIA_VM_SOCKET_DIR:-$SOCKET_DIR}"
  RESULT="${EVIA_VM_RESULT:-$RESULT}"
  AS_POSTGRES=()
  # the server started for the recovery inherits these, so its restore_command finds the configuration
  export PGBACKREST_CONFIG="$PGBACKREST_DIR/pgbackrest.conf" PGBACKREST_CONFIG_INCLUDE_PATH="$PGBACKREST_DIR/conf.d"
fi

started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
stage="start"
status="failed"
restored_to=""
rpo=0
tables=0
rows=0
media_files=0
media_sample=0
register_entries=0

secret() { tr -d '\n' < "$SECRETS/$1"; }
as_postgres() { "${AS_POSTGRES[@]}" "$@"; }

publish() {
  local finished
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq -n --arg runId "$RUN_ID" --arg status "$status" --arg stage "$stage" --arg startedAt "$started" --arg finishedAt "$finished" \
    --arg targetTime "$TARGET_TIME" --arg restoredTo "${restored_to:-$TARGET_TIME}" --argjson rpoSeconds "$rpo" \
    --argjson dbTables "$tables" --argjson dbRows "$rows" --argjson mediaFiles "$media_files" \
    --argjson mediaSampleVerified "$media_sample" --argjson deletionRegisterEntries "$register_entries" \
    '{runId: $runId, status: $status, stage: $stage, startedAt: $startedAt, finishedAt: $finishedAt, targetTime: $targetTime, restoredTo: $restoredTo, rpoSeconds: $rpoSeconds, dbTables: $dbTables, dbRows: $dbRows, mediaFiles: $mediaFiles, mediaSampleVerified: $mediaSampleVerified, deletionRegisterEntries: $deletionRegisterEntries}' > "$RESULT"
  # The signed PUT works once (If-None-Match: * is part of the signature); the response is not printed.
  curl -sS --proto '=https' --max-time 60 -X PUT -H 'If-None-Match: *' -H 'Content-Type: application/json' \
    --data-binary "@$RESULT" -o /dev/null "$RESULT_PUT_URL" || true
}

install_packages() {
  stage="packages"
  export DEBIAN_FRONTEND=noninteractive
  # Egress allows 443 only: apt over https; the PGDG repository with the pinned fingerprint of its key.
  apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg jq rclone || return 1
  install -d -m 0755 /usr/share/postgresql-common/pgdg
  curl -fsS --proto '=https' https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /tmp/pgdg.asc || return 1
  gpg --show-keys --with-colons /tmp/pgdg.asc | grep -q '^fpr:::::::::B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8:' || return 1
  gpg --dearmor < /tmp/pgdg.asc > /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg || return 1
  printf 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main\n' > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq && apt-get install -y -qq --no-install-recommends "postgresql-${PG_MAJOR}" "pgbackrest=${PGBACKREST_VERSION:?}" || return 1
  systemctl disable --now postgresql > /dev/null 2>&1 || true
}

# write_pgbackrest_config: the configuration without secrets, the secrets in the include file (see the header).
write_pgbackrest_config() {
  local repo
  if [ "$TEST_MODE" = 1 ] && [ -n "${EVIA_VM_REPO_PATH:-}" ]; then
    repo="$(printf 'repo1-type=posix\nrepo1-path=%s' "$EVIA_VM_REPO_PATH")"
  else
    repo="$(printf 'repo1-type=s3\nrepo1-path=/pgbackrest\nrepo1-s3-endpoint=%s\nrepo1-s3-region=%s\nrepo1-s3-bucket=%s\nrepo1-s3-uri-style=path\nrepo1-s3-key=%s' \
      "${S3_ENDPOINT#https://}" "$S3_REGION" "$DB_BACKUP_BUCKET" "$RESTORE_READER_ACCESS_KEY_ID")"
  fi
  install -d -m 0750 "$PGBACKREST_DIR" "$PGBACKREST_DIR/conf.d"
  printf '[global]\n%s\nrepo1-cipher-type=aes-256-cbc\nlog-level-console=warn\nspool-path=%s\n\n[%s]\npg1-path=%s\n' \
    "$repo" "$SPOOL_DIR" "${STANZA:?}" "$PGDATA_DIR" > "$PGBACKREST_DIR/pgbackrest.conf"
  {
    printf '[global]\nrepo1-cipher-pass=%s\n' "$(secret pgbackrest-cipher-pass)"
    if [ "$TEST_MODE" = 0 ] || [ -z "${EVIA_VM_REPO_PATH:-}" ]; then printf 'repo1-s3-key-secret=%s\n' "$(secret restore-reader-s3-secret-access-key)"; fi
  } > "$PGBACKREST_DIR/conf.d/secrets.conf"
  chmod 0640 "$PGBACKREST_DIR/pgbackrest.conf" "$PGBACKREST_DIR/conf.d/secrets.conf"
  if [ "$TEST_MODE" = 0 ]; then
    chown -R root:postgres "$PGBACKREST_DIR"
    chmod 0750 "$PGBACKREST_DIR" "$PGBACKREST_DIR/conf.d"
  fi
}

# db_restore: restore to the named point, wait for the promotion, take the control numbers. Sets stage, restored_to, rpo, tables, rows.
db_restore() {
  stage="database"
  install -d -m 0700 "$PGDATA_DIR"
  install -d -m 0750 "$SPOOL_DIR"
  if [ "$TEST_MODE" = 0 ]; then chown -R postgres:postgres "$PGDATA_DIR" "$SPOOL_DIR"; fi
  write_pgbackrest_config || return 1
  local restore_args=(--stanza="$STANZA" --type=name --target="${RESTORE_POINT:?}" --target-action=promote --set="${BACKUP_SET:?}")
  # --repo-target-time is valid only with an explicit --repo (pgBackRest 2.54+)
  [ -z "${REPO_TARGET_TIME:-}" ] || restore_args+=(--repo=1 --repo-target-time="$REPO_TARGET_TIME")
  as_postgres pgbackrest "${restore_args[@]}" restore || return 1

  stage="recovery"
  local superuser="${PG_SUPERUSER:-evia_owner}" attempt PG_BIN="/usr/lib/postgresql/${PG_MAJOR:-18}/bin"
  [ "$TEST_MODE" = 0 ] || PG_BIN="${EVIA_VM_PG_BIN:-$PG_BIN}"
  as_postgres "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" -l "$PG_LOG" \
    -o "-c listen_addresses='' -c archive_mode=off -c unix_socket_directories=$SOCKET_DIR" -w -t 600 start || return 1
  psql_q() { as_postgres "$PG_BIN/psql" -h "$SOCKET_DIR" -U "$superuser" -d evia -Atq -c "$1"; }
  for attempt in $(seq 1 60); do
    [ "$(psql_q 'select pg_is_in_recovery()' 2> /dev/null)" = f ] && break
    # the server died: the recovery ended before the target (a point that is not in the archive) — no reason to wait
    as_postgres "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" status > /dev/null 2>&1 || break
    [ "$attempt" -lt 60 ] && sleep "${EVIA_VM_POLL_SECONDS:-5}"
  done
  [ "$(psql_q 'select pg_is_in_recovery()' 2> /dev/null)" = f ] || return 1
  # The recovery really stopped at the named point (not at the end of the archive, not at another target).
  grep -Fq "recovery stopping at restore point \"$RESTORE_POINT\"" "$PG_LOG" || return 1
  restored_to="$TARGET_TIME"
  rpo=$(($(date -u -d "${ARCHIVED_AT:?}" +%s) - $(date -u -d "$TARGET_TIME" +%s)))
  [ "$rpo" -ge 0 ] || rpo=0
  tables="$(psql_q "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')")" || return 1
  # reltuples is -1 for a table that was never analysed (PostgreSQL 14+): negative values do not count
  rows="$(psql_q "select coalesce(sum(greatest(reltuples, 0)), 0)::bigint from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname not in ('pg_catalog','information_schema')")" || return 1
  [ "$tables" -gt 0 ] || return 1
}

media_check() {
  stage="media"
  local obscured_box obscured_one obscured_two listing file
  obscured_box="$(secret restore-storagebox-password | rclone obscure -)"
  obscured_one="$(secret rclone-crypt-password | rclone obscure -)"
  obscured_two="$(secret rclone-crypt-password2 | rclone obscure -)"
  export RCLONE_CONFIG_BOX_TYPE=sftp RCLONE_CONFIG_BOX_HOST="$STORAGEBOX_HOST" RCLONE_CONFIG_BOX_PORT="${STORAGEBOX_SFTP_PORT:-23}" \
    RCLONE_CONFIG_BOX_USER="$STORAGEBOX_RESTORE_USER" RCLONE_CONFIG_BOX_PASS="$obscured_box" RCLONE_CONFIG_BOX_KNOWN_HOSTS_FILE=/etc/evia-restore/known_hosts \
    RCLONE_CONFIG_MEDIA_TYPE=crypt RCLONE_CONFIG_MEDIA_REMOTE="box:${STORAGEBOX_MEDIA_PATH:-media}" RCLONE_CONFIG_MEDIA_FILENAME_ENCRYPTION=standard \
    RCLONE_CONFIG_MEDIA_PASSWORD="$obscured_one" RCLONE_CONFIG_MEDIA_PASSWORD2="$obscured_two"
  listing="$(rclone --config /dev/null lsf -R --files-only media: | head -n 100000)" || return 1
  media_files="$(printf '%s' "$listing" | grep -c . || true)"
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    rclone --config /dev/null cat --count 1024 "media:$file" > /dev/null || return 1
    media_sample=$((media_sample + 1))
  done < <(printf '%s\n' "$listing" | head -n 3)
}

register_check() {
  stage="register"
  local reader_secret
  reader_secret="$(secret restore-reader-s3-secret-access-key)"
  export RCLONE_CONFIG_REG_TYPE=s3 RCLONE_CONFIG_REG_PROVIDER=Scaleway RCLONE_CONFIG_REG_ENDPOINT="$S3_ENDPOINT" RCLONE_CONFIG_REG_REGION="$S3_REGION" \
    RCLONE_CONFIG_REG_ACCESS_KEY_ID="$RESTORE_READER_ACCESS_KEY_ID" RCLONE_CONFIG_REG_SECRET_ACCESS_KEY="$reader_secret"
  # All versions count; the oldest one is binding (SR-PRIV-04). The application of the entries to the restored database is
  # the command of EVM-040/062; here the test checks that the register is readable and counts its entries.
  register_entries="$(rclone --config /dev/null lsf -R --files-only --s3-versions "reg:${DELETION_REGISTER_BUCKET}" | grep -c . || true)"
}

restore_steps() {
  install_packages || return 1
  db_restore || return 1
  media_check || return 1
  register_check || return 1
  status="ok"
  stage="done"
}

main() {
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  # A failure ends with a result of status failed (stage) and the power-off, like a success.
  restore_steps
  publish
  shutdown -h now
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main; fi
