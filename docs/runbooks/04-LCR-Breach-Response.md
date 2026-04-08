# Runbook 04: LCR Breach Response

**Trigger:** `LCRBelowMinimum` Prometheus alert (LCR < 100%)

**Severity:** Critical — regulatory minimum breached

**Important:** An LCR breach is a regulatory event. The compliance team
must be notified immediately. Do not delay to investigate first.

---

## Immediate Actions (First 15 Minutes)

### 1. Notify compliance team

Call the compliance officer immediately. Do not wait for investigation.
They must start the regulatory notification clock (24-hour rule in most jurisdictions).

### 2. Confirm the breach

```bash
# Get current LCR
curl -H "Authorization: Bearer $TOKEN" \
  https://api.nexustreasury.com/api/v1/alm/lcr

# Response: { "lcrRatio": 87.3, "isCompliant": false }
```

### 3. Check data quality

Is this a real breach or a calculation error?

```bash
# Check when the last report was generated
kubectl exec -n nexus-prod postgres-0 -- \
  psql -U nexus -d nexustreasury -c \
  "SELECT id, lcr_ratio, generated_at
   FROM alm.liquidity_gap_reports
   ORDER BY generated_at DESC LIMIT 5;"

# Check for errors in alm-service
kubectl logs -n nexus-prod -l app=alm-service --tail=200 | grep ERROR
```

If the last report was generated with bad input data (e.g. HQLA amounts were zero),
it may be a data quality issue, not a real breach.

---

## Investigation

### Identify the cause

The LCR can drop because:

1. **HQLA decreased** — liquid assets were sold or pledged as collateral
2. **Outflows increased** — large deposits withdrawn, wholesale funding maturing
3. **Both** — the most serious scenario

```bash
# Compare with the previous report
kubectl exec -n nexus-prod postgres-0 -- \
  psql -U nexus -d nexustreasury -c \
  "SELECT lcr_json, generated_at
   FROM alm.liquidity_gap_reports
   ORDER BY generated_at DESC LIMIT 2;"
```

Look at the JSON for changes in `hqlaLevel1`, `hqlaLevel2A`, `hqlaLevel2B`,
and `netCashOutflows30d` between the two most recent reports.

---

## Remediation Options

| Action                                           | Effect                   | Timeframe               |
| ------------------------------------------------ | ------------------------ | ----------------------- |
| Purchase eligible HQLA (govvies, CB deposits)    | Increases HQLA numerator | Same day                |
| Draw on committed credit facilities              | Increases HQLA           | 1–2 days                |
| Reduce stress outflows (e.g. stabilise deposits) | Reduces denominator      | 1–30 days               |
| Reduce lending (reduce RSF)                      | Indirect via NSFR        | 1–30 days               |
| Emergency CB repo facility                       | Increases HQLA           | Hours (if pre-arranged) |

### Trigger an emergency liquidity plan

The bank's treasury committee must be convened to decide on remediation.
NexusTreasury can model the impact of proposed actions:

```bash
# Model the impact of purchasing $200M of govvies
curl -X POST https://api.nexustreasury.com/api/v1/alm/liquidity-gap \
  -d '{
    "scenario": "STRESSED_30D",
    "lcr": {
      "hqlaLevel1": 1400000000,   # ← increased from original
      ...
    }
  }'
```

---

## Regulatory Notification

In most jurisdictions (Basel, EU CRR, UK PRA, Ghana BOG):

- **Within 24 hours:** Notify the regulator of the breach
- **Within 72 hours:** Submit a remediation plan
- **Within 30 days:** Restore LCR to ≥ 100%

The compliance team leads this process. Engineering provides reports and data.

---

## Confirmation

```bash
# Confirm LCR has been restored
curl -H "Authorization: Bearer $TOKEN" \
  https://api.nexustreasury.com/api/v1/alm/lcr

# Should return: { "lcrRatio": 105.2, "isCompliant": true }

# Confirm Prometheus alert has resolved
# Grafana: ALM dashboards → LCR Ratio panel → should be green
```

---

## Post-Incident

1. Write a full incident report within 48 hours
2. Submit regulatory notification with timeline and root cause
3. Review ALM governance: did warning thresholds fire early enough?
4. Consider increasing the internal warning threshold (e.g. from 110% to 115%)
