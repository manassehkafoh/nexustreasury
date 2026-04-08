# ─── Stage 1: Builder ────────────────────────────────────────
FROM node:24-alpine3.21 AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/domain/package.json ./packages/domain/
COPY packages/trade-service/package.json ./packages/trade-service/
COPY packages/position-service/package.json ./packages/position-service/
COPY packages/risk-service/package.json ./packages/risk-service/
COPY packages/alm-service/package.json ./packages/alm-service/
COPY packages/bo-service/package.json ./packages/bo-service/
COPY packages/market-data-service/package.json ./packages/market-data-service/
COPY packages/web/package.json ./packages/web/

RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm exec prisma generate --schema=prisma/schema.prisma

COPY packages/domain ./packages/domain
COPY packages/alm-service ./packages/alm-service
RUN pnpm --filter @nexustreasury/domain build
RUN pnpm --filter @nexustreasury/alm-service build

RUN pnpm deploy --filter @nexustreasury/alm-service --prod /deploy

# ─── Stage 2: Production ─────────────────────────────────────
FROM node:24-alpine3.21 AS production

RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 nexus && adduser -u 1001 -G nexus -s /bin/sh -D nexus

WORKDIR /app
RUN chown nexus:nexus /app

COPY --from=builder --chown=nexus:nexus /deploy/node_modules ./node_modules
COPY --from=builder --chown=nexus:nexus /deploy/dist ./dist

USER nexus

EXPOSE 4004 9090

ENV NODE_ENV=production

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4004/health/live || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
