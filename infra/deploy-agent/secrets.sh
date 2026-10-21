#!/bin/bash
# Materialisation of the service secrets (EVM-007 AC7; ADR-0018 "Gdzie żyją sekrety"; SR-INFRA-05; architect 14;
# security-engineer review round 1). Installed ONLY in an IaC session at /usr/local/sbin/evia-secrets and called by:
#   - deploy.sh, with the manifest hash of the release being deployed: evia-secrets <manifest-sha256>;
#   - evia-secrets.service at boot (Before=docker.service; /run is empty after a reboot), without arguments: the hash
#     of the API is taken from the last entry of the registry (the colour that serves), none before the first deployment.
# The source is /etc/evia/secrets (0700, files 0600 root); every service of secrets.manifest.json gets a tmpfs copy of
# only its files in /run/evia/secrets/<service>/ (0400, owned by its UID). The start is refused when an owner, a mode,
# a file or the manifest is wrong. The directory of a service is kept (files replaced by rename, stale files removed),
# so the bind mount of a running container never loses its files. No eval, every variable quoted.
# EVIA_ROOT (tests only) prefixes the paths, EVIA_EXPECTED_UID (tests only) replaces root as the owner.
set -euo pipefail
umask 077
shopt -s nullglob dotglob

readonly ROOT="${EVIA_ROOT:-}"
readonly OWNER_UID="${EVIA_EXPECTED_UID:-0}"
readonly SECRETS_MANIFEST="$ROOT/etc/evia/deploy-agent/secrets.manifest.json"
readonly SECRETS_SOURCE="$ROOT/etc/evia/secrets"
readonly SECRETS_RUN="$ROOT/run/evia/secrets"
readonly REGISTRY="$ROOT/var/lib/evia/registry/registry.json"

log() { printf '%s secrets: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >&2; }
fail() {
  log "REFUSED: $1"
  exit 1
}
owner_mode() { stat -c '%u %a' -- "$1"; }

[ "$#" -le 1 ] || fail "usage: evia-secrets [manifest-sha256]"
manifest_sha="${1:-}"
if [ "$#" -eq 0 ] && [ -f "$REGISTRY" ]; then
  manifest_sha="$(jq -r '(.entries // [])[-1].manifestSha256 // "" | if type == "string" then . else "invalid" end' "$REGISTRY")"
fi
[ -z "$manifest_sha" ] || [[ "$manifest_sha" =~ ^[0-9a-f]{64}$ ]] || fail "manifest hash"

[ -f "$SECRETS_MANIFEST" ] || fail "no secrets manifest"
[ "$(owner_mode "$SECRETS_SOURCE")" = "$OWNER_UID 700" ] || fail "$SECRETS_SOURCE must be 0700 root"
install -d -m 0711 "$SECRETS_RUN"

# One copy of a file into the directory of a service: written next to the target, then renamed over it.
place() {
  install -m 0400 -- "$1" "$2/.$3.next"
  mv -f -- "$2/.$3.next" "$2/$3"
}

for service in $(jq -r '.services | keys[]' "$SECRETS_MANIFEST"); do
  uid="$(jq -r --arg s "$service" '.services[$s].uid' "$SECRETS_MANIFEST")"
  case "$service" in
    # The PostgreSQL image runs as its own user 999 (compose.infra.yaml); nothing else may claim that UID.
    postgres) [ "$uid" = 999 ] || fail "secrets manifest: uid of postgres" ;;
    api | worker | migrate | web) [[ "$uid" =~ ^[1-9][0-9]{3,5}$ ]] || fail "secrets manifest: uid of $service" ;;
    *) fail "secrets manifest: service $service" ;;
  esac
  target="$SECRETS_RUN/$service"
  [ ! -L "$target" ] || fail "$target is a symbolic link"
  install -d -m 0700 "$target"
  chmod 0700 "$target"
  wanted=" "
  for file in $(jq -r --arg s "$service" '.services[$s].files[]' "$SECRETS_MANIFEST"); do
    [[ "$file" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]] || fail "secrets manifest: file name"
    source="$SECRETS_SOURCE/$file"
    { [ -f "$source" ] && [ ! -L "$source" ]; } || fail "secret $file is missing"
    [ "$(owner_mode "$source")" = "$OWNER_UID 600" ] || fail "secret $file must be 0600 root"
    place "$source" "$target" "$file"
    wanted="$wanted$file "
  done
  if [ "$service" = api ] && [ -n "$manifest_sha" ]; then
    printf '%s' "$manifest_sha" > "$target/.release-manifest-sha256.source"
    place "$target/.release-manifest-sha256.source" "$target" release-manifest-sha256
    rm -f -- "$target/.release-manifest-sha256.source"
    wanted="${wanted}release-manifest-sha256 "
  fi
  for path in "$target"/*; do
    name="${path##*/}"
    case "$wanted" in *" $name "*) ;; *) rm -rf -- "$path" ;; esac
  done
  chmod 0500 "$target"
  if [ "$(id -u)" = 0 ]; then chown -R "$uid:$uid" -- "$target"; fi
done
log "secrets of $(jq -r '.services | keys | join(", ")' "$SECRETS_MANIFEST") in place"
