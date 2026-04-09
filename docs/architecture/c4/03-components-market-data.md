# C4 Level 3 — Market Data Service Components

Internal architecture of the **Market Data Service** (`packages/market-data-service`).

## Diagram

```mermaid
flowchart TB
  subgraph mdSvc["Market Data Service  :4006"]
    routes["Market Data Routes
Fastify / OpenAPI 3
GET /marketdata/rates, /curves, /vol-surface"]
    rateAdapter["MockRateAdapter
Infrastructure Adapter
CI/test: synthetic rates
Prod: replaced by Bloomberg/LSEG adapter"]
    bloombergAdp["BloombergAdapter
Infrastructure Adapter (Prod)
B-PIPE subscription · FX spots · deposit rates"]
    lsegAdp["LSEGAdapter
Infrastructure Adapter (Prod)
RMDS subscription · Vol surfaces · OIS curves"]
    curveBuilder["YieldCurveBuilder
Domain Service
Bootstraps OIS/IBOR curves · Nelson-Siegel-Svensson"]
    volSurface["VolatilitySurface
Domain Service
FX implied vol surface · SABR model"]
    ratePub["RatePublisher
Kafka Producer
nexus.marketdata.rates · target < 10ms"]
    curvePub["CurvePublisher
Kafka Producer
nexus.marketdata.curves · every 5 min"]
    rateCache["RateCache
Infrastructure — Redis
nexus:rate:{pair} TTL 5s"]
  end

  subgraph external["External"]
    bloomberg[("Bloomberg B-PIPE")]
    lseg[("LSEG Refinitiv")]
    kafka[("Apache Kafka")]
    redis[("Redis Cluster")]
    tradeSvc[("Trade Service")]
    riskSvc[("Risk Service")]
    almSvc[("ALM Service")]
  end

  bloomberg   -->|"B-PIPE subscription feed (TCP/TLS)"| bloombergAdp
  lseg        -->|"RMDS subscription feed (TCP/TLS)"| lsegAdp
  bloombergAdp -->|"raw rates"| curveBuilder
  lsegAdp     -->|"vol quotes"| volSurface
  bloombergAdp -->|"tick data"| ratePub
  lsegAdp     -->|"curve data"| curvePub
  rateAdapter -->|"synthetic tick (CI/dev)"| ratePub
  ratePub     -->|"nexus.marketdata.rates"| kafka
  ratePub     -->|"SET nexus:rate:{pair} EX 5"| rateCache
  curveBuilder -->|"rebuilt curve"| curvePub
  curvePub    -->|"nexus.marketdata.curves"| kafka
  rateCache   -->|"GET/SET"| redis
  tradeSvc    -->|"GET nexus:rate:{pair}"| redis
  kafka       -->|"nexus.marketdata.rates (VaR RF)"| riskSvc
  kafka       -->|"nexus.marketdata.curves (IRRBB)"| almSvc
  routes      -->|"GET /marketdata/rates"| rateAdapter
  routes      -->|"GET /marketdata/curves"| curveBuilder
  routes      -->|"GET /marketdata/vol-surface"| volSurface
```

## Rate Cache Strategy

| Key Pattern           | Value                                                 | TTL  | Consumer      |
| --------------------- | ----------------------------------------------------- | ---- | ------------- |
| `nexus:rate:USDEUR`   | `{"bid":1.0840,"ask":1.0845,"mid":1.0842,"ts":"..."}` | 5s   | Trade Service |
| `nexus:rate:USDGHS`   | `{"bid":14.80,"ask":14.82,"mid":14.81,"ts":"..."}`    | 5s   | Trade Service |
| `nexus:curve:USD-OIS` | `{"pillars":[0.25,0.5,1,2,5,10],"rates":[...]}`       | 300s | Risk/ALM      |
| `nexus:vol:EURUSD`    | `{"surface":[[delta,tenor,vol],...]}`                 | 300s | Risk (XVA)    |

## Data Flow Timing

```mermaid
sequenceDiagram
  participant Bloomberg
  participant Adapter as BloombergAdapter
  participant Publisher as RatePublisher
  participant Redis
  participant Kafka
  participant TradeSvc as Trade Service
  participant RiskSvc as Risk Service

  Bloomberg->>Adapter: FX tick USDEUR 1.0842 (T=0ms)
  Adapter->>Publisher: onTick(pair, bid, ask)
  Publisher->>Redis: SET nexus:rate:USDEUR ... EX 5 (T=2ms)
  Publisher->>Kafka: nexus.marketdata.rates (T=3ms)
  Note right of Redis: Trade pre-deal checks use Redis\n< 5ms total latency
  Kafka->>RiskSvc: RateTickEvent (T=8ms)
  Note right of RiskSvc: VaR risk factor updated\n< 15ms from tick
```
