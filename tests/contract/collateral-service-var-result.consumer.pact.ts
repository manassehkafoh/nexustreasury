/**
 * @module tests/contract/collateral-service-var-result.consumer.pact.ts
 *
 * Consumer-Driven Contract Test — Sprint 7.2
 *
 * Consumer:  collateral-service
 * Provider:  risk-service
 * Topic:     nexus.risk.var-result
 *
 * The collateral-service consumes VaR results to determine margin requirements
 * under ISDA CSA agreements. This contract defines the minimum fields required
 * for margin call calculation.
 *
 * @see ROADMAP.md Sprint 7.2
 * @see docs/api/asyncapi.yaml — nexus.risk.var-result channel
 */

import { describe, it, expect } from 'vitest';
import {
  PactV3,
  MatchersV3,
  SpecificationVersion,
} from '@pact-foundation/pact';

const { like, decimal, integer, regex } = MatchersV3;

const pact = new PactV3({
  consumer: 'collateral-service',
  provider: 'risk-service',
  spec:     SpecificationVersion.SPECIFICATION_VERSION_V4,
});

describe('Contract: collateral-service ← risk-service (nexus.risk.var-result)', () => {

  it('receives a VaR result with margin calculation fields', async () => {
    await pact
      .addInteraction({
        states: [{ description: 'a historical VaR has been computed for the fx-prop-desk book' }],
        uponReceiving: 'a VaR result event for margin requirement calculation',
        withRequest: {
          method:  'POST',
          path:    '/api/v1/risk/var/historical',
          headers: { 'Content-Type': 'application/json' },
          body: {
            pnlHistory:  like([
              { date: '2026-01-02', pnl: -82000,  currency: 'USD' },
              { date: '2026-01-03', pnl: -150000, currency: 'USD' },
            ]),
            confidence:  decimal(0.99),
            currency:    regex('USD', '^[A-Z]{3}$'),
          },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            // Fields required by collateral-service for CSA margin calculation
            var1Day:          decimal(150000),
            var10Day:         decimal(474342),   // var1Day × √10
            expectedShortfall: decimal(218500),   // ES ≥ VaR (tail risk measure)
            confidenceLevel:  decimal(0.99),
            currency:         regex('USD', '^[A-Z]{3}$'),
            computedAt:       like('2026-04-09T17:00:00.000Z'),
            portfolioId:      like('fx-prop-desk'),
            method:           regex('HISTORICAL', '^(HISTORICAL|PARAMETRIC|MONTE_CARLO)$'),
          },
        },
      })
      .executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/risk/var/historical`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pnlHistory: [
              { date: '2026-01-02', pnl: -82000,  currency: 'USD' },
              { date: '2026-01-03', pnl: -150000, currency: 'USD' },
            ],
            confidence: 0.99,
            currency:   'USD',
          }),
        });

        expect(response.status).toBe(200);
        const body = await response.json() as Record<string, unknown>;

        // Collateral-service REQUIRES these fields for ISDA CSA margin calculation
        expect(body).toHaveProperty('var1Day');
        expect(body).toHaveProperty('var10Day');
        expect(body).toHaveProperty('expectedShortfall');
        expect(body).toHaveProperty('confidenceLevel');
        expect(body).toHaveProperty('currency');

        // Quantitative invariants the collateral-service depends on
        expect(body.var1Day    as number).toBeGreaterThan(0);
        expect(body.var10Day   as number).toBeGreaterThanOrEqual(body.var1Day as number);
        expect(body.expectedShortfall as number).toBeGreaterThanOrEqual(body.var1Day as number);
        expect(body.confidenceLevel as number).toBeGreaterThan(0.90);
        expect(body.confidenceLevel as number).toBeLessThanOrEqual(1.0);
      });
  });

  it('collateral-service requires var10Day ≥ var1Day (√10 scaling invariant)', async () => {
    await pact
      .addInteraction({
        states: [{ description: 'a stressed VaR has been computed' }],
        uponReceiving: 'a stressed VaR result for scaling invariant check',
        withRequest: {
          method: 'POST',
          path:   '/api/v1/risk/var/historical',
          headers: { 'Content-Type': 'application/json' },
          body: {
            pnlHistory: like([{ date: '2026-01-05', pnl: -250000, currency: 'USD' }]),
            confidence: decimal(0.99),
            currency:   regex('USD', '^[A-Z]{3}$'),
          },
        },
        willRespondWith: {
          status: 200,
          body: {
            var1Day:           decimal(225000),
            var10Day:          decimal(711548),
            expectedShortfall: decimal(310000),
            confidenceLevel:   decimal(0.99),
            currency:          like('USD'),
            stressedVar1Day:   decimal(225000),
            stressedVar10Day:  decimal(711548),
          },
        },
      })
      .executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/risk/var/historical`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pnlHistory: [{ date: '2026-01-05', pnl: -250000, currency: 'USD' }],
            confidence: 0.99,
            currency:   'USD',
          }),
        });
        const body = await response.json() as Record<string, unknown>;
        // The √10 scaling rule: var10Day must be ≥ var1Day
        expect(body.var10Day as number).toBeGreaterThanOrEqual(body.var1Day as number);
      });
  });
});
