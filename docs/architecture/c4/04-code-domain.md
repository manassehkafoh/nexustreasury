# C4 Level 4 — Domain Model Class Diagrams

DDD value objects, aggregates, domain events, and bounded-context relationships
from `packages/domain/src/`.

## Shared Kernel — Value Objects

```mermaid
classDiagram
  class Brand~T,B~ {
    <<type>>
    +T value
    +__brand: B
  }

  class TradeId { <<Brand string TradeId>> }
  class PositionId { <<Brand string PositionId>> }
  class CounterpartyId { <<Brand string CounterpartyId>> }
  class InstrumentId { <<Brand string InstrumentId>> }
  class BookId { <<Brand string BookId>> }
  class TraderId { <<Brand string TraderId>> }
  class TenantId { <<Brand string TenantId>> }
  class LimitId { <<Brand string LimitId>> }

  class Money {
    +amount: bigint (cents)
    +currency: string (ISO 4217)
    +static of(amount, currency) Money
    +static fromCents(cents, currency) Money
    +add(other: Money) Money
    +subtract(other: Money) Money
    +multiply(factor: number) Money
    +toNumber() number
    +toString() string
  }

  class Percentage {
    +value: number (0.0 – 1.0)
    +static of(pct: number) Percentage
    +toDecimal() number
    +toDisplay() string
  }

  class BusinessDate {
    +date: Date
    +static today() BusinessDate
    +static parse(iso: string) BusinessDate
    +addDays(n: number) BusinessDate
    +addMonths(n: number) BusinessDate
    +isWeekend() boolean
    +isBefore(other: BusinessDate) boolean
    +toISO() string
  }

  class DomainEvent {
    <<abstract>>
    +eventId: string
    +eventType: string
    +aggregateId: string
    +aggregateType: string
    +correlationId: string
    +causationId: string
    +occurredAt: Date
    +tenantId: TenantId
    +version: number
  }

  Brand <|-- TradeId
  Brand <|-- PositionId
  Brand <|-- CounterpartyId
  Brand <|-- InstrumentId
  Brand <|-- BookId
  Brand <|-- TraderId
  Brand <|-- TenantId
  Brand <|-- LimitId
```

## Trading Bounded Context

```mermaid
classDiagram
  class Trade {  %% Trade Aggregate Root
    +id: TradeId
    +tenantId: TenantId
    +instrumentId: InstrumentId
    +counterpartyId: CounterpartyId
    +bookId: BookId
    +traderId: TraderId
    +reference: string
    +status: TradeStatus
    +direction: TradeDirection
    +notional: Money
    +price: number
    +tradeDate: BusinessDate
    +valueDate: BusinessDate
    +maturityDate: BusinessDate
    +createdAt: Date
    +updatedAt: Date
    +static create(props: CreateTradeProps) Trade
    +confirm() void
    +amend(props: AmendTradeProps) void
    +cancel(reason: string) void
    +toDTO() TradeDTO
  }

  class TradeStatus {
    <<enumeration>>
    DRAFT
    CONFIRMED
    AMENDED
    CANCELLED
    SETTLED
    MATURED
  }

  class TradeDirection {
    <<enumeration>>
    BUY
    SELL
  }

  class TradeCreatedEvent {
    +eventType: "TradeCreated"
    +tradeId: TradeId
    +tradeRef: string
    +instrumentId: InstrumentId
    +counterpartyId: CounterpartyId
    +bookId: BookId
    +direction: TradeDirection
    +notional: Money
    +price: number
    +tradeDate: BusinessDate
    +valueDate: BusinessDate
  }

  class TradeAmendedEvent {
    +eventType: "TradeAmended"
    +tradeId: TradeId
    +amendments: Partial~TradeProps~
    +reason: string
  }

  class TradeCancelledEvent {
    +eventType: "TradeCancelled"
    +tradeId: TradeId
    +reason: string
    +cancelledAt: Date
  }

  class BookTradeCommand {
    +instrumentId: InstrumentId
    +counterpartyId: CounterpartyId
    +bookId: BookId
    +direction: TradeDirection
    +notional: Money
    +price: number
    +tradeDate: BusinessDate
    +valueDate: BusinessDate
    +tenantId: TenantId
    +traderId: TraderId
  }

  class PreDealCheckResult {
    +passed: boolean
    +checks: PreDealCheck[]
    +limitUtilisation: Percentage
    +counterpartyExposure: Money
    +checkedAt: Date
  }

  Trade --> TradeStatus : has
  Trade --> TradeDirection : has
  Trade --> Money : notional
  Trade --> BusinessDate : tradeDate
  Trade --> BusinessDate : valueDate
  Trade ..> TradeCreatedEvent : raises
  Trade ..> TradeAmendedEvent : raises
  Trade ..> TradeCancelledEvent : raises
  DomainEvent <|-- TradeCreatedEvent
  DomainEvent <|-- TradeAmendedEvent
  DomainEvent <|-- TradeCancelledEvent
```

## Position Bounded Context

```mermaid
classDiagram
  class Position {
    +id: PositionId
    +tenantId: TenantId
    +bookId: BookId
    +instrumentId: InstrumentId
    +quantity: number
    +notional: Money
    +marketValue: Money
    +unrealisedPnL: Money
    +realisedPnL: Money
    +accruedInterest: Money
    +positionDate: BusinessDate
    +lastUpdated: Date
    +version: number
    +static reconstitute(events) Position
    +applyTradeCreated(event) void
    +applyPositionRevalued(event) void
    +applyPositionClosed(event) void
    +getUnrealisedPnL(currentPrice) Money
  }

  class PositionUpdatedEvent {
    +eventType: "PositionUpdated"
    +positionId: PositionId
    +bookId: BookId
    +instrumentId: InstrumentId
    +notional: Money
    +unrealisedPnL: Money
    +triggeringTradeId: TradeId
  }

  class LiquidityGapReport {
    +id: string
    +tenantId: TenantId
    +legalEntityId: string
    +reportDate: BusinessDate
    +scenario: GapScenario
    +currency: string
    +buckets: GapBucket[]
    +lcr: Percentage
    +nsfr: Percentage
    +survivalDays: number
    +generatedAt: Date
    +static generate(cashFlows, hqla) LiquidityGapReport
  }

  class GapBucket {
    +tenor: string (O/N, 1W, 1M, 3M, 6M, 1Y, 2Y, 5Y+)
    +inflows: Money
    +outflows: Money
    +netGap: Money
    +cumulativeGap: Money
  }

  class GapScenario {
    <<enumeration>>
    CONTRACTUAL
    BEHAVIOURAL
    STRESSED
  }

  Position --> PositionUpdatedEvent : raises
  DomainEvent <|-- PositionUpdatedEvent
  LiquidityGapReport --> GapBucket : contains
  LiquidityGapReport --> GapScenario : has
```

## Risk Bounded Context

```mermaid
classDiagram
  class Limit {
    +id: LimitId
    +tenantId: TenantId
    +limitType: LimitType
    +counterpartyId: CounterpartyId
    +bookId: BookId
    +amount: Money
    +utilisedAmount: Money
    +status: LimitStatus
    +effectiveDate: BusinessDate
    +expiryDate: BusinessDate
    +static create(props) Limit
    +utilisationPct() Percentage
    +hasCapacity(required: Money) boolean
    +reserve(amount: Money) void
    +release(amount: Money) void
    +isBreach() boolean
  }

  class LimitType {
    <<enumeration>>
    FX_NET_OPEN_POSITION
    COUNTERPARTY_CREDIT
    DV01
    VAR
    CVA
    FRTB_SA
  }

  class LimitStatus {
    <<enumeration>>
    ACTIVE
    SUSPENDED
    EXPIRED
    BREACHED
  }

  class LimitBreachEvent {
    +eventType: "LimitBreach"
    +limitId: LimitId
    +limitType: LimitType
    +counterpartyId: CounterpartyId
    +utilisedAmount: Money
    +limitAmount: Money
    +utilisationPct: Percentage
    +breachedAt: Date
  }

  class PreDealCheckHandler {
    -limitRepo: LimitRepository
    -rateAdapter: RateAdapter
    +check(command: BookTradeCommand) PreDealCheckResult
    +checkCounterpartyExposure(cpId, amount) boolean
    +checkBookLimit(bookId, limitType, amount) boolean
  }

  Limit --> LimitType : has
  Limit --> LimitStatus : has
  Limit ..> LimitBreachEvent : raises
  DomainEvent <|-- LimitBreachEvent
  PreDealCheckHandler ..> Limit : reads
```
