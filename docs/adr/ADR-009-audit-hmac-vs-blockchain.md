# ADR-009: HMAC-SHA256 Audit Trail vs Blockchain Ledger

**Status**: Accepted  
**Date**: 2026-01-22  
**Deciders**: CISO, Principal Engineer, Head of Compliance

## Context

SOC 2 Type II requires tamper-evident audit logs. Two approaches were evaluated:

1. **Blockchain/DLT** — store audit hashes on a permissioned blockchain (Hyperledger Fabric)
2. **HMAC-SHA256** — append-only Elasticsearch with HMAC-signed records, key in Vault

## Decision

Use **HMAC-SHA256 with append-only Elasticsearch** and HashiCorp Vault-managed keys.

## Rationale

| Criterion | Blockchain/DLT | HMAC-SHA256 | Winner |
|---|---|---|---|
| Write latency P99 | ~500ms (consensus) | < 50ms | HMAC |
| Throughput | ~500 TPS | Unlimited | HMAC |
| Operational complexity | Requires 4-node Fabric network | Single Elasticsearch cluster | HMAC |
| Key rotation | Complex (re-signing) | Vault KV rotate | HMAC |
| SOC 2 acceptance | Accepted (rare) | Well-established | Tie |
| Forensic tooling | Custom | Standard Elasticsearch DSL | HMAC |
| Cost | $40K+/year | Included in existing ELK stack | HMAC |

**Tamper evidence**: HMAC-SHA256 over canonical string prevents any field mutation from
going undetected. The HMAC key is stored exclusively in HashiCorp Vault with audit logging
on every key access. This satisfies SOC 2 CC7.4 (incident forensics) and CC9.2 (change management).

**Append-only guarantee**: Elasticsearch ILM policy with frozen tier + legal hold flag prevents
index deletion. Rollover creates new indices; old indices are sealed.

## Consequences

- `verifyAuditRecord(record, hmacKey)` catches any field mutation, including payload, actor, entityId
- HMAC key rotation requires a re-signing job (planned quarterly; automated via Vault)
- Blockchain remains an option if regulators require it in future
