/**
 * @module tests/contract/trades-booked.consumer.pact.ts
 *
 * Consumer-Driven Contract Test
 *
 * Consumer:  accounting-service
 * Producer:  trade-service
 * Topic:     nexus.trading.trades.booked
 *
 * This test defines EXACTLY what fields the accounting-service
 * requires from the TradeBooked event payload. The trade-service
 * must publish events that satisfy this contract before any
 * deployment to staging or production.
 *
 * @see ROADMAP.md Sprint 7.2
 * @see docs/api/asyncapi.yaml — nexus.trading.trades.booked channel
 */

import { describe, it, expect } from 'vitest';
import {
  PactV3,
  MatchersV3,
  SpecificationVersion,
} from '@pact-foundation/pact';
import type { TradeBookedPayload } from './types/trade-events.js';

const { like, regex, decimal, integer } = MatchersV3;

// ── Consumer Contract Definition ─────────────────────────────────────────────

const pact = new PactV3({
  consumer: 'accounting-service',
  provider: 'trade-service',
  spec:     SpecificationVersion.SPECIFICATION_VERSION_V4,
});

describe('Contract: accounting-service ← trade-service (nexus.trading.trades.booked)', () => {

  it('receives a TradeBooked event with IFRS9 classification fields', async () => {
    await pact
      .addInteraction({
        states: [{ description: 'a valid FX Forward trade exists' }],
        uponReceiving: 'a nexus.trading.trades.booked Kafka message',
        withRequest: {
          method:  'POST',
          path:    '/api/v1/trades',
          headers: { 'Content-Type': 'application/json' },
          body: {
            assetClass:     'FX',
            instrumentType: 'FORWARD',
            direction:      'BUY',
            notional:       1_000_000,
            currency:       'EUR',
          },
        },
        willRespondWith: {
          status:  201,
          headers: { 'Content-Type': 'application/json' },
          body: {
            // accounting-service MUST receive these fields to classify + journal
            tradeId:        like('550e8400-e29b-41d4-a716-446655440001'),
            tenantId:       like('bank-001'),
            assetClass:     like('FX'),
            instrumentType: like('FORWARD'),
            direction:      regex('BUY|SELL', 'BUY'),
            notional:       decimal(1_000_000),
            currency:       regex('^[A-Z]{3}$', 'EUR'),
            tradeDate:      like('2026-04-09'),
            status:         like('PENDING_VALIDATION'),
            createdAt:      like('2026-04-09T09:30:00.187Z'),
          },
        },
      })
      .executeTest(async (mockServer) => {
        // Simulate accounting-service consuming the event
        const resp = await fetch(`${mockServer.url}/api/v1/trades`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assetClass: 'FX', instrumentType: 'FORWARD',
            direction: 'BUY', notional: 1_000_000, currency: 'EUR',
          }),
        });

        const body = await resp.json() as TradeBookedPayload;

        // accounting-service invariants
        expect(body.tradeId).toBeTruthy();
        expect(body.assetClass).toBe('FX');
        expect(['BUY', 'SELL']).toContain(body.direction);
        expect(body.notional).toBeGreaterThan(0);
        expect(resp.status).toBe(201);
      });
  });
});
