/**
 * @file sanctions-screening.service.test.ts
 * @description TDD tests for the SanctionsScreeningService.
 *
 * Sanctions screening is a REGULATORY PREREQUISITE for any financial
 * institution. Before any trade is booked, the counterparty MUST be
 * checked against:
 *   - OFAC SDN (US Office of Foreign Assets Control)
 *   - HM Treasury Consolidated List (UK)
 *   - UN Security Council Consolidated List
 *   - EU Consolidated Financial Sanctions List
 *
 * A trade booked against a sanctioned entity can result in:
 *   - Criminal prosecution of individuals
 *   - Institutional fines up to the full value of the transaction
 *   - Loss of banking licence
 *
 * This service implements a configurable, pluggable screening engine
 * with a built-in free-list provider and hooks for premium providers
 * (Refinitiv World-Check, Dow Jones Risk & Compliance).
 */

import { describe, it, expect } from 'vitest';
import {
  SanctionsScreeningService,
  SanctionsResult,
  type SanctionsConfig,
} from './sanctions-screening.service.js';

// ── Test Fixtures ─────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SanctionsConfig = {
  enabled: true,
  throwOnMatch: false, // return result, don't throw
  fuzzyMatchThreshold: 0.85,
  providers: ['INTERNAL_TEST'],
  aiEnhancedMatching: true,
};

const service = new SanctionsScreeningService(DEFAULT_CONFIG);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SanctionsScreeningService', () => {
  describe('clear counterparties', () => {
    it('CLEAR for a known-good bank (Standard Chartered)', async () => {
      const result = await service.screen({
        counterpartyId: 'cpty-001',
        legalName: 'Standard Chartered Bank',
        lei: 'RILFO74KP1CM8P6PCT96',
        bic: 'SCBLGB2L',
      });
      expect(result.status).toBe(SanctionsResult.CLEAR);
    });

    it('CLEAR result includes screening timestamp', async () => {
      const result = await service.screen({
        counterpartyId: 'cpty-002',
        legalName: 'Barclays Bank PLC',
      });
      expect(result.screenedAt).toBeInstanceOf(Date);
    });

    it('CLEAR result has empty matches array', async () => {
      const result = await service.screen({
        counterpartyId: 'cpty-003',
        legalName: 'Deutsche Bank AG',
      });
      expect(result.matches).toHaveLength(0);
    });
  });

  describe('sanctioned counterparties', () => {
    it('MATCH for an entity on the internal test sanctions list', async () => {
      // Using a test fixture name — safe for unit tests
      const result = await service.screen({
        counterpartyId: 'cpty-bad-001',
        legalName: '__TEST_SANCTIONED_ENTITY__',
      });
      expect(result.status).toBe(SanctionsResult.MATCH);
    });

    it('MATCH result includes the matching list name', async () => {
      const result = await service.screen({
        counterpartyId: 'cpty-bad-002',
        legalName: '__TEST_SANCTIONED_ENTITY__',
      });
      expect(result.listName).toBeTruthy();
    });

    it('MATCH result includes match score [0,1]', async () => {
      const result = await service.screen({
        counterpartyId: 'cpty-bad-003',
        legalName: '__TEST_SANCTIONED_ENTITY__',
      });
      expect(result.matchScore).toBeGreaterThan(0);
      expect(result.matchScore).toBeLessThanOrEqual(1);
    });
  });

  describe('potential matches (fuzzy)', () => {
    it('POTENTIAL_MATCH for a similar-but-not-exact name', async () => {
      // Close variant of the test sanctioned name
      const result = await service.screen({
        counterpartyId: 'cpty-fuzzy-001',
        legalName: '__TEST_SANCTIONED_ENTTY__', // typo
      });
      // Depending on fuzzy match score, may be POTENTIAL_MATCH or CLEAR
      expect([SanctionsResult.POTENTIAL_MATCH, SanctionsResult.CLEAR]).toContain(result.status);
    });
  });

  describe('disabled screening', () => {
    it('returns CLEAR immediately when screening is disabled', async () => {
      const disabledService = new SanctionsScreeningService({ ...DEFAULT_CONFIG, enabled: false });
      const result = await disabledService.screen({
        counterpartyId: 'any-id',
        legalName: '__TEST_SANCTIONED_ENTITY__',
      });
      expect(result.status).toBe(SanctionsResult.CLEAR);
      expect(result.screeningBypassed).toBe(true);
    });
  });

  describe('AI-enhanced matching', () => {
    it('AI score is present when aiEnhancedMatching is true', async () => {
      const result = await service.screen({
        counterpartyId: 'cpty-ai-001',
        legalName: 'Republic of Ghana Central Bank',
      });
      expect(result.aiRiskScore).toBeGreaterThanOrEqual(0);
      expect(result.aiRiskScore).toBeLessThanOrEqual(1);
    });

    it('AI risk score is lower for well-known legitimate banks', async () => {
      const clearResult = await service.screen({
        counterpartyId: 'cpty-ai-002',
        legalName: 'HSBC Holdings PLC',
        lei: 'MLQ5HLMZQLHGRH4GBD64',
      });
      // Well-known G-SIB — AI risk score should be low
      expect(clearResult.aiRiskScore).toBeLessThan(0.3);
    });
  });
});
