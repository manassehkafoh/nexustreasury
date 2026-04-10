/**
 * @module tests/benchmarks/critical-path.bench.ts
 *
 * NexusTreasury — Performance Benchmarks for Critical SLA Paths
 *
 * SLA targets (from PRD NFR section):
 *   Pre-deal check:          P99 < 5ms
 *   Black-Scholes pricing:   P99 < 2ms
 *   Bond pricing (YTM):      P99 < 3ms
 *   IRS pricing (NPV):       P99 < 5ms
 *   VaR (HS 250-day):        P99 < 500ms (full book; 1 position = sub-ms)
 *   IFRS9 classification:    P99 < 1ms
 *   ECL calculation:         P99 < 5ms
 *   Margin call computation: P99 < 1ms
 *
 * Run with:
 *   pnpm --filter @nexustreasury/e2e exec vitest bench
 *
 * @see PRD §NFR — Performance Requirements
 */

import { bench, describe } from 'vitest';
import { Money, BusinessDate } from '@nexustreasury/domain';
import { OptionPricer } from '../../packages/domain/src/pricing/option-pricer.js';
import { BondPricer } from '../../packages/domain/src/pricing/bond-pricer.js';
import { IRSPricer } from '../../packages/domain/src/pricing/irs-pricer.js';
import { FXPricer } from '../../packages/domain/src/pricing/fx-pricer.js';
import { PricingEngine } from '../../packages/domain/src/pricing/pricing-engine.js';
import { IFRS9Classifier } from '../../packages/accounting-service/src/domain/ifrs9-classifier.js';
import { ECLCalculator } from '../../packages/accounting-service/src/application/ecl-calculator.js';
import {
  BusinessModel,
  IFRS9Category,
} from '../../packages/accounting-service/src/domain/value-objects.js';
import {
  MarginCalculator,
  AgreementType,
  CollateralType,
} from '../../packages/collateral-service/src/domain/collateral-agreement.js';
import { AssetClass } from '@nexustreasury/domain';

// ── Pricing Engine Benchmarks ─────────────────────────────────────────────────

describe('Black-Scholes Options Pricing — target P99 < 2ms', () => {
  const pricer = new OptionPricer();
  const atm = {
    spot: 1.0842,
    strike: 1.0842,
    riskFreeRate: 0.045,
    foreignRate: 0.025,
    volatility: 0.12,
    timeToExpiry: 0.25,
    optionType: 'CALL' as const,
  };

  bench('ATM call — Black-Scholes + full Greeks', () => {
    pricer.price(atm);
  });

  bench('Deep ITM call', () => {
    pricer.price({ ...atm, strike: 1.0 });
  });

  bench('Far OTM put', () => {
    pricer.price({ ...atm, strike: 1.25, optionType: 'PUT' as const });
  });
});

describe('Bond Pricing — target P99 < 3ms', () => {
  const pricer = new BondPricer();
  const bond = {
    face: 1_000_000,
    couponRate: 0.045,
    frequency: 2,
    yieldToMaturity: 0.047,
    yearsToMaturity: 5,
  };

  bench('5Y semi-annual bond — price + DV01 + convexity', () => {
    pricer.price(bond);
  });

  bench('30Y bond (deep discount)', () => {
    pricer.price({ ...bond, yearsToMaturity: 30, couponRate: 0.02, yieldToMaturity: 0.04 });
  });

  bench('Zero-coupon bond', () => {
    pricer.price({ ...bond, couponRate: 0, yearsToMaturity: 2 });
  });
});

describe('IRS Pricing — target P99 < 5ms', () => {
  const pricer = new IRSPricer();
  const irs = {
    notional: 10_000_000,
    fixedRate: 0.04,
    floatingSpread: 0,
    tenor: 5,
    frequency: 4,
    discountCurveRates: [0.03, 0.035, 0.04, 0.042, 0.044],
    forwardCurveRates: [0.038, 0.041, 0.043, 0.044, 0.045],
  };

  bench('5Y quarterly IRS — multi-curve NPV', () => {
    pricer.price(irs);
  });

  bench('10Y annual IRS', () => {
    pricer.price({
      ...irs,
      tenor: 10,
      frequency: 1,
      discountCurveRates: [0.03, 0.035, 0.04, 0.042, 0.044, 0.045, 0.046, 0.047, 0.048, 0.049],
      forwardCurveRates: [0.038, 0.041, 0.043, 0.044, 0.045, 0.046, 0.047, 0.048, 0.049, 0.05],
    });
  });
});

describe('FX Forward Pricing — target P99 < 1ms', () => {
  const pricer = new FXPricer();
  const fx = {
    spot: 1.0842,
    domesticRate: 0.045,
    foreignRate: 0.025,
    tenor: 1.0,
  };

  bench('1Y FX Forward — CIP pricing', () => {
    pricer.priceForward(fx);
  });

  bench('3M FX Forward', () => {
    pricer.priceForward({ ...fx, tenor: 0.25 });
  });
});

// ── IFRS9 Classification Benchmarks ──────────────────────────────────────────

describe('IFRS9 Classification — target P99 < 1ms', () => {
  const classifier = new IFRS9Classifier();

  bench('FX Forward → FVPL_MANDATORY', () => {
    classifier.classify({
      assetClass: AssetClass.FX,
      instrumentType: 'FORWARD',
      businessModel: BusinessModel.OTHER,
    });
  });

  bench('Bond HTC → Amortised Cost', () => {
    classifier.classify({
      assetClass: AssetClass.FIXED_INCOME,
      instrumentType: 'BOND',
      businessModel: BusinessModel.HOLD_TO_COLLECT,
    });
  });

  bench('100 classifications (batch simulation)', () => {
    for (let i = 0; i < 100; i++) {
      classifier.classify({
        assetClass: i % 2 === 0 ? AssetClass.FX : AssetClass.FIXED_INCOME,
        instrumentType: i % 2 === 0 ? 'FORWARD' : 'BOND',
        businessModel: i % 2 === 0 ? BusinessModel.OTHER : BusinessModel.HOLD_TO_COLLECT,
      });
    }
  });
});

// ── ECL Benchmarks ────────────────────────────────────────────────────────────

describe('ECL Calculation — target P99 < 5ms', () => {
  const calc = new ECLCalculator();
  const base = {
    instrumentId: 'b1',
    originationDate: new Date('2024-01-01'),
    reportingDate: new Date('2026-04-09'),
    outstandingPrincipal: 10_000_000,
    currency: 'USD',
    accruedInterest: 0,
    originationRating: 'BBB',
    currentRating: 'BBB',
    daysPastDue: 0,
    onWatchList: false,
    effectiveInterestRate: 0.05,
    recoveryRate: 0.4,
  };

  bench('Stage 1 ECL — performing loan', () => {
    calc.calculate(base);
  });

  bench('Stage 3 ECL — defaulted loan', () => {
    calc.calculate({ ...base, currentRating: 'D', daysPastDue: 120, onWatchList: true });
  });

  bench('50 ECL calculations (month-end batch simulation)', () => {
    for (let i = 0; i < 50; i++) {
      calc.calculate({
        ...base,
        instrumentId: `loan-${i}`,
        outstandingPrincipal: 1_000_000 * (i + 1),
        currentRating: i % 10 === 0 ? 'D' : i % 5 === 0 ? 'BB' : 'BBB',
        daysPastDue: i % 10 === 0 ? 90 : 0,
      });
    }
  });
});

// ── Collateral Margin Call Benchmarks ─────────────────────────────────────────

describe('Margin Call Computation — target P99 < 1ms', () => {
  const calc = new MarginCalculator();
  const CSA = {
    id: 'csa-1',
    tenantId: 'bank-001',
    counterpartyId: 'cp-001',
    agreementType: AgreementType.ISDA_CSA,
    threshold: 500_000,
    mta: 50_000,
    independentAmount: 0,
    currency: 'USD',
    eligibilitySchedule: [{ collateralType: CollateralType.CASH, maxHaircut: 0 }],
    active: true,
    createdAt: new Date(),
  };

  bench('Single margin call computation', () => {
    calc.computeMarginCall(CSA, 1_800_000, 200_000, new Date());
  });

  bench('100 margin calls (EOD batch — 100 CSAs)', () => {
    for (let i = 0; i < 100; i++) {
      calc.computeMarginCall(CSA, 500_000 + i * 10_000, i * 1_000, new Date());
    }
  });
});
