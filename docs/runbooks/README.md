# Runbooks

Runbooks are step-by-step incident response guides. Each runbook covers:

- How to detect the problem
- Immediate triage steps
- Root cause investigation
- Resolution steps
- How to confirm the fix
- Post-incident actions

---

## Runbook Index

| Runbook                                                     | Trigger                           | Severity |
| ----------------------------------------------------------- | --------------------------------- | -------- |
| [01 — Trade Booking Failure](./01-Trade-Booking-Failure.md) | `TradeServiceErrorRateHigh` alert | Critical |
| [02 — Position Not Updating](./02-Position-Not-Updating.md) | Position consumer lag alert       | High     |
| [03 — Rollback Procedure](./03-Rollback-Procedure.md)       | Bad deployment identified         | Critical |
| [04 — LCR Breach Response](./04-LCR-Breach-Response.md)     | `LCRBelowMinimum` alert           | Critical |

---

## On-Call Checklist (First 5 Minutes)

For any production incident:

```bash
# 1. Check all pods are running
kubectl get pods -n nexus-prod

# 2. Check for crash loops
kubectl get pods -n nexus-prod | grep -E "CrashLoopBackOff|Error"

# 3. Check error logs for the affected service
kubectl logs -n nexus-prod -l app=trade-service --tail=100 | grep ERROR

# 4. Check Kafka consumer lag (is position-service keeping up?)
open http://localhost:8080  # Kafka UI

# 5. Check Grafana dashboards
open http://grafana.nexustreasury.com  # production Grafana
```
