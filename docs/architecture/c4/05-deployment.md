# Deployment Architecture

Kubernetes topology, namespace layout, and GitOps pipeline for NexusTreasury.

## Kubernetes Cluster Topology

```mermaid
flowchart TB
  subgraph cloud["☁️ Cloud Provider — Managed Kubernetes"]
    subgraph cluster["Kubernetes Cluster (EKS / AKS / GKE)"]

      subgraph nsApp["nexus-prod namespace — Application Workloads"]
        tradeDeploy["trade-service
Deployment · 3 replicas
node:24-alpine3.21 · Port 4001
HPA: 3–20 pods"]
        posDeploy["position-service
Deployment · 3 replicas
Port 4002 · HPA: 3–10"]
        riskDeploy["risk-service
Deployment · 2 replicas
Port 4003 · HPA: 2–8"]
        almDeploy["alm-service
Deployment · 2 replicas
Port 4004 · HPA: 2–6"]
        boDeploy["bo-service
Deployment · 2 replicas
Port 4005 · HPA: 2–6"]
        mdDeploy["market-data-service
Deployment · 2 replicas
Port 4006 · HPA: 2–6"]
        webDeploy["web (Next.js)
Deployment · 2 replicas
Standalone output · Port 3000"]
      end

      subgraph nsPlatform["nexus-platform namespace — Platform Services"]
        keycloakDeploy["keycloak
StatefulSet · 2 replicas
OIDC/OAuth2 · Port 8080"]
        kongDeploy["api-gateway
Deployment · 2 replicas
Kong / Nginx · Port 443"]
        argoCD["argocd
GitOps controller
Port 8080"]
        vaultDeploy["vault
StatefulSet · 3 replicas
HA Raft · Port 8200"]
      end

      subgraph nsData["nexus-data namespace — Data Stores"]
        pgCluster[("postgresql-patroni
StatefulSet · 3 nodes
1 primary + 2 standby")]
        kafkaCluster[("kafka
StatefulSet · 3 brokers
KRaft mode · Port 9092")]
        redisCluster[("redis
StatefulSet · 6 nodes
3 primary + 3 replica")]
        elasticDeploy[("elasticsearch
StatefulSet · 3 nodes
Port 9200")]
      end

      subgraph nsObs["nexus-observability namespace"]
        promDeploy["prometheus
Deployment · 30d retention"]
        grafanaDeploy["grafana
Deployment · Port 3000"]
        jaegerDeploy["jaeger
Deployment · Port 16686"]
        otelDeploy["otel-collector
DaemonSet · 1 per node"]
      end

      subgraph nsSec["nexus-security namespace"]
        opaDeploy["opa-gatekeeper
DaemonSet · Policy enforcement"]
        trivyDeploy["trivy-operator
DaemonSet · Runtime CVE scan"]
        ciliumDeploy["cilium
DaemonSet · 1 per node
eBPF L7 networking"]
      end
    end

    subgraph ingress["Ingress Layer"]
      nlb["NLB / ALB
TLS 1.3 + WAF
Port 443"]
    end
  end

  subgraph github["GitHub"]
    ghActions["GitHub Actions
CI Pipeline"]
    ghcr["GHCR
ghcr.io/manassehkafoh/nexustreasury/*"]
  end

  nlb         -->|"HTTPS"| kongDeploy
  kongDeploy  -->|"HTTP/2 mTLS"| tradeDeploy
  kongDeploy  -->|"HTTP/2"| webDeploy
  argoCD      -->|"Pull images"| ghcr
  ghActions   -->|"Push images"| ghcr
  argoCD      -->|"Watch main branch"| github
  tradeDeploy -->|"pg-wire/TLS"| pgCluster
  tradeDeploy -->|"SASL"| kafkaCluster
  tradeDeploy -->|"AUTH+TLS"| redisCluster
  posDeploy   -->|"pg-wire/TLS"| pgCluster
  posDeploy   -->|"SASL"| kafkaCluster
  otelDeploy  -->|"gRPC"| promDeploy
  otelDeploy  -->|"gRPC"| jaegerDeploy
  promDeploy  -->|"Query"| grafanaDeploy
  tradeDeploy -->|"mTLS Vault"| vaultDeploy
```

## Namespace Isolation (Cilium Zero Trust)

```mermaid
flowchart TB
  subgraph internet["🌐 Internet"]
    user[User Browser]
    swiftNet[SWIFT Network]
  end

  subgraph ingress["Ingress Layer"]
    nlb[NLB / WAF]
  end

  subgraph nexus_platform["nexus-platform namespace"]
    kong[API Gateway<br/>Kong]
    keycloak[Keycloak<br/>OIDC]
    vault[HashiCorp Vault]
    argocd[ArgoCD]
  end

  subgraph nexus_prod["nexus-prod namespace — Zero Trust"]
    tradeSvc[trade-service]
    posSvc[position-service]
    riskSvc[risk-service]
    almSvc[alm-service]
    boSvc[bo-service]
    mdSvc[market-data-service]
    webApp[web / Next.js]
  end

  subgraph nexus_data["nexus-data namespace"]
    pg[(PostgreSQL)]
    kafka[(Kafka)]
    redis[(Redis)]
    elastic[(Elasticsearch)]
  end

  subgraph nexus_obs["nexus-observability"]
    prometheus[Prometheus]
    grafana[Grafana]
    jaeger[Jaeger]
    otel[OTel Collector]
  end

  user -->|HTTPS 443| nlb
  swiftNet -->|mTLS| nlb
  nlb --> kong
  kong -->|JWT verify| keycloak
  kong -->|Route| tradeSvc
  kong -->|Route| webApp

  tradeSvc -->|mTLS| kafka
  tradeSvc -->|mTLS| pg
  tradeSvc -->|mTLS| redis
  posSvc -->|mTLS| kafka
  posSvc -->|mTLS| pg
  riskSvc -->|mTLS| kafka
  riskSvc -->|mTLS| pg
  almSvc -->|mTLS| kafka
  almSvc -->|mTLS| pg
  boSvc -->|mTLS| kafka
  boSvc -->|mTLS| pg
  mdSvc -->|mTLS| kafka
  mdSvc -->|mTLS| redis

  tradeSvc -->|mTLS Vault| vault
  posSvc -->|mTLS Vault| vault

  tradeSvc -->|OTel traces| otel
  otel --> jaeger
  otel --> prometheus
  prometheus --> grafana

  style nexus_prod fill:#1a1a2e,stroke:#e94560,color:#fff
  style nexus_data fill:#16213e,stroke:#0f3460,color:#fff
```

## GitOps Pipeline

```mermaid
flowchart LR
  A[Developer<br/>git push] --> B[GitHub Actions<br/>CI Pipeline]
  B --> C{All checks<br/>green?}
  C -->|No| D[❌ Fail — notify]
  C -->|Yes| E[Build & Push<br/>Docker image to GHCR]
  E --> F[Update Helm values<br/>values-staging.yaml]
  F --> G[ArgoCD detects<br/>drift in Git]
  G --> H[ArgoCD syncs<br/>Staging cluster]
  H --> I[Health checks pass?]
  I -->|No| J[Auto-rollback]
  I -->|Yes| K[Smoke tests pass]
  K --> L[Manual approval<br/>2 reviewers]
  L --> M[Update<br/>values-production.yaml]
  M --> N[ArgoCD syncs<br/>Production cluster]
  N --> O[Blue-Green switch]
  O --> P[✅ Deployed]
```

## Resource Profiles

| Service              | CPU Request | CPU Limit | Memory Request | Memory Limit | HPA Min/Max |
| -------------------- | ----------- | --------- | -------------- | ------------ | ----------- |
| trade-service        | 250m        | 1000m     | 256Mi          | 1Gi          | 3 / 20      |
| position-service     | 250m        | 1000m     | 256Mi          | 1Gi          | 3 / 10      |
| risk-service         | 500m        | 2000m     | 512Mi          | 2Gi          | 2 / 8       |
| alm-service          | 250m        | 1000m     | 256Mi          | 1Gi          | 2 / 6       |
| bo-service           | 250m        | 1000m     | 256Mi          | 1Gi          | 2 / 6       |
| market-data-service  | 250m        | 500m      | 128Mi          | 512Mi        | 2 / 6       |
| web                  | 100m        | 500m      | 128Mi          | 512Mi        | 2 / 10      |
| postgresql (primary) | 2000m       | 4000m     | 4Gi            | 8Gi          | Fixed: 1    |
| kafka broker         | 1000m       | 2000m     | 2Gi            | 4Gi          | Fixed: 3    |
| redis                | 250m        | 500m      | 256Mi          | 1Gi          | Fixed: 6    |
