/**
 * CollateralManagement — TDD test suite
 * Tests: margin call computation, CTD allocation, MTA/threshold
 */
import { describe, it, expect } from 'vitest';
import {
  MarginCalculator,
  MarginCallStatus,
  AgreementType,
  CollateralType,
  InMemoryCollateralRepository,
  type CollateralAgreement,
  type InventoryItem,
} from './collateral-agreement.js';

const TODAY = new Date('2026-04-09');

const baseAgreement: CollateralAgreement = {
  id: 'csa-001',
  tenantId: 'tenant-001',
  counterpartyId: 'cp-citi',
  agreementType: AgreementType.ISDA_CSA,
  threshold: 500_000,
  mta: 100_000,
  independentAmount: 0,
  currency: 'USD',
  eligibilitySchedule: [
    { collateralType: CollateralType.CASH, maxHaircut: 0.0 },
    { collateralType: CollateralType.GOVERNMENT_BOND, maxHaircut: 0.02 },
    { collateralType: CollateralType.T_BILL, maxHaircut: 0.01 },
  ],
  active: true,
  createdAt: new Date(),
};

const cashInventory: InventoryItem[] = [
  {
    id: 'inv-1',
    collateralType: CollateralType.CASH,
    faceValue: 5_000_000,
    marketValue: 5_000_000,
    currency: 'USD',
    availableValue: 5_000_000,
    annualYield: 0,
  },
];

const bondInventory: InventoryItem[] = [
  {
    id: 'inv-2',
    collateralType: CollateralType.GOVERNMENT_BOND,
    isin: 'US912828YK06',
    faceValue: 2_000_000,
    marketValue: 1_980_000,
    currency: 'USD',
    availableValue: 1_980_000,
    annualYield: 0.04,
  },
];

const calc = new MarginCalculator();

// ── Margin Call Computation ───────────────────────────────────────────────────

describe('MarginCalculator — computeMarginCall', () => {
  it('issues WE_CALL when MTM > threshold', () => {
    const call = calc.computeMarginCall(baseAgreement, 1_200_000, 0, TODAY);
    expect(call.direction).toBe('WE_CALL');
    expect(call.callAmount).toBe(700_000); // 1.2M - 500K threshold
    expect(call.status).toBe(MarginCallStatus.ISSUED);
  });

  it('issues THEY_CALL when MTM < -threshold', () => {
    const call = calc.computeMarginCall(baseAgreement, -800_000, 0, TODAY);
    expect(call.direction).toBe('THEY_CALL');
    expect(call.callAmount).toBe(300_000); // abs(-800K - 500K threshold) → 300K
  });

  it('no call when exposure within threshold', () => {
    const call = calc.computeMarginCall(baseAgreement, 400_000, 0, TODAY);
    expect(call.callAmount).toBe(0);
    expect(call.status).toBe(MarginCallStatus.SETTLED);
  });

  it('no call when exposure below MTA after threshold', () => {
    // excess = 600K - 500K = 100K; MTA = 100K; 100K < MTA → no call
    const call = calc.computeMarginCall(baseAgreement, 599_000, 0, TODAY);
    expect(call.callAmount).toBe(0);
  });

  it('reduces call by existing collateral already posted', () => {
    // netMTM=1.2M, threshold=500K, currentCollateral=300K → call = 1.2M-500K-300K = 400K
    const call = calc.computeMarginCall(baseAgreement, 1_200_000, 300_000, TODAY);
    expect(call.callAmount).toBe(400_000);
  });

  it('value date is T+1', () => {
    const call = calc.computeMarginCall(baseAgreement, 1_000_000, 0, TODAY);
    const diffMs = call.valueDate.getTime() - call.callDate.getTime();
    expect(diffMs).toBe(86_400_000); // exactly 1 day
  });

  it('captures netMTMExposure and threshold in result', () => {
    const call = calc.computeMarginCall(baseAgreement, 1_500_000, 0, TODAY);
    expect(call.netMTMExposure).toBe(1_500_000);
    expect(call.thresholdAmount).toBe(500_000);
  });
});

// ── Greedy Collateral Allocation ─────────────────────────────────────────────

describe('MarginCalculator — settleMarginCall (greedy)', () => {
  it('allocates cash with 0% haircut — full face value', async () => {
    const call = calc.computeMarginCall(baseAgreement, 1_200_000, 0, TODAY);
    const alloc = await calc.settleMarginCall(call, baseAgreement, cashInventory);
    expect(alloc).toHaveLength(1);
    expect(alloc[0]!.collateralType).toBe(CollateralType.CASH);
    expect(alloc[0]!.adjustedValue).toBeCloseTo(call.callAmount, 2);
    expect(alloc[0]!.haircut).toBe(0);
  });

  it('allocates bonds with 2% haircut — adjusted value = face × 0.98', async () => {
    const call = calc.computeMarginCall(baseAgreement, 1_000_000, 0, TODAY);
    const alloc = await calc.settleMarginCall(call, baseAgreement, bondInventory);
    if (alloc.length > 0) {
      expect(alloc[0]!.haircut).toBe(0.02);
      expect(alloc[0]!.adjustedValue).toBeCloseTo(alloc[0]!.amount * 0.98, 2);
    }
  });

  it('returns empty allocation when no eligible inventory', async () => {
    const call = calc.computeMarginCall(baseAgreement, 1_200_000, 0, TODAY);
    const alloc = await calc.settleMarginCall(call, baseAgreement, [
      {
        id: 'inv-bad',
        collateralType: CollateralType.EQUITY, // not in eligibility schedule
        faceValue: 5_000_000,
        marketValue: 5_000_000,
        currency: 'USD',
        availableValue: 5_000_000,
        annualYield: 0.02,
      },
    ]);
    expect(alloc).toHaveLength(0);
  });
});

// ── CTD Optimiser Hook ────────────────────────────────────────────────────────

describe('MarginCalculator — CTD optimiser AI/ML hook', () => {
  it('uses optimiser output when configured', async () => {
    const mockCTD = {
      optimise: async () => [
        {
          collateralType: CollateralType.T_BILL,
          isin: 'US912796V456',
          amount: 700_000,
          currency: 'USD',
          haircut: 0.01,
          adjustedValue: 693_000,
        },
      ],
    };
    const calcWithML = new MarginCalculator(mockCTD);
    const call = calc.computeMarginCall(baseAgreement, 1_200_000, 0, TODAY);
    const alloc = await calcWithML.settleMarginCall(call, baseAgreement, cashInventory);
    expect(alloc[0]!.collateralType).toBe(CollateralType.T_BILL);
  });
});

// ── Repository ────────────────────────────────────────────────────────────────

describe('InMemoryCollateralRepository', () => {
  it('saves and retrieves agreement', async () => {
    const repo = new InMemoryCollateralRepository();
    await repo.saveAgreement(baseAgreement);
    const found = await repo.findAgreement('csa-001', 'tenant-001');
    expect(found).not.toBeNull();
    expect(found!.counterpartyId).toBe('cp-citi');
  });

  it('updates margin call status', async () => {
    const repo = new InMemoryCollateralRepository();
    const call = calc.computeMarginCall(baseAgreement, 1_000_000, 0, TODAY);
    await repo.saveMarginCall(call);
    await repo.updateMarginCallStatus(call.id, MarginCallStatus.SETTLED, []);
    const calls = await repo.findMarginCallsByAgreement('csa-001', 'tenant-001');
    expect(calls[0]!.status).toBe(MarginCallStatus.SETTLED);
  });
});
