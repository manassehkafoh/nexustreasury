# Runbook 01: Trade Booking Failure

**Trigger:** `TradeServiceErrorRateHigh` alert (> 1% error rate) or `POST /api/v1/trades`
returning 5xx errors

**Severity:** Critical — traders cannot book deals

---

## Immediate Detection

```bash
# Check error rate in Grafana
# trade-service dashboard → "Error Rate" panel

# Or check logs directly
kubectl logs -n nexus-prod -l app=trade-service --tail=200 | grep '"level":"error"'

# Check pod health
kubectl get pods -n nexus-prod -l app=trade-service
```

---

## Triage Decision Tree

### Case 1: `CrashLoopBackOff`

```bash
kubectl describe pod -n nexus-prod <trade-service-pod>
kubectl logs -n nexus-prod <trade-service-pod> --previous
```

**Common causes:**

- `JWT_SECRET environment variable is required` → Vault agent failed to inject secret
- `connect ECONNREFUSED postgres:5432` → Database unreachable
- `connect ECONNREFUSED kafka:9092` → Kafka unreachable

**Fix for Vault injection failure:**

```bash
kubectl rollout restart deployment/trade-service -n nexus-prod
# Wait for pods to come up
kubectl rollout status deployment/trade-service -n nexus-prod
```

**Fix for database unreachable:**

```bash
kubectl get pods -n nexus-prod | grep postgres
# If postgres is down, escalate to database team immediately
```

---

### Case 2: Pods running but returning 500

```bash
# Get recent error logs with stack traces
kubectl logs -n nexus-prod -l app=trade-service --tail=500 \
  | jq '. | select(.level == "error")'
```

**Common causes:**

- Prisma connection pool exhausted → `ECONNRESET` errors
- ZodError not caught (returns 500 instead of 400) → validation issue
- Kafka publish failing → `UNKNOWN_TOPIC_OR_PARTITION`

**Fix for Prisma pool exhaustion:**

```bash
# Temporarily scale up to reduce connections per pod
kubectl scale deployment/trade-service -n nexus-prod --replicas=5
# This spreads load — connection count per pod decreases
```

---

### Case 3: Only certain trades failing (not all)

**Likely cause:** Domain invariant violation or pre-deal check misconfiguration

Check if a specific asset class or counterparty is failing:

```bash
kubectl logs -n nexus-prod -l app=trade-service --tail=500 \
  | jq '. | select(.level == "error") | {msg: .msg, err: .err}'
```

---

## Resolution Confirmation

```bash
# Confirm error rate has dropped below 0.1%
# Check Grafana: trade-service → Error Rate panel → should be green

# Test with a sample booking
curl -X POST https://api.nexustreasury.com/api/v1/trades \
  -H "Authorization: Bearer $PROD_TOKEN" \
  -d '{"assetClass":"FX","direction":"BUY",...}'
# Should return 201
```

---

## Post-Incident

1. Create a post-mortem ticket within 24 hours
2. Document: timeline, root cause, fix, prevention
3. Add alerting if a detection gap was identified
