# NexusTreasury — Chaos Engineering: Chaos Monkey Design & Integration

**Document version:** 1.0.0  
**Applies to:** NexusTreasury v1.6.0+  
**Audience:** SRE engineers, platform architects, engineering leads  
**Last updated:** April 2026

---

## Table of contents

1. [What is Chaos Monkey and why NexusTreasury needs it](#1-what-is-chaos-monkey-and-why-nexustreasury-needs-it)
2. [Chaos engineering principles applied to financial platforms](#2-chaos-engineering-principles-applied-to-financial-platforms)
3. [Chaos Monkey on Kubernetes — tooling selection](#3-chaos-monkey-on-kubernetes--tooling-selection)
4. [Steady-state hypothesis definition](#4-steady-state-hypothesis-definition)
5. [Experiment catalogue](#5-experiment-catalogue)
6. [Experiment execution framework](#6-experiment-execution-framework)
7. [GameDay programme](#7-gameday-programme)
8. [Observability during chaos experiments](#8-observability-during-chaos-experiments)
9. [Blast radius controls and safety mechanisms](#9-blast-radius-controls-and-safety-mechanisms)
10. [Rollout schedule: dev → staging → production](#10-rollout-schedule-dev--staging--production)
11. [Regulatory and compliance considerations](#11-regulatory-and-compliance-considerations)
12. [Integrating chaos results into the SRE improvement cycle](#12-integrating-chaos-results-into-the-sre-improvement-cycle)
13. [Chaos experiment code examples](#13-chaos-experiment-code-examples)

---

## 1. What is Chaos Monkey and why NexusTreasury needs it

Chaos Monkey is the original chaos engineering tool created by Netflix in 2011. It randomly terminates instances in production to ensure that the system can survive unexpected failures without human intervention. The philosophy has since evolved into a discipline called Chaos Engineering — the practice of deliberately injecting failures into a system to build confidence that it will behave correctly when real failures occur.

### 1.1 The core problem it solves

NexusTreasury has 14 microservices, a 3-broker Kafka cluster, a Patroni-managed PostgreSQL HA pair, an Istio service mesh, and integrations with Bloomberg B-PIPE, TorchServe, and the Anthropic API. Our resilience design (see `docs/sre/SITE-RESILIENCE-DESIGN.md`) documents how each of these components should behave under failure. But documentation and design are not proof.

Without chaos experiments we cannot answer questions like:

- Does the `AdaptiveMarketDataAdapter` actually fail over from Bloomberg to Refinitiv within 30 seconds when B-PIPE goes down?
- Does the `LimitAggregate` correctly deny a trade when the pre-deal check service is temporarily unreachable, or does it silently approve?
- When three pods of `trade-service` are simultaneously killed during a morning market open, does the fourth serve traffic without dropping requests, and does HPA scale back to the desired replica count within the defined window?
- Can dealers continue booking trades when the `reporting-service` is down for a rolling restart?
- Does the AUDIT_HMAC chain remain intact and verifiable when the `audit-service` pod is replaced mid-stream?

Chaos experiments answer these questions empirically, before production incidents do.

### 1.2 Business justification for a financial platform

In financial services, the consequences of an undiscovered failure mode can include:

- **Missed trades** — a dealer cannot execute a time-sensitive FX trade during a brief service outage
- **Limit breach** — a pre-deal check failure silently approving a trade that exceeds a counterparty credit limit (regulatory and credit risk exposure)
- **Regulatory reporting gap** — COREP/FINREP submission fails silently during a period when the submission engine is restarting
- **Audit trail corruption** — an incomplete HMAC anchor chain that cannot be verified during a regulator audit

Each of these has both financial and regulatory consequences. Chaos engineering is not an optional engineering practice — it is a component of the risk management framework for Tier-1 financial infrastructure.

---

## 2. Chaos engineering principles applied to financial platforms

The original Netflix Chaos Engineering principles are adapted here for regulated financial platforms.

### 2.1 Build a hypothesis around steady-state behaviour

Before injecting any failure, we define the steady state in precise, measurable terms:

- Trade booking API: `success_rate ≥ 99.9%`, `p99_latency ≤ 100ms`
- Position updates: `staleness ≤ 500ms`
- Pre-deal check: `p99_latency ≤ 5ms`
- Regulatory reports: successfully queued within 30 seconds

The experiment only has meaning if we can measure whether the system returned to this steady state after the failure was resolved.

### 2.2 Vary real-world events

Chaos experiments should reflect realistic failure modes that have actually occurred or could plausibly occur. The priority order for NexusTreasury experiments is derived from historical incident frequency and blast radius:

1. **Pod crashes** (most frequent — OS-level OOM, memory leaks, JVM crashes)
2. **Network partitions** (cloud provider AZ failures, cross-region link degradation)
3. **Database connection exhaustion** (PgBouncer pool full under load)
4. **External dependency timeouts** (Bloomberg, TorchServe, Anthropic API)
5. **Kafka consumer lag spikes** (slow consumer catching up from a backlog)
6. **CPU throttling** (cgroup limits; occurs during tenant load spikes)
7. **Disk I/O saturation** (especially under TimescaleDB chunk creation)

### 2.3 Run experiments in production (with controls)

Staging does not replicate production behaviour. Production has real traffic patterns, tenant data volumes, and resource contention that staging cannot simulate. NexusTreasury runs chaos experiments in production but with three mandatory controls:

1. **Time windows** — only during defined low-risk windows (Monday–Thursday, 10:00–15:00 UTC for FX markets; never during regulatory reporting deadlines)
2. **Blast radius caps** — never more than 33% of replicas affected simultaneously; never targeting the primary database
3. **Emergency stop** — all experiments have a one-command abort that stops the failure injection and returns the system to normal state within 60 seconds

### 2.4 Automate experiments to run continuously

The goal is a continuous validation loop, not an annual exercise. Each experiment is encoded as a YAML definition and scheduled in the chaos engineering platform. Results are fed back into SLO dashboards and compared against the steady-state hypothesis automatically.

### 2.5 Minimise blast radius during early phases

New experiments always run in development first, then staging, before production. The first production run of any new experiment uses the minimum possible disruption (e.g., killing one pod rather than all pods, a 1-second network delay rather than a full partition).

---

## 3. Chaos Monkey on Kubernetes — tooling selection

### 3.1 Primary tool: Chaos Mesh

NexusTreasury uses **Chaos Mesh** (CNCF project) as the primary chaos engineering platform for its Kubernetes-native design and financial-services-friendly features:

```bash
# Installation via Helm
helm repo add chaos-mesh https://charts.chaos-mesh.org
helm install chaos-mesh chaos-mesh/chaos-mesh \
  --namespace chaos-mesh \
  --create-namespace \
  --set controllerManager.replicaCount=3 \
  --set dashboard.securityMode=true
```

Chaos Mesh provides:

- **PodChaos** — pod kill, pod failure, container kill
- **NetworkChaos** — partition, delay, bandwidth limit, corrupt, duplicate packets
- **StressChaos** — CPU and memory pressure
- **IOChaos** — I/O delay, I/O error, I/O attribute override
- **TimeChaos** — clock skew injection
- **KernelChaos** — kernel-level fault injection (requires privileged mode)
- **HTTPChaos** — inject delays and errors into HTTP traffic
- **Workflow** — multi-step experiments with conditions and scheduling

### 3.2 Secondary tool: Litmus Chaos

**Litmus Chaos** provides additional experiment types including:

- Node drain and taint experiments (for testing HPA and cluster autoscaler)
- Kafka broker kill experiments
- Database pod delete experiments

### 3.3 Chaos engineering as code

All experiments are defined in YAML and stored in `infra/chaos/experiments/`. They are version-controlled and reviewed as part of the standard PR process before being applied to any environment.

### 3.4 Kube Monkey (legacy reference)

The original Netflix Chaos Monkey has a Kubernetes equivalent called `kube-monkey`. It is simpler than Chaos Mesh but less feature-rich. NexusTreasury uses Chaos Mesh as the primary tool; kube-monkey concepts are referenced here for context only.

---

## 4. Steady-state hypothesis definition

Every chaos experiment must define a steady-state hypothesis before execution. This is the observable, measurable definition of "the system is healthy".

### 4.1 Steady-state template

```yaml
# infra/chaos/experiments/template.yaml
steadyState:
  probes:
    - type: http
      name: 'Trade booking API healthy'
      endpoint: 'https://api.nexustreasury.bank.com/health/ready'
      expectedStatusCode: 200
      timeout: 5s

    - type: prometheus
      name: 'Trade booking success rate >= 99.9%'
      query: |
        (1 - rate(nexus_trade_booking_total{status="failure"}[5m])
             / rate(nexus_trade_booking_total[5m]))
      expectedValue:
        operator: gte
        value: 0.999

    - type: prometheus
      name: 'Pre-deal check P99 latency <= 5ms'
      query: |
        histogram_quantile(0.99,
          rate(nexus_predeal_check_duration_seconds_bucket[5m])) * 1000
      expectedValue:
        operator: lte
        value: 5.0

    - type: prometheus
      name: 'No active limit breaches'
      query: 'increase(nexus_limit_breach_total[5m])'
      expectedValue:
        operator: lte
        value: 0
```

The steady-state must be verified before the experiment starts (to establish a baseline), continuously during the experiment (to measure impact), and after the failure is removed (to confirm recovery).

---

## 5. Experiment catalogue

### 5.1 Category 1 — Pod lifecycle chaos

#### EXP-001: Single service pod kill (trade-service)

**Hypothesis:** Killing one of three `trade-service` pods causes no increase in error rate; latency returns to baseline within 30 seconds.

**Injection:**

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: trade-service-pod-kill
  namespace: nexustreasury-bank-001
spec:
  action: pod-kill
  mode: one # kill exactly one pod
  selector:
    namespaces: [nexustreasury-bank-001]
    labelSelectors:
      app: trade-service
  scheduler:
    cron: '@daily' # once per day in staging; weekly in production
  duration: '1m'
```

**Expected outcome:** Kubernetes scheduler detects pod failure, the HPA maintains the replica count, and the two remaining pods absorb traffic within one readiness probe cycle (~10 seconds). No trade booking errors reach end users.

**Failure hypothesis violated if:** Error rate exceeds 0.1% during the 30-second recovery window, or the new pod does not reach Ready state within 90 seconds.

---

#### EXP-002: Simultaneous multi-pod kill (trade-service 33%)

**Hypothesis:** Killing 33% of `trade-service` pods (1 of 3 minimum replicas) causes temporary latency increase but zero errors.

**This experiment tests:** zone anti-affinity is correctly applied (the three pods are in different AZs; killing one does not take out a whole AZ).

---

#### EXP-003: risk-service pod kill during active trading

**Hypothesis:** When the `risk-service` pod is killed during active trading, the `trade-service` pre-deal check handler correctly applies its fail-safe behaviour (reject the trade with `503 Dependency Unavailable`), and no trade passes without a completed risk check.

**Critical safety assertion:** The limit enforcement contract guarantees that a missing pre-deal check result is treated as a rejection, never as an approval. This experiment validates that guarantee under real failure conditions.

---

#### EXP-004: audit-service pod restart mid-chain

**Hypothesis:** When the `audit-service` pod is restarted while a burst of audit events is in flight, the HMAC anchor chain remains continuous and verifiable. No gaps appear in the audit log.

**Validation:** After the experiment, run the HMAC chain integrity verifier:

```bash
kubectl exec -n nexustreasury-bank-001 audit-service-0 -- \
  node dist/scripts/verify-hmac-chain.js \
  --from=$(date -d '1 hour ago' -u +%Y-%m-%dT%H:%M:%SZ) \
  --to=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

Expected output: `Chain integrity: VERIFIED. 0 gaps. 0 invalid anchors.`

---

### 5.2 Category 2 — Network chaos

#### EXP-005: Bloomberg B-PIPE network partition

**Hypothesis:** When the network between `market-data-service` and Bloomberg B-PIPE is partitioned, the `AdaptiveMarketDataAdapter` circuit breaker trips to OPEN within 30 seconds and promotes the Refinitiv RDP fallback. Market rate tiles on the trading dashboard continue updating without interruption.

**Injection:**

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: bloomberg-bpipe-partition
  namespace: nexustreasury-bank-001
spec:
  action: partition
  mode: all
  selector:
    namespaces: [nexustreasury-bank-001]
    labelSelectors:
      app: market-data-service
  direction: both
  target:
    mode: external
    externalTargets:
      - bloomberg.bpipe.internal:8194
  duration: '5m'
```

**Steady-state probe:** `nexus_circuit_breaker_state{service="bloomberg-bpipe",state="open"} == 1` within 30 seconds of partition start.

---

#### EXP-006: Inter-service latency injection (risk → trade)

**Hypothesis:** Injecting 50ms of latency on calls from `trade-service` to `risk-service` does not cause trade booking timeouts because the Istio per-try timeout (2s) and overall request timeout (8s) provide sufficient headroom.

**Injection:**

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: risk-service-latency
spec:
  action: delay
  mode: all
  selector:
    namespaces: [nexustreasury-bank-001]
    labelSelectors:
      app: risk-service
  delay:
    latency: '50ms'
    correlation: '25' # 25% correlation between consecutive packets
    jitter: '10ms'
  duration: '10m'
```

**Extension:** Gradually increase from 50ms → 100ms → 500ms → 2000ms to find the exact threshold where trade booking begins failing. This establishes the real operational headroom of the timeout chain.

---

#### EXP-007: Complete AZ network partition simulation

**Hypothesis:** Partitioning all pods in `availability-zone-a` from the rest of the cluster triggers pod redistribution by Kubernetes and does not cause a sustained trading outage exceeding 60 seconds.

**This is a high-blast-radius experiment.** It is approved only for staging. Production AZ partition tolerance is validated through the quarterly DR test instead.

---

#### EXP-008: Kafka broker network partition (one of three brokers)

**Hypothesis:** Partitioning one Kafka broker from the other two does not cause any consumer group lag to exceed 1,000 messages, because the Kafka controller will detect the partition and elect a new leader for the affected partitions within the `session.timeout.ms = 10s` window.

**Validation metric:** `nexus_kafka_consumer_lag{consumer_group="trade-service-consumer-v2"}` remains below 1,000.

---

### 5.3 Category 3 — Resource stress chaos

#### EXP-009: CPU stress on accounting-service

**Hypothesis:** Injecting 80% CPU stress on `accounting-service` (simulating a rogue IFRS9 ECL batch) causes the HPA to trigger a scale-out within 60 seconds, and the `alm-service` and `reporting-service` (which do not share CPU with accounting) continue serving at normal latency.

**Injection:**

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: StressChaos
metadata:
  name: accounting-cpu-stress
spec:
  mode: one
  selector:
    namespaces: [nexustreasury-bank-001]
    labelSelectors:
      app: accounting-service
  stressors:
    cpu:
      workers: 4 # 4 goroutines fully consuming CPU
      load: 80 # 80% load target
  duration: '5m'
```

---

#### EXP-010: Memory pressure on reporting-service (COREP generation)

**Hypothesis:** When `reporting-service` is under memory pressure (simulating a large COREP computation with 100+ exposure classes), the OOM killer does not terminate the pod during an active submission because the pod's memory request/limit is correctly sized.

**This validates:** The 1GB memory limit set in the Kubernetes resource spec is sufficient for the largest expected COREP calculation. If the pod is OOM-killed, this is a signal to increase the memory limit.

---

#### EXP-011: PgBouncer connection pool exhaustion

**Hypothesis:** When 100% of PgBouncer connection pool slots are consumed (simulating a slow query storm), new connection attempts queue gracefully and return within the `server_connect_timeout = 15s` window rather than failing immediately with a connection error.

**Injection:** A synthetic load generator runs 200 concurrent slow queries (each holding a connection for 30 seconds) against the staging database, exhausting the 25-slot connection pool.

---

### 5.4 Category 4 — External dependency chaos

#### EXP-012: Anthropic API timeout (AI assistant)

**Hypothesis:** When the Anthropic API is unresponsive (simulated by injecting a 35-second delay exceeding the 30-second `timeoutMs`), the `TreasuryAIAssistant` returns a graceful fallback response within 31 seconds. The fallback response correctly classifies the query category and returns appropriate follow-up questions. No `500 Internal Server Error` is returned to the user.

**Validation:**

```typescript
// In the experiment, assert:
expect(response.status).toBe(200);
expect(response.body.answer).toContain('unable to reach the AI model');
expect(response.body.confidence).toBe('LOW');
expect(response.body.followUpQuestions).toHaveLength(3);
```

---

#### EXP-013: TorchServe (FinBERT) crash

**Hypothesis:** When TorchServe is terminated, the `BERTBreakClassifier` detects the failure on the next reconciliation request, logs the circuit breaker trip, and routes all subsequent reconciliation requests to the rule-based fallback within one request cycle. No reconciliation requests return errors to the caller; they all complete (some with AI classification, some with rule-based classification).

---

#### EXP-014: Keycloak (identity provider) restart

**Hypothesis:** When Keycloak is restarted (simulating an IdP update), JWT tokens issued before the restart remain valid for their remaining TTL because `trade-service` and `risk-service` use cached public keys from the JWKS endpoint. A token issued after restart is validated against the new keys without requiring service restarts.

**Edge case tested:** Does the JWT signing key dual-validation window (Sprint 12.2) function correctly when Keycloak restarts mid-window?

---

### 5.5 Category 5 — Time and clock chaos

#### EXP-015: Clock skew injection on accounting-service

**Hypothesis:** Injecting a 5-second clock skew on `accounting-service` does not cause HMAC timestamp validation failures in the `audit-service`, because audit events include both logical sequence numbers and wall-clock timestamps, and the verification chain uses only logical ordering.

**Injection:**

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: TimeChaos
metadata:
  name: accounting-clock-skew
spec:
  mode: one
  selector:
    labelSelectors:
      app: accounting-service
  timeOffset: '+5s'
  duration: '10m'
```

---

#### EXP-016: Daylight saving time boundary (scheduled)

**Hypothesis:** All cron-scheduled reporting jobs (daily LCR report at 08:00 UTC, COREP monthly submission) execute at the correct UTC times regardless of the local timezone of the Kubernetes node where the `reporting-service` pod is scheduled.

**This experiment runs:** On the Sunday preceding the EU and US DST transitions (late March and late October/early November).

---

### 5.6 Category 6 — Cascading failure scenarios

#### EXP-017: Database failover during peak trading (GameDay)

**Hypothesis:** When the PostgreSQL primary is forcibly terminated during a simulated peak trading period (200 concurrent trade bookings/second), Patroni promotes the standby within 120 seconds. Trades submitted during the failover window are correctly queued in Kafka and replayed from the `nexus.trades.booked` dead letter topic once the new primary is ready. No trades are lost. The position book is consistent after replay.

**This is the highest-stakes experiment in the catalogue.** It is only run in production with full on-call team assembled and the engineering director notified.

---

#### EXP-018: Multiple simultaneous failures (compound chaos)

**Hypothesis:** Simultaneous failure of one `trade-service` pod, a 30ms network delay on `risk-service`, and a Bloomberg B-PIPE partition does not cause any trade to pass without a completed pre-deal check, and the error rate stays below 0.5% for the duration (the Tier 2 degradation SLO).

**This tests:** The interaction between multiple circuit breakers, fallback paths, and Kubernetes self-healing running concurrently. These compound scenarios are the hardest to reason about analytically.

---

## 6. Experiment execution framework

### 6.1 Experiment YAML structure

```yaml
# infra/chaos/experiments/exp-001-trade-service-pod-kill.yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: Workflow
metadata:
  name: exp-001-trade-service-pod-kill
  namespace: chaos-mesh
  labels:
    experiment-id: 'EXP-001'
    tier: 'pod-lifecycle'
    risk-level: 'low' # low | medium | high | critical
    environment: 'staging' # dev | staging | production
spec:
  entry: run-experiment
  templates:
    - name: run-experiment
      steps:
        - - name: verify-steady-state-before
            template: steady-state-check

        - - name: inject-failure
            template: pod-kill-injection

        - - name: observe-recovery
            template: wait-for-recovery

        - - name: verify-steady-state-after
            template: steady-state-check

    - name: steady-state-check
      suspend: {} # replaced by Prometheus probe in production

    - name: pod-kill-injection
      chaos:
        action: pod-kill
        selector:
          namespaces: [nexustreasury-bank-001]
          labelSelectors:
            app: trade-service
        mode: one

    - name: wait-for-recovery
      suspend:
        duration: '90s'
```

### 6.2 Experiment registry

All experiments are registered in `infra/chaos/EXPERIMENT-REGISTRY.yaml`:

```yaml
experiments:
  - id: EXP-001
    name: Trade service single pod kill
    category: pod-lifecycle
    risk: low
    approved-environments: [dev, staging, production]
    approval-required: false # can run automatically on schedule
    last-production-run: '2026-04-07'
    next-scheduled: '2026-04-14'
    owner: sre-team

  - id: EXP-017
    name: Database failover during peak trading
    category: cascading-failure
    risk: critical
    approved-environments: [staging, production]
    approval-required: true # requires explicit approval from engineering director
    last-production-run: '2026-01-20'
    next-scheduled: '2026-07-01'
    owner: sre-team
```

### 6.3 Automated scheduling in CI/CD

Low and medium risk experiments run automatically on a weekly schedule in staging via a dedicated GitHub Actions workflow:

```yaml
# .github/workflows/chaos-experiments.yml
name: Weekly Chaos Experiments (Staging)
on:
  schedule:
    - cron: '0 10 * * 2' # Every Tuesday at 10:00 UTC
  workflow_dispatch:
    inputs:
      experiment_id:
        description: 'Specific experiment ID (e.g. EXP-001)'
        required: false

jobs:
  run-chaos:
    name: Run scheduled chaos experiments
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - name: Apply chaos experiments to staging cluster
        run: |
          kubectl apply -f infra/chaos/experiments/low-risk/
        env:
          KUBECONFIG: ${{ secrets.STAGING_KUBECONFIG }}
      - name: Wait for experiments to complete
        run: |
          kubectl wait workflow --all --for=condition=Complete \
            -n chaos-mesh --timeout=30m
      - name: Collect results
        run: |
          kubectl get workflows -n chaos-mesh -o json > chaos-results.json
      - uses: actions/upload-artifact@v4
        with:
          name: chaos-results-${{ github.run_id }}
          path: chaos-results.json
          retention-days: 30
```

---

## 7. GameDay programme

A GameDay is a structured, scheduled event where the entire on-call team participates in running high-impact chaos experiments against production. It combines the chaos experiment with an observability and incident response drill.

### 7.1 GameDay frequency and structure

| GameDay type                | Frequency             | Duration | Risk level                 |
| --------------------------- | --------------------- | -------- | -------------------------- |
| Quarterly DR GameDay        | Every quarter         | 4 hours  | Critical (EXP-017)         |
| Monthly operational GameDay | Monthly               | 2 hours  | Medium (EXP-005, 009, 012) |
| Ad-hoc feature GameDay      | Before major releases | 1 hour   | Low-Medium (EXP-001, 003)  |

### 7.2 Quarterly DR GameDay agenda

**T-2 weeks:**

- Experiment plan reviewed and approved by engineering director
- On-call team notified; stakeholders (product, operations) informed
- Staging GameDay run to validate experiment procedures
- Pre-mortem: "what could go wrong with this GameDay itself?"

**T-0 (GameDay):**

| Time        | Activity                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| 09:00       | Briefing: hypothesis, blast radius controls, abort criteria, role assignments                                  |
| 09:15       | Steady-state verified on all SLO probes                                                                        |
| 09:30       | EXP-017 injection: PostgreSQL primary terminated                                                               |
| 09:30–09:50 | Observation: on-call team responds as if this is a real incident (pager fires, IC assembles, runbook executed) |
| 09:50       | Recovery validation: RTO measured from T+00:00                                                                 |
| 10:00       | Compound scenario: add EXP-006 (risk latency) on top of still-recovering system                                |
| 10:30       | All experiments completed; system returned to steady state                                                     |
| 10:30–11:30 | Hot retrospective: what did we learn? What would have gone wrong in a real incident?                           |
| 11:30–12:00 | Action items drafted and assigned                                                                              |

**T+5 business days:**

- Written GameDay report published internally
- Action items entered into sprint backlog
- SOC 2 CC7.4 evidence record updated

### 7.3 Abort criteria

A GameDay is immediately aborted and the emergency stop is triggered if any of the following occur:

- A real production incident (unrelated to the GameDay) is declared
- The steady-state probes show error rates exceeding P1 alert thresholds
- Any regulatory submission deadline falls within the next 2 hours
- A team member identifies a safety concern not anticipated in the plan

### 7.4 Post-GameDay report template

```markdown
# GameDay Report — [Date] — [Experiment IDs]

## Participants

[List IC, responders, observers]

## Experiments run

[EXP-XXX: name, duration, outcome]

## Steady-state before / during / after

[SLO probe values at each phase]

## Findings

1. [Finding]: [What was discovered]
   - Expected: [What the design predicted]
   - Actual: [What actually happened]
   - Impact: [SLO data during the deviation]

## Action items

| Action               | Owner  | Due date   | Priority |
| -------------------- | ------ | ---------- | -------- |
| [Fix identified gap] | @owner | YYYY-MM-DD | P1/P2/P3 |

## SOC 2 evidence

- CC7.4 evidence record: s3://nexustreasury-soc2/gameday-[date].json
```

---

## 8. Observability during chaos experiments

### 8.1 Chaos experiment dashboard

A dedicated Grafana dashboard (`nexustreasury-chaos-experiments`) shows:

- Real-time SLO probe status (pass/fail) for each steady-state hypothesis
- Service error rates (5m rolling window) vs. steady-state baseline
- P99 latency for critical paths (trade booking, pre-deal check, position update)
- Active chaos experiments (from Chaos Mesh API) overlaid as annotations on all time series
- Kafka consumer lag per consumer group
- Circuit breaker state per dependency

All chaos experiment start and end events are emitted as Grafana annotations, making it trivial to correlate any metric spike with an active experiment.

### 8.2 Chaos event correlation in traces

Every Chaos Mesh experiment injects a `X-Chaos-Experiment-ID` header into affected requests via Istio. This header propagates through the trace and allows OpenTelemetry/Jaeger to flag traces that were affected by a chaos experiment — essential for distinguishing intentional degradation from coincidental bugs.

### 8.3 Automated result collection

After every experiment, a result record is written to `nexus.chaos.experiment-results` Kafka topic:

```json
{
  "experimentId": "EXP-001",
  "runId": "RUN-2026-04-14-001",
  "environment": "staging",
  "duration": "90s",
  "steadyStateBefore": { "tradeSuccessRate": 0.9994, "p99Latency": 87 },
  "steadyStateDuring": { "tradeSuccessRate": 0.9991, "p99Latency": 143 },
  "steadyStateAfter": { "tradeSuccessRate": 0.9995, "p99Latency": 89 },
  "hypothesisVerified": true,
  "anomalies": [],
  "recoveryTimeMs": 28400
}
```

The SRE team reviews these records weekly in the SRE sync meeting.

---

## 9. Blast radius controls and safety mechanisms

### 9.1 Hard limits enforced by Chaos Mesh selectors

```yaml
# Every experiment spec MUST include these constraints:
spec:
  mode: one # Never 'all' in production
  duration: '10m' # Maximum 10 minutes per experiment
  selector:
    namespaces: [nexustreasury-bank-001] # Never target chaos-mesh or kube-system
    labelSelectors:
      chaos-eligible: 'true' # Only pods explicitly opted in
```

Pods are opted in to chaos experiments by applying the `chaos-eligible: "true"` label. This label is never applied to:

- PostgreSQL primary nodes
- Vault nodes
- Keycloak primary nodes
- ArgoCD controller pods
- The `audit-service` (only `audit-service` chaos experiments, which are specifically designed for this service, run against it)

### 9.2 Emergency stop procedure

```bash
# Stop all active chaos experiments immediately
kubectl delete podchaos,networkchaos,stresschaos,timechaos --all -n chaos-mesh
kubectl delete iochaos,httpchaos,kernelchaos --all -n chaos-mesh 2>/dev/null || true

# Verify all experiments terminated
kubectl get workflows -n chaos-mesh
# Expected: No resources found

# Verify services recovering
kubectl rollout status deployment/trade-service -n nexustreasury-bank-001
```

The emergency stop command is documented in every on-call runbook and available as a one-click button in the Grafana chaos dashboard.

### 9.3 Regulatory blackout windows

Chaos experiments are forbidden during:

| Window                                           | Reason                                        |
| ------------------------------------------------ | --------------------------------------------- |
| Monday–Friday 07:00–09:00 UTC                    | Pre-market open (dealers preparing positions) |
| Friday 14:00–17:00 UTC                           | FX weekly fixing window                       |
| Month-end (last 2 business days)                 | Regulatory reporting deadlines                |
| Quarter-end (last 5 business days)               | COREP/FINREP submission periods               |
| Immediately before/after a production deployment | Change freeze window                          |

These windows are encoded in the Chaos Mesh schedule configuration as `forbidConcurrent` annotations.

### 9.4 Tenant isolation during experiments

Chaos experiments never target more than one tenant namespace simultaneously. If an experiment reveals that a fault in `nexustreasury-bank-001` affects `nexustreasury-bank-002` (which should be impossible given the namespace-level isolation), this is immediately escalated as a critical architecture defect.

---

## 10. Rollout schedule: dev → staging → production

### 10.1 Environment progression gates

```
Stage 1 (dev):
  - All new experiment designs validated here first
  - No blast radius controls required (dev is disposable)
  - Runs automatically on every feature branch push to main

Stage 2 (staging):
  - Low and medium risk experiments: automated weekly schedule
  - High risk experiments: require PR approval from SRE lead
  - Steady-state baseline must match production within 20%

Stage 3 (production):
  - Low risk experiments: automated, weekly, during approved windows
  - Medium risk experiments: manual trigger, SRE lead approval
  - High risk experiments: require GameDay approval process
  - Critical experiments (EXP-017, EXP-018): require engineering director approval
```

### 10.2 Promotion criteria

An experiment can advance from staging to production only when:

1. The experiment ran successfully in staging at least 3 times without unexpected findings
2. The steady-state hypothesis was verified every time (i.e., the system recovered correctly every time)
3. The recovery time measured in staging is within the SLO target (RTO ≤ 15 minutes for DR experiments)
4. The experiment has been reviewed in the SRE sync meeting

### 10.3 Experiment maturity levels

| Maturity  | Criteria                                              | Schedule                                 |
| --------- | ----------------------------------------------------- | ---------------------------------------- |
| Draft     | Design complete; not yet run in dev                   | Manual only                              |
| Active    | Validated in dev and staging                          | Weekly in staging; monthly in production |
| Automated | 6+ successful production runs; no unexpected findings | Continuous (automated schedule)          |
| Archived  | System change made the experiment obsolete            | Not run; kept for historical reference   |

---

## 11. Regulatory and compliance considerations

### 11.1 MiFID II and DORA (Digital Operational Resilience Act)

The EU Digital Operational Resilience Act (DORA), effective January 2025, requires financial institutions to conduct ICT resilience testing including **threat-led penetration testing** and **operational resilience testing**. Chaos engineering is directly relevant to DORA Article 25 (Testing of ICT tools and systems).

NexusTreasury's chaos engineering programme satisfies DORA Article 25 requirements for:

- Regular resilience testing of critical systems (Article 25.1)
- Testing of recovery procedures including failover and redundancy (Article 25.3)
- Documentation of test results and remediation actions (Article 25.7)

Each GameDay report serves as evidence for DORA compliance. Records are retained in S3 Object Lock for 7 years.

### 11.2 SOC 2 Type II alignment

Chaos experiment results provide evidence for SOC 2 Trust Service Criteria:

| SOC 2 Control             | Evidence from chaos experiments                                  |
| ------------------------- | ---------------------------------------------------------------- |
| CC7.2 — Monitoring        | Steady-state probes demonstrate that monitoring detects failures |
| CC7.4 — Incident response | GameDay reports demonstrate incident response procedures work    |
| CC9.1 — Risk management   | Experiment findings feed the technical risk register             |
| A1.2 — System capacity    | Stress experiments validate capacity planning assumptions        |
| A1.3 — Recovery           | EXP-017 (DB failover) directly evidences RTO/RPO achievement     |

### 11.3 Pre-experiment approval for regulated entities

For regulated banking tenants, the following approval is required before running any medium or high risk experiment:

1. Written notification to the tenant's technology risk function (48 hours advance notice)
2. Confirmation that no regulatory deadlines fall within the experiment window
3. Confirmation from the tenant's CISO that the experiment scope is acceptable

This is documented in the tenant service agreement.

---

## 12. Integrating chaos results into the SRE improvement cycle

### 12.1 Findings classification

Every experiment finding is classified as:

| Class             | Description                                                                   | Action                                               |
| ----------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| Confirmed         | System behaved exactly as designed                                            | No action; record as evidence                        |
| Unexpected-Benign | System recovered correctly but via a different mechanism than expected        | Update design documentation                          |
| SLO-Degradation   | Recovery happened but SLO was briefly breached                                | Add to error budget tracking; investigate root cause |
| SLO-Violation     | Recovery failed or SLO was sustained breached                                 | P2 incident opened; sprint story to fix the gap      |
| Safety-Defect     | A safety invariant was violated (e.g., trade approved without pre-deal check) | Immediate P1 incident; trading suspended until fixed |

### 12.2 Chaos findings to sprint backlog

Confirmed findings become evidence for the SRE quarterly report. All other findings become sprint stories ranked by severity:

```
Safety-Defect   → P1 incident + immediate hotfix
SLO-Violation   → P1 sprint story; blocks release of related features
SLO-Degradation → P2 sprint story; part of next sprint
Unexpected-Benign → P3 story or documentation update
```

### 12.3 Chaos engineering maturity model

The programme targets the following maturity progression:

| Phase               | Characteristics                                                  | NexusTreasury target  |
| ------------------- | ---------------------------------------------------------------- | --------------------- |
| Phase 1: Manual     | Ad-hoc experiments; no automation                                | ✅ Complete           |
| Phase 2: Systematic | Experiment catalogue; staging automation                         | ✅ Complete           |
| Phase 3: Continuous | Production automation for low-risk; GameDay programme            | In progress (Q2 2026) |
| Phase 4: Proactive  | ML-driven anomaly detection feeds experiment design; chaos in CI | Planned (Q4 2026)     |

---

## 13. Chaos experiment code examples

### 13.1 DisasterRecoveryOrchestrator integration

The `DisasterRecoveryOrchestrator` (Sprint 12.1) is the programmatic interface for DR chaos experiments:

```typescript
import { DisasterRecoveryOrchestrator } from '@nexustreasury/audit-service';

// Quarterly DR test simulation (probe mode — no live traffic affected)
const orchestrator = new DisasterRecoveryOrchestrator({
  primaryRegion: 'eu-west-1',
  standbyRegions: ['us-east-1', 'ap-southeast-1'],
});

// Run DR test and assert RTO/RPO SLA
const result = orchestrator.runDRTest('primary-region-failure-simulation');

console.log(`RTO measured: ${result.rtoMeasuredMs}ms (target: ${result.rtoTargetMs}ms)`);
console.log(`RPO measured: ${result.rpoMeasuredMs}ms (target: ${result.rpoTargetMs}ms)`);
console.log(`Overall passed: ${result.overallPassed}`);

if (!result.overallPassed) {
  // Create P2 incident automatically
  await pagerduty.sendAlert({
    severity: 'error',
    summary: `DR test FAILED: RTO=${result.rtoMeasuredMs}ms, RPO=${result.rpoMeasuredMs}ms`,
    findings: result.findings,
  });
}
```

### 13.2 Health probe integration in steady-state verification

```typescript
// Steady-state verification script (used before/during/after experiments)
async function verifyPlatformSteadyState(
  tenantId: string,
  window: '1m' | '5m',
): Promise<{ healthy: boolean; violations: string[] }> {
  const violations: string[] = [];

  // 1. Trade booking success rate
  const tradeSuccessRate = await prometheusQuery(
    `1 - rate(nexus_trade_booking_total{status="failure",tenant_id="${tenantId}"}[${window}])
       / rate(nexus_trade_booking_total{tenant_id="${tenantId}"}[${window}])`,
  );
  if (tradeSuccessRate < 0.999) {
    violations.push(`Trade success rate ${(tradeSuccessRate * 100).toFixed(2)}% < 99.9% threshold`);
  }

  // 2. Pre-deal check latency
  const preDealP99 = await prometheusQuery(
    `histogram_quantile(0.99, rate(nexus_predeal_check_duration_seconds_bucket[${window}])) * 1000`,
  );
  if (preDealP99 > 5) {
    violations.push(`Pre-deal P99 ${preDealP99.toFixed(1)}ms > 5ms threshold`);
  }

  // 3. Kafka consumer lag
  const maxConsumerLag = await prometheusQuery(
    `max(nexus_kafka_consumer_lag{tenant_id="${tenantId}"})`,
  );
  if (maxConsumerLag > 1000) {
    violations.push(`Kafka consumer lag ${maxConsumerLag} > 1000 messages`);
  }

  // 4. Active circuit breakers
  const openBreakers = await prometheusQuery(
    `count(nexus_circuit_breaker_state{state="open",tenant_id="${tenantId}"})`,
  );
  if (openBreakers > 0) {
    violations.push(`${openBreakers} circuit breaker(s) in OPEN state`);
  }

  return { healthy: violations.length === 0, violations };
}
```

### 13.3 Chaos experiment as a vitest test

For lower-level unit/integration chaos testing, experiments can be written as vitest tests that inject failures programmatically:

```typescript
// packages/trade-service/src/application/resilience.test.ts
import { describe, it, expect } from 'vitest';
import { TreasuryAIAssistant, QueryCategory } from '../application/treasury-ai-assistant';

describe('Chaos: Anthropic API unavailable', () => {
  it('returns graceful fallback when API is unreachable', async () => {
    // Simulate API unavailability with unreachable endpoint + short timeout
    const assistant = new TreasuryAIAssistant({
      apiEndpoint: 'http://localhost:99999/unreachable',
      timeoutMs: 100,
    });

    const result = await assistant.ask({
      tenantId: 'bank-001',
      userId: 'trader-01',
      question: 'What is our EUR/USD FX exposure?',
      context: { snapshotDate: '2026-04-14', lcrRatio: 142.5 },
    });

    // Steady-state hypothesis: no 500 error; fallback response served
    expect(result.answer).toBeTruthy();
    expect(result.confidence).toBe('LOW'); // graceful degradation
    expect(result.modelVersion).toBe('fallback'); // fallback path taken
    expect(result.followUpQuestions).toHaveLength(3); // still useful
    expect(result.disclaimers).toHaveLength(1);
  });

  it('tracks failed queries in metrics for observability', async () => {
    const assistant = new TreasuryAIAssistant({
      apiEndpoint: 'http://localhost:99999/unreachable',
      timeoutMs: 100,
    });

    await assistant.ask({ tenantId: 'bank-001', userId: 'u1', question: 'Q1' });
    await assistant.ask({ tenantId: 'bank-001', userId: 'u1', question: 'Q2' });

    // Verify circuit state is observable (telemetry for Prometheus)
    expect(assistant.metrics.failedQueries).toBe(2);
    expect(assistant.metrics.totalQueries).toBe(2);
    expect(assistant.metrics.successRate).toBe('0.0%');
  });
});
```

---

## References and further reading

- **Chaos Engineering** — Rosenthal, Jones et al. (O'Reilly, 2020)
- **Chaos Mesh documentation** — https://chaos-mesh.org/docs/
- **Netflix Chaos Monkey** — https://github.com/Netflix/chaosmonkey
- **Google SRE Workbook** — Chapter 9: Simplicity; Chapter 13: Data Processing Pipelines
- **DORA (EU Digital Operational Resilience Act)** — Regulation (EU) 2022/2554, Articles 24–27
- **NexusTreasury Site Resilience Design** — `docs/sre/SITE-RESILIENCE-DESIGN.md`
- **NexusTreasury DR Runbook** — `docs/runbooks/production-runbook.md`

---

_Maintained by the NexusTreasury SRE team. All chaos experiment definitions live in `infra/chaos/experiments/`.  
For experiment scheduling requests, contact `#sre-platform` on Slack._
