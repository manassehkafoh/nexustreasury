# Learner Guide 8: Building on NexusTreasury

**Prerequisites:** All previous learner guides, or practical engineering experience
with the codebase.

**What you'll learn:** How to add new features confidently — new asset classes,
new services, new API endpoints, and new integrations — following the same
patterns used throughout the platform.

---

## The Golden Rule

> **Every new feature starts in the domain.**
>
> Before writing a route, a repository, or a Kafka producer, write the domain
> aggregate, value object, or domain event. Test it in isolation. Only then
> wire it to infrastructure.

This rule is not bureaucracy — it's what makes the codebase testable, readable,
and maintainable at scale.

---

## Scenario 1: Adding a New Asset Class (e.g. Repo)

**A repo (repurchase agreement)** is a short-term borrowing instrument where
the bank sells securities and agrees to repurchase them later.

### Step 1: Domain layer

```typescript
// packages/domain/src/trading/trade.aggregate.ts
export enum AssetClass {
  FX = 'FX',
  FIXED_INCOME = 'FIXED_INCOME',
  MONEY_MARKET = 'MONEY_MARKET',
  REPO = 'REPO', // ← add this
  // ...
}
```

If repos have unique invariants (e.g. must have a maturityDate), add them:

```typescript
// In Trade.book() invariants section
if (params.assetClass === AssetClass.REPO && !params.maturityDate) {
  throw new TradeDomainError('REPO_REQUIRES_MATURITY', 'Repo trades must have a maturity date');
}
```

Add a test:

```typescript
// packages/domain/src/trading/trade.aggregate.test.ts
it('throws when booking a REPO without maturityDate', () => {
  expect(() => Trade.book({ ...repoParams, maturityDate: undefined })).toThrow(TradeDomainError);
});
```

### Step 2: Zod validation schema

```typescript
// packages/trade-service/src/routes/trade.routes.ts
const BookTradeSchema = z.object({
  assetClass: z.enum([
    'FX',
    'FIXED_INCOME',
    'MONEY_MARKET',
    'REPO', // ← add REPO
    // ...
  ]),
  // ...
});
```

### Step 3: OpenAPI spec

```yaml
# packages/trade-service/openapi/trade-service.yaml
assetClass:
  type: string
  enum:
    - FX
    - FIXED_INCOME
    - MONEY_MARKET
    - REPO # ← add REPO
```

That's it. No database migration needed (asset class is stored as a `STRING`
in the `trades` table, so new values work without schema changes).

---

## Scenario 2: Adding a New API Endpoint

Example: `GET /api/v1/trades?bookId=<uuid>` — list all trades for a book.

### Step 1: Add to TradeRepository interface (domain)

```typescript
// packages/domain/src/trading/trade.aggregate.ts
export interface TradeRepository {
  findByBookId(bookId: BookId, tenantId: TenantId): Promise<Trade[]>; // ← add
  // ...
}
```

### Step 2: Implement in PrismaTradeRepository

```typescript
// packages/trade-service/src/infrastructure/postgres/trade.repository.ts
async findByBookId(bookId: BookId, tenantId: TenantId): Promise<Trade[]> {
  const rows = await this.prisma.trade.findMany({
    where: { bookId, tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100,  // always paginate
  });
  return rows.map((r) => this.toDomain(r));
}
```

### Step 3: Add the route

```typescript
// packages/trade-service/src/routes/trade.routes.ts
const ListTradesSchema = z.object({ bookId: z.string().uuid() });

app.get(
  '/by-book/:bookId',
  {
    schema: { tags: ['trades'], security: [{ bearerAuth: [] }] },
  },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ListTradesSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: params.error.message });
    }
    const user = request.user as { tenantId: string };
    const trades = await app.tradeRepository.findByBookId(
      BookId(params.data.bookId),
      TenantId(user.tenantId),
    );
    return reply.status(200).send({ trades, count: trades.length });
  },
);
```

### Step 4: Add a test

```typescript
it('returns trades for a book', async () => {
  (app.tradeRepository.findByBookId as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce([{ id: 'trade-1', ... }]);

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/trades/by-book/1234abcd-ab12-1234-1234-123412341234',
    headers: { authorization: `Bearer ${token}` },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json().count).toBe(1);
});
```

---

## Scenario 3: Adding a New Microservice

Example: A `reporting-service` that generates PDF trade reports.

Follow the checklist in [CONTRIBUTING.md §7](../../CONTRIBUTING.md#7-adding-a-new-service),
then apply these principles:

1. **Define the bounded context** — what data does this service own? Does it need a database schema?
2. **Consume via Kafka** — if it needs trade data, subscribe to `nexus.trading.trades`
3. **Never query another service's DB** — only its own schema
4. **Add Kubernetes manifests** in `infra/kubernetes/base/reporting-service.yaml`
5. **Add to turbo.json** with `dependsOn: ["@nexustreasury/domain#build"]`

---

## Scenario 4: Adding a New Kafka Consumer

Example: The reporting-service subscribes to `nexus.trading.trades`.

Pattern to follow (identical to `PositionKafkaConsumer`):

```typescript
export class ReportingKafkaConsumer {
  private consumer: Consumer;

  constructor(private readonly onTradeBooked: (event: TradeBookedEvent) => Promise<void>) {
    this.consumer = new Kafka({
      clientId: 'reporting-service',
      brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(','),
    }).consumer({ groupId: 'reporting-service-group' });
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: ['nexus.trading.trades'], fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const event = JSON.parse(message.value!.toString());
        if (event.eventType === 'nexus.trading.trade.booked') {
          await this.onTradeBooked(event as TradeBookedEvent);
        }
      },
    });
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }
}
```

---

## Scenario 5: Adding a New Domain Event

Example: `TradeValidatedEvent` — fired when a trade passes validation.

### Step 1: Define the event

```typescript
// packages/domain/src/trading/trade.aggregate.ts
export class TradeValidatedEvent extends DomainEvent {
  readonly eventType = 'nexus.trading.trade.validated';
  constructor(public readonly trade: Trade) {
    super({ aggregateId: trade.id, tenantId: trade.tenantId });
  }
}
```

### Step 2: Emit from the aggregate

```typescript
// In the Trade aggregate
validate(): void {
  if (this._props.status !== TradeStatus.PENDING_VALIDATION) {
    throw new TradeDomainError('CANNOT_VALIDATE', '...');
  }
  (this._props as { status: TradeStatus }).status = TradeStatus.VALIDATED;
  this._domainEvents.push(new TradeValidatedEvent(this));
}
```

### Step 3: Export from domain index

```typescript
// packages/domain/src/index.ts
export { TradeValidatedEvent } from './trading/trade.aggregate.js';
```

### Step 4: Document in Kafka Event Reference

Update `docs/wiki/Kafka-Event-Reference.md` with the new event payload schema.

---

## Testing Checklist

Before every pull request:

```bash
# 1. Build passes (no TypeScript errors)
pnpm build

# 2. All tests pass
pnpm test

# 3. Coverage thresholds met
pnpm test:coverage

# 4. Prettier formatting
pnpm exec prettier --check "**/*.{ts,tsx,yaml,md}" --ignore-path .prettierignore

# 5. ESLint passes
pnpm lint
```

All 5 must be green before opening a PR. The CI gates enforce the same checks —
if your local run is green, CI will be too.

---

## Common Mistakes to Avoid

| Mistake                                                     | Correct approach                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Importing Prisma in the domain layer                        | Define a Repository interface in domain; implement in infrastructure            |
| Using `parse()` instead of `safeParse()` for Zod validation | `safeParse()` returns 400; `parse()` throws a 500                               |
| Running `prisma generate` inside a service package          | Always run from root: `pnpm exec prisma generate --schema=prisma/schema.prisma` |
| Committing `tsconfig.tsbuildinfo` to git                    | Already in `.gitignore` — check `git status` before committing                  |
| Adding a new field to a model without a Prisma migration    | Run `pnpm exec prisma migrate dev --name my_field`                              |
| Writing tests that depend on real Kafka / Postgres          | Use mocks for unit tests; use docker-compose for integration tests              |

---

Congratulations — you've completed the NexusTreasury learner series. 🎓

You now understand the complete platform: from what a TMS does, through the trade lifecycle,
domain-driven design, position keeping, risk controls, liquidity management, back office
operations, and how to build new features confidently.

Start with a small first contribution: fix a failing test, improve a piece of documentation,
or add a missing test case for an uncovered code path.
