# Day 1 — Development Environment Setup

## Prerequisites

| Tool           | Version | Install                                        |
| -------------- | ------- | ---------------------------------------------- |
| Node.js        | 22 LTS  | `nvm install 22 && nvm use 22`                 |
| pnpm           | 9.x     | `npm install -g pnpm@9`                        |
| Docker Desktop | 4.x+    | https://www.docker.com/products/docker-desktop |
| Git            | 2.40+   | `brew install git` / `apt install git`         |
| VS Code        | Latest  | https://code.visualstudio.com                  |

## Step 1 — Clone and install

```bash
git clone https://github.com/manassehkafoh/nexustreasury.git
cd nexustreasury
nvm use 22
pnpm install
```

`pnpm install` resolves all 14 workspace packages in a single lockfile. Do not use `npm install` — it will break the workspace symlinks.

## Step 2 — Verify build

```bash
pnpm build
# Expected: Tasks: 14 successful, 14 total
```

The TypeScript `--strict` flag is enabled on all packages. Build errors indicate a real problem — do not disable strictness.

## Step 3 — Run the test suite

```bash
pnpm test
# Expected: 791 tests, 0 failures, 0 prod CVEs
```

If you see failures, check that Node.js 22 is active (`node --version`).

## Step 4 — Security audit

```bash
pnpm audit --prod
# Expected: No known vulnerabilities found
```

Dev-only vulnerabilities (Stryker, esbuild) are acceptable. Prod vulnerabilities must be fixed before merging.

## Step 5 — VS Code extensions (recommended)

- **ESLint** — `dbaeumer.vscode-eslint`
- **Prettier** — `esbenp.prettier-vscode`
- **TypeScript** — built-in (use workspace version)
- **REST Client** — `humao.rest-client` (for `.http` files in `/docs/api`)

## Step 6 — DevContainer (optional but recommended)

```bash
code .
# VS Code will prompt: "Reopen in Container" — click Yes
```

The DevContainer pre-installs Node 22, pnpm 9, the Kafka CLI, and all VS Code extensions. It mirrors the CI environment exactly.

## Environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

You will need:

- `ANTHROPIC_API_KEY` — for Sprint 11 AI assistant (optional for local dev; tests mock it)
- `BLOOMBERG_BPIPE_HOST` — mock is used by default in test mode
- `DATABASE_URL` — defaults to `postgresql://localhost:5432/nexustreasury_dev`

## Troubleshooting

| Symptom                              | Fix                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` | A package test failed. Run `pnpm --filter @nexustreasury/X exec vitest run` to isolate.                            |
| `error TS...` on build               | TypeScript strict violation. Fix the type error — do not add `@ts-ignore`.                                         |
| `No known vulnerabilities` missing   | Run `pnpm install` to refresh the lockfile, then `pnpm audit --prod`.                                              |
| Port conflict                        | Each service has a fixed port (domain=none, trade=4001, risk=4003, alm=4004...). Check `packages/*/src/server.ts`. |
