# NexusTreasury — Networking & Service Mesh Architecture

**Document version:** 1.0.0  
**Applies to:** NexusTreasury v1.6.0+  
**Status:** Authoritative — supersedes any conflicting references in other documents  
**Last updated:** April 2026

---

## Executive summary

NexusTreasury uses **Cilium** as both the CNI (Container Network Interface) and
service mesh. Istio was evaluated and explicitly rejected in ADR-005 (see
`02_SDD_NexusTreasury.md`) due to its high memory overhead and operational
complexity. Any references to "Istio" found elsewhere in the documentation are
incorrect and are being systematically corrected.

| Layer                 | Technology                                             | Version | Purpose                                                    |
| --------------------- | ------------------------------------------------------ | ------- | ---------------------------------------------------------- |
| CNI                   | **Cilium**                                             | 1.15+   | Pod networking, IP allocation, eBPF datapath               |
| L3/L4 policy          | **CiliumNetworkPolicy**                                | —       | IP/port allow-lists; default-deny namespace isolation      |
| L7 policy             | **CiliumNetworkPolicy (HTTP/gRPC rules)**              | —       | Method- and path-scoped HTTP enforcement                   |
| mTLS                  | **Cilium Mutual Auth**                                 | 1.14+   | SPIFFE/SPIRE workload identity; cert rotation every 24h    |
| Service mesh          | **Cilium Service Mesh** (with Envoy sidecarless)       | 1.15+   | Traffic management, retries, timeouts, load balancing      |
| Network observability | **Hubble**                                             | 1.15+   | Real-time flow visibility, Prometheus metrics, UI          |
| Service discovery     | **Kubernetes CoreDNS + Cilium kube-proxy replacement** | —       | kube-proxy replaced by eBPF for sub-millisecond forwarding |

---

## 1. Why Cilium and not Istio

### 1.1 ADR-005 decision record

From `02_SDD_NexusTreasury.md`, ADR-005:

> **Decision**: Cilium CNI with eBPF-based network policies; Hubble for network
> observability.  
> **Rationale**: Cilium enforces mutual TLS (mTLS) + L7 HTTP/gRPC policies;
> eBPF-based performance; native Kubernetes NetworkPolicy compliance; built-in
> Hubble UI for network flow visibility.  
> **Alternatives Considered**: Calico (no L7 policies); **Istio (high memory
> overhead; complexity)**; Flannel (no security features).

### 1.2 Concrete reasons for rejecting Istio

| Concern                | Istio                                                       | Cilium                                                |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| Memory overhead        | ~400MB per node (Envoy sidecar per pod)                     | ~50MB per node (single eBPF program per node)         |
| Latency                | +2–5ms per hop (userspace proxy)                            | +0.05ms per hop (kernel eBPF bypass)                  |
| Operational complexity | Separate control plane (istiod), CRDs, sidecar injection    | Single DaemonSet; standard k8s CRDs                   |
| mTLS mechanism         | Envoy sidecar intercepts; cert managed by Istiod CA         | SPIFFE/SPIRE kernel-level; no sidecar needed          |
| L7 policy              | VirtualService CRDs (separate from NetworkPolicy)           | Native CiliumNetworkPolicy (L3/L4/L7 unified)         |
| Financial services fit | Sidecar injection can interfere with timing-sensitive paths | Kernel-bypass avoids latency jitter on pre-deal check |

For a treasury platform where the pre-deal check SLO is P99 < 5ms, the 2–5ms
sidecar overhead introduced by Istio would consume the entire latency budget.

---

## 2. Cilium deployment architecture

### 2.1 Installation

Cilium is deployed via Helm with the following key flags:

```bash
helm install cilium cilium/cilium \
  --namespace kube-system \
  --version 1.15.x \
  --set kubeProxyReplacement=strict \
  --set k8sServiceHost=<API_SERVER_IP> \
  --set k8sServicePort=6443 \
  --set hubble.relay.enabled=true \
  --set hubble.ui.enabled=true \
  --set encryption.enabled=true \
  --set encryption.type=wireguard \
  --set authentication.mutual.spire.enabled=true \
  --set authentication.mutual.spire.install.enabled=true \
  --set ingressController.enabled=true \
  --set ingressController.loadbalancerMode=shared
```

Key flags explained:

- `kubeProxyReplacement=strict` — Cilium fully replaces kube-proxy using eBPF.
  All service load balancing and DNAT happens at the kernel level. No iptables.
- `encryption.type=wireguard` — Node-to-node traffic is encrypted with WireGuard
  at the network layer. This handles inter-node encryption without per-pod overhead.
- `authentication.mutual.spire.enabled=true` — Cilium integrates with SPIRE for
  SPIFFE workload identity. Each pod gets a SPIFFE identity automatically. mTLS
  is enforced at the Cilium level without sidecar proxies.
- `hubble.relay.enabled=true` — Hubble relay aggregates flow data from all nodes,
  enabling cluster-wide network observability via Prometheus and the Hubble UI.

### 2.2 Namespace labelling

All namespaces carrying application workloads have `cilium.io/policy: enforced`
which activates the default-deny policy:

```yaml
# infra/kubernetes/base/namespaces.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: nexus-prod
  labels:
    app.kubernetes.io/part-of: nexustreasury
    cilium.io/policy: enforced # ← activates Cilium policy enforcement
---
apiVersion: v1
kind: Namespace
metadata:
  name: nexus-data
  labels:
    app.kubernetes.io/part-of: nexustreasury
    cilium.io/policy: enforced
```

### 2.3 Default deny-all base policy

The first policy applied in every enforced namespace is a global default-deny
that blocks all traffic not explicitly permitted:

```yaml
# From 06_Kubernetes_Platform_NexusTreasury.yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: default-deny-all
  namespace: nexus-prod
spec:
  endpointSelector: {} # matches ALL pods in namespace
  ingress:
    - {} # deny all ingress
  egress:
    - {} # deny all egress
```

This implements the Zero Trust principle: "deny all, permit explicitly." Every
allowed communication path is declared in a per-service policy.

---

## 3. How Cilium replaces Istio's service mesh capabilities

Cilium Service Mesh (introduced in Cilium 1.12, stable in 1.14+) uses a
**sidecarless model**. Instead of injecting an Envoy proxy into every pod,
Cilium runs a shared Envoy instance per node, managed by the Cilium agent. This
achieves all the service mesh features of Istio with a fraction of the resource
cost.

### 3.1 mTLS (mutual TLS)

**Istio approach:** Istio injects an Envoy sidecar into every pod. Istiod issues
X.509 certificates. TLS termination happens in the sidecar.

**Cilium approach:** SPIFFE/SPIRE issues SVID (SPIFFE Verifiable Identity
Document) certificates to each workload. Cilium's mutual auth enforces these at
the kernel/socket level. No sidecar injection. No certificate management daemon
per pod.

```yaml
# CiliumNetworkPolicy — require mTLS identity for risk-service → trade-service
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: trade-service-mtls-policy
  namespace: nexus-prod
spec:
  endpointSelector:
    matchLabels:
      app: trade-service
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: risk-service
      authentication:
        mode: 'required' # enforce SPIFFE mTLS — unauthenticated pods rejected
```

Certificate rotation: SPIRE rotates SVIDs every 24 hours by default. The dual
SVID window allows seamless rotation with zero connection drops.

### 3.2 L7 HTTP and gRPC policy enforcement

Cilium enforces HTTP method/path rules directly in the kernel using eBPF + a
per-node Envoy instance. The policy for `trade-service` permits only the exact
API surface it exposes:

```yaml
# From 06_Kubernetes_Platform_NexusTreasury.yaml — trade-service L7 policy
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: trade-service-policy
  namespace: nexus-prod
spec:
  endpointSelector:
    matchLabels:
      app: trade-service
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: api-gateway
            namespace: nexus-ingress
      toPorts:
        - ports:
            - port: '4001'
              protocol: TCP
          rules:
            http:
              - method: 'POST'
                path: '/v1/trades'
              - method: 'GET'
                path: '/v1/trades.*'
              - method: 'PATCH'
                path: '/v1/trades/.*'
              - method: 'GET'
                path: '/health/.*'
    - fromEndpoints:
        - matchLabels:
            app: risk-service
      toPorts:
        - ports:
            - port: '4101' # gRPC pre-deal check
              protocol: TCP
```

Any HTTP method or path not listed is dropped at the kernel level before it
reaches the application. A malformed request to `/admin` from a compromised
pod is blocked without the trade-service process ever seeing it.

### 3.3 Traffic management (retries, timeouts, circuit breaking)

Cilium Service Mesh provides traffic management via its per-node Envoy instance
configured through `CiliumEnvoyConfig` CRDs:

```yaml
apiVersion: cilium.io/v2alpha1
kind: CiliumEnvoyConfig
metadata:
  name: trade-service-traffic-mgmt
  namespace: nexus-prod
spec:
  services:
    - name: trade-service
      namespace: nexus-prod
  resources:
    - '@type': type.googleapis.com/envoy.config.route.v3.RouteConfiguration
      name: trade-service-routes
      virtual_hosts:
        - name: trade-service
          domains: ['trade-service.nexus-prod.svc.cluster.local']
          routes:
            - match:
                prefix: '/'
              route:
                cluster: trade-service-cluster
                timeout: 8s
                retry_policy:
                  retry_on: 'gateway-error,connect-failure,reset,retriable-4xx'
                  num_retries: 3
                  per_try_timeout: 2s
```

Circuit breaking is implemented via Envoy's `OutlierDetection`:

```yaml
- '@type': type.googleapis.com/envoy.config.cluster.v3.Cluster
  name: trade-service-cluster
  outlier_detection:
    consecutive_5xx: 3 # open after 3 consecutive errors
    interval: 10s
    base_ejection_time: 30s # HALF_OPEN after 30s
    max_ejection_percent: 33 # max 33% of pods ejected
```

This replicates the circuit breaker behaviour documented in the SRE design
(`docs/sre/SITE-RESILIENCE-DESIGN.md`) using Cilium's Envoy integration rather
than Istio's VirtualService CRDs.

### 3.4 Load balancing

Cilium replaces kube-proxy entirely. Service load balancing uses eBPF maps
(XDP/TC hooks) for direct socket-level DNAT. This is faster than iptables
(O(1) lookup vs O(n) iptables rules):

```
Request → eBPF XDP hook → Cilium BPF map lookup → direct DNAT to pod IP
                                                    (no iptables, no conntrack)
```

The result is sub-millisecond load balancing — critical for the pre-deal check
path (P99 SLO: 5ms).

---

## 4. Service-by-service allowed communication matrix

The following matrix shows which services are explicitly permitted to communicate.
All other combinations are blocked by the default-deny policy.

| Source               | Destination                          | Port | Protocol  | L7 Rules                           |
| -------------------- | ------------------------------------ | ---- | --------- | ---------------------------------- |
| `api-gateway`        | `trade-service`                      | 4001 | TCP/HTTP  | POST /v1/trades, GET /v1/trades/\* |
| `api-gateway`        | `risk-service`                       | 4003 | TCP/HTTP  | POST /v1/risk/pre-deal             |
| `api-gateway`        | `alm-service`                        | 4004 | TCP/HTTP  | GET /v1/alm/\*                     |
| `api-gateway`        | `reporting-service`                  | 4011 | TCP/HTTP  | GET /v1/reports/\*                 |
| `api-gateway`        | `planning-service`                   | 4012 | TCP/HTTP  | GET,POST /v1/planning/\*           |
| `trade-service`      | `risk-service`                       | 4101 | TCP/gRPC  | PreDealCheck RPC                   |
| `trade-service`      | `notification-service`               | 4009 | TCP/HTTP  | POST /v1/notify/\*                 |
| `trade-service`      | `audit-service`                      | 4008 | TCP/HTTP  | POST /v1/audit/events              |
| `risk-service`       | `market-data-service`                | 4006 | TCP/HTTP  | GET /v1/rates/\*                   |
| `bo-service`         | `trade-service`                      | 4001 | TCP/HTTP  | GET /v1/trades/\*                  |
| `accounting-service` | `trade-service`                      | 4001 | TCP/HTTP  | GET /v1/trades/\* (EOD)            |
| `reporting-service`  | `\*.nexus-data`                      | 5432 | TCP/PG    | read replica only                  |
| All services         | `vault.nexus-platform`               | 8200 | TCP/HTTPS | secret read                        |
| All services         | `keycloak.nexus-platform`            | 8080 | TCP/HTTP  | JWKS /realms/\*/\*                 |
| All services         | `kafka.nexus-data`                   | 9092 | TCP       | topic-scoped ACLs                  |
| All services         | `otel-collector.nexus-observability` | 4317 | TCP/gRPC  | OTLP traces                        |
| All services         | `kube-dns.kube-system`               | 53   | UDP       | DNS                                |

---

## 5. Hubble observability

Hubble is Cilium's network observability layer. It gives real-time visibility
into all network flows without any application instrumentation.

### 5.1 What Hubble provides

- **Flow visibility** — every TCP connection, HTTP request, and DNS query is
  visible in Hubble UI and CLI
- **Policy verdict logging** — every dropped packet is logged with the source,
  destination, and policy name that dropped it
- **Prometheus metrics** — `cilium_drop_count_total`, `hubble_flows_processed_total`,
  `hubble_http_requests_total` (with method, status, service labels)
- **Service dependency map** — auto-generated topology of which services talk to
  which, with error rates overlaid

### 5.2 Key Hubble metrics exported to Prometheus

```
# Flows processed per service (tracks throughput)
hubble_flows_processed_total{source="trade-service",destination="risk-service",
  type="L7",verdict="FORWARDED"}

# HTTP request rate and latency (per service pair)
hubble_http_requests_total{source,destination,method,status_code}
hubble_http_request_duration_seconds{source,destination,method,quantile}

# Policy drop rate (security audit signal)
cilium_drop_count_total{reason="Policy denied",direction="ingress",
  protocol="TCP"}

# Cilium identity (SPIFFE workload ID) verified count
cilium_policy_endpoint_enforcement_status{policy="required",
  status="has-identity"}
```

These metrics feed the Grafana dashboards in the `nexus-observability` namespace
alongside the application Prometheus metrics.

### 5.3 Accessing Hubble in development

```bash
# Port-forward the Hubble UI
kubectl port-forward -n kube-system svc/hubble-ui 12000:80

# Use Hubble CLI to watch live flows
hubble observe --namespace nexus-prod --follow

# Watch only trade-service flows
hubble observe --namespace nexus-prod \
  --from-pod nexus-prod/trade-service \
  --follow

# Show dropped packets with policy reason
hubble observe --namespace nexus-prod \
  --verdict DROPPED \
  --follow
```

---

## 6. mTLS enforcement: how workload identity works

### 6.1 SPIFFE/SPIRE integration

Cilium 1.14+ integrates natively with SPIRE (the SPIFFE Runtime Environment).
Each pod automatically receives a SPIFFE ID in the format:

```
spiffe://nexustreasury.bank.com/ns/nexus-prod/sa/trade-service
```

The SVID (certificate) is issued by SPIRE Server and injected into the Cilium
agent. When two pods communicate, Cilium verifies both SVIDs at the kernel level
before forwarding traffic. No application code change is required.

### 6.2 Identity-based policies

CiliumNetworkPolicy uses SPIFFE identity as an additional selector:

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: risk-to-trade-mtls
  namespace: nexus-prod
spec:
  endpointSelector:
    matchLabels:
      app: trade-service
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: risk-service
      authentication:
        mode: 'required'
        # Only pods with valid SPIFFE ID from our trust domain are accepted
        # spiffe://nexustreasury.bank.com/ns/nexus-prod/sa/risk-service
```

If a compromised pod attempts to impersonate `risk-service` without a valid
SPIFFE SVID, the connection is dropped at the kernel level — the application
never receives the request.

### 6.3 Certificate rotation (zero-downtime)

SPIRE rotates SVIDs every 24 hours. The rotation sequence:

```
T-0:    SPIRE issues new SVID to risk-service pod
T+0:    Cilium loads new SVID alongside the old SVID (dual-SVID window)
T+10m:  Old SVID expired; all connections now use new identity
T+10m:  Cilium removes old SVID from the auth table
```

The dual-SVID window (configurable, default 10 minutes) ensures no connection
drops during rotation. This is the Cilium equivalent of what the SRE document
refers to as "workload identity certs rotated every 24 hours."

---

## 7. WireGuard node-to-node encryption

When `encryption.type=wireguard` is set, Cilium automatically establishes
WireGuard tunnels between every pair of nodes in the cluster. All pod-to-pod
traffic crossing a node boundary is encrypted.

This is **transparent to applications** — no TLS configuration required at the
application layer for cross-node traffic. Combined with SPIFFE mTLS at the
endpoint level, NexusTreasury achieves encryption-in-depth:

```
Pod (trade-service)
  │  Application-level: no TLS needed (mTLS handled by Cilium SPIFFE)
  │
  ↓ Cilium eBPF hook (L7 policy enforcement)
  │
  ↓ WireGuard tunnel (node boundary — encrypts the packet)
  │
  ↓ Remote node: WireGuard decrypts
  │
  ↓ Cilium eBPF hook (SPIFFE identity verification)
  │
Pod (risk-service)
```

---

## 8. Comparison: Cilium vs Istio capabilities for NexusTreasury

This table shows how each Istio capability referenced in the wider ecosystem maps
to its Cilium equivalent in NexusTreasury.

| Capability                 | Istio mechanism                    | Cilium equivalent                    | Status      |
| -------------------------- | ---------------------------------- | ------------------------------------ | ----------- |
| mTLS everywhere            | Envoy sidecar + Istiod CA          | Cilium Mutual Auth + SPIRE SVIDs     | ✅ Deployed |
| L7 HTTP policy             | `AuthorizationPolicy`              | `CiliumNetworkPolicy` HTTP rules     | ✅ Deployed |
| Traffic retries            | `VirtualService` retryPolicy       | `CiliumEnvoyConfig` retry_policy     | ✅ Deployed |
| Request timeouts           | `VirtualService` timeout           | `CiliumEnvoyConfig` timeout          | ✅ Deployed |
| Circuit breaking           | `DestinationRule` outlierDetection | `CiliumEnvoyConfig` OutlierDetection | ✅ Deployed |
| Load balancing             | Envoy upstream LB                  | eBPF BPF map DNAT                    | ✅ Deployed |
| Traffic weighting (canary) | `VirtualService` weight            | `CiliumEnvoyConfig` weighted cluster | ✅ Deployed |
| Network observability      | Kiali + Jaeger                     | Hubble UI + Hubble CLI               | ✅ Deployed |
| Service-to-service metrics | Prometheus via sidecar             | Hubble Prometheus metrics            | ✅ Deployed |
| Ingress                    | `Istio Gateway`                    | Cilium Ingress Controller            | ✅ Deployed |

---

## 9. Files and configuration locations

| Resource                                        | File location                                            |
| ----------------------------------------------- | -------------------------------------------------------- |
| Cilium Helm values                              | `infra/helm/nexustreasury/values.yaml`                   |
| Namespace labels (`cilium.io/policy: enforced`) | `infra/kubernetes/base/namespaces.yaml`                  |
| Default-deny-all policy                         | `infra/kubernetes/base/network-policy.yaml`              |
| Trade-service L3/L4/L7 policy                   | `06_Kubernetes_Platform_NexusTreasury.yaml` lines 88–200 |
| Cilium CiliumNetworkPolicy: all services        | `06_Kubernetes_Platform_NexusTreasury.yaml`              |
| Hubble Prometheus alerts                        | `infra/monitoring/alerts/nexustreasury.rules.yaml`       |
| ADR-005 decision record                         | `02_SDD_NexusTreasury.md` §3.5                           |

---

## 10. Documentation corrections (Istio references)

The `docs/sre/SITE-RESILIENCE-DESIGN.md` was written with references to Istio
that are incorrect. The following sections have been corrected in the document:

| Section | Incorrect (was)                        | Correct (now)                  |
| ------- | -------------------------------------- | ------------------------------ |
| §5.1    | "Istio service mesh"                   | "Cilium Service Mesh"          |
| §5.1    | "mTLS certificates issued by Istio CA" | "SPIFFE SVIDs issued by SPIRE" |
| §5.1    | `VirtualService` YAML                  | `CiliumEnvoyConfig` YAML       |
| §5.2    | "Istio retry/timeout policy"           | "Cilium Envoy traffic policy"  |
| §14.1   | "Istio CA"                             | "SPIRE / Cilium Mutual Auth"   |

The SDD (`02_SDD_NexusTreasury.md`) and Kubernetes YAML
(`06_Kubernetes_Platform_NexusTreasury.yaml`) were always correct — they
reference Cilium exclusively throughout.

---

_Maintained by the NexusTreasury Platform Engineering team.  
For networking policy changes, raise a PR against `infra/kubernetes/base/network-policy.yaml`  
or `06_Kubernetes_Platform_NexusTreasury.yaml`. All changes require SRE review._
