# Image evia-media-processor (EVM-068 AC5; ADR-0009; SR-FILE-06, SR-SUPPLY-02, SR-INFRA-11): the parser of hostile images, so the smallest runtime that
# works. Built in an IaC session (docs/ops/runbooks/media-processor.md) from the commit of the release:
#   docker build -f infra/images/media-processor/Dockerfile .   (the context is the repository root, restricted by Dockerfile.dockerignore)
# Every base by tag + digest (the same ones as the image of the API), pnpm in the exact version of package.json "packageManager" verified by its SHA-512,
# the lockfile frozen, install scripts disabled (sharp has none: the prebuilt libvips comes in @img/sharp-libvips-*, with the integrity of the lockfile).
# Runtime: Node.js 26 on Debian slim (the same base, by digest, as the image of the API) with ffmpeg and ffprobe from the Debian archive at an EXACT pinned version
# (EVM-046, SR-SUPPLY-06: the build fails without FFMPEG_VERSION); non-root; the process runs `src/main.ts` with type stripping, no build step.
# EVM-046 departs from the distroless runtime of EVM-068: ffprobe and ffmpeg are programs with many shared libraries, which the distroless image does not have.
# The container stays closed by its configuration, not by the image alone (no network, read-only root, no capabilities - compose.media.yaml). The build of
# ffmpeg in Debian is GPL (libx264); the image is not redistributed (server tool, scan 4 in docs/security/requirements.md lists ffmpeg). It is an OS package, so the library licence scan
# (`--pkg-types library`) does not see it and no `.trivyignore.yaml` entry is needed; exception noted 2026-10-31 (SR-SUPPLY-06, as libvips in EVM-068).
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

# Production dependencies of @evia/media-processor only, installed from the manifests and the lockfile (the platform packages of the TARGET:
# libvips for glibc of the distroless runtime).
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
 && pnpm install --frozen-lockfile --ignore-scripts --prod --os=linux --cpu="$cpu" --libc=glibc --filter "@evia/media-processor..."

FROM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS runtime

# renovate: datasource=deb depName=ffmpeg
# The exact Debian package version (`apt-cache madison ffmpeg` in the image of the build date), given by the IaC session and recorded in the register of releases.
ARG FFMPEG_VERSION
RUN test -n "${FFMPEG_VERSION}" \n && apt-get update \n && apt-get install -y --no-install-recommends "ffmpeg=${FFMPEG_VERSION}" \n && rm -rf /var/lib/apt/lists/* \n && ffmpeg -version | head -n 1 && ffprobe -version | head -n 1

# Metadata only (no RUN): links the GHCR package to the repository.
LABEL org.opencontainers.image.source="https://github.com/konradkluz/evia-manager"

ENV NODE_ENV=production

WORKDIR /app
COPY --from=deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/services/media-processor/package.json ./services/media-processor/package.json
COPY --from=deps /app/services/media-processor/node_modules ./services/media-processor/node_modules
COPY services/media-processor/src ./services/media-processor/src

USER 65532:65532
WORKDIR /app/services/media-processor
HEALTHCHECK NONE
# The entry point is node itself (the entry script of the Node image is bypassed); the compose file chooses src/main.ts (and the user of the container, which shares the group of the worker).
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["src/main.ts"]
