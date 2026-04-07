# ─── Stage 1: Builder ─────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/domain/package.json   ./packages/domain/
COPY packages/web/package.json      ./packages/web/

RUN pnpm install --frozen-lockfile

COPY packages/domain ./packages/domain
COPY packages/web    ./packages/web

RUN pnpm --filter @nexustreasury/domain build
RUN pnpm --filter @nexustreasury/web    build

# ─── Stage 2: Production ──────────────────────────────────────
FROM node:20-alpine AS production

RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 nexus && adduser -u 1001 -G nexus -s /bin/sh -D nexus

WORKDIR /app
RUN chown nexus:nexus /app

COPY --from=builder --chown=nexus:nexus /app/packages/web/.next/standalone  ./
COPY --from=builder --chown=nexus:nexus /app/packages/web/.next/static       ./.next/static
COPY --from=builder --chown=nexus:nexus /app/packages/web/public             ./public

USER nexus
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
