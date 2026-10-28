#!/bin/sh
# Runs pgbackrest with the secrets read from files (EVM-084 AC1; security-engineer P8): they never sit in the compose environment
# (docker inspect) or in the image. archive_command and the backup timers call this wrapper.
set -eu
PGBACKREST_REPO1_CIPHER_PASS="$(cat /run/secrets/pgbackrest-cipher-pass)"
PGBACKREST_REPO1_S3_KEY_SECRET="$(cat /run/secrets/backup-s3-secret-access-key)"
export PGBACKREST_REPO1_CIPHER_PASS PGBACKREST_REPO1_S3_KEY_SECRET
exec pgbackrest "$@"
