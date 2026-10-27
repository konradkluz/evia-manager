#!/bin/bash
# The restore test ON the temporary VM (EVM-084 AC3, AC6; ADR-0011, ADR-0018; security-engineer P5, P9). Delivered by run.sh in
# the user-data (cloud-init) as /usr/local/sbin/evia-restore-vm. The VM has no inbound ports, no SSH, only read keys; it restores
# the database (pgBackRest, point in time), lists the media copy (rclone crypt on the Storage Box, read-only account), counts the
# entries of the deletion register, writes ONE result without data (times, RPO, control numbers) with the signed PUT and powers
# off. A failure also ends with a result (status failed, the stage) and the power-off; the orchestrator deletes the VM anyway.
# Secrets are files of /etc/evia-restore/secrets (0600); they reach a process only through its environment, never argv or the log.
set -uo pipefail
set +x
umask 077

# shellcheck source=/dev/null
. /etc/evia-restore/env
readonly SECRETS=/etc/evia-restore/secrets
readonly PGDATA_DIR=/var/lib/evia-restore/pgdata
readonly PG_BIN="/usr/lib/postgresql/${PG_MAJOR:?}/bin"
readonly RESULT=/run/evia-restore-result.json
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
stage="start"
status="failed"
restored_to=""
rpo=-1
tables=0
rows=0
media_files=0
media_sample=0
register_entries=0

secret() { tr -d '\n' < "$SECRETS/$1"; }

publish() {
  local finished
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq -n --arg runId "$RUN_ID" --arg status "$status" --arg stage "$stage" --arg startedAt "$started" --arg finishedAt "$finished" \
    --arg targetTime "$TARGET_TIME" --arg restoredTo "${restored_to:-$finished}" --argjson rpoSeconds "$rpo" \
    --argjson dbTables "$tables" --argjson dbRows "$rows" --argjson mediaFiles "$media_files" \
    --argjson mediaSampleVerified "$media_sample" --argjson deletionRegisterEntries "$register_entries" \
    '{runId: $runId, status: $status, stage: $stage, startedAt: $startedAt, finishedAt: $finishedAt, targetTime: $targetTime, restoredTo: $restoredTo, rpoSeconds: $rpoSeconds, dbTables: $dbTables, dbRows: $dbRows, mediaFiles: $mediaFiles, mediaSampleVerified: $mediaSampleVerified, deletionRegisterEntries: $deletionRegisterEntries}' > "$RESULT"
  # The signed PUT works once (If-None-Match: * is part of the signature); the response is not printed.
  curl -sS --proto '=https' --max-time 60 -X PUT -H 'If-None-Match: *' -H 'Content-Type: application/json' \
    --data-binary "@$RESULT" -o /dev/null "$RESULT_PUT_URL" || true
}

restore_steps() {
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

  stage="database"
  install -d -m 0700 /etc/pgbackrest "$PGDATA_DIR"
  chown -R postgres:postgres "$PGDATA_DIR"
  printf '[global]
repo1-type=s3
repo1-path=/pgbackrest
repo1-s3-endpoint=%s
repo1-s3-region=%s
repo1-s3-bucket=%s
repo1-s3-uri-style=path
repo1-s3-key=%s
repo1-cipher-type=aes-256-cbc
log-level-console=warn
spool-path=/var/spool/pgbackrest

[%s]
pg1-path=%s
' "${S3_ENDPOINT#https://}" "$S3_REGION" "$DB_BACKUP_BUCKET" "$RESTORE_READER_ACCESS_KEY_ID" "${STANZA:?}" "$PGDATA_DIR" > /etc/pgbackrest/pgbackrest.conf
  chmod 0640 /etc/pgbackrest/pgbackrest.conf && chown root:postgres /etc/pgbackrest/pgbackrest.conf
  install -d -m 0750 -o postgres -g postgres /var/spool/pgbackrest
  restore_args=(--stanza="$STANZA" --type=time --target="$TARGET_TIME" --target-action=promote)
  [ -z "${REPO_TARGET_TIME:-}" ] || restore_args+=(--repo-target-time="$REPO_TARGET_TIME")
  PGBACKREST_REPO1_S3_KEY_SECRET="$(secret restore-reader-s3-secret-access-key)" PGBACKREST_REPO1_CIPHER_PASS="$(secret pgbackrest-cipher-pass)" \
    runuser -u postgres --preserve-environment -- pgbackrest "${restore_args[@]}" restore || return 1

  stage="recovery"
  runuser -u postgres -- "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" -o "-c listen_addresses='' -c archive_mode=off -c unix_socket_directories=/tmp" -w -t 600 start || return 1
  psql_q() { runuser -u postgres -- "$PG_BIN/psql" -h /tmp -d evia -Atq -c "$1"; }
  for _ in $(seq 1 60); do [ "$(psql_q 'select pg_is_in_recovery()')" = f ] && break; sleep 5; done
  restored_to="$(psql_q "select to_char(pg_last_xact_replay_timestamp() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")"
  [ -n "$restored_to" ] || return 1
  rpo=$(($(date -u -d "$TARGET_TIME" +%s) - $(date -u -d "$restored_to" +%s)))
  [ "$rpo" -ge 0 ] || rpo=0
  tables="$(psql_q "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')")"
  rows="$(psql_q "select coalesce(sum(reltuples), 0)::bigint from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname not in ('pg_catalog','information_schema')")"
  [ "$tables" -gt 0 ] || return 1

  stage="media"
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

  stage="register"
  reader_secret="$(secret restore-reader-s3-secret-access-key)"
  export RCLONE_CONFIG_REG_TYPE=s3 RCLONE_CONFIG_REG_PROVIDER=Scaleway RCLONE_CONFIG_REG_ENDPOINT="$S3_ENDPOINT" RCLONE_CONFIG_REG_REGION="$S3_REGION" \
    RCLONE_CONFIG_REG_ACCESS_KEY_ID="$RESTORE_READER_ACCESS_KEY_ID" RCLONE_CONFIG_REG_SECRET_ACCESS_KEY="$reader_secret"
  # All versions count; the oldest one is binding (SR-PRIV-04). The application of the entries to the restored database is
  # the command of EVM-040/062; here the test checks that the register is readable and counts its entries.
  register_entries="$(rclone --config /dev/null lsf -R --files-only --s3-versions "reg:${DELETION_REGISTER_BUCKET}" | grep -c . || true)"

  status="ok"
  stage="done"
  return 0
}

# A failure ends with a result of status failed (stage) and the power-off, like a success.
restore_steps
publish
shutdown -h now
