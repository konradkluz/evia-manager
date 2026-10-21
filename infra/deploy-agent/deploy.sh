#!/bin/bash
# Deployment of root on the VM (EVM-007 AC4; ADR-0018 V6, "Rollback i migracje"; architect 10, 12–14; security-engineer B
# "Granica zaufania verifier → root"). Runs in the same systemd cycle right after the verifier (exit code 0 only).
# The result of the verifier is UNTRUSTED: it is copied into a directory of root first and only the copy is read; every
# field is checked again (commit, digests of the allowed repositories, hashes, the compose document against an
# allow-list, a rollback only to a commit of the registry). Order: pull by digest -> migrations (one-off `migrate`,
# role evia_migrator; never for a rollback) -> start of the new colour -> /api/health and /api/version (commit + manifest hash) -> switch of
# the edge Caddy -> check through the edge -> stop of the old colour -> registry (atomic) -> images of the last 3
# deployments kept. A failure before the switch leaves the previous version serving. No eval, every variable quoted.
# Paths are fixed; EVIA_ROOT (tests only) prefixes them; EVIA_EXPECTED_UID (tests only) reaches evia-secrets, where it
# replaces root as the owner of the secrets.
set -euo pipefail
umask 077

readonly ROOT="${EVIA_ROOT:-}"
readonly WAIT="${EVIA_HEALTH_WAIT:-2}"
readonly CONFIG="$ROOT/etc/evia/deploy-agent/config.json"
readonly ROLLBACK_COMMAND="$ROOT/etc/evia/deploy-agent/rollback"
readonly RESULT_SOURCE="$ROOT/var/lib/evia/agent/out/result.json"
readonly WORK="$ROOT/var/lib/evia/deploy"
readonly REGISTRY="$ROOT/var/lib/evia/registry/registry.json"
readonly CADDY_SNIPPET="$ROOT/etc/evia/caddy/upstream.caddy"
readonly INFRA_COMPOSE="$ROOT/etc/evia/runtime/compose.infra.yaml"
readonly DOMAIN="staging.eviacharge.pl"
readonly KEEP_DEPLOYMENTS=3

log() { printf '%s deploy: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >&2; }
fail() {
  log "REFUSED: $1"
  exit 1
}

# Compose never reads variables of root's environment or files of the current directory (architect 10).
for name in $(compgen -e); do
  case "$name" in COMPOSE_* | DOCKER_DEFAULT_PLATFORM) unset "$name" ;; esac
done

install -d -m 0700 "$WORK" "$WORK/incoming" "$WORK/empty" "$WORK/colors"
# The registry is readable by the verifier (no secret in it: commits, hashes, manifests) and writable by root only.
install -d -m 0755 "$(dirname "$REGISTRY")"
[ -f "$RESULT_SOURCE" ] || fail "no result of the verifier"
[ "$(stat -c %s -- "$RESULT_SOURCE")" -le 4194304 ] || fail "result too large"
cp -- "$RESULT_SOURCE" "$WORK/incoming/result.json"
readonly RESULT="$WORK/incoming/result.json"
jq -e 'type == "object" and .schemaVersion == 1' "$RESULT" > /dev/null || fail "result is not a result of the verifier"

decision="$(jq -r '.decision | if type == "string" then . else "" end' "$RESULT")"
case "$decision" in
  deploy | rollback) ;;
  none)
    log "nothing to deploy"
    exit 0
    ;;
  *) fail "decision '$decision'" ;;
esac

field() { jq -r --arg key "$1" '.[$key] | if type == "string" or type == "number" then tostring else "" end' "$RESULT"; }
commit="$(field commit)"
manifest_sha="$(field manifestSha256)"
compose_sha="$(field composeSha256)"
event_id="$(field activityEventId)"
api="$(jq -r '.images.api | if type == "string" then . else "" end' "$RESULT")"
web="$(jq -r '.images.web | if type == "string" then . else "" end' "$RESULT")"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "commit"
[[ "$manifest_sha" =~ ^[0-9a-f]{64}$ ]] || fail "manifest hash"
[[ "$compose_sha" =~ ^[0-9a-f]{64}$ ]] || fail "compose hash"
[[ "$event_id" =~ ^[1-9][0-9]{0,18}$ ]] || fail "activity event"

api_repo="$(jq -r '.imageRepositories.api' "$CONFIG")"
web_repo="$(jq -r '.imageRepositories.web' "$CONFIG")"
network="$(jq -r '.runtimeNetwork' "$CONFIG")"
baseline="$(jq -r '.baseline.commit' "$CONFIG")"
[[ "$network" =~ ^[a-z][a-z0-9-]{1,40}$ ]] || fail "runtime network in the configuration"
[[ "$baseline" =~ ^[0-9a-f]{40}$ ]] || fail "baseline in the configuration"
check_image() {
  local image="$1" repository="$2"
  [ "${image%@*}" = "$repository" ] || fail "image outside the allowed repository $repository"
  [[ "${image#*@}" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "image without a sha256 digest"
}
check_image "$api" "$api_repo"
check_image "$web" "$web_repo"

# The manifest: its exact text, its hash, its commit and images (the same definition as in the verifier).
manifest_file="$WORK/incoming/release-manifest.json"
jq -j '.manifest' "$RESULT" > "$manifest_file"
[ "$(sha256sum -- "$manifest_file" | cut -d' ' -f1)" = "$manifest_sha" ] || fail "manifest does not match its hash"
jq -e --arg c "$commit" --arg a "$api" --arg w "$web" '.commit == $c and .images.api == $a and .images.web == $w' "$manifest_file" > /dev/null ||
  fail "manifest of another commit or other images"

# The compose document: exactly the bytes the verifier hashed, checked again against an allow-list (no TOCTOU: only this
# copy of root is used from here on).
release="$WORK/releases/$commit"
install -d -m 0700 "$WORK/releases" "$release"
jq -j '.compose' "$RESULT" > "$release/compose.json"
[ "$(sha256sum -- "$release/compose.json" | cut -d' ' -f1)" = "$compose_sha" ] || fail "compose does not match its hash"
cp -- "$manifest_file" "$release/release-manifest.json"
jq -e --arg a "$api" --arg w "$web" --arg n "$network" '
  (keys == ["networks", "services"])
  and (.networks == {($n): {external: true, name: $n}})
  and ((.services | keys) == ["api", "migrate", "web", "worker"])
  and all(.services | to_entries[];
    ((.value | keys) - ["cap_drop", "command", "environment", "image", "init", "mem_limit", "networks", "pids_limit",
      "pull_policy", "read_only", "restart", "security_opt", "stop_grace_period", "tmpfs", "user", "volumes"]) == []
    and .value.image == (if .key == "web" then $w else $a end)
    and .value.pull_policy == "never" and .value.read_only == true and .value.cap_drop == ["ALL"]
    and .value.security_opt == ["no-new-privileges:true"] and .value.networks == [$n]
    and (.value.user | test("^[1-9][0-9]{3,5}:[1-9][0-9]{3,5}$"))
    and ((.value.volumes // ["/run/evia/secrets/" + .key + ":/run/secrets:ro"]) == ["/run/evia/secrets/" + .key + ":/run/secrets:ro"]))
' "$release/compose.json" > /dev/null || fail "compose document outside the allow-list"

if [ ! -f "$REGISTRY" ]; then
  printf '{"schemaVersion":1,"entries":[]}\n' > "$REGISTRY"
  chmod 0644 "$REGISTRY"
fi
# A rollback repeats an earlier deploy entry of this baseline exactly (commit, hashes, Activity event) — the verifier
# rejects a registry with any other rollback entry (services/deploy-agent/src/registry.ts).
if [ "$decision" = rollback ]; then
  jq -e --arg c "$commit" --arg m "$manifest_sha" --arg s "$compose_sha" --argjson e "$event_id" --arg b "$baseline" \
    'any(.entries[]; .kind == "deploy" and .commit == $c and .manifestSha256 == $m and .composeSha256 == $s
      and .activityEventId == $e and .baseline == $b)' "$REGISTRY" > /dev/null ||
    fail "rollback to a commit outside the registry"
fi

# Secrets (AC7; architect 14): one materialisation shared with the boot unit evia-secrets.service (a reboot empties
# /run) — every service of secrets.manifest.json gets a tmpfs copy of only its files, the API the manifest hash.
"$ROOT/usr/local/sbin/evia-secrets" "$manifest_sha" || fail "secrets of the services"

active="$(cat -- "$WORK/active-color" 2> /dev/null || echo none)"
case "$active" in blue | green | none) ;; *) fail "active colour" ;; esac
if [ "$active" = blue ]; then colour=green; else colour=blue; fi
project="evia-$colour"
compose_of() { docker compose --project-name "$1" --project-directory "$WORK/empty" --env-file /dev/null -f "$2" "${@:3}"; }

log "deploying $commit ($decision) as $project"
docker pull --quiet -- "$api" > /dev/null
docker pull --quiet -- "$web" > /dev/null
# A rollback never migrates: the schema is expand-only (tools/repo-policy migrations.test.ts), so N−1 runs on schema N,
# and the older migrator would refuse a database with migrations it does not know (ADR-0018 "Rollback i migracje").
if [ "$decision" = rollback ]; then
  log "rollback: migrations skipped (expand-only schema)"
elif ! compose_of "$project" "$release/compose.json" run --rm --no-deps migrate; then
  compose_of "$project" "$release/compose.json" down --remove-orphans || true
  fail "migration failed — the previous version stays"
fi
compose_of "$project" "$release/compose.json" up -d --no-build --pull never --no-deps api worker web

address() { docker inspect --format "{{(index .NetworkSettings.Networks \"$network\").IPAddress}}" -- "$project-$1-1"; }
healthy() {
  local api_address web_address version
  api_address="$(address api)" || return 1
  web_address="$(address web)" || return 1
  [[ "$api_address" =~ ^[0-9.]+$ && "$web_address" =~ ^[0-9.]+$ ]] || return 1
  curl --fail --silent --max-time 3 -o /dev/null "http://$api_address:3000/api/health" || return 1
  version="$(curl --fail --silent --max-time 3 "http://$api_address:3000/api/version")" || return 1
  jq -e --arg c "$commit" --arg m "$manifest_sha" '.commit == $c and .manifestSha256 == $m' <<< "$version" > /dev/null || return 1
  curl --fail --silent --max-time 3 -o /dev/null "http://$web_address:8080/" || return 1
}
ok=0
for _ in $(seq 1 30); do
  if healthy; then
    ok=1
    break
  fi
  sleep "$WAIT"
done
if [ "$ok" != 1 ]; then
  compose_of "$project" "$release/compose.json" down --remove-orphans || true
  fail "health or version check of $project failed — the previous version stays"
fi

# The switch: the snippet comes from a fixed template; only the colour (blue|green) varies — nothing of the manifest.
upstream() {
  printf '%s\n' \
    '# Generated by deploy.sh (EVM-007 AC4): the active colour only.' \
    'handle /healthz {' '	rewrite * /api/health' "	reverse_proxy evia-$1-api-1:3000" '}' \
    'handle /version {' '	rewrite * /api/version' "	reverse_proxy evia-$1-api-1:3000" '}' \
    'handle /api/* {' "	reverse_proxy evia-$1-api-1:3000" '}' \
    'handle {' "	reverse_proxy evia-$1-web-1:8080" '}'
}
reload() { docker compose --project-name evia-infra --env-file /dev/null -f "$INFRA_COMPOSE" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; }
previous_snippet="$(cat -- "$CADDY_SNIPPET" 2> /dev/null || true)"
upstream "$colour" > "$CADDY_SNIPPET.tmp"
mv -- "$CADDY_SNIPPET.tmp" "$CADDY_SNIPPET"
edge=""
if reload; then edge="$(curl --fail --silent --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/version" || true)"; fi
if ! jq -e --arg c "$commit" --arg m "$manifest_sha" '.commit == $c and .manifestSha256 == $m' <<< "$edge" > /dev/null 2>&1; then
  if [ -n "$previous_snippet" ]; then
    printf '%s\n' "$previous_snippet" > "$CADDY_SNIPPET"
    reload || true
  fi
  compose_of "$project" "$release/compose.json" down --remove-orphans || true
  fail "the edge does not serve $commit — switched back"
fi

if [ "$active" != none ] && [ -f "$WORK/colors/$active/compose.json" ]; then
  compose_of "evia-$active" "$WORK/colors/$active/compose.json" down --remove-orphans || log "stopping evia-$active failed"
fi
install -d -m 0700 "$WORK/colors/$colour"
cp -- "$release/compose.json" "$WORK/colors/$colour/compose.json"
printf '%s\n' "$colour" > "$WORK/active-color.tmp"
mv -- "$WORK/active-color.tmp" "$WORK/active-color"

# The registry: written only here, after a successful switch, atomically. `kind` = the decision: a rollback entry never
# moves the frontier of the verifier (its newest deploy entry), so after a rollback the channel holds instead of
# deploying the commit it rolled back from again (ADR-0018 "Rollback"; services/deploy-agent/src/verify.ts).
jq --arg k "$decision" --arg c "$commit" --arg m "$manifest_sha" --rawfile text "$manifest_file" --arg s "$compose_sha" \
  --argjson e "$event_id" --arg b "$baseline" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '.entries += [{kind: $k, commit: $c,manifestSha256: $m, manifest: $text, composeSha256: $s, activityEventId: $e, baseline: $b, deployedAt: $t}]' \
  "$REGISTRY" > "$REGISTRY.tmp"
chmod 0644 "$REGISTRY.tmp"
mv -- "$REGISTRY.tmp" "$REGISTRY"
if [ "$decision" = rollback ]; then rm -f -- "$ROLLBACK_COMMAND"; fi

# Images of the last KEEP_DEPLOYMENTS deployments stay (independent of the GHCR retention); older evia images go.
keep="$(jq -r --argjson n "$KEEP_DEPLOYMENTS" '.entries[-$n:][] | .manifest | fromjson | .images[]' "$REGISTRY")"
pattern="^(${api_repo//./\\.}|${web_repo//./\\.})@sha256:[0-9a-f]{64}$"
for image in $(docker image ls --digests --format '{{.Repository}}@{{.Digest}}' | grep -E "$pattern" || true); do
  grep -qxF -- "$image" <<< "$keep" || docker image rm -- "$image" > /dev/null || log "could not remove $image"
done
log "deployed $commit as $project"
