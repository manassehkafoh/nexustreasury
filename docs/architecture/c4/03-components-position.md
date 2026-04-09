# C4 Level 3 — Position Service Components

Internal architecture of the **Position Service** (`packages/position-service`).
Implements **event sourcing** — position state is derived entirely from an append-only event store.

## Diagram

```mermaid
flowchart TB
  subgraph posSvc["Position Service  :4002"]
    routes["Position Routes
Fastify / OpenAPI 3
GET /positions, GET /positions/:id/history"]
    kafkaConsumer["PositionKafkaConsumer
Kafka Consumer Group
nexus.trading.trades.created"]
    posHandler["PositionEventHandler
Application Service
Apply event to aggregate, save, snapshot"]
    posAgg["Position Aggregate
DDD Aggregate Root — Event-Sourced
Derives state from event stream"]
    eventStore["EventStore
Repository
Append events, load stream, manage snapshots"]
    snapshotRepo["SnapshotRepository
Repository
Snapshot every 50 events"]
    pnlCalc["P&L Calculator
Domain Service
MTM revaluation, unrealised P&L"]
    kafkaPub["PositionEventPublisher
Kafka Producer
nexus.positions.updated"]
    queryRepo["PositionQueryRepository
Read Model
Efficient snapshot reads"]
    otelTrace["OTel Tracer
Observability
Consumer lag, processing time"]
  end

  subgraph external["External"]
    kafka[("Apache Kafka")]
    pg[("PostgreSQL")]
    riskSvc[("Risk Service")]
    almSvc[("ALM Service")]
  end

  kafka        -->|"nexus.trading.trades.created"| kafkaConsumer
  kafkaConsumer -->|"handle(TradeCreatedEvent)"| posHandler
  posHandler   -->|"loadLatestSnapshot()"| eventStore
  posHandler   -->|"apply(event)"| posAgg
  posHandler   -->|"append(PositionEvent)"| eventStore
  posHandler   -->|"saveSnapshot() every 50"| snapshotRepo
  posHandler   -->|"computePnL(position, rates)"| pnlCalc
  posHandler   -->|"publish(PositionUpdatedEvent)"| kafkaPub
  routes       -->|"findByBook(bookId)"| queryRepo
  eventStore   -->|"INSERT position_events"| pg
  snapshotRepo -->|"UPSERT position_snapshots"| pg
  queryRepo    -->|"SELECT current snapshot"| pg
  kafkaPub     -->|"nexus.positions.updated"| kafka
  kafka        -->|"nexus.positions.updated"| riskSvc
  kafka        -->|"nexus.positions.updated"| almSvc
```

## Event Sourcing Design

```mermaid
sequenceDiagram
  participant Kafka
  participant Consumer as PositionKafkaConsumer
  participant Handler as PositionEventHandler
  participant Aggregate as Position Aggregate
  participant EventStore
  participant Snapshot as SnapshotRepository
  participant Publisher as KafkaPublisher

  Kafka->>Consumer: TradeCreatedEvent {tradeRef, notional, currency}
  Consumer->>Handler: handle(event)
  Handler->>EventStore: loadLatestSnapshot(aggregateId)
  EventStore-->>Handler: PositionSnapshot {seq: 200, state: {...}}
  Handler->>EventStore: loadEventsSince(seq: 200)
  EventStore-->>Handler: [PositionEvent seq:201..210]
  Handler->>Aggregate: replay(events)
  Aggregate-->>Handler: Position {notional: 50M, unrealisedPnL: 125k}
  Handler->>Aggregate: apply(TradeCreatedEvent)
  Aggregate-->>Handler: Position {notional: 60M, unrealisedPnL: 150k}
  Handler->>EventStore: append(PositionEvent {seq: 211})
  alt seq % 50 == 0
    Handler->>Snapshot: save(seq:211, state)
  end
  Handler->>Publisher: publish(PositionUpdatedEvent)
  Publisher->>Kafka: nexus.positions.updated
```

## Event Types

| Event Type          | Trigger                          | Fields                                   |
| ------------------- | -------------------------------- | ---------------------------------------- |
| `PositionOpened`    | First trade in a book/instrument | bookId, instrumentId, notional, currency |
| `PositionIncreased` | Buy trade                        | delta, newNotional, unrealisedPnL        |
| `PositionDecreased` | Sell trade                       | delta, newNotional, realisedPnL          |
| `PositionClosed`    | Net zero position                | realisedPnL, closedAt                    |
| `PositionRevalued`  | MTM revaluation                  | marketValue, unrealisedPnL, rate         |
| `PositionAmended`   | Trade amendment                  | oldState, newState                       |
