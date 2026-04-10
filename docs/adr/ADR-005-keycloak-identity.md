# ADR-005: Keycloak vs Auth0 vs AWS Cognito

**Status**: Accepted | **Date**: 2025-11-12 | **Deciders**: CISO, Principal Engineer

## Decision: Keycloak 24

| Criterion                       | Auth0             | AWS Cognito     | Keycloak 24              | Winner   |
| ------------------------------- | ----------------- | --------------- | ------------------------ | -------- |
| Multi-tenant realm isolation    | Via organisations | User pools      | Native realms            | Keycloak |
| Self-hosted option              | No                | No              | Yes                      | Keycloak |
| Data residency (GDPR)           | US-based          | Region-specific | On-prem                  | Keycloak |
| MFA customisation               | Limited           | Limited         | Full                     | Keycloak |
| Role hierarchy                  | Flat              | Groups          | Full RBAC + fine-grained | Keycloak |
| Cost at scale                   | $0.0023/MAU       | $0.0055/MAU     | Self-hosted (infra only) | Keycloak |
| Caribbean regulatory compliance | Unknown           | Unknown         | On-prem = compliant      | Keycloak |

**Critical constraint**: Some deployment targets (Caribbean, MENA) require data to remain in-country. Auth0 and Cognito cannot guarantee data residency without complex workarounds. Keycloak deployed in-cluster on Kubernetes satisfies this requirement natively.

## Consequences

- One Keycloak realm per tenant: `nexustreasury-bank-001`, `nexustreasury-republic-bank`
- 9 roles per realm: `TREASURY_DEALER` through `READ_ONLY`
- MFA mandatory for: `RISK_MANAGER`, `COMPLIANCE_OFFICER`, `PLATFORM_ADMIN`
- JWT expiry: 15 minutes access token, 8 hours SSO session
- Token introspection endpoint used by all services (< 1ms via local Keycloak cache)
