/**
 * @file sukuk-pricer.test.ts
 * @description Sprint 9.1 + 9.2 — Sukuk pricing + Murabaha lifecycle tests.
 */
import { describe, it, expect } from 'vitest';
import { SukukPricer, SukukGrade } from './sukuk-pricer.js';
import { MurabahaLifecycleEngine, MurabahaCommodity, MurabahaRepayment } from './murabaha-lifecycle.js';

const IJARA_BASE = {
  sukukType: 'IJARA' as const,
  faceValue: 1_000_000,
  rentalRate: 0.05,
  frequency: 2,
  tenorYears: 5,
  discountRate: 0.04,
  currency: 'USD',
  grade: SukukGrade.INVESTMENT_GRADE,
};

const MURABAHA_BASE = {
  sukukType: 'MURABAHA' as const,
  faceValue: 1_000_000,
  ribhRate: 0.055,
  tenorYears: 3,
  discountRate: 0.04,
  currency: 'USD',
  grade: SukukGrade.INVESTMENT_GRADE,
};

// ── Ijara Sukuk ───────────────────────────────────────────────────────────────
describe('SukukPricer — Ijara (lease-based)', () => {
  const pricer = new SukukPricer();

  it('premium Ijara: dirtyPrice > faceValue when rental > discount', () => {
    const r = pricer.price(IJARA_BASE);
    expect(r.dirtyPrice).toBeGreaterThan(1_000_000);
  });

  it('discount Ijara: dirtyPrice < faceValue when rental < discount', () => {
    const r = pricer.price({ ...IJARA_BASE, rentalRate: 0.03, discountRate: 0.06 });
    expect(r.dirtyPrice).toBeLessThan(1_000_000);
  });

  it('profit rate round-trip: price at solved yield ≈ original dirty price', () => {
    const r = pricer.price(IJARA_BASE);
    // Solving back: if we discount at the solved profit rate, we recover the original price
    const check = pricer.price({ ...IJARA_BASE, discountRate: r.profitRate });
    expect(Math.abs(check.dirtyPrice - r.dirtyPrice)).toBeLessThan(1);
  });

  it('DV01 > 0', () => {
    expect(pricer.price(IJARA_BASE).dv01).toBeGreaterThan(0);
  });

  it('modified duration > 0', () => {
    expect(pricer.price(IJARA_BASE).modifiedDuration).toBeGreaterThan(0);
  });

  it('longer tenor → higher duration', () => {
    const s5  = pricer.price(IJARA_BASE);
    const s10 = pricer.price({ ...IJARA_BASE, tenorYears: 10 });
    expect(s10.modifiedDuration).toBeGreaterThan(s5.modifiedDuration);
  });

  it('investment-grade risk weight = 20%', () => {
    expect(pricer.price(IJARA_BASE).riskWeightPct).toBe(20);
  });

  it('sub-investment risk weight = 150%', () => {
    const r = pricer.price({ ...IJARA_BASE, grade: SukukGrade.SUB_INVESTMENT });
    expect(r.riskWeightPct).toBe(150);
  });

  it('capital charge = price × riskWeight × 8%', () => {
    const r = pricer.price(IJARA_BASE);
    const expected = r.dirtyPrice * 0.20 * 0.08;
    expect(Math.abs(r.reguCapitalCharge - expected)).toBeLessThan(1);
  });

  it('AAOIFI standard is set', () => {
    expect(pricer.price(IJARA_BASE).aaoifiStandard).toContain('AAOIFI');
  });

  it('sharia note mentions ujrah not riba', () => {
    expect(pricer.price(IJARA_BASE).shariaNote.toLowerCase()).toContain('ujrah');
  });
});

// ── Murabaha Sukuk ────────────────────────────────────────────────────────────
describe('SukukPricer — Murabaha (cost-plus-profit)', () => {
  const pricer = new SukukPricer();

  it('dirtyPrice > 0', () => {
    expect(pricer.price(MURABAHA_BASE).dirtyPrice).toBeGreaterThan(0);
  });

  it('profit rate > discount rate (risk premium)', () => {
    const r = pricer.price(MURABAHA_BASE);
    expect(r.profitRate).toBeGreaterThan(MURABAHA_BASE.discountRate);
  });

  it('AAOIFI Standard 17 referenced', () => {
    expect(pricer.price(MURABAHA_BASE).aaoifiStandard).toContain('17');
  });

  it('sharia note mentions no compounding', () => {
    expect(pricer.price(MURABAHA_BASE).shariaNote.toLowerCase()).toContain('no compounding');
  });
});

// ── Murabaha Lifecycle Engine ─────────────────────────────────────────────────
describe('MurabahaLifecycleEngine — Sprint 9.2', () => {
  const engine = new MurabahaLifecycleEngine();

  const BASE_TX = {
    customerId:    'cust-001',
    commodity:     MurabahaCommodity.LME_COPPER,
    costPrice:     500_000,
    currency:      'USD',
    profitAmount:  27_500,  // 5.5% pa over 1 year
    tenorDays:     365,
    repaymentType: MurabahaRepayment.BULLET,
    isTawarruq:    false,
    valueDate:     '2026-04-09',
  };

  it('sale price = cost + profit', () => {
    const r = engine.create(BASE_TX);
    expect(r.salePrice).toBeCloseTo(527_500, 0);
  });

  it('bullet schedule has exactly 1 payment', () => {
    const r = engine.create(BASE_TX);
    expect(r.schedule).toHaveLength(1);
    expect(r.schedule[0].totalPayment).toBeCloseTo(527_500, 0);
  });

  it('instalment schedule has correct number of payments', () => {
    const r = engine.create({ ...BASE_TX, repaymentType: MurabahaRepayment.INSTALMENT, numInstalments: 4 });
    expect(r.schedule).toHaveLength(4);
  });

  it('all instalment payments sum to sale price', () => {
    const r = engine.create({ ...BASE_TX, repaymentType: MurabahaRepayment.INSTALMENT, numInstalments: 4 });
    const total = r.schedule.reduce((s, c) => s + c.totalPayment, 0);
    expect(Math.abs(total - r.salePrice)).toBeLessThan(1);
  });

  it('outstanding principal reaches 0 after last instalment', () => {
    const r = engine.create({ ...BASE_TX, repaymentType: MurabahaRepayment.INSTALMENT, numInstalments: 4 });
    expect(r.schedule[r.schedule.length - 1].outstandingPrincipal).toBe(0);
  });

  it('Tawarruq: customer receives cash ≈ costPrice after broker fee', () => {
    const r = engine.create({ ...BASE_TX, isTawarruq: true });
    expect(r.tawarruqCash).toBeDefined();
    expect(r.tawarruqCash!).toBeCloseTo(BASE_TX.costPrice * 0.995, 0);
  });

  it('sharia compliant = true for valid input', () => {
    expect(engine.create(BASE_TX).shariaCompliant).toBe(true);
  });

  it('IFRS9 classification = AMORTISED_COST', () => {
    expect(engine.create(BASE_TX).ifrs9Classification).toBe('AMORTISED_COST');
  });

  it('effective profit rate > 0', () => {
    expect(engine.create(BASE_TX).effectiveProfitRatePct).toBeGreaterThan(0);
  });

  it('reference is unique across transactions', () => {
    const r1 = engine.create(BASE_TX);
    const r2 = engine.create(BASE_TX);
    expect(r1.reference).not.toBe(r2.reference);
  });
});
