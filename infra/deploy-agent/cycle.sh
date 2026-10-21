#!/bin/bash
# One cycle of the deployment channel (EVM-007 AC3, AC4; architect 12): the verifier container, then — only when it
# exits 0 — deploy.sh of root, under one lock (systemd runs this through flock; no .path units, no races).
# A rejection (exit 3) or an unsafe environment (exit 2) fails the unit: OnFailure= raises the local alert.
set -euo pipefail
umask 077
for name in $(compgen -e); do
  case "$name" in COMPOSE_* | DOCKER_DEFAULT_PLATFORM) unset "$name" ;; esac
done
# The fine-grained PAT (0600 root in /etc/evia/secrets) as a tmpfs copy readable by the verifier user only.
install -d -m 0711 /run/evia/agent
install -m 0400 -o 10010 -g 10010 /etc/evia/secrets/github-pat /run/evia/agent/github-pat
docker compose --project-name evia-agent --project-directory /var/lib/evia/deploy/empty --env-file /dev/null \
  -f /etc/evia/deploy-agent/compose.agent.yaml run --rm verifier
exec /usr/local/sbin/evia-deploy
