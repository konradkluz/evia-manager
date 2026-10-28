#!/bin/bash
# The database stage of the restore test on the temporary VM, executed for real (EVM-084 AC3, AC5; solution-architect: vm-restore.sh was
# tested only by regular expressions, so the unreachable "time now" target, the missing secrets of archive-get and the wrong role went
# unnoticed). Runs in the image of staging (PostgreSQL + pgBackRest, user postgres, no network) through
#   docker compose -f compose.yaml run --rm restore-db-test
# A real cluster is backed up to a posix repository (encrypted, aes-256-cbc), a named restore point is written and archived, rows are
# added after it, and `db_restore` of vm-restore.sh (the same function as on the VM, in test mode) restores to the point from a chosen
# backup set — with the repository secrets only in the include file (the server started for the recovery calls archive-get itself).
set -euo pipefail
set +x

readonly SCRIPT=/src/infra/deploy-agent/restore/vm-restore.sh
readonly PGBIN=/usr/lib/postgresql/18/bin
readonly W=/tmp/restore-db
readonly PASS='SYNTHETIC-CIPHER-PASS-FOR-THE-TEST-ONLY'
failed=0

ok() { echo "ok: $1"; }
fail() {
  echo "FAIL: $1"
  failed=1
}
check() { # DESCRIPTION CONDITION-COMMAND...
  local description="$1"
  shift
  if "$@"; then ok "$description"; else fail "$description"; fi
}

rm -rf "$W"
mkdir -p "$W"/{src-sock,secrets,src-conf,repo,spool}
chmod 0700 "$W/secrets" "$W/repo"
printf '%s' "$PASS" > "$W/secrets/pgbackrest-cipher-pass"

# --- the source cluster: encrypted archive and backup into the posix repository ------------------------------------------------
cat > "$W/src-conf/pgbackrest.conf" << CONF
[global]
repo1-type=posix
repo1-path=$W/repo
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=$PASS
log-level-console=warn
spool-path=$W/spool
start-fast=y

[evia]
pg1-path=$W/src
pg1-socket-path=$W/src-sock
pg1-user=evia_owner
CONF
export PGBACKREST_LOG_LEVEL_FILE=off
pgb() { pgbackrest --config="$W/src-conf/pgbackrest.conf" --stanza=evia "$@"; }
"$PGBIN/initdb" -D "$W/src" -U evia_owner -A trust > /dev/null
cat >> "$W/src/postgresql.conf" << CONF
listen_addresses = ''
unix_socket_directories = '$W/src-sock'
archive_mode = on
wal_level = replica
archive_command = 'pgbackrest --config=$W/src-conf/pgbackrest.conf --stanza=evia archive-push %p'
CONF
"$PGBIN/pg_ctl" -D "$W/src" -l "$W/src.log" -w start > /dev/null
src_psql() { "$PGBIN/psql" -h "$W/src-sock" -U evia_owner -d "${2:-evia}" -Atq -c "$1"; }
src_psql 'create database evia' postgres
src_psql 'create table orders (id int primary key, note text)'
src_psql "insert into orders select g, 'synthetic ' || g from generate_series(1, 100) g"
pgb stanza-create > /dev/null
pgb check > /dev/null
pgb backup --type=full > /dev/null
src_psql "insert into orders select g, 'synthetic ' || g from generate_series(101, 150) g"

# the named restore point and its archiving, exactly as run.sh does (pg_create_restore_point, then `pgbackrest check`)
RESTORE_POINT="20261027t120000z-0123456789ab"
TARGET_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
src_psql "select pg_create_restore_point('$RESTORE_POINT')" > /dev/null
pgb check > /dev/null
ARCHIVED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sleep 2
INBETWEEN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sleep 2

# later changes, archived, and a backup that STOPS AFTER the point (a timer of the backup or the fresh backup of the scenario)
src_psql "insert into orders select g, 'later ' || g from generate_series(1001, 2000) g"
pgb check > /dev/null
pgb backup --type=incr > /dev/null
pgb check > /dev/null
BACKUPS="$(pgb info --output=json)"
BACKUP_SET="$(grep -o '"label":"[^"]*"' <<< "$BACKUPS" | head -n 1 | sed 's/"label":"\(.*\)"/\1/')"
check "the first backup (full) is the set to restore from, the incremental one stopped after the point" test -n "$BACKUP_SET" -a "$(grep -o '"label"' <<< "$BACKUPS" | wc -l)" -ge 2
"$PGBIN/pg_ctl" -D "$W/src" -m fast -w stop > /dev/null

# --- the stage of the VM -------------------------------------------------------------------------------------------------------
export EVIA_RESTORE_TEST_MODE=1 EVIA_VM_REPO_PATH="$W/repo" EVIA_VM_PGBACKREST_DIR="$W/etc-pgbackrest" EVIA_VM_SPOOL="$W/spool-vm" \
  EVIA_VM_SECRETS="$W/secrets" EVIA_VM_PG_BIN="$PGBIN" EVIA_VM_POLL_SECONDS=1
export STANZA=evia PG_MAJOR=18 PG_SUPERUSER=evia_owner PGBACKREST_LOG_LEVEL_FILE=off
unset PGBACKREST_REPO1_CIPHER_PASS PGBACKREST_CONFIG PGBACKREST_CONFIG_INCLUDE_PATH

# run_stage NAME [VAR=value ...]: a fresh data directory, the function of the script in a subshell; prints the result variables.
run_stage() {
  local name="$1"
  shift
  (
    export EVIA_VM_PGDATA="$W/restored-$name" EVIA_VM_PG_LOG="$W/restored-$name.log" EVIA_VM_SOCKET_DIR="$W/sock-$name"
    mkdir -p "$EVIA_VM_SOCKET_DIR"
    # shellcheck source=/dev/null
    . "$SCRIPT"
    export RESTORE_POINT BACKUP_SET TARGET_TIME ARCHIVED_AT
    for assignment in "$@"; do export "${assignment?}"; done
    set +e
    db_restore
    code=$?
    set -e
    printf 'code=%s stage=%s restored_to=%s rpo=%s tables=%s rows=%s\n' "$code" "$stage" "$restored_to" "$rpo" "$tables" "$rows" > "$W/result-$name"
    "$PGBIN/pg_ctl" -D "$EVIA_VM_PGDATA" -m immediate stop > /dev/null 2>&1 || true
  )
}
field() { sed -n "s/.*[ ]$2=\([^ ]*\).*/\1/p; s/^$2=\([^ ]*\).*/\1/p" "$W/result-$1" | head -n 1; }
restored_count() { # NAME -> rows of orders in the restored cluster
  local name="$1" sock="$W/sock-$1"
  "$PGBIN/pg_ctl" -D "$W/restored-$name" -o "-c listen_addresses='' -c archive_mode=off -c unix_socket_directories=$sock" -l "$W/count-$name.log" -w start > /dev/null
  "$PGBIN/psql" -h "$sock" -U evia_owner -d evia -Atq -c 'select count(*) from orders'
  "$PGBIN/pg_ctl" -D "$W/restored-$name" -m immediate stop > /dev/null
}

run_stage point
check "db_restore to the named point succeeds (role evia_owner, secrets in the include file, archive-get decrypts the WAL)" test "$(field point code)" = 0
check "the stage reached is the recovery" test "$(field point stage)" = recovery
check "restored_to is the instant of the point" test "$(field point restored_to)" = "$TARGET_TIME"
check "the RPO is the archive delay and not negative" test "$(field point rpo)" -ge 0
check "the database has tables" test "$(field point tables)" -ge 1
check "the number of rows is not negative (reltuples -1 of a never analysed table does not count)" test "$(field point rows)" -ge 0
check "the secrets are in the include file, not in the configuration" grep -q 'repo1-cipher-pass=' "$W/etc-pgbackrest/conf.d/secrets.conf"
check "the configuration file has no secret" bash -c "! grep -q 'cipher-pass' '$W/etc-pgbackrest/pgbackrest.conf'"
check "the recovery stopped at the named point" grep -Fq "recovery stopping at restore point \"$RESTORE_POINT\"" "$W/restored-point.log"
check "the rows up to the point are there (150) and the later ones (1000) are not" test "$(restored_count point)" = 150

run_stage window "REPO_TARGET_TIME=$INBETWEEN"
check "the scenario: --repo-target-time after the point, with the chosen backup set, restores to the point too" test "$(field window code)" = 0
check "the scenario: the same rows" test "$(restored_count window)" = 150

run_stage missing "RESTORE_POINT=20261027t120000z-ffffffffffff"
check "a point that is not in the archive is a failure (the recovery ends before the target), not a silent success" test "$(field missing code)" != 0

exit "$failed"
