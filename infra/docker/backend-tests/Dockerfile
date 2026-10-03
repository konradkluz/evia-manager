# Dev and CI only (ADR-0015, ADR-0016; EVM-006): Linux environment for backend tests. Never used on staging or production.
# Reproducible: base image by tag + digest (updated by Renovate with a cooldown), pnpm in the exact version from
# package.json "packageManager", install scripts disabled. Nothing else is downloaded (no apt-get) — tested by tools/repo-policy.
FROM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1

# renovate: datasource=npm depName=pnpm
ARG PNPM_VERSION=12.8.1

# pnpm 12 ships a native binary in an optional dependency; with --ignore-scripts its bin stays a shebang-less
# placeholder that Turborepo cannot exec. pnpm's own install.js (run explicitly, offline) links the native binary.
RUN npm install --global "pnpm@${PNPM_VERSION}" --ignore-scripts --no-audit --no-fund \
 && node /usr/local/lib/node_modules/pnpm/install.js \
 && npm cache clean --force \
 && mkdir -p /work/repo /work/pnpm-store /work/cache /out \
 && chown -R node:node /work /out

# XDG_CACHE_HOME in the bt-work volume: pnpm keeps package metadata there, so the offline install in backend-tests
# can verify the lockfile against minimumReleaseAge (the home directory is a tmpfs, emptied after every run).
ENV XDG_CACHE_HOME=/work/cache \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    TURBO_TELEMETRY_DISABLED=1 \
    TURBO_NO_UPDATE_NOTIFIER=1 \
    DO_NOT_TRACK=1

USER node
WORKDIR /work/repo
ENTRYPOINT ["node", "/src/tools/container/sync.mjs"]
