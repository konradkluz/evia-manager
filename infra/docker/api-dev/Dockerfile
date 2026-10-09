# Local development only (EVM-077; ADR-0015): the API image for compose.dev.yaml — close to staging and production (built
# JavaScript from `dist/`, production dependencies only, non-root, nothing but the application inside). Never deployed.
# Reproducible: base image by tag + digest (Renovate), pnpm in the exact version of package.json "packageManager",
# `--frozen-lockfile`, install scripts disabled (allowBuilds of pnpm-workspace.yaml applies). No secret enters the image:
# no ARG/ENV with values — CURSOR_KEY exists only at run time, from the environment of the container (compose.dev.yaml).
# The build context is an allow-list (Dockerfile.dockerignore). apps/api/dev (seed, tools) is not copied anywhere.
FROM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS build

# renovate: datasource=npm depName=pnpm
ARG PNPM_VERSION=12.8.1

RUN npm install --global "pnpm@${PNPM_VERSION}" --ignore-scripts --no-audit --no-fund \
 && node /usr/local/lib/node_modules/pnpm/install.js \
 && npm cache clean --force

ENV CI=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    DO_NOT_TRACK=1

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@evia/api..." \
 && pnpm --filter @evia/contracts run build \
 && pnpm --filter @evia/api run build \
 && pnpm install --frozen-lockfile --ignore-scripts --prod --filter "@evia/api..."

FROM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS runtime

WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules

# The image holds the built API only: the seed and the development tools (apps/api/dev) are never part of it.
RUN test ! -e /app/apps/api/dev && test ! -e /app/apps/api/.dev-build && test ! -e /app/apps/api/src

USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK NONE
CMD ["sh", "-c", "node dist/src/migrate.js && exec node dist/src/main.js"]
