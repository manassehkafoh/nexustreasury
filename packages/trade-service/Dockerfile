# ─── Stage 1: Builder ────────────────────────────────────────
FROM node:20-alpine3.21 AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/domain/package.json ./packages/domain/
COPY packages/trade-service/package.json ./packages/trade-service/

RUN pnpm install --frozen-lockfile

COPY packages/domain ./packages/domain
COPY packages/trade-service ./packages/trade-service

RUN pnpm --filter @nexustreasury/domain build
RUN pnpm --filter @nexustreasury/trade-service build

# ─── Stage 2: Production ─────────────────────────────────────
FROM node:20-alpine3.21 AS production

RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 nexus && adduser -u 1001 -G nexus -s /bin/sh -D nexus

WORKDIR /app
RUN chown nexus:nexus /app

COPY --from=builder --chown=nexus:nexus /app/packages/trade-service/dist ./dist
COPY --from=builder --chown=nexus:nexus /app/packages/domain/dist ./node_modules/@nexustreasury/domain/dist
COPY --from=builder --chown=nexus:nexus /app/packages/trade-service/node_modules ./node_modules

USER nexus

EXPOSE 4001 4101 9090

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4001/health/live || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
