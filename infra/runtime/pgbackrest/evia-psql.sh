#!/bin/bash
# Host entry to psql in the PostgreSQL container (EVM-084 AC3). Installed ONLY in an IaC session at /usr/local/sbin/evia-psql; used by
# the orchestrator of the restore test (run.sh) to write the named restore point (`select pg_create_restore_point(...)`). The role is
# the owner of the cluster of staging (POSTGRES_USER in compose.infra.yaml); the connection is the local socket in the container.
set -euo pipefail
exec docker compose --project-name evia-infra -f /etc/evia/runtime/compose.infra.yaml exec -T postgres psql --username=evia_owner --dbname=evia -v ON_ERROR_STOP=1 "$@"
