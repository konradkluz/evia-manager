# PostgreSQL with pgBackRest for staging (EVM-084 AC1; ADR-0011; security-engineer P8, architect 8). The same base digest as
# postgres in infra/runtime/infra-images.json (multi-arch: linux/arm64 for the VM CAX); pgBackRest from PGDG (already configured in
# the base image, signed repository), the exact version (>= 2.54 is needed for --repo-target-time). MIT licence.
# Built in CI (job publish-infra of .github/workflows/ci.yml, EVM-124) natively for linux/arm64, scanned, attested and pushed to GHCR (private); the
# entry in infra-images.json "builtImages" has no digest - it comes from the CI record and the attestation, verified in the IaC session (compose.infra.yaml
# switches to this image there, EVM-084).
FROM postgres:18.6-trixie@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42

RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest=2.60.0-1.pgdg13+1 \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -m 0755 /etc/pgbackrest

COPY --chmod=0644 infra/runtime/pgbackrest/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY --chmod=0555 infra/images/postgres-pgbackrest/pgbackrest-wrapper.sh /usr/local/bin/pgbackrest-wrapper

USER postgres

# Metadata only: links the GHCR package to the repository.
LABEL org.opencontainers.image.source="https://github.com/konradkluz/evia-manager"
