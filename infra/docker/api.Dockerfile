# Engine API + worker image. Both run from the same image; the worker overrides the command.
# Build context is the repo root:  docker build -f infra/docker/api.Dockerfile .

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /repo

# ── deps: install with the lockfile only, so this layer caches across code changes ──
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @delicate/api... --config.confirmModulesPurge=false

# ── build ──
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter @delicate/contracts run build \
 && pnpm --filter @delicate/db run build \
 && pnpm --filter @delicate/api run build \
 && pnpm --filter @delicate/api --prod deploy --legacy /out

# ── runtime ──
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /out ./
# migrations are applied by the api container at start (see entrypoint)
COPY --from=build --chown=app:app /repo/packages/db/migrations ./node_modules/@delicate/db/migrations
COPY --chown=app:app infra/docker/api-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER app
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
