FROM node:20-alpine3.21 AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/domain/package.json ./packages/domain/
COPY packages/position-service/package.json ./packages/position-service/
RUN pnpm install --frozen-lockfile

# Copy root Prisma schema and generate @prisma/client types
COPY prisma ./prisma
RUN pnpm exec prisma generate --schema=prisma/schema.prisma

COPY packages/domain ./packages/domain
COPY packages/position-service ./packages/position-service
RUN pnpm --filter @nexustreasury/domain build
RUN pnpm --filter @nexustreasury/position-service build

FROM node:20-alpine3.21 AS production
RUN apk add --no-cache dumb-init && addgroup -g 1001 nexus && adduser -u 1001 -G nexus -s /bin/sh -D nexus
WORKDIR /app
RUN chown nexus:nexus /app
COPY --from=builder --chown=nexus:nexus /app/packages/position-service/dist ./dist
COPY --from=builder --chown=nexus:nexus /app/packages/position-service/node_modules ./node_modules
USER nexus
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
