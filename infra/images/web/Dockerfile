# Release image evia-web (EVM-007 AC2; plan P3, architect 3): the built panel (static files of `vite build`) served by an
# internal Caddy on :8080 without TLS — TLS, HSTS on the edge and routing are the edge Caddy of the VM (infra/runtime).
# The security headers and the CSP of the panel are served here (apps/web/security-headers.ts, strict + https; a test
# of apps/web compares them with web/Caddyfile). Same build rules as evia-api: bases by tag + digest, pnpm verified by
# SHA-512, frozen lockfile, no install scripts, --no-cache --pull in `publish`, nothing from ghcr.io/konradkluz.
# Platform (Arm64 VM): the build stage runs on $BUILDPLATFORM (static files do not depend on the CPU; native build tools
# of the runner), the Caddy runtime stage of the target platform (linux/arm64 in `publish`) only copies files.
FROM --platform=$BUILDPLATFORM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS build

# renovate: datasource=npm depName=pnpm
ARG PNPM_VERSION=12.8.1
ARG PNPM_SHA512=f64ba907507f5ceafe06c8d38e6052d0179444580ec1279ddd5bfc11cb48aa8a2644b66598e07e761da84872a9fc57d5f902b87fa49d024198d558612aabbe45

ENV CI=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    DO_NOT_TRACK=1

WORKDIR /tmp/pnpm
RUN npm pack "pnpm@${PNPM_VERSION}" --silent \
 && echo "${PNPM_SHA512}  pnpm-${PNPM_VERSION}.tgz" | sha512sum -c - \
 && npm install --global "./pnpm-${PNPM_VERSION}.tgz" --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@evia/web..." \
 && pnpm --filter "@evia/web^..." run build \
 && pnpm --filter @evia/web run build

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f AS caddy-src

# The official image sets the file capability cap_net_bind_service=+ep on /usr/bin/caddy. The VM runs this container with
# cap_drop: ALL + no-new-privileges, so exec of a binary with file capabilities outside the bounding set fails with EPERM
# (restart loop). The panel listens on 8080 and needs no capability. A plain cp (no -a) on the runner platform
# drops the xattr without running the target binary (no emulation); the final stage only copies it.
FROM --platform=$BUILDPLATFORM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS caddy-nocap
COPY --from=caddy-src /usr/bin/caddy /tmp/caddy-orig
RUN cp /tmp/caddy-orig /tmp/caddy && chmod 0555 /tmp/caddy

FROM caddy-src AS runtime

# Metadata only (no RUN): links the GHCR package to the repository.
LABEL org.opencontainers.image.source="https://github.com/konradkluz/evia-manager"

ENV XDG_CONFIG_HOME=/tmp/caddy-config \
    XDG_DATA_HOME=/tmp/caddy-data
COPY --chmod=0444 infra/images/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
COPY --from=caddy-nocap /tmp/caddy /usr/local/bin/caddy

USER 65532:65532
EXPOSE 8080
HEALTHCHECK NONE
CMD ["/usr/local/bin/caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
