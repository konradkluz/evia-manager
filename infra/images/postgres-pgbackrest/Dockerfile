# PostgreSQL with pgBackRest for staging (EVM-084 AC1; ADR-0011; security-engineer P8, architect 8). The same base digest as
# postgres in infra/runtime/infra-images.json (multi-arch: linux/arm64 for the VM CAX); pgBackRest from PGDG (already configured in
# the base image, signed repository), the exact version (>= 2.54 is needed for --repo-target-time). MIT licence.
# Built in CI (job publish-infra of .github/workflows/ci.yml, EVM-124) natively for linux/arm64, scanned, attested and pushed to GHCR (private); the
# entry in infra-images.json "builtImages" has no digest - it comes from the CI record and the attestation, verified in the IaC session (compose.infra.yaml
# switches to this image there, EVM-084).
FROM postgres:18.7-trixie@sha256:c699303802144847d238196173655dbbecf7a96aeca1565f2b02eb671a1f0b6b

# libzstd1 and zstd (CVE-2026-124851, High, EVM-153): the Debian fix (trixie-security, 2026-11-24) is in no official base image yet (checked 2026-11-26: postgres
# 18.7 and 19.0, debian:trixie-slim), so the fixed versions are installed with pgBackRest at an exact version (no `apt upgrade`; the build fails when Debian
# replaces them). Drop them when the base carries the fix.
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest=2.60.0-1.pgdg13+1 libzstd1=1.5.7+dfsg-1+deb13u1 zstd=1.5.7+dfsg-1+deb13u1 \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -m 0755 /etc/pgbackrest

COPY --chmod=0644 infra/runtime/pgbackrest/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY --chmod=0555 infra/images/postgres-pgbackrest/pgbackrest-wrapper.sh /usr/local/bin/pgbackrest-wrapper

USER postgres

# Metadata only: links the GHCR package to the repository.
LABEL org.opencontainers.image.source="https://github.com/konradkluz/evia-manager"
LABEL org.opencontainers.image.documentation="https://github.com/konradkluz/evia-manager/blob/main/infra/images/README.md"
