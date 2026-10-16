# Dev and CI only (ADR-0015 pkt 7, ADR-0016; EVM-087): Linux Playwright environment for the panel E2E before a push.
# Browsers and their system libraries come from the official Playwright image (version = @playwright/test in
# apps/web/package.json); Node.js comes from the same image as backend-tests (engines: >=26 <27). Both by tag + digest
# (Renovate). Nothing else is downloaded except the exact pnpm. Never used on staging or production.
FROM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS node

FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27

# Node.js 26 (binary, npm, corepack) in /usr/local, ahead of the Node.js of the Playwright image in PATH.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# renovate: datasource=npm depName=pnpm
ARG PNPM_VERSION=12.8.1

# Same pnpm handling as infra/docker/backend-tests/Dockerfile (native binary linked by pnpm's own install.js).
# /work is the shared volume bt-work (Linux node_modules and pnpm store of backend-install); uid 1000 owns it there too.
RUN npm install --global "pnpm@${PNPM_VERSION}" --ignore-scripts --no-audit --no-fund \
 && node /usr/local/lib/node_modules/pnpm/install.js \
 && npm cache clean --force \
 && mkdir -p /work/repo /work/pnpm-store /work/cache /out \
 && chown -R 1000:1000 /work /out

ENV XDG_CACHE_HOME=/work/cache \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    TURBO_TELEMETRY_DISABLED=1 \
    TURBO_NO_UPDATE_NOTIFIER=1 \
    DO_NOT_TRACK=1

USER 1000:1000
WORKDIR /work/repo
HEALTHCHECK NONE
# Reused entry point of backend-tests: sync /src → /work/repo, offline install from the volume, run the command.
ENTRYPOINT ["node", "/src/tools/container/sync.mjs"]
