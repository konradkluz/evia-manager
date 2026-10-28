# PostgreSQL with pgBackRest for staging (EVM-084 AC1; ADR-0011; security-engineer P8, architect 8). The same base digest as
# postgres in infra/runtime/infra-images.json (multi-arch: linux/arm64 for the VM CAX); pgBackRest from PGDG (already configured in
# the base image, signed repository), the exact version (>= 2.54 is needed for --repo-target-time). MIT licence.
# NOT yet in infra-images.json: the entry (tag + digest) and the change of compose.infra.yaml (image + archive_command) come
# together in the IaC session, after the image has passed the pipeline (scan, signature). Until then this file is only prepared.
FROM postgres:18.6-trixie@sha256:1267c7e692de235fda2a50dbcdbcbca4672ea6a0298576a6bd9d07cafc319b32

RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest=2.60.0-1.pgdg13+1 \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -m 0755 /etc/pgbackrest

COPY --chmod=0644 infra/runtime/pgbackrest/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY --chmod=0555 infra/images/postgres-pgbackrest/pgbackrest-wrapper.sh /usr/local/bin/pgbackrest-wrapper

USER postgres
