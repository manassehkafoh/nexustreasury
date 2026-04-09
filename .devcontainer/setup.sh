#!/bin/bash
# NexusTreasury Dev Container — Post-Create Setup
# Runs automatically after the container is created.
# Target: Developer sees a running platform in < 5 minutes.

set -euo pipefail

echo "🏦 Setting up NexusTreasury development environment..."

# 1. Install pnpm
npm install -g pnpm@9 --silent

# 2. Install workspace dependencies
pnpm install --frozen-lockfile

# 3. Generate Prisma client
pnpm exec prisma generate --schema=prisma/schema.prisma 2>/dev/null || true

# 4. Start local infrastructure (Docker in Docker)
if command -v docker &>/dev/null; then
  echo "⚙️  Starting PostgreSQL, Kafka, Redis..."
  docker-compose up -d postgres kafka redis 2>/dev/null || echo "⚠️  Docker unavailable — start manually"
  sleep 5
fi

# 5. Run database migrations
pnpm exec prisma migrate deploy --schema=prisma/schema.prisma 2>/dev/null || true

# 6. Build all packages
echo "🔨 Building 13 services..."
pnpm build

# 7. Run tests to verify the environment
echo "🧪 Running smoke tests..."
pnpm --filter @nexustreasury/domain exec vitest run --reporter=dot 2>/dev/null \
  && echo "✅ Domain tests passing" \
  || echo "⚠️  Some tests failed — check output"

echo ""
echo "✅ NexusTreasury is ready!"
echo "   Run: pnpm dev"
echo "   Dashboard: http://localhost:3000"
echo "   Trade API: http://localhost:4001/api/v1"
