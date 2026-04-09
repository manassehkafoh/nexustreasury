/**
 * @module tests/contract/position-service-trades-booked.consumer.pact.ts
 *
 * Consumer-Driven Contract Test — Sprint 7.2
 *
 * Consumer:  position-service
 * Producer:  trade-service
 * Topic:     nexus.trading.trades.booked
 *
 * The position-service consumes TradeBooked events to update real-time
 * position aggregates. This contract defines the minimum fields required
 * for accurate position calculation.
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

const { like, regex, decimal } = MatchersV3;

const pact = new PactV3({
  consumer: 'position-service',
  provider: 'trade-service',
  spec:     SpecificationVersion.SPECIFICATION_VERSION_V4,
});

describe('Contract: position-service ← trade-service (nexus.trading.trades.booked)', () => {

  it('receives a TradeBooked event with position calculation fields', async () => {
    await pact
      .addInteraction({
        states: [{ description: 'a valid FX Forward trade has been booked' }],
        uponReceiving: 'a TradeBooked event for position aggregation',
        withRequest: {
          method:  'POST',
          path:    '/api/v1/trades',
          headers: { 'Content-Type': 'application/json' },
          body: {
            assetClass:     'FX',
            instrumentType: 'FORWARD',
            direction:      'BUY',
            notional:       decimal(1_000_000),
            currency:       regex('EUR', '^[A-Z]{3}$'),
            counterpartyCurrency: regex('USD', '^[A-Z]{3}$'),
            price:          decimal(1.0842),
            bookId:         like('fx-prop-desk'),
            traderId:       like('trader-alex-01'),
            valueDate:      regex('2026-04-11', '^\\d{4}-\\d{2}-\\d{2}$'),
          },
        },
        willRespondWith: {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: {
            tradeId:      regex('550e8400-e29b-41d4-a716-446655440001',
                            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
            reference:    regex('FX-20260409-A1B2C3', '^FX-\\d{8}-[A-Z0-9]{6}$'),
            assetClass:   like('FX'),
            instrumentType: like('FORWARD'),
            direction:    like('BUY'),
            notional:     decimal(1_000_000),
            currency:     regex('EUR', '^[A-Z]{3}$'),
            counterpartyCurrency: regex('USD', '^[A-Z]{3}$'),
            price:        decimal(1.0842),
            bookId:       like('fx-prop-desk'),
            traderId:     like('trader-alex-01'),
            valueDate:    regex('2026-04-11', '^\\d{4}-\\d{2}-\\d{2}$'),
            tradeDate:    regex('2026-04-09', '^\\d{4}-\\d{2}-\\d{2}$'),
            status:       regex('PENDING_VALIDATION', '^(PENDING_VALIDATION|CONFIRMED|CANCELLED)$'),
          },
        },
      })
      .executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/trades`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assetClass:          'FX',
            instrumentType:      'FORWARD',
            direction:           'BUY',
            notional:            1_000_000,
            currency:            'EUR',
            counterpartyCurrency: 'USD',
            price:               1.0842,
            bookId:              'fx-prop-desk',
            traderId:            'trader-alex-01',
            valueDate:           '2026-04-11',
          }),
        });

        expect(response.status).toBe(201);
        const body = await response.json() as Record<string, unknown>;

        // Fields required by position-service for position calculation
        expect(body).toHaveProperty('tradeId');
        expect(body).toHaveProperty('reference');
        expect(body).toHaveProperty('assetClass',   'FX');
        expect(body).toHaveProperty('direction',    'BUY');
        expect(body).toHaveProperty('notional',     1_000_000);
        expect(body).toHaveProperty('currency',     'EUR');
        expect(body).toHaveProperty('bookId',       'fx-prop-desk');
        expect(body).toHaveProperty('valueDate');
        expect(body).toHaveProperty('status');
      });
  });

  it('position-service requires tradeId to be a valid UUID v4', async () => {
    await pact
      .addInteraction({
        states: [{ description: 'a second FX trade has been booked' }],
        uponReceiving: 'a TradeBooked event — UUID format validation',
        withRequest: {
          method: 'POST',
          path:   '/api/v1/trades',
          headers: { 'Content-Type': 'application/json' },
          body: { assetClass: 'FX', instrumentType: 'SPOT', direction: 'SELL',
                  notional: 500_000, currency: 'GBP', counterpartyCurrency: 'USD',
                  price: 1.2654, bookId: 'fx-prop-desk', traderId: 't-1',
                  valueDate: '2026-04-09' },
        },
        willRespondWith: {
          status: 201,
          body: {
            tradeId: regex(
              '550e8400-e29b-41d4-a716-446655440099',
              '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
            ),
            reference: like('FX-20260409-B1C2D3'),
            status:    like('PENDING_VALIDATION'),
          },
        },
      })
      .executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/trades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetClass: 'FX', instrumentType: 'SPOT',
            direction: 'SELL', notional: 500_000, currency: 'GBP',
            counterpartyCurrency: 'USD', price: 1.2654,
            bookId: 'fx-prop-desk', traderId: 't-1', valueDate: '2026-04-09' }),
        });
        expect(response.status).toBe(201);
        const body = await response.json() as Record<string, unknown>;
        expect(typeof body.tradeId).toBe('string');
        expect(body.tradeId as string).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      });
  });
});
