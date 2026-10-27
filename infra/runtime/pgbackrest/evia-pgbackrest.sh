#!/bin/bash
# Host entry to pgBackRest in the PostgreSQL container (EVM-084 AC1). Installed ONLY in an IaC session at
# /usr/local/sbin/evia-pgbackrest; used by backup.sh, scenario.sh and the administrator. The secrets are read inside the container.
set -euo pipefail
exec docker compose --project-name evia-infra -f /etc/evia/runtime/compose.infra.yaml exec -T postgres pgbackrest-wrapper --stanza=evia "$@"
