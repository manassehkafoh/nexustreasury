/**
 * IFRS9Classifier — TDD test suite
 *
 * Covers all branches of the IFRS 9 §4.1 classification matrix:
 *  - Fixed income: AMC / FVOCI / FVPL by business model
 *  - Derivatives: mandatory FVPL
 *  - Equity: FVOCI designation or mandatory FVPL
 *  - Money market: AMC
 *  - Islamic Finance: AMC for Murabaha/Wakala
 *  - FVO election and tenant override
 *  - SPPI fail → FVPL mandatory
 */

import { describe, it, expect } from 'vitest';
import { AssetClass } from '@nexustreasury/domain';
import { IFRS9Classifier } from './ifrs9-classifier.js';
import { BusinessModel, IFRS9Category } from './value-objects.js';

const classifier = new IFRS9Classifier();

describe('IFRS9Classifier — Fixed Income', () => {
  it('classifies standard bond in HTC BM as Amortised Cost', () => {
    const result = classifier.classify({
      assetClass: AssetClass.FIXED_INCOME,
      instrumentType: 'BOND',
      businessModel: BusinessModel.HOLD_TO_COLLECT,
    });
    expect(result.category).toBe(IFRS9Category.AMORTISED_COST);
    expect(result.sppiPass).toBe(true);
    expect(result.assetAccountCode).toBe('1300');
  });

  it('classifies bond in HTC+Sell BM as FVOCI', () => {
    const result = classifier.classify({
      assetClass: AssetClass.FIXED_INCOME,
      instrumentType: 'BOND',
      businessModel: BusinessModel.HOLD_TO_COLLECT_AND_SELL,
    });
    expect(result.category).toBe(IFRS9Category.FVOCI);
    expect(result.assetAccountCode).toBe('1310');
  });

  it('classifies bond in Other BM (trading) as FVPL_MANDATORY', () => {
    const result = classifier.classify({
      assetClass: AssetClass.FIXED_INCOME,
      instrumentType: 'BOND',
      businessModel: BusinessModel.OTHER,
    });
    expect(result.category).toBe(IFRS9Category.FVPL_MANDATORY);
    expect(result.assetAccountCode).toBe('1320');
  });

  it('classifies structured note as FVPL_MANDATORY (SPPI fail)', () => {
    const result = classifier.classify({
      assetClass: AssetClass.FIXED_INCOME,
      instrumentType: 'STRUCTURED',
      businessModel: BusinessModel.HOLD_TO_COLLECT,
    });
    expect(result.category).toBe(IFRS9Category.FVPL_MANDATORY);
    expect(result.sppiPass).toBe(false);
    expect(result.rationale).toContain('SPPI test failed');
  });

  it('classifies T-Bill as AMC in HTC model', () => {
    const result = classifier.classify({
      assetClass: AssetClass.FIXED_INCOME,
      instrumentType: 'T_BILL',
      businessModel: BusinessModel.HOLD_TO_COLLECT,
    });
    expect(result.category).toBe(IFRS9Category.AMORTISED_COST);
  });
});

describe('IFRS9Classifier — Derivatives', () => {
  it('classifies IRS as FVPL_MANDATORY', () => {
    const result = classifier.classify({
      assetClass: AssetClass.INTEREST_RATE_DERIVATIVE,
      instrumentType: 'IRS',
      businessModel: BusinessModel.HOLD_TO_COLLECT,
    });
    expect(result.category).toBe(IFRS9Category.FVPL_MANDATORY);
    expect(result.sppiPass).toBe(false);
    expect(result.rationale).toContain('Derivative');
  });

  it('classifies FX Option as FVPL_MANDATORY', () => {
    const result = classifier.classify({
      assetClass: AssetClass.FX,
      instrumentType: 'OPTION',
      businessModel: BusinessModel.OTHER,
    });
    expect(result.category).toBe(IFRS9Category.FVPL_MANDATORY);
  });

  it('classifies FX Forward as FVPL (non-SPPI — rate contingent)', () => {
    const result = classifier.classify({
      assetClass: AssetClass.FX,
      instrumentType: 'FORWARD',
      businessModel: BusinessModel.OTHER,
    });
    expect(result.category).toBe(IFRS9Category.FVPL_MANDATORY);
  });
});

describe('IFRS9Classifier — Equity', () => {
  it('classifies equity stock without designation as FVPL_MANDATORY', () => {
    const result = classifier.classify({
      assetClass: AssetClass.EQUITY,
      instrumentType: 'STOCK',
      businessModel: BusinessModel.OTHER,
    });
    expect(result.category).toBe(IFRS9Category.FVPL_MANDATORY);
  });

  it('classifies equity with FVOCI designation as FVOCI_EQUITY', () => {
    const result = classifier.classify({
      assetClass: AssetClass.EQUITY,
      instrumentType: 'STOCK',
      businessModel: BusinessModel.OTHER,
      equityFVOCIDesignation: true,
    });
    expect(result.category).toBe(IFRS9Category.FVOCI_EQUITY);
    expect(result.rationale).toContain('§4.1.4');
  });
});

describe('IFRS9Classifier — Money Market', () => {
  it('classifies MM deposit as AMC in HTC model', () => {
    const result = classifier.classify({
      assetClass: AssetClass.MONEY_MARKET,
      instrumentType: 'DEPOSIT',
      businessModel: BusinessModel.HOLD_TO_COLLECT,
    });
    expect(result.category).toBe(IFRS9Category.AMORTISED_COST);
    expect(result.sppiPass).toBe(true);
  });
});

describe('IFRS9Classifier — Overrides', () => {
  it('applies tenant override with highest priority', () => {
    const result = classifier.classify({
      assetClass: AssetClass.FIXED_INCOME,
      instrumentType: 'BOND',
      businessModel: BusinessModel.HOLD_TO_COLLECT,
      tenantOverride: IFRS9Category.FVPL,
    });
    expect(result.category).toBe(IFRS9Category.FVPL);
    expect(result.rationale).toContain('Tenant configuration override');
  });

  it('applies FVO election over business model', () => {
    const result = classifier.classify({
      assetClass: AssetClass.FIXED_INCOME,
      instrumentType: 'BOND',
      businessModel: BusinessModel.HOLD_TO_COLLECT,
      fvoElected: true,
    });
    expect(result.category).toBe(IFRS9Category.FVPL);
    expect(result.rationale).toContain('Fair Value Option');
  });
});

describe('IFRS9Classifier — Islamic Finance', () => {
  it('classifies Murabaha as AMC (SPPI-like cash flows)', () => {
    const result = classifier.classify({
      assetClass: AssetClass.ISLAMIC_FINANCE,
      instrumentType: 'MURABAHA',
      businessModel: BusinessModel.HOLD_TO_COLLECT,
    });
    expect(result.category).toBe(IFRS9Category.AMORTISED_COST);
    expect(result.sppiPass).toBe(true);
  });
});
