# syntax=docker/dockerfile:1

# Build on the runner's native platform: `vite build` emits plain JS that is the
# same for every target, so there's no reason to run it under QEMU.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /maia

ENV NODE_ENV=development

# Manifests only, for layer caching.
COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY tsconfig.json vite.config.ts flue.config.ts ./
COPY src src

RUN npm run build

# The runtime stage is built per target platform. Production dependencies are
# NOT copied from the build stage: esbuild (pulled in at runtime through
# @flue/runtime -> pi-agent-core -> chord) ships an arch-specific binary, so
# they have to be installed for the target platform.
FROM node:24-alpine AS runtime
WORKDIR /maia

ENV NODE_ENV=production

EXPOSE 3000
# PORT here only sees the container environment, not the .env file, hence the
# fallback matching the default in .env.dist.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --spider -q http://127.0.0.1:${PORT:-3000}/health || exit 1

# Manifests only, kept separate from the compiled app below so this layer's
# cache only busts when dependencies actually change, not on every source edit.
# Optional deps are kept on purpose: esbuild's platform binary is one.
COPY package.json package-lock.json ./

# tini runs as PID 1: it forwards SIGTERM to the server (which shuts down
# gracefully) and reaps orphaned processes, e.g. shell commands an agent runs.
RUN --mount=type=cache,target=/root/.npm \
    apk add --no-cache tini \
    && npm ci --omit=dev \
    && mkdir data \
    && chown node:node data

COPY --from=build /maia/dist dist

# Defaults for `--env-file=.env` below. Override any of them with the container
# environment, which takes precedence over the file.
COPY .env.dist .env

USER node

# src/db.ts stores conversations in ./data/flue.db (node:sqlite, relative to the
# cwd). Mount a volume here or they're lost when the container is replaced.
VOLUME ["/maia/data"]

ENTRYPOINT ["tini", "--"]
# Same command as `npm start`, without npm in between: one process fewer and
# signals go straight from tini to node.
CMD ["node", "--env-file=.env", "dist/server.mjs"]
