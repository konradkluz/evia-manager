# Image of the deployment verifier (EVM-007 AC3; ADR-0018 m5): built ONLY in an IaC session of Konrad from a clean main
# (never by the deployment channel or by `publish`) and pinned by its ID in /etc/evia/deploy-agent/compose.agent.yaml.
# The TypeScript sources run directly (Node.js 26 strips types); the only runtime dependency is yaml from the lockfile.
# Runtime: distroless Node.js 26, non-root, no shell. Same build rules as the release images, including the platform:
# build with --platform linux/arm64 (Arm64 VM) — the build stage runs on $BUILDPLATFORM and installs the dependencies of
# the target CPU, the runtime stage only copies files (natively on the VM or cross-built elsewhere, no emulation).
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

ARG TARGETARCH
WORKDIR /app
COPY . .
RUN case "$TARGETARCH" in arm64) cpu=arm64 ;; amd64) cpu=x64 ;; *) echo "unsupported TARGETARCH $TARGETARCH" >&2; exit 1 ;; esac \
 && pnpm install --frozen-lockfile --ignore-scripts --prod --os=linux --cpu="$cpu" --libc=glibc --filter "@evia/deploy-agent"

FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:b093852cde840e6f7ab2c2081adfbdb81810a340e06a2869fdc4ed31354c9d9e AS runtime

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/deploy-agent/package.json ./services/deploy-agent/package.json
COPY --from=build /app/services/deploy-agent/node_modules ./services/deploy-agent/node_modules
COPY --from=build /app/services/deploy-agent/src ./services/deploy-agent/src

USER 10010:10010
WORKDIR /app/services/deploy-agent
HEALTHCHECK NONE
CMD ["src/cli.ts"]
