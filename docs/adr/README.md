# Architecture Decision Records

This directory contains all ADRs (Architecture Decision Records) for NexusTreasury.

ADRs document _why_ a decision was made — the context, the alternatives considered,
and the consequences accepted. When you see something in the codebase and wonder
"why is it done this way?", check here first.

| ADR     | Title                                                    | Status   |
| ------- | -------------------------------------------------------- | -------- |
| ADR-001 | Single Combined Prisma Schema at Root                    | Accepted |
| ADR-002 | Renovate Bot Instead of Dependabot                       | Accepted |
| ADR-003 | Turbo v2 `tasks` Instead of `pipeline`                   | Accepted |
| ADR-004 | `(app as any).get()` for @fastify/websocket Routes       | Accepted |
| ADR-005 | `@ts-expect-error` Banned in Favour of Explicit Casts    | Accepted |
| ADR-006 | One Vitest Config Per Package with `tsc --build --force` | Accepted |

Full ADR text is in [ARCHITECTURE.md](../../ARCHITECTURE.md#11-architecture-decision-records-adrs).

## How to Write a New ADR

When you make a significant architectural decision, document it:

```markdown
### ADR-NNN: Title

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-NNN

**Context:** What situation or problem led to this decision?

**Decision:** What did we decide to do?

**Consequences:** What are the positive and negative outcomes?
```

Add the ADR to `ARCHITECTURE.md` and update this index.
