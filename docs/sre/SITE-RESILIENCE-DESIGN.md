# NexusTreasury — Site Reliability Engineering: Site Resilience Design

**Document version:** 1.0.0  
**Applies to:** NexusTreasury v1.6.0+  
**Audience:** SRE engineers, platform architects, on-call responders  
**Last updated:** April 2026

---

## Table of contents

1. [Philosophy and principles](#1-philosophy-and-principles)
2. [Service level objectives](#2-service-level-objectives)
3. [Multi-region architecture](#3-multi-region-architecture)
4. [Redundancy and fault isolation](#4-redundancy-and-fault-isolation)
5. [Traffic management and load balancing](#5-traffic-management-and-load-balancing)
6. [Database resilience](#6-database-resilience)
7. [Kafka resilience](#7-kafka-resilience)
8. [Circuit breaking and bulkheads](#8-circuit-breaking-and-bulkheads)
9. [Health checking and readiness gates](#9-health-checking-and-readiness-gates)
10. [Observability and alerting](#10-observability-and-alerting)
11. [Incident response and escalation](#11-incident-response-and-escalation)
12. [Capacity planning and auto-scaling](#12-capacity-planning-and-auto-scaling)
13. [Disaster recovery and RTO/RPO](#13-disaster-recovery-and-rtorpo)
14. [Security resilience](#14-security-resilience)
15. [Change management and deployment safety](#15-change-management-and-deployment-safety)
16. [Regulatory-specific resilience (financial services)](#16-regulatory-specific-resilience-financial-services)
17. [Error budget policy](#17-error-budget-policy)

---

## 1. Philosophy and principles

NexusTreasury is a Tier-1 financial platform. Downtime directly causes missed trades, regulatory reporting failures, and potential financial loss. Our resilience design follows three layered principles.

### 1.1 Design for failure

Every component is assumed to fail. The question is not whether a pod, database node, or network link will fail — it is when. Every dependency has a documented fallback behaviour:

- Bloomberg B-PIPE unavailable → `AdaptiveMarketDataAdapter` fails over to Refinitiv RDP within 30 seconds
- PostgreSQL primary unavailable → automated WAL-streaming standby promotion in under 120 seconds
- An individual microservice crashes → Kubernetes restarts it within one liveness probe cycle; pending events replay from Kafka
- The entire primary region is unavailable → `DisasterRecoveryOrchestrator` triggers failover within the 15-minute RTO SLA

### 1.2 Blast radius minimisation

Failures must be contained. The platform uses five isolation layers:

1. **Pod isolation** — each service runs in its own pod; a crash does not affect sibling pods
2. **Namespace isolation** — each tenant runs in its own Kubernetes namespace; runaway tenants cannot exhaust shared cluster resources
3. **Circuit breakers** — external and inter-service calls trip to OPEN after three consecutive failures
4. **Database schema isolation** — each bounded context has its own PostgreSQL schema
5. **Kafka partition isolation** — dedicated consumer groups per service; a lagging consumer in one service does not delay another

### 1.3 Recovery is automatic by default

Human intervention is the exception. Automatic recovery mechanisms include:

- Kubernetes pod restarts (liveness probes)
- Kubernetes deployment rollbacks (readiness gate failures)
- Kafka consumer group rebalancing
- PostgreSQL failover (Patroni-managed)
- Circuit breaker HALF_OPEN probing and automatic recovery
- Horizontal Pod Autoscaler scale-out under load

---

## 2. Service level objectives

### 2.1 Platform-wide SLOs

| SLO                            | Target      | Window                | Alert threshold |
| ------------------------------ | ----------- | --------------------- | --------------- |
| Availability (trade booking)   | 99.9%       | Rolling 30 days       | < 99.5% → P1    |
| Availability (reporting APIs)  | 99.5%       | Rolling 30 days       | < 99.0% → P2    |
| Availability (AI assistant)    | 99.0%       | Rolling 30 days       | < 98.0% → P3    |
| Trade booking P99 latency      | < 100ms     | Rolling 24 hours      | > 200ms → P2    |
| Pre-deal check P99 latency     | < 5ms       | Rolling 24 hours      | > 10ms → P1     |
| Position update staleness      | < 500ms     | Per event             | > 2s → P2       |
| COREP/FINREP report generation | < 30s       | Per request           | > 120s → P3     |
| LCR intraday update            | < 5 minutes | Per calculation cycle | > 15 min → P1   |

### 2.2 Error budgets

Error budgets are calculated monthly as: `budget = (1 − SLO_target) × window_minutes`

For trade booking at 99.9% over 30 days:

- Budget = 0.001 × 43,200 = **43.2 minutes per month**
- At 50% consumed → release frequency review
- At 100% consumed → non-critical releases halted; mandatory post-mortem

Burn rates use the Google SRE multiwindow model (1-hour and 6-hour windows).

### 2.3 Per-service SLOs

```
trade-service:       availability=99.9%   p99_latency=100ms
risk-service:        availability=99.9%   p99_latency=5ms    (pre-deal check)
alm-service:         availability=99.5%   p99_latency=500ms
reporting-service:   availability=99.5%   p99_latency=30s
bo-service:          availability=99.5%   p99_latency=2s
accounting-service:  availability=99.5%   p99_latency=1s
notification-svc:    availability=99.9%   p99_latency=50ms   (SSE stream)
planning-service:    availability=99.0%   p99_latency=5s
collateral-service:  availability=99.5%   p99_latency=500ms
audit-service:       availability=99.99%  p99_latency=200ms  (immutable log)
```

---

## 3. Multi-region architecture

### 3.1 Topology overview

NexusTreasury operates active-active multi-region with one primary and one warm standby:

```
┌────────────────────────────────────────────────────────┐
│  Global Load Balancer (Route 53 / Azure Traffic Mgr)   │
│  Health-checked DNS failover, TTL=30s                  │
└──────────────────┬─────────────────────────────────────┘
                   │ Active traffic
       ┌───────────▼──────────┐      ┌────────────────────────┐
       │  Region: eu-west-1   │◄────►│  Region: us-east-1     │
       │  (Primary)           │ WAL  │  (Warm standby)        │
       │  AKS/GKE cluster     │      │  AKS/GKE cluster       │
       │  PostgreSQL primary  │      │  PostgreSQL standby     │
       │  Kafka cluster (3)   │      │  Kafka MirrorMaker2    │
       └──────────────────────┘      └────────────────────────┘
               │                              │
               └─────── Shared ──────────────┘
                        Keycloak HA cluster
                        HashiCorp Vault (Raft)
                        Prometheus → Thanos remote-write
```

### 3.2 Region failure detection

Three signals assessed simultaneously:

1. **Synthetic health checks** — HTTP probes to `/health/live` every 30 seconds from a neutral third-party monitor
2. **Latency degradation** — P99 latency exceeding `LATENCY_THRESHOLD_MS` (5,000ms)
3. **Error rate spike** — error rate > 5% in a 60-second rolling window

Three consecutive failures on any signal trigger automatic failover.

### 3.3 Data synchronisation

| Component      | Mechanism                                                                | RPO                             |
| -------------- | ------------------------------------------------------------------------ | ------------------------------- |
| PostgreSQL     | WAL streaming replication; Patroni `maximum_lag_on_failover = 1MB`       | ≤ 5 minutes                     |
| Kafka          | MirrorMaker 2; replication factor = 3; offset synchronisation            | ≤ 1 minute                      |
| Redis          | Redis Cluster cross-region replication; sessions invalidated on failover | < 5 minutes (session loss only) |
| Object storage | Cross-region S3/GCS replication for audit archive and reports            | ≤ 1 minute                      |

---

## 4. Redundancy and fault isolation

### 4.1 Pod redundancy and zone anti-affinity

All production deployments use a minimum of 3 replicas with zone anti-affinity:

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: trade-service
        topologyKey: topology.kubernetes.io/zone
```

A single AZ failure cannot take down all replicas of a service.

### 4.2 Namespace-per-tenant isolation

Each tenant operates in its own Kubernetes namespace with:

- `ResourceQuota` — prevents noisy-neighbour resource exhaustion
- `NetworkPolicy` — prevents cross-tenant pod traffic
- Dedicated Keycloak realm — identity isolation
- Dedicated PostgreSQL schema — schema-level role grants; no cross-schema access

### 4.3 Graceful degradation tiers

| Tier               | Condition                    | Behaviour                                                                                             |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Tier 1 (full)      | All services healthy         | All features available                                                                                |
| Tier 2 (core only) | Supporting services degraded | Trade capture, pre-deal checks, position keeping, limits fully operational; reporting/AI/SSE degraded |
| Tier 3 (read-only) | Database primary unavailable | Trade booking suspended (`503 Retry-After: 120`); reads from replica                                  |

---

## 5. Traffic management and load balancing

### 5.1 Cilium Service Mesh

All inter-service communication is governed by Cilium (CNI + service mesh). NexusTreasury does **not** use Istio — it was evaluated and rejected in ADR-005 due to high memory overhead (400MB/node) and sidecar injection latency incompatible with the 5ms pre-deal check SLO. See `docs/platform/NETWORKING-SERVICE-MESH.md` for the full design.

Cilium provides:

- **mTLS everywhere** — all pod-to-pod traffic encrypted; workload identity certs rotated every 24 hours
- **Traffic weighting** — canary deployments route 5% traffic to new version while monitoring error rates
- **Automatic retries** — on `503`/`504` for idempotent methods; exponential backoff (base 25ms, max 3 retries)
- **Outlier detection** — pods returning > 50% errors ejected from the pool for 30 seconds

### 5.2 Retry and timeout policy

```yaml
# Cilium Envoy traffic policy — trade-service (equivalent to Istio VirtualService)
retries:
  attempts: 3
  perTryTimeout: 2s
  retryOn: gateway-error,connect-failure,reset,retriable-4xx
timeout: 8s
```

POST (trade booking) does not auto-retry to prevent duplicate submissions. The client receives `503` and retries with an idempotency key.

### 5.3 Rate limiting (per tenant)

```
trade-service:      200 req/s  (burst: 400 req/s for 10s)
risk-service:       500 req/s  (pre-deal checks are high-frequency)
reporting-service:  20 req/s   (heavy computation)
ai-assistant:       10 req/s   (Anthropic API cost management)
```

---

## 6. Database resilience

### 6.1 PostgreSQL HA (Patroni)

```yaml
# patroni.yaml — key settings
bootstrap:
  dcs:
    ttl: 30
    maximum_lag_on_failover: 1048576 # 1MB — blocks failover if standby too far behind
postgresql:
  parameters:
    synchronous_commit: 'on'
    synchronous_standby_names: 'ANY 1 (standby1, standby2)'
    max_wal_senders: 10
    wal_keep_size: 1GB
```

`synchronous_standby_names: 'ANY 1'` — every `COMMIT` waits for at least one standby to acknowledge the WAL record. Zero transaction loss on primary failure.

### 6.2 Connection pooling (PgBouncer)

```
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
reserve_pool_size = 5
server_lifetime = 600
client_idle_timeout = 120
```

Up to 980 client connections (14 services × 70 pods) served through a pool of 25 server connections.

### 6.3 Read replica offloading

Read-heavy workloads (COREP, FINREP, RAROC, AI assistant context) are routed to read replicas:

```typescript
const pool = queryType === 'READ' ? readReplicaPool : primaryPool;
```

Long-running COREP computations (10–30s) cannot block trade booking connections on the primary.

### 6.4 TimescaleDB hypertable partitioning

```sql
SELECT create_hypertable('position_snapshots', 'snapshot_at',
  chunk_time_interval => INTERVAL '7 days');

SELECT add_compression_policy('position_snapshots', INTERVAL '30 days');
SELECT add_retention_policy('position_snapshots', INTERVAL '2 years');
```

Prevents unbounded table growth from causing query plan regression.

---

## 7. Kafka resilience

### 7.1 Cluster configuration

```
replication.factor = 3
min.insync.replicas = 2
unclean.leader.election.enable = false
```

A message is only committed when 2 of 3 replicas have written it. `unclean.leader.election.enable = false` prevents a lagging broker from being elected leader (which would cause data loss).

### 7.2 Topic configuration

| Topic                          | Partitions | Retention |
| ------------------------------ | ---------- | --------- |
| `nexus.trades.booked`          | 12         | 7 days    |
| `nexus.positions.updated`      | 12         | 3 days    |
| `nexus.risk.limit-breached`    | 6          | 30 days   |
| `nexus.market.rates-updated`   | 24         | 1 day     |
| `nexus.audit.events`           | 6          | 90 days   |
| `nexus.regulatory.submissions` | 3          | 365 days  |

### 7.3 Consumer resilience and dead letter topics

```typescript
const consumer = kafka.consumer({
  groupId: 'trade-service-consumer-v2',
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
  retry: { initialRetryTime: 100, retries: 8 },
});
```

Messages failing after all retries are moved to `nexus.{topic}.dlt` with diagnostic headers attached:

```
Header: DLT-Original-Topic: nexus.trades.booked
Header: DLT-Original-Offset: 189234
Header: DLT-Exception-Message: LimitDomainError: Counterparty limit breach
Header: DLT-Retry-Count: 8
```

---

## 8. Circuit breaking and bulkheads

### 8.1 Bloomberg B-PIPE circuit breaker

State machine:

```
CLOSED → OPEN    after 3 consecutive failures within 10s
OPEN   → HALF_OPEN after 30s cooldown
HALF_OPEN → CLOSED if probe succeeds
HALF_OPEN → OPEN   if probe fails
```

When OPEN: last known good rates are returned immediately. `AdaptiveMarketDataAdapter` simultaneously promotes Refinitiv RDP. Transition events are published to `nexus.market.datasource-failover`.

### 8.2 Anthropic API (AI assistant) circuit breaker

```typescript
const ctrl = new AbortController();
const tid = setTimeout(() => ctrl.abort(), this._config.timeoutMs);
```

On `AbortError`: falls back to `_fallbackResponse()` with rule-based category-appropriate responses. The AI assistant is Tier 2; its degradation never affects core trading.

### 8.3 TorchServe (FinBERT) fallback

```typescript
try {
  return await this._inferenceClient.classify(entry);
} catch (err) {
  this._circuitBreaker.recordFailure();
  return this._ruleBasedFallback(entry); // heuristic: amount delta + reference mismatch
}
```

Auto-reconciliation drops from ~95% to ~60% in fallback mode. Remaining entries queue for manual review rather than failing outright.

### 8.4 Resource bulkheads

Pre-deal checks run in an isolated Kotlin coroutine pool (simulated via dedicated worker threads in Node.js). A thundering herd of risk computations cannot starve health check responses:

```yaml
resources:
  requests: { cpu: '500m', memory: '512Mi' }
  limits: { cpu: '2000m', memory: '1024Mi' }
```

---

## 9. Health checking and readiness gates

### 9.1 Health endpoint contract

Every service exposes:

```
GET /health/live    → 200 if process alive (liveness probe)
GET /health/ready   → 200 if ready to serve traffic (readiness probe)
GET /health/startup → 200 if startup complete (startup probe)
```

The readiness probe checks the full dependency graph:

```typescript
const [db, kafka, cache] = await Promise.allSettled([
  postgresPool.query('SELECT 1'),
  kafkaAdmin.describeCluster(),
  redisClient.ping(),
]);
const ready = [db, kafka, cache].every((r) => r.status === 'fulfilled');
```

A failing readiness probe immediately removes the pod from the load-balancer pool.

### 9.2 Startup probe (prevents premature liveness kills)

```yaml
startupProbe:
  httpGet: { path: /health/startup, port: 4001 }
  failureThreshold: 30 # 30 × 3s = 90s max startup budget
  periodSeconds: 3
livenessProbe:
  httpGet: { path: /health/live, port: 4001 }
  failureThreshold: 3
  periodSeconds: 10
```

Cold start (JVM warm-up, Kafka join, connection pool) can take up to 45 seconds. Startup probe prevents liveness from killing a pod that is still legitimately initialising.

### 9.3 Mathematical invariant gate (CI pre-deployment)

`platform-health.test.ts` validates invariants before every deployment:

- CIP: `|F − S·exp((r_d − r_f)·T)| < 0.0001`
- Put-call parity: `|C − P − S·e^(−qT) + K·e^(−rT)| < 0.01`
- At-par IRS NPV: `|NPV| < 1000`

Deploying with a broken pricing invariant is blocked at CI level before reaching any environment.

---

## 10. Observability and alerting

### 10.1 Metrics (Prometheus + Grafana)

Key custom metrics exported via `prom-client`:

```
nexus_trade_booking_total{status,tenant_id}
nexus_trade_booking_duration_seconds{quantile,tenant_id}
nexus_limit_breach_total{limit_type,counterparty_id,tenant_id}
nexus_kafka_consumer_lag{topic,partition,consumer_group}
nexus_circuit_breaker_state{service,dependency,state}
nexus_pd_model_drift{model_version,metric,alert_level}
nexus_lcr_ratio{tenant_id,entity_id}           # alert if < 110%
nexus_cet1_ratio{tenant_id}                     # alert if < 12%
nexus_regulatory_submission_status{regulator,period,status}
```

### 10.2 Traces (OpenTelemetry + Jaeger)

```typescript
const span = tracer.startSpan('trade-booking', {
  attributes: {
    'trade.tenant_id': tenantId,
    'trade.instrument_type': instrumentType,
    'trade.notional_usd': notional,
  },
});
```

Sampling rates: critical path (trade booking) = 100%; background jobs = 1%.

### 10.3 Logs (structured JSON → Elasticsearch → Kibana)

Every log entry is structured JSON with mandatory fields:

```json
{
  "timestamp": "2026-04-14T09:15:22.341Z",
  "level": "INFO",
  "service": "trade-service",
  "version": "1.6.0",
  "tenant_id": "bank-001",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "message": "Trade booked successfully",
  "trade_id": "TRD-20260414-001234"
}
```

Retention: 90 days hot (Elasticsearch), 7 years cold (S3 Glacier) — MiFID II and SOC 2 compliance.

### 10.4 Alerting hierarchy and routing

| Severity    | Response SLA      | Example                                                 |
| ----------- | ----------------- | ------------------------------------------------------- |
| P1 Critical | 5 minutes         | trade-service down; pre-deal P99 > 10ms; LCR breach     |
| P2 High     | 15 minutes        | Bloomberg circuit breaker OPEN; position staleness > 2s |
| P3 Medium   | 1 hour            | Error budget burn rate > 5× for 1 hour                  |
| P4 Low      | Next business day | Disk at 70%; deprecated API usage                       |

### 10.5 Multi-window burn rate alerting

```yaml
- alert: TradingApiSLOBurnRateHigh
  expr: |
    (rate(nexus_trade_booking_total{status="failure"}[1h])
     / rate(nexus_trade_booking_total[1h])) > 14 * (1 - 0.999)
    AND
    (rate(nexus_trade_booking_total{status="failure"}[5m])
     / rate(nexus_trade_booking_total[5m])) > 14 * (1 - 0.999)
  for: 2m
  labels:
    severity: critical
```

---

## 11. Incident response and escalation

### 11.1 Incident commander responsibilities (P1)

1. Declare in `#incidents-critical` Slack within 5 minutes of page
2. Open Zoom war room
3. Delegate investigation to service owners
4. Stakeholder update every 15 minutes
5. Drive to resolution or executive escalation if unresolved after 30 minutes

### 11.2 On-call rotation

| Tier   | Role                  | Responsibility                              |
| ------ | --------------------- | ------------------------------------------- |
| Tier 1 | SRE engineer          | First responder; applies runbook procedures |
| Tier 2 | Service domain expert | Deep service-specific investigation         |
| Tier 3 | Engineering Director  | Customer-impacting P1s > 30 minutes         |

### 11.3 Runbook index

| Incident                     | Runbook                                     |
| ---------------------------- | ------------------------------------------- |
| Trade booking failure        | `docs/runbooks/01-Trade-Booking-Failure.md` |
| Position not updating        | `docs/runbooks/02-Position-Not-Updating.md` |
| Rollback procedure           | `docs/runbooks/03-Rollback-Procedure.md`    |
| LCR breach                   | `docs/runbooks/04-LCR-Breach-Response.md`   |
| Full DR failover             | `docs/runbooks/production-runbook.md` §5    |
| Chaos experiment post-mortem | `docs/sre/CHAOS-MONKEY.md` §7               |

### 11.4 Blameless post-mortem policy

Every P1 and every P2 consuming > 20% of monthly error budget triggers a blameless post-mortem within 5 business days. Template captures: timeline, root cause, contributing factors, impact measurement, and specific time-boxed action items.

---

## 12. Capacity planning and auto-scaling

### 12.1 Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 60 }
    - type: Pods
      pods:
        metric:
          name: nexus_active_trade_bookings_per_second
        target: { type: AverageValue, averageValue: '50' }
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0 # immediate scale-up
      policies: [{ type: Pods, value: 4, periodSeconds: 60 }]
    scaleDown:
      stabilizationWindowSeconds: 300 # 5-minute drain window before scale-down
```

### 12.2 Node pool composition

| Pool             | Instance type  | Usage                                              |
| ---------------- | -------------- | -------------------------------------------------- |
| General          | 8-core / 32GB  | Stateless services                                 |
| Memory-optimised | 16-core / 64GB | Accounting, position, PostgreSQL-adjacent          |
| Spot/preemptible | Varied         | Batch reporting, background jobs only (not Tier-1) |

### 12.3 Quarterly capacity review

- Peak utilisation vs. headroom across all node pools
- 90-day growth trend extrapolated 12 months forward
- Error budget burn rate trends per service
- Infrastructure cost per tenant (`FinOpsCostTracker` CSV output)

---

## 13. Disaster recovery and RTO/RPO

### 13.1 SLA targets

| Metric                         | Target                            |
| ------------------------------ | --------------------------------- |
| RTO (Recovery Time Objective)  | ≤ 15 minutes                      |
| RPO (Recovery Point Objective) | ≤ 5 minutes                       |
| MTTR (Mean Time to Recover)    | ≤ 20 minutes (historical average) |

### 13.2 Automated failover sequence

```
T+00:00 — 00:30  Health probe confirmation (3× consecutive failures confirmed)
T+00:30 — 01:30  DNS failover (Route 53 / Traffic Manager, TTL=30s)
T+01:30 — 03:30  PostgreSQL standby promotion (Patroni forced failover)
T+03:30 — 04:15  Kafka consumer rebalance (rollout restart, wait for LAG=0)
T+04:15 — 04:45  Service health validation (all 14 /health/ready probes green)
T+04:45 — 05:00  PagerDuty resolution + stakeholder notification
```

### 13.3 Quarterly DR test automation

`DisasterRecoveryOrchestrator.runDRTest()` runs in probe mode every quarter:

- Simulates failure without affecting live traffic
- Measures actual RTO and RPO
- Auto-creates P2 incident if RTO > 15 minutes
- Produces SOC 2 CC7.4 evidence record (S3 Object Lock, 7-year retention)

---

## 14. Security resilience

### 14.1 Zero-trust network

Every service-to-service call is authenticated using SPIFFE SVIDs issued by SPIRE and enforced by Cilium Mutual Auth, rotated every 24 hours. No implicit trust from network location. Even intra-namespace calls require valid SPIFFE identity. See `docs/platform/NETWORKING-SERVICE-MESH.md` §6 for the full mTLS and certificate rotation design.

### 14.2 Secret rotation (zero-downtime)

| Secret          | Rotation    | Method                                                                  |
| --------------- | ----------- | ----------------------------------------------------------------------- |
| JWT signing key | 90 days     | Dual-validation window (30 min); existing sessions remain valid         |
| AUDIT_HMAC_KEY  | Quarterly   | All existing anchor records are re-signed before old key decommissioned |
| DB credentials  | Per session | Vault dynamic credentials; 1-hour lease; unique username per pod        |

### 14.3 HashiCorp Vault HA

3-node Vault cluster (Raft consensus). Secrets injected via Vault Agent Sidecar as in-memory files. Never stored in environment variables, Kubernetes ConfigMaps, or container images.

### 14.4 Supply chain security

Security patch pipeline runs every 6 hours:

- `pnpm audit --prod` — dependency CVE scan
- Trivy — Docker image OS and application CVE scan
- Renovate Bot — auto-merges dependency patches when all tests pass
- High/critical CVEs block deployment; security team is notified within 15 minutes

---

## 15. Change management and deployment safety

### 15.1 GitOps (ArgoCD)

All production changes flow through Git. Direct `kubectl apply` is forbidden in production. ArgoCD provides automatic drift detection and rollback: `git revert HEAD && git push` is sufficient for a full production rollback.

### 15.2 Canary rollout policy

```
Stage 1:   5% traffic → new version  (10 min gate: error rate ≤ baseline + 0.1%)
Stage 2:  25% traffic → new version  (10 min gate: P99 ≤ baseline × 1.1)
Stage 3: 100% traffic → new version  (auto-promote on pass; auto-rollback on fail)
```

### 15.3 Feature flags

High-risk features (new risk models, regulatory calculation changes) are deployed behind feature flags in Kubernetes ConfigMaps, enabling per-tenant rollout and instant disable without a deployment.

---

## 16. Regulatory-specific resilience (financial services)

### 16.1 Regulatory reporting continuity

The `RegulatorySubmissionEngine` provides:

- **Submission queuing** — regulator API unavailability queues submissions with exponential backoff
- **Acknowledgement tracking** — SUBMITTED → ACKNOWLEDGED / REJECTED lifecycle; unacknowledged after 24 hours triggers P3
- **Dual submission** — critical regulators (EBA COREP) use both API and XBRL file upload portal

### 16.2 Audit log immutability

HMAC-anchored immutable chain:

```
anchor_N.hmac = HMAC(AUDIT_HMAC_KEY, anchor_N.payload + anchor_{N-1}.hmac)
```

Audit service has a dedicated 99.99% availability SLO. Records are archived to S3 Object Lock (WORM) immediately on creation. Any tampering is mathematically detectable.

### 16.3 Trading halt propagation

When a market-wide circuit breaker is detected via Bloomberg, the halt propagates to all pending pre-deal checks within 250ms via Kafka `nexus.market.trading-halt`. All consumers at `auto.offset.reset = latest` process halt events before any other message.

---

## 17. Error budget policy

### 17.1 Burn rate thresholds

| Burn rate | Window                      | Action                            |
| --------- | --------------------------- | --------------------------------- |
| > 14×     | 1-hour (confirmed on 5-min) | Page on-call immediately (P1)     |
| > 6×      | 6-hour window               | Alert on-call (P2)                |
| > 3×      | 3-day window                | SRE team notification (P3 ticket) |
| > 1×      | 30-day window               | Monthly review                    |

### 17.2 Budget exhaustion policy

**At 100% consumed:**

- All non-critical releases frozen immediately
- Mandatory post-mortem within 5 business days
- Next sprint: 50% capacity allocated to reliability

**At 50% consumed with > 10 days remaining:**

- Release frequency reduced (max 2 per week)
- SRE review required before releases touching the affected service

### 17.3 Reliability OKRs (quarterly)

Example targets:

- Reduce pre-deal check P99 latency by 20%
- Complete ≥ 2 quarterly DR tests with RTO ≤ 15 minutes
- Reduce MTTR to ≤ 15 minutes across all P1 incidents
- Increase automated recovery rate (alert → resolution without human) from 60% to 80%

---

_Maintained by the NexusTreasury SRE team. Raise a PR against `docs/sre/SITE-RESILIENCE-DESIGN.md` for changes.  
For operational emergencies, contact `#sre-platform` on Slack._
