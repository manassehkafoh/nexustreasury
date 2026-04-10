# NexusTreasury Production Runbook

> **Audience**: Platform Engineers, SRE, On-Call Engineers  
> **On-call rotation**: PagerDuty — NexusTreasury service group  
> **Severity levels**: P1 (< 15min), P2 (< 1hr), P3 (< 4hr), P4 (next business day)

---

## 1. Service Map & Health Endpoints

| Service            | Port | Health           | Metrics         | Logs                                 |
| ------------------ | ---- | ---------------- | --------------- | ------------------------------------ |
| trade-service      | 4001 | `/live` `/ready` | `:9090/metrics` | Kibana: `service:trade-service`      |
| risk-service       | 4003 | `/live` `/ready` | `:9090/metrics` | Kibana: `service:risk-service`       |
| alm-service        | 4004 | `/live` `/ready` | `:9090/metrics` | Kibana: `service:alm-service`        |
| bo-service         | 4005 | `/live` `/ready` | `:9090/metrics` | Kibana: `service:bo-service`         |
| accounting-service | 4007 | `/live` `/ready` | `:9090/metrics` | Kibana: `service:accounting-service` |
| audit-service      | 4008 | `/live` `/ready` | `:9090/metrics` | Kibana: `service:audit-service`      |
| reporting-service  | 4011 | `/live` `/ready` | `:9090/metrics` | Kibana: `service:reporting-service`  |

---

## 2. Deployment Playbook

### Standard Deployment (GitOps / ArgoCD)

```bash
# All deployments go through GitHub Actions CI → ArgoCD GitOps
# DO NOT kubectl apply directly in production

# 1. Merge PR to main
# 2. CI pipeline runs: lint → build → test → docker build → push
# 3. ArgoCD detects new image tag → deploys to staging
# 4. Staging smoke tests run automatically
# 5. Manual approval gate in GitHub Actions for production
# 6. ArgoCD deploys to production with 10% canary → 100% on success
```

### Rollback Procedure

```bash
# Option A: ArgoCD UI → select previous sync
# Option B: CLI rollback
argocd app rollback nexustreasury-prod --revision <previous-revision>

# Option C: Emergency Helm rollback
helm rollback nexustreasury -n nexustreasury

# Verify rollback
kubectl rollout status deployment/trade-service -n nexustreasury
kubectl rollout status deployment/risk-service  -n nexustreasury
```

### Canary Validation

```bash
# Check canary metrics (Grafana: NexusTreasury Canary dashboard)
# Pass criteria:
#   - P99 latency < 100ms (trade booking)
#   - Error rate < 0.1%
#   - VaR calculation P99 < 5s
#   - Zero CRITICAL audit events in last 5min
```

---

## 3. Incident Response

### P1: Trade Booking Unavailable

```bash
# Check trade-service pods
kubectl get pods -n nexustreasury -l app=trade-service

# Check readiness probe
kubectl describe pod <trade-service-pod> -n nexustreasury | grep -A5 "Readiness"

# Check dependencies (DB + Kafka + Redis)
curl https://internal.nexustreasury.io/api/v1/ready
# Response should include status for each dependency

# Common fixes:
# 1. DB connection exhausted → restart pod (auto-heals via HPA)
kubectl rollout restart deployment/trade-service -n nexustreasury

# 2. Kafka consumer lag too high → check consumer group
kubectl exec -n nexustreasury <kafka-pod> -- kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group nexustreasury-trade-service

# 3. Redis eviction → check Redis memory usage
kubectl exec -n nexustreasury <redis-pod> -- redis-cli info memory
```

### P1: Sanctions Screening Failure

```bash
# CRITICAL: All trade bookings will fail if sanctions screening errors
# This will appear as 500 errors on POST /api/v1/trades

# 1. Check if it's a list provider timeout
kubectl logs -n nexustreasury deployment/trade-service | grep "sanctions\|OFAC\|timeout"

# 2. Emergency bypass (ONLY with Head of Compliance approval + dual sign-off)
# Set the config to use INTERNAL_TEST list only as emergency fallback
# THIS MUST BE ESCALATED IMMEDIATELY — do not bypass without approval

# 3. Contact OFAC API status: https://ofac.treasury.gov/system-status
```

### P2: LCR Calculation Failure

```bash
# ALM reports not generating → check alm-service
kubectl logs -n nexustreasury deployment/alm-service --tail=100

# Re-trigger LCR calculation
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://internal.nexustreasury.io/api/v1/alm/lcr \
  -H "Content-Type: application/json" \
  -d '{"forceRecalculate": true}'
```

### P2: Nostro Reconciliation Break Spike

```bash
# High break count → check BO service
kubectl logs -n nexustreasury deployment/bo-service | grep "BREAK\|reconcil"

# Check if SWIFT network is experiencing issues
# Contact SWIFT Operations: swift.com/swift-resource/250992

# Manual match intervention (authorised BO Supervisor only)
curl -X PATCH -H "Authorization: Bearer $BO_SUPERVISOR_TOKEN" \
  https://internal.nexustreasury.io/api/v1/bo/reconciliation/breaks/{breakId}/resolve \
  -d '{"resolution": "MANUAL_MATCH", "authorisedBy": "supervisor@bank.com"}'
```

### P3: Audit Service Lag

```bash
# Check Elasticsearch write queue
kubectl logs -n nexustreasury deployment/audit-service | grep "elasticsearch\|lag"

# Check Kafka consumer group lag for audit
kubectl exec -n nexustreasury <kafka-pod> -- kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group nexustreasury-audit-service

# Scale up audit-service if lag > 10,000 messages
kubectl scale deployment/audit-service -n nexustreasury --replicas=5
```

---

## 4. Scaling Playbook

### HPA Triggers (Automatic)

All services have HPA configured. Thresholds:

| Service              | Min Replicas | Max Replicas | Scale-up Trigger                 |
| -------------------- | ------------ | ------------ | -------------------------------- |
| trade-service        | 3            | 20           | CPU > 70% or P99 latency > 80ms  |
| risk-service         | 2            | 10           | CPU > 60% (VaR is CPU-intensive) |
| alm-service          | 2            | 8            | CPU > 70%                        |
| bo-service           | 2            | 12           | Queue depth > 1,000              |
| audit-service        | 2            | 10           | Kafka lag > 5,000                |
| notification-service | 2            | 8            | CPU > 70%                        |
| collateral-service   | 2            | 8            | CPU > 70%                        |
| reporting-service    | 2            | 6            | Concurrent requests > 10         |

### Manual Scale for EOD/Month-End

```bash
# EOD VaR run (scales risk-service temporarily)
kubectl scale deployment/risk-service -n nexustreasury --replicas=8

# After EOD run completes
kubectl scale deployment/risk-service -n nexustreasury --replicas=2

# Month-end regulatory reporting
kubectl scale deployment/reporting-service -n nexustreasury --replicas=4
```

---

## 5. Database Operations

### Read-Only Replica Failover

```bash
# If primary DB fails, promote read replica
# This is automated via Citus HA — but verify:
kubectl get citusmasters -n nexustreasury
kubectl get citusworkers -n nexustreasury

# Force failover if automated promotion fails
kubectl annotate citusmasters nexustreasury-db \
  citus.io/failover=true -n nexustreasury
```

### Long-Running Query Kill

```bash
# Check for blocking queries (> 30s)
kubectl exec -n nexustreasury <postgres-pod> -- psql -U nexus -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
  FROM pg_stat_activity
  WHERE (now() - pg_stat_activity.query_start) > interval '30 seconds'
  AND state = 'active'
  ORDER BY duration DESC;"

# Kill a specific query (get pid from above)
kubectl exec -n nexustreasury <postgres-pod> -- psql -U nexus -c \
  "SELECT pg_cancel_backend(<pid>);"
```

### Audit Log Retention

```bash
# Audit records must be retained for 10 years (NFR-022, regulatory requirement)
# NEVER delete audit records without CISO + Legal approval + 2-person authorisation

# Check Elasticsearch retention policy
curl -X GET "https://elasticsearch.nexustreasury.io/_ilm/policy/nexus-audit-10y-retention"

# Verify no records deleted accidentally
curl -X GET "https://elasticsearch.nexustreasury.io/nexus-audit-*/_count"
```

---

## 6. Security Incident Response

### Suspected JWT Token Compromise

```bash
# 1. Immediately rotate JWT_SECRET in HashiCorp Vault
vault kv put secret/nexustreasury/prod JWT_SECRET=$(openssl rand -hex 32)

# 2. Force pod restarts to pick up new secret (Vault agent auto-injects)
kubectl rollout restart deployment -n nexustreasury

# 3. Invalidate all active sessions (Redis flush)
kubectl exec -n nexustreasury <redis-pod> -- redis-cli FLUSHDB

# 4. Check audit trail for suspicious tokens
curl "https://internal.nexustreasury.io/api/v1/audit/records?category=SECURITY&severity=CRITICAL"

# 5. Notify: CISO, Security Team, Compliance within 1 hour
```

### Sanctions Match Alert

```bash
# If a MATCH (not POTENTIAL_MATCH) is returned:
# 1. Trade is automatically blocked — no action needed to prevent booking
# 2. Alert sent to compliance@bank.com automatically via notification-service
# 3. Document in compliance system within 1 hour
# 4. Check if trade was booked before screening was wired (check audit trail)
curl "https://internal.nexustreasury.io/api/v1/audit/records?entityId={counterpartyId}&category=SECURITY"
```

### HMAC Tamper Detection

```bash
# If verifyAuditRecord() returns false in Elasticsearch verification job:
# This is a CRITICAL security incident — escalate to CISO immediately

# 1. Identify the tampered record
# 2. Check surrounding records for pattern
# 3. Preserve evidence — do NOT delete or overwrite
# 4. Initiate forensic investigation

# Verification job runs daily at 02:00 UTC
# Check job status:
kubectl get cronjobs -n nexustreasury | grep audit-verify
kubectl logs job/audit-integrity-verify-<date> -n nexustreasury
```

---

## 7. Key Contacts

| Role                      | Contact                  | Escalation                        |
| ------------------------- | ------------------------ | --------------------------------- |
| Platform Engineering Lead | platform-lead@bank.com   | PagerDuty: nexustreasury-p1       |
| CISO / Security           | ciso@bank.com            | For JWT/audit/sanctions incidents |
| Head of Treasury          | treasury-head@bank.com   | For trading availability P1       |
| Head of Compliance        | compliance-head@bank.com | For sanctions/AML incidents       |
| HashiCorp Vault Admin     | infra-security@bank.com  | Secret rotation                   |
| SWIFT Operations          | +1-800-000-0000          | For MT/MX message failures        |

---

## 8. SLO Dashboard

Grafana: https://grafana.nexustreasury.io/d/nexustreasury-slo

| Metric                     | SLO          | Alert Threshold        |
| -------------------------- | ------------ | ---------------------- |
| Trade booking availability | 99.9%        | < 99.5% in 5min window |
| Trade booking P99 latency  | < 100ms      | > 150ms P99            |
| Pre-deal check P99         | < 5ms        | > 10ms P99             |
| VaR calculation P99        | < 5s         | > 8s P99               |
| LCR report generation      | < 30s        | > 45s                  |
| Kafka consumer lag (all)   | < 1,000 msgs | > 5,000 msgs           |
| Audit write latency P99    | < 100ms      | > 200ms P99            |
| Error rate (all services)  | < 0.1%       | > 0.5% in 5min         |

Error budget burn rate alert: Page if burn rate > 5× in any 1-hour window.
