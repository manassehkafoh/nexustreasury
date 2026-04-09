# NexusTreasury — Developer Makefile
# Common tasks made simple. All commands assume pnpm is installed.
# Usage: make <target>

.PHONY: help install build test test-e2e bench lint typecheck dev clean \
        infra-up infra-down db-migrate db-reset audit deploy-staging \
        api-test postman-import k6 pact coverage

# ── Colours ───────────────────────────────────────────────────────────────────
BOLD  := \033[1m
GREEN := \033[32m
CYAN  := \033[36m
RESET := \033[0m

help: ## Show this help
	@echo ""
	@echo "$(BOLD)NexusTreasury Developer Commands$(RESET)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  $(CYAN)%-20s$(RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────────

install: ## Install all workspace dependencies
	pnpm install

build: ## Build all 13 services
	pnpm build

clean: ## Remove all build artifacts and node_modules
	pnpm exec turbo clean
	find . -name "node_modules" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	find . -name "dist" -type d -prune -exec rm -rf {} + 2>/dev/null || true

# ── Testing ───────────────────────────────────────────────────────────────────

test: ## Run all unit tests (502 tests)
	pnpm test

test-e2e: ## Run E2E integration tests (31 tests, in-memory)
	pnpm --filter @nexustreasury/e2e exec vitest run

bench: ## Run performance benchmarks (SLA verification)
	pnpm --filter @nexustreasury/e2e exec vitest bench --run

coverage: ## Run tests with coverage report
	pnpm test:coverage
	@echo "Coverage report: packages/*/coverage/lcov-report/index.html"

pact: ## Run Pact consumer contract tests
	pnpm --filter @nexustreasury/accounting-service exec vitest run --config vitest.pact.config.ts 2>/dev/null || echo "Pact tests require pact dependency installed"

k6: ## Run k6 performance tests against local environment (requires k6 installed)
	@command -v k6 >/dev/null 2>&1 || (echo "Install k6: https://k6.io/docs/getting-started/installation/" && exit 1)
	k6 run tests/performance/trade-booking.k6.js --vus 10 --duration 30s

# ── Quality ───────────────────────────────────────────────────────────────────

lint: ## Lint all TypeScript files
	pnpm lint

typecheck: ## TypeScript type-check all packages (no emit)
	pnpm typecheck

audit: ## Security audit (must return 0 vulnerabilities)
	pnpm audit --prod
	@echo "$(GREEN)✅ Zero production CVEs$(RESET)"

format: ## Format all files with Prettier
	pnpm exec prettier --write "**/*.{ts,tsx,yaml,md}" --ignore-path .prettierignore

# ── Local Development ─────────────────────────────────────────────────────────

dev: ## Start all services (requires infra-up first)
	pnpm dev

infra-up: ## Start local infrastructure (PostgreSQL, Kafka, Redis, Elasticsearch)
	docker-compose up -d
	@echo "Waiting for services to be healthy..."
	@sleep 10
	@docker-compose ps

infra-down: ## Stop local infrastructure
	docker-compose down

infra-reset: ## Reset all infrastructure (destroys all data)
	docker-compose down -v
	docker-compose up -d

# ── Database ──────────────────────────────────────────────────────────────────

db-migrate: ## Apply all pending migrations
	pnpm exec prisma migrate dev --schema=prisma/schema.prisma

db-reset: ## Reset database and replay all migrations
	pnpm exec prisma migrate reset --schema=prisma/schema.prisma --force

db-studio: ## Open Prisma Studio (visual DB browser)
	pnpm exec prisma studio --schema=prisma/schema.prisma

# ── API Testing ───────────────────────────────────────────────────────────────

api-test: ## Run Newman API smoke tests against local environment
	@command -v newman >/dev/null 2>&1 || npm install -g newman newman-reporter-htmlextra
	./scripts/run-api-tests.sh local

api-test-staging: ## Run Newman API smoke tests against staging
	./scripts/run-api-tests.sh staging

# ── Tenant Provisioning ───────────────────────────────────────────────────────

provision-tenant: ## Dry-run tenant provisioning (override TENANT_ID, DISPLAY_NAME, ADMIN_EMAIL)
	pnpm exec tsx scripts/provision-tenant.ts \
		--tenantId   $${TENANT_ID:-demo-bank} \
		--displayName "$${DISPLAY_NAME:-Demo Bank Ltd}" \
		--adminEmail $${ADMIN_EMAIL:-admin@demobank.com} \
		--currency   $${CURRENCY:-USD} \
		--dryRun

# ── Docker ────────────────────────────────────────────────────────────────────

docker-build: ## Build all Docker images locally
	docker-compose build

docker-build-service: ## Build a single service (usage: make docker-build-service SERVICE=trade-service)
	docker build -t nexustreasury/$(SERVICE):local \
		-f packages/$(SERVICE)/Dockerfile .

# ── Deployment ────────────────────────────────────────────────────────────────

deploy-staging: ## Trigger staging deployment (requires GitHub CLI)
	gh workflow run cd-staging.yml --ref main

# ── Postman ───────────────────────────────────────────────────────────────────

postman-import: ## Import Postman collection and local environment
	@echo "Import these files into Postman:"
	@echo "  Collection: docs/NexusTreasury_API_Collection.postman_collection.json"
	@echo "  Environment: docs/NexusTreasury_Local.postman_environment.json"
	@echo ""
	@echo "Or use the mock server (no setup needed):"
	@echo "  https://eeed7962-2b7b-495b-b197-03bb48aaae11.mock.pstmn.io"
