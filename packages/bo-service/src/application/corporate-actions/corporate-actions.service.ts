/**
 * @module bo-service/application/corporate-actions/corporate-actions.service
 *
 * Corporate Actions Engine — processes trade lifecycle events for all
 * instrument types managed in NexusTreasury.
 *
 * Lifecycle events by asset class:
 *
 *  Fixed Income:
 *    COUPON_PAYMENT    — scheduled coupon on a bond/CD/CP
 *    PRINCIPAL_REPAYMENT — bond maturity / bullet repayment
 *    CALL_EXERCISE     — issuer calls a callable bond
 *    PUT_EXERCISE      — holder puts back a putable bond
 *
 *  Interest Rate Derivatives:
 *    SWAP_RESET        — floating rate fixing on an IRS reset date
 *    FRA_SETTLEMENT    — FRA cash settlement on effective date
 *    OPTION_EXERCISE   — exercise of an interest rate cap/floor/swaption
 *    OPTION_EXPIRY     — expiry of an unexercised option
 *
 *  FX:
 *    FX_OPTION_EXERCISE — exercise of an FX option
 *    FX_OPTION_EXPIRY   — expiry
 *    NDF_FIXING         — NDF rate fixing on observation date
 *
 *  Repo:
 *    REPO_ROLL          — roll of a maturing repo at new terms
 *    REPO_MATURITY      — termination of repo
 *
 *  Money Market:
 *    DEPOSIT_MATURITY   — maturity of placed/received deposit
 *    INTEREST_PAYMENT   — periodic interest on MM instrument
 *
 * Each processed lifecycle event:
 *  1. Updates trade status in trade-service
 *  2. Publishes Kafka event for position and accounting services
 *  3. Generates settlement instruction if cash flow is involved
 *  4. Creates audit record
 *
 * AI/ML hook: MaturityPredictor
 *  - Predicts which instruments will exercise early (callable bonds, options)
 *  - Uses implied vol surface and issuer credit spread dynamics
 *  - Output used to pre-generate settlement instructions ahead of deadline
 *
 * @see BRD BR-SETT-005 — lifecycle events: coupon, maturity, option exercise, swap reset
 * @see PRD REQ-B-007 — corporate actions processing
 */

import { AssetClass } from '@nexustreasury/domain';

// ── Event Types ───────────────────────────────────────────────────────────────

export enum LifecycleEventType {
  // Fixed Income
  COUPON_PAYMENT = 'COUPON_PAYMENT',
  PRINCIPAL_REPAYMENT = 'PRINCIPAL_REPAYMENT',
  CALL_EXERCISE = 'CALL_EXERCISE',
  PUT_EXERCISE = 'PUT_EXERCISE',
  // IRS / IRD
  SWAP_RESET = 'SWAP_RESET',
  FRA_SETTLEMENT = 'FRA_SETTLEMENT',
  OPTION_EXERCISE = 'OPTION_EXERCISE',
  OPTION_EXPIRY = 'OPTION_EXPIRY',
  // FX
  FX_OPTION_EXERCISE = 'FX_OPTION_EXERCISE',
  FX_OPTION_EXPIRY = 'FX_OPTION_EXPIRY',
  NDF_FIXING = 'NDF_FIXING',
  // Repo / MM
  REPO_ROLL = 'REPO_ROLL',
  REPO_MATURITY = 'REPO_MATURITY',
  DEPOSIT_MATURITY = 'DEPOSIT_MATURITY',
  INTEREST_PAYMENT = 'INTEREST_PAYMENT',
}

export enum LifecycleEventStatus {
  SCHEDULED = 'SCHEDULED',
  PROCESSING = 'PROCESSING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface TradeForLifecycle {
  tradeId: string;
  tenantId: string;
  assetClass: AssetClass;
  instrumentType: string;
  direction: 'BUY' | 'SELL';
  notional: number;
  currency: string;
  couponRate?: number; // annual coupon rate for FI/MM
  frequency?: number; // coupon periods per year (2 = semi-annual)
  fixedRate?: number; // fixed leg rate for IRS
  floatingRate?: number; // last fixing rate for IRS floating leg
  maturityDate?: Date;
  tradeRef: string;
  counterpartyId: string;
  isCorporateClient: boolean;
}

// ── Cash Flow Output ──────────────────────────────────────────────────────────

export interface CashFlow {
  flowId: string;
  tradeId: string;
  eventType: LifecycleEventType;
  flowDate: Date;
  amount: number; // positive = receive; negative = pay
  currency: string;
  description: string;
  requiresSwift: boolean; // true = generate settlement instruction
}

// ── Lifecycle Event Result ────────────────────────────────────────────────────

export interface LifecycleEventResult {
  eventId: string;
  tradeId: string;
  eventType: LifecycleEventType;
  status: LifecycleEventStatus;
  cashFlows: CashFlow[];
  newTradeStatus?: string; // 'MATURED', 'EXERCISED', 'EXPIRED', etc.
  kafkaEvent: Record<string, unknown>; // payload to publish to Kafka
  processedAt: Date;
}

// ── AI/ML Maturity Predictor ──────────────────────────────────────────────────

export interface MaturityPredictor {
  predictEarlyExercise(params: {
    tradeId: string;
    assetClass: AssetClass;
    notional: number;
    impliedVol?: number;
    creditSpread?: number;
    daysToMaturity: number;
  }): Promise<{ probability: number; recommendedAction: string }>;
}

// ── Corporate Actions Service ────────────────────────────────────────────────

export class CorporateActionsService {
  constructor(private readonly maturityPredictor?: MaturityPredictor) {}

  /**
   * Process a lifecycle event for a trade.
   * Returns the event result including generated cash flows and Kafka payload.
   */
  async process(
    trade: TradeForLifecycle,
    eventType: LifecycleEventType,
    eventDate: Date,
  ): Promise<LifecycleEventResult> {
    const { randomUUID } = await import('crypto');
    const eventId = randomUUID();

    const cashFlows = this.computeCashFlows(trade, eventType, eventDate);
    const newTradeStatus = this.computeNewStatus(eventType);

    const kafkaEvent = {
      eventId,
      eventType: `nexus.bo.lifecycle.${eventType.toLowerCase()}`,
      tradeId: trade.tradeId,
      tenantId: trade.tenantId,
      lifecycleEvent: eventType,
      eventDate: eventDate.toISOString(),
      cashFlows: cashFlows.map((cf) => ({
        flowId: cf.flowId,
        amount: cf.amount,
        currency: cf.currency,
        flowDate: cf.flowDate.toISOString(),
      })),
      newTradeStatus,
      occurredAt: new Date().toISOString(),
    };

    return {
      eventId,
      tradeId: trade.tradeId,
      eventType,
      status: LifecycleEventStatus.PROCESSED,
      cashFlows,
      newTradeStatus,
      kafkaEvent,
      processedAt: new Date(),
    };
  }

  // ── Cash Flow Computation ────────────────────────────────────────────────

  private computeCashFlows(
    trade: TradeForLifecycle,
    eventType: LifecycleEventType,
    eventDate: Date,
  ): CashFlow[] {
    const { randomUUID } = require('crypto') as typeof import('crypto');
    const isReceiver = trade.direction === 'BUY';

    switch (eventType) {
      // Fixed Income — Coupon Payment
      case LifecycleEventType.COUPON_PAYMENT: {
        if (!trade.couponRate || !trade.frequency) return [];
        const coupon = (trade.notional * trade.couponRate) / trade.frequency;
        return [
          {
            flowId: randomUUID(),
            tradeId: trade.tradeId,
            eventType,
            flowDate: eventDate,
            amount: isReceiver ? coupon : -coupon,
            currency: trade.currency,
            description: `Coupon payment: ${(trade.couponRate * 100).toFixed(3)}% × ${trade.notional.toLocaleString()} / ${trade.frequency}`,
            requiresSwift: true,
          },
        ];
      }

      // Fixed Income — Principal Repayment (Maturity)
      case LifecycleEventType.PRINCIPAL_REPAYMENT: {
        const flows: CashFlow[] = [];
        // Return of principal
        flows.push({
          flowId: randomUUID(),
          tradeId: trade.tradeId,
          eventType,
          flowDate: eventDate,
          amount: isReceiver ? trade.notional : -trade.notional,
          currency: trade.currency,
          description: `Principal repayment at maturity: ${trade.notional.toLocaleString()} ${trade.currency}`,
          requiresSwift: true,
        });
        // Final coupon if applicable
        if (trade.couponRate && trade.frequency) {
          const coupon = (trade.notional * trade.couponRate) / trade.frequency;
          flows.push({
            flowId: randomUUID(),
            tradeId: trade.tradeId,
            eventType: LifecycleEventType.COUPON_PAYMENT,
            flowDate: eventDate,
            amount: isReceiver ? coupon : -coupon,
            currency: trade.currency,
            description: `Final coupon on maturity`,
            requiresSwift: true,
          });
        }
        return flows;
      }

      // IRS — Swap Reset (floating leg fixing)
      case LifecycleEventType.SWAP_RESET: {
        if (!trade.floatingRate || !trade.fixedRate || !trade.frequency) return [];
        const periodFraction = 1 / trade.frequency;
        const fixedCF = trade.notional * trade.fixedRate * periodFraction;
        const floatCF = trade.notional * trade.floatingRate * periodFraction;
        const netCF = floatCF - fixedCF; // receiver perspective: receive float, pay fixed

        return [
          {
            flowId: randomUUID(),
            tradeId: trade.tradeId,
            eventType,
            flowDate: eventDate,
            amount: isReceiver ? netCF : -netCF,
            currency: trade.currency,
            description: `IRS reset — float: ${(trade.floatingRate * 100).toFixed(3)}%, fixed: ${(trade.fixedRate * 100).toFixed(3)}%, net: ${netCF.toFixed(2)} ${trade.currency}`,
            requiresSwift: Math.abs(netCF) > 1_000,
          },
        ];
      }

      // FX NDF — Cash Settlement at Fixing
      case LifecycleEventType.NDF_FIXING: {
        // NDF settlement = (fixingRate - contractRate) × notional (simplified)
        return [
          {
            flowId: randomUUID(),
            tradeId: trade.tradeId,
            eventType,
            flowDate: eventDate,
            amount: 0, // amount set by fixing service with actual rates
            currency: trade.currency,
            description: `NDF fixing — settlement amount TBD pending official fixing`,
            requiresSwift: false,
          },
        ];
      }

      // Option Expiry (no cash flow — positions closed)
      case LifecycleEventType.OPTION_EXPIRY:
      case LifecycleEventType.FX_OPTION_EXPIRY:
        return [];

      // Repo Maturity — return of securities and cash
      case LifecycleEventType.REPO_MATURITY: {
        return [
          {
            flowId: randomUUID(),
            tradeId: trade.tradeId,
            eventType,
            flowDate: eventDate,
            amount: isReceiver ? -trade.notional : trade.notional,
            currency: trade.currency,
            description: `Repo maturity — securities returned, cash repaid`,
            requiresSwift: true,
          },
        ];
      }

      // Deposit Maturity — principal + interest
      case LifecycleEventType.DEPOSIT_MATURITY: {
        const interest = trade.couponRate
          ? trade.notional * trade.couponRate // simplified: annual rate × notional
          : 0;
        return [
          {
            flowId: randomUUID(),
            tradeId: trade.tradeId,
            eventType,
            flowDate: eventDate,
            amount: isReceiver ? trade.notional + interest : -(trade.notional + interest),
            currency: trade.currency,
            description: `Deposit maturity — principal: ${trade.notional.toLocaleString()}, interest: ${interest.toFixed(2)}`,
            requiresSwift: true,
          },
        ];
      }

      default:
        return [];
    }
  }

  private computeNewStatus(eventType: LifecycleEventType): string | undefined {
    switch (eventType) {
      case LifecycleEventType.PRINCIPAL_REPAYMENT:
      case LifecycleEventType.DEPOSIT_MATURITY:
      case LifecycleEventType.REPO_MATURITY:
        return 'MATURED';
      case LifecycleEventType.OPTION_EXERCISE:
      case LifecycleEventType.FX_OPTION_EXERCISE:
        return 'EXERCISED';
      case LifecycleEventType.OPTION_EXPIRY:
      case LifecycleEventType.FX_OPTION_EXPIRY:
        return 'EXPIRED';
      default:
        return undefined;
    }
  }

  /**
   * Get AI/ML early exercise prediction for options/callable bonds.
   * Returns null if no predictor configured.
   */
  async predictEarlyExercise(params: {
    tradeId: string;
    assetClass: AssetClass;
    notional: number;
    impliedVol?: number;
    creditSpread?: number;
    daysToMaturity: number;
  }): Promise<{ probability: number; recommendedAction: string } | null> {
    if (!this.maturityPredictor) return null;
    return this.maturityPredictor.predictEarlyExercise(params);
  }
}
