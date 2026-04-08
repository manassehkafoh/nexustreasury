# ─── Stage 1: Builder ────────────────────────────────────────
FROM node:22-alpine3.21 AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy ALL workspace package manifests (pnpm workspace requires all to be present)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/domain/package.json ./packages/domain/
COPY packages/trade-service/package.json ./packages/trade-service/
COPY packages/position-service/package.json ./packages/position-service/
COPY packages/risk-service/package.json ./packages/risk-service/
COPY packages/alm-service/package.json ./packages/alm-service/
COPY packages/bo-service/package.json ./packages/bo-service/
COPY packages/market-data-service/package.json ./packages/market-data-service/
COPY packages/web/package.json ./packages/web/

# Install all dependencies (workspace packages remain symlinks here — that is fine;
# pnpm deploy below will copy them as physical files for the production stage)
RUN pnpm install --frozen-lockfile

# Copy root Prisma schema and generate @prisma/client types
COPY prisma ./prisma
RUN pnpm exec prisma generate --schema=prisma/schema.prisma

# Copy source and build domain + service
COPY packages/domain ./packages/domain
COPY packages/trade-service ./packages/trade-service
RUN pnpm --filter @nexustreasury/domain build
RUN pnpm --filter @nexustreasury/trade-service build

# pnpm deploy: creates /deploy with ALL production deps as PHYSICAL FILES
# This eliminates workspace symlinks entirely — no more overlayfs conflicts
RUN pnpm deploy --filter @nexustreasury/trade-service --prod /deploy

# ─── Stage 2: Production ─────────────────────────────────────
FROM node:22-alpine3.21 AS production

RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 nexus && adduser -u 1001 -G nexus -s /bin/sh -D nexus

WORKDIR /app
RUN chown nexus:nexus /app

# Copy the self-contained deployment (no symlinks, no workspace packages)
COPY --from=builder --chown=nexus:nexus /deploy/node_modules ./node_modules
COPY --from=builder --chown=nexus:nexus /deploy/dist ./dist

USER nexus

EXPOSE 4001 9090

ENV NODE_ENV=production

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4001/health/live || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
