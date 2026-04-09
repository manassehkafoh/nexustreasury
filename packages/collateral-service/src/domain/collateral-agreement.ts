/**
 * @module collateral-service/domain/collateral-agreement
 *
 * Collateral Management Domain — ISDA CSA, GMRA, GMSLA.
 *
 * A collateral agreement governs the exchange of collateral between two
 * counterparties to mitigate credit risk on OTC derivatives or repo trades.
 *
 * Supported agreement types:
 *  ISDA CSA (Credit Support Annex) — OTC derivatives margining
 *    Daily Variation Margin (VM): covers current MTM exposure
 *    Initial Margin (IM): covers potential future exposure (SIMM/GRID)
 *
 *  GMRA (Global Master Repurchase Agreement) — repo margining
 *    Daily margining based on haircut × collateral price movement
 *
 *  GMSLA (Global Master Securities Lending Agreement) — securities lending
 *    Daily margining of loaned securities value
 *
 * Margin call lifecycle:
 *  1. EOD MTM run → compute net exposure per CSA
 *  2. Apply threshold + MTA (Minimum Transfer Amount) → call amount
 *  3. Generate margin call → counterparty has T+1 to respond
 *  4. Process response: collateral posted → update inventory
 *  5. If dispute: escalate to senior management
 *
 * AI/ML hook: CTDOptimiser (Cheapest-To-Deliver)
 *   Selects the optimal collateral from available inventory to minimise
 *   funding cost while meeting eligibility schedule requirements.
 *   Trained on collateral pool yields and financing rates.
 *
 * @see BRD BR-COLL-001 to BR-COLL-005
 * @see ISDA Credit Support Annex (2016 VM CSA)
 * @see BCBS-IOSCO Uncleared Margin Rules (UMR)
 */

import { randomUUID } from 'crypto';

// ── Agreement Types & Enums ───────────────────────────────────────────────────

export enum AgreementType {
  ISDA_CSA = 'ISDA_CSA',
  GMRA = 'GMRA',
  GMSLA = 'GMSLA',
}

export enum MarginCallStatus {
  PENDING = 'PENDING',
  ISSUED = 'ISSUED',
  DISPUTED = 'DISPUTED',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
}

export enum CollateralType {
  CASH = 'CASH',
  GOVERNMENT_BOND = 'GOVERNMENT_BOND',
  CORPORATE_BOND = 'CORPORATE_BOND',
  EQUITY = 'EQUITY',
  T_BILL = 'T_BILL',
}

// ── Collateral Agreement Aggregate ───────────────────────────────────────────

export interface CollateralAgreement {
  readonly id: string;
  readonly tenantId: string;
  readonly counterpartyId: string;
  readonly agreementType: AgreementType;
  /** Threshold: exposure below this → no margin call (default 0 for cleared) */
  readonly threshold: number;
  /** Minimum Transfer Amount: call only if amount exceeds MTA */
  readonly mta: number;
  /** Independent Amount / Initial Margin required (0 if pre-UMR) */
  readonly independentAmount: number;
  readonly currency: string;
  /** Eligible collateral types and their haircuts */
  readonly eligibilitySchedule: EligibilityItem[];
  readonly active: boolean;
  readonly createdAt: Date;
}

export interface EligibilityItem {
  collateralType: CollateralType;
  maxHaircut: number; // e.g. 0.02 = 2% haircut
  minRating?: string; // e.g. 'BBB-'
}

// ── Margin Call ───────────────────────────────────────────────────────────────

export interface MarginCall {
  readonly id: string;
  readonly agreementId: string;
  readonly tenantId: string;
  readonly callDate: Date;
  readonly valueDate: Date;
  readonly netMTMExposure: number;
  readonly thresholdAmount: number;
  readonly currentCollateral: number;
  readonly callAmount: number; // = max(0, netMTM - threshold - currentCollateral - MTA)
  readonly direction: 'WE_CALL' | 'THEY_CALL';
  readonly currency: string;
  readonly status: MarginCallStatus;
  readonly settledWith?: CollateralAllocation[];
  readonly createdAt: Date;
}

export interface CollateralAllocation {
  collateralType: CollateralType;
  isin?: string;
  amount: number;
  currency: string;
  haircut: number;
  adjustedValue: number; // amount × (1 - haircut)
}

// ── Repository Interface ──────────────────────────────────────────────────────

export interface CollateralRepository {
  saveAgreement(agreement: CollateralAgreement): Promise<void>;
  findAgreement(id: string, tenantId: string): Promise<CollateralAgreement | null>;
  findAgreementsByCounterparty(
    counterpartyId: string,
    tenantId: string,
  ): Promise<CollateralAgreement[]>;
  saveMarginCall(call: MarginCall): Promise<void>;
  findMarginCallsByAgreement(agreementId: string, tenantId: string): Promise<MarginCall[]>;
  updateMarginCallStatus(
    id: string,
    status: MarginCallStatus,
    settled?: CollateralAllocation[],
  ): Promise<void>;
}

export class InMemoryCollateralRepository implements CollateralRepository {
  private agreements = new Map<string, CollateralAgreement>();
  private marginCalls = new Map<string, MarginCall>();

  async saveAgreement(a: CollateralAgreement): Promise<void> {
    this.agreements.set(a.id, a);
  }
  async findAgreement(id: string, tenantId: string): Promise<CollateralAgreement | null> {
    const a = this.agreements.get(id);
    return a?.tenantId === tenantId ? a : null;
  }
  async findAgreementsByCounterparty(
    cpId: string,
    tenantId: string,
  ): Promise<CollateralAgreement[]> {
    return [...this.agreements.values()].filter(
      (a) => a.counterpartyId === cpId && a.tenantId === tenantId && a.active,
    );
  }
  async saveMarginCall(c: MarginCall): Promise<void> {
    this.marginCalls.set(c.id, c);
  }
  async findMarginCallsByAgreement(agreementId: string, tenantId: string): Promise<MarginCall[]> {
    return [...this.marginCalls.values()].filter(
      (c) => c.agreementId === agreementId && c.tenantId === tenantId,
    );
  }
  async updateMarginCallStatus(
    id: string,
    status: MarginCallStatus,
    settled?: CollateralAllocation[],
  ): Promise<void> {
    const c = this.marginCalls.get(id);
    if (c) this.marginCalls.set(id, { ...c, status, settledWith: settled ?? c.settledWith });
  }
}

// ── AI/ML CTD Optimiser ───────────────────────────────────────────────────────

/**
 * Cheapest-To-Deliver optimiser — selects collateral from inventory that:
 *  1. Meets eligibility schedule (type, rating, haircut)
 *  2. Minimises the funding cost (yield of pledged collateral)
 *  3. Subject to: adjusted value ≥ call amount
 *
 * Trained features: repo rate, yield spread to equivalent, eligibility score,
 * anticipated collateral demand from other counterparties.
 */
export interface CTDOptimiser {
  optimise(params: {
    callAmount: number;
    currency: string;
    eligibilitySchedule: EligibilityItem[];
    inventory: InventoryItem[];
  }): Promise<CollateralAllocation[]>;
}

export interface InventoryItem {
  id: string;
  collateralType: CollateralType;
  isin?: string;
  faceValue: number;
  marketValue: number;
  currency: string;
  availableValue: number; // not pledged elsewhere
  annualYield: number; // funding cost proxy
  rating?: string;
}

// ── Margin Calculator ─────────────────────────────────────────────────────────

export class MarginCalculator {
  constructor(private readonly ctdOptimiser?: CTDOptimiser) {}

  /**
   * Compute the margin call amount for a CSA given current exposures.
   *
   * Call amount = max(0, netMTM − threshold − currentCollateral, MTA_check)
   * where MTA_check means: only call if |amount| ≥ MTA.
   *
   * Direction: WE_CALL if netMTM > threshold (we are owed collateral)
   *            THEY_CALL if netMTM < -threshold (we owe collateral)
   */
  computeMarginCall(
    agreement: CollateralAgreement,
    netMTMExposure: number, // +ve = we are owed; -ve = we owe
    currentCollateral: number, // collateral currently held/posted
    callDate: Date,
  ): MarginCall {
    // For WE_CALL (netMTM > 0): we are owed → call = max(0, netMTM - threshold - currentHeld)
    // For THEY_CALL (netMTM < 0): we owe → call = max(0, |netMTM| - threshold - currentPosted)
    const direction: MarginCall['direction'] = netMTMExposure >= 0 ? 'WE_CALL' : 'THEY_CALL';
    const absNet = Math.abs(netMTMExposure);
    const rawCall = absNet - agreement.threshold - Math.abs(currentCollateral);
    const callAmount = rawCall >= agreement.mta ? rawCall : 0;

    return {
      id: randomUUID(),
      agreementId: agreement.id,
      tenantId: agreement.tenantId,
      callDate,
      valueDate: new Date(callDate.getTime() + 86_400_000), // T+1
      netMTMExposure,
      thresholdAmount: agreement.threshold,
      currentCollateral,
      callAmount,
      direction,
      currency: agreement.currency,
      status: callAmount > 0 ? MarginCallStatus.ISSUED : MarginCallStatus.SETTLED,
      createdAt: new Date(),
    };
  }

  /**
   * Settle a margin call by allocating collateral from inventory.
   * Uses CTD optimiser if configured; otherwise allocates first eligible item.
   */
  async settleMarginCall(
    call: MarginCall,
    agreement: CollateralAgreement,
    inventory: InventoryItem[],
  ): Promise<CollateralAllocation[]> {
    if (this.ctdOptimiser) {
      return this.ctdOptimiser.optimise({
        callAmount: call.callAmount,
        currency: call.currency,
        eligibilitySchedule: agreement.eligibilitySchedule,
        inventory,
      });
    }
    // Greedy fallback: allocate first eligible item
    return this.greedyAllocate(call.callAmount, agreement.eligibilitySchedule, inventory);
  }

  private greedyAllocate(
    required: number,
    eligibility: EligibilityItem[],
    inventory: InventoryItem[],
  ): CollateralAllocation[] {
    const allocations: CollateralAllocation[] = [];
    let remaining = required;

    for (const item of inventory) {
      if (remaining <= 0) break;
      const eligible = eligibility.find((e) => e.collateralType === item.collateralType);
      if (!eligible) continue;
      const haircut = eligible.maxHaircut;
      const adjustedVal = item.availableValue * (1 - haircut);
      const allocate = Math.min(adjustedVal, remaining);
      const faceAllocate = haircut < 1 ? allocate / (1 - haircut) : allocate;

      allocations.push({
        collateralType: item.collateralType,
        isin: item.isin,
        amount: faceAllocate,
        currency: item.currency,
        haircut,
        adjustedValue: allocate,
      });
      remaining -= allocate;
    }
    return allocations;
  }
}
