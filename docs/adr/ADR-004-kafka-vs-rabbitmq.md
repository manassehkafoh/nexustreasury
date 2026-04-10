# ADR-004: Apache Kafka vs RabbitMQ vs NATS

**Status**: Accepted | **Date**: 2025-11-10 | **Deciders**: Principal Engineer

## Decision: Apache Kafka 3.7

| Criterion                | RabbitMQ                   | NATS JetStream | Kafka 3.7          | Winner     |
| ------------------------ | -------------------------- | -------------- | ------------------ | ---------- |
| Message retention        | Queue (consumed = deleted) | Configurable   | 7 days default     | Kafka      |
| Replay capability        | No                         | Yes            | Yes                | Kafka/NATS |
| Consumer group semantics | Competing consumers        | Push/pull      | Pull-based offsets | Kafka      |
| Throughput               | ~50K msg/s                 | ~1M msg/s      | ~500K msg/s        | NATS       |
| Audit trail replay       | Manual DLQ                 | Limited        | Full offset replay | Kafka      |
| KEDA autoscaling support | Yes                        | Yes            | Yes                | Tie        |

**Key driver**: Audit service requires **replay** of all events to re-verify HMAC signatures after a suspected breach. Kafka's offset-based consumer model enables full replay without message loss. RabbitMQ deletes messages on consumption, making audit replay impossible.

## Consequences

- 13 topics, replication factor 3, min.insync.replicas 2
- Consumer groups per service per tenant (e.g. `nexustreasury-bank-001-audit-service`)
- Dead letter queue: `nexus.dlq.*` topics for failed processing
- KEDA ScaledObject on `nexus.trading.trades.booked` lag for audit-service
- `nexus.security.*` topics: 90-day retention (standard: 7 days)
