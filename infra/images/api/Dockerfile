# Release image evia-api (EVM-007 AC2; ADR-0018 "Publikacja hermetyczna"; plan P3, architect 18): the API, the worker and
# the one-off migrations (`migrate`) — one image, the command chooses the entry point. Built only by the `publish` job
# of ci.yml with --no-cache --pull: every base by tag + digest, nothing from ghcr.io/konradkluz, pnpm in the exact
# version of package.json "packageManager" verified by its SHA-512, the lockfile frozen, install scripts disabled.
# Runtime: distroless Node.js 26 (no shell, no package manager), non-root. No secret enters the image: the only build
# argument is the commit (EVIA_RELEASE_COMMIT, public — GET /api/version); secrets are files mounted at run time.
# The build context is the repository root, restricted by the allow-list Dockerfile.dockerignore.
# Platform (Arm64 VM, Hetzner CAX): `publish` builds --platform linux/arm64 on the x86 runner WITHOUT emulation — every
# stage that runs commands is on $BUILDPLATFORM, the runtime stage of the target platform only copies files.
FROM --platform=$BUILDPLATFORM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS pnpm

# renovate: datasource=npm depName=pnpm
ARG PNPM_VERSION=12.8.1
# SHA-512 of the pnpm tarball = the hash in package.json "packageManager" (tools/repo-policy checks they are equal).
ARG PNPM_SHA512=f64ba907507f5ceafe06c8d38e6052d0179444580ec1279ddd5bfc11cb48aa8a2644b66598e07e761da84872a9fc57d5f902b87fa49d024198d558612aabbe45

ENV CI=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    DO_NOT_TRACK=1

WORKDIR /tmp/pnpm
RUN npm pack "pnpm@${PNPM_VERSION}" --silent \
 && echo "${PNPM_SHA512}  pnpm-${PNPM_VERSION}.tgz" | sha512sum -c - \
 && npm install --global "./pnpm-${PNPM_VERSION}.tgz" --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

# Build: every dependency of @evia/api (with devDependencies), the contract and the API compiled.
FROM pnpm AS build
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@evia/api..." \
 && pnpm --filter @evia/contracts run build \
 && pnpm --filter @evia/api run build

# Production dependencies installed from scratch from the manifests and the lockfile only: nothing of the build install
# (devDependencies, root tools) can remain in the image — bramka 6 found them after a pruning `--prod` install.
# Cross build (Arm64 VM): this stage runs on the runner platform, so pnpm installs the platform packages of the TARGET
# (e.g. @node-rs/argon2-linux-arm64-gnu from the lockfile), never the runner's, for the glibc of the distroless runtime.
FROM pnpm AS deps
ARG TARGETARCH
WORKDIR /app
RUN --mount=type=bind,source=.,target=/context \
    case "$TARGETARCH" in arm64) cpu=arm64 ;; amd64) cpu=x64 ;; *) echo "unsupported TARGETARCH $TARGETARCH" >&2; exit 1 ;; esac \
 && cp /context/package.json /context/pnpm-lock.yaml /context/pnpm-workspace.yaml . \
 && cp -R /context/patches . \
 && for manifest in /context/apps/*/package.json /context/packages/*/package.json /context/tools/*/package.json /context/services/*/package.json; do \
      if [ -f "$manifest" ]; then target="${manifest#/context/}"; mkdir -p "$(dirname "$target")"; cp "$manifest" "$target"; fi; \
    done \
 && pnpm install --frozen-lockfile --ignore-scripts --prod --os=linux --cpu="$cpu" --libc=glibc --filter "@evia/api..."

FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:96455baef11b178fc135b32206e3922c515dbed2400676c94f907f8f84e6abf6 AS runtime

# Metadata only (no RUN): links the GHCR package to the repository.
LABEL org.opencontainers.image.source="https://github.com/konradkluz/evia-manager"

ARG EVIA_RELEASE_COMMIT
ENV NODE_ENV=production \
    EVIA_RELEASE_COMMIT=${EVIA_RELEASE_COMMIT}

WORKDIR /app
COPY --from=deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=deps /app/apps/api/package.json ./apps/api/package.json
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist

USER 65532:65532
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK NONE
# The entry point of the base image is node; the runtime compose file chooses dist/src/main.js, worker.js or migrate.js.
CMD ["dist/src/main.js"]
