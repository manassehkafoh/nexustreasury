# Runbook 02: Position Not Updating

**Trigger:** Traders report position not reflecting recent trades, or
`KafkaConsumerLagHigh` alert fires for `position-service-group`

**Severity:** High — P&L and risk calculations will be wrong

---

## Immediate Detection

```bash
# Check Kafka consumer lag for position-service
# In Kafka UI (localhost:8080 or kafka-ui.nexustreasury.com):
# Consumer Groups → position-service-group → nexus.trading.trades
# Lag > 100 messages is a concern; lag > 1000 is critical

# Or via CLI
kubectl exec -n nexus-prod kafka-0 -- \
  kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --group position-service-group \
  --describe
```

---

## Triage

### Case 1: Consumer group shows high lag but pods are running

The position-service is running but processing slowly.

```bash
# Check position-service logs for errors
kubectl logs -n nexus-prod -l app=position-service --tail=200 | grep ERROR

# Check CPU/memory
kubectl top pods -n nexus-prod -l app=position-service
```

**Fix:** Scale up position-service:

```bash
kubectl scale deployment/position-service -n nexus-prod --replicas=5
```

---

### Case 2: Consumer group shows no progress (lag frozen)

The consumer has stopped consuming. Check for crash loops:

```bash
kubectl get pods -n nexus-prod -l app=position-service
kubectl describe pod -n nexus-prod <position-service-pod>
```

**Fix:** Restart the deployment:

```bash
kubectl rollout restart deployment/position-service -n nexus-prod
kubectl rollout status deployment/position-service -n nexus-prod
```

---

### Case 3: Position calculated incorrectly (not just delayed)

This is a data quality issue, not a lag issue.

```bash
# Find the trade and compare with position
kubectl exec -n nexus-prod postgres-0 -- \
  psql -U nexus -d nexustreasury -c \
  "SELECT * FROM trading.trade_events
   WHERE tenant_id = '<tenant>'
   ORDER BY occurred_at DESC LIMIT 20;"

# Compare with position
kubectl exec -n nexus-prod postgres-0 -- \
  psql -U nexus -d nexustreasury -c \
  "SELECT * FROM position.positions
   WHERE tenant_id = '<tenant>'
   AND instrument_id = '<instrument>';"
```

---

## Resolution Confirmation

1. Consumer lag returns to 0 in Kafka UI
2. Trade a small test position and verify it appears immediately
3. Confirm P&L matches manual calculation

---

## Post-Incident

Document the root cause. If position was calculated incorrectly, a reconciliation
job may be needed to replay events from `trading.trade_events` and recalculate.
