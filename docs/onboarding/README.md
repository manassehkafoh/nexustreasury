# Software Engineer Onboarding — NexusTreasury

Welcome to the NexusTreasury engineering team. This guide takes you from zero to your first merged PR in one week.

## Onboarding modules

| Day | Module | Goal |
|---|---|---|
| Day 1 | [01 — Dev environment setup](./01-dev-environment.md) | Running `pnpm test` locally |
| Day 1–2 | [02 — Architecture primer](./02-architecture-primer.md) | Understanding the 14-service monorepo |
| Day 2–3 | [03 — Domain model deep dive](./03-domain-model.md) | Navigating DDD aggregates and bounded contexts |
| Day 3–4 | [04 — Adding a new service](./04-adding-a-service.md) | Step-by-step: scaffold → test → deploy |
| Day 4–5 | [05 — Testing guide](./05-testing-guide.md) | Unit, integration, contract, E2E, k6 performance |
| Day 5 | [06 — First week checklist](./06-first-week-checklist.md) | Verify you can ship |

## Repository

`https://github.com/manassehkafoh/nexustreasury` — branch `main`

## Quick start (TL;DR)

```bash
git clone https://github.com/manassehkafoh/nexustreasury.git
cd nexustreasury
nvm use 22          # Node.js 22 LTS
pnpm install
pnpm build
pnpm test           # 791 tests, 0 failures expected
```
