/**
 * @module tests/contract/limit-breach.consumer.pact.ts
 *
 * Consumer-Driven Contract Test
 *
 * Consumer:  notification-service
 * Producer:  risk-service
 * Topic:     nexus.risk.limit-breach
 *
 * The notification-service requires specific fields to route
 * CRITICAL alerts to the correct channels. This contract
 * prevents the risk-service from removing fields without
 * notification-service's awareness.
 */

import { describe, it, expect } from 'vitest';
import { PactV3, MatchersV3, SpecificationVersion } from '@pact-foundation/pact';

const { like, regex, decimal } = MatchersV3;

const pact = new PactV3({
  consumer: 'notification-service',
  provider: 'risk-service',
  spec:     SpecificationVersion.SPECIFICATION_VERSION_V4,
});

describe('Contract: notification-service ← risk-service (nexus.risk.limit-breach)', () => {

  it('receives a LimitBreach event with routing fields', async () => {
    await pact
      .addInteraction({
        states: [{ description: 'a counterparty credit limit has been breached' }],
        uponReceiving: 'a nexus.risk.limit-breach event',
        withRequest: {
          method: 'POST',
          path:   '/api/v1/risk/limits/breach',
          headers: { 'Content-Type': 'application/json' },
          body: {
            limitId:         like('lim-cp-3fa85f64'),
            counterpartyId:  like('3fa85f64-5717-4562-b3fc-2c963f66afa6'),
            utilisationPct:  decimal(102.4),
          },
        },
        willRespondWith: {
          status: 201,
          body: {
            // notification-service requires these fields for alert routing:
            eventId:        like('evt-001'),
            tenantId:       like('bank-001'),
            limitId:        like('lim-cp-3fa85f64'),
            limitType:      regex('CREDIT|MARKET|CONCENTRATION', 'CREDIT'),
            counterpartyId: like('3fa85f64-5717-4562-b3fc-2c963f66afa6'),
            utilisationPct: decimal(102.4),
            currency:       regex('^[A-Z]{3}$', 'USD'),
            breachedAt:     like('2026-04-09T09:30:00.000Z'),
          },
        },
      })
      .executeTest(async (mockServer) => {
        const resp = await fetch(`${mockServer.url}/api/v1/risk/limits/breach`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            limitId: 'lim-cp-3fa85f64',
            counterpartyId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            utilisationPct: 102.4,
          }),
        });

        const body = await resp.json() as Record<string, unknown>;

        // notification-service routing invariants
        expect(body['eventId']).toBeTruthy();
        expect(body['tenantId']).toBeTruthy();
        expect(['CREDIT', 'MARKET', 'CONCENTRATION']).toContain(body['limitType']);
        expect(resp.status).toBe(201);
      });
  });
});
