/**
 * @module bo-service/application/settlement/settlement-instruction-generator
 *
 * Settlement Instruction Generator — produces ISO 20022 MX and legacy SWIFT MT
 * settlement messages for every asset class booked in NexusTreasury.
 *
 * Message type matrix:
 * ┌──────────────────────┬──────────────┬──────────────┬────────────────────┐
 * │ Asset Class          │ MT (legacy)  │ MX (ISO20022)│ Settlement network │
 * ├──────────────────────┼──────────────┼──────────────┼────────────────────┤
 * │ FX Spot / Fwd (bank) │ MT202        │ pacs.009     │ CLS / bilateral    │
 * │ FX (customer)        │ MT103        │ pacs.008     │ SWIFT              │
 * │ FX (Notice to recv)  │ MT210        │ camt.057     │ Correspondent bank │
 * │ Securities (buy)     │ MT540        │ sese.023     │ CSD / custodian    │
 * │ Securities (sell)    │ MT542        │ sese.023     │ CSD / custodian    │
 * │ Securities (recv)    │ MT541        │ sese.023     │ CSD / custodian    │
 * │ Securities (deliv)   │ MT543        │ sese.023     │ CSD / custodian    │
 * │ Repo                 │ MT540/542    │ sese.023     │ CSD                │
 * └──────────────────────┴──────────────┴──────────────┴────────────────────┘
 *
 * Output format: the generator produces a SettlementInstruction value object
 * carrying both the rendered MT message text and structured MX fields.
 * The BO service SWIFT gateway picks these up for onward transmission.
 *
 * AI/ML hook: CutoffTimeOptimiser — predicts the optimal send time for
 * each instruction to maximise settlement rate given CLS/RTGS cut-off windows.
 *
 * @see SWIFT SR 2024 — MT Standards
 * @see ISO 20022 — pacs.009.001.08, sese.023.001.10, camt.057.001.06
 * @see BRD BR-SETT-001, BR-SETT-004
 */

import { AssetClass, type TradeId } from '@nexustreasury/domain';
import type { SSIRecord } from './ssi.service.js';

// ── Enums ─────────────────────────────────────────────────────────────────────

export enum MessageType {
  MT103 = 'MT103', // Customer credit transfer
  MT202 = 'MT202', // Bank-to-bank credit transfer
  MT210 = 'MT210', // Notice to receive
  MT540 = 'MT540', // Receive free of payment
  MT541 = 'MT541', // Receive against payment
  MT542 = 'MT542', // Deliver free of payment
  MT543 = 'MT543', // Deliver against payment
  PACS008 = 'pacs.008', // FI to FI customer credit transfer (MX)
  PACS009 = 'pacs.009', // Financial institution credit transfer (MX)
  SESE023 = 'sese.023', // Securities settlement (MX)
  CAMT057 = 'camt.057', // Notification to receive (MX)
}

export enum SettlementInstructionStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  MATCHED = 'MATCHED',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

// ── Value Object ──────────────────────────────────────────────────────────────

export interface SettlementInstruction {
  readonly id: string;
  readonly tradeId: TradeId;
  readonly tenantId: string;
  readonly messageType: MessageType;
  readonly mtMessage: string; // formatted SWIFT MT text
  readonly mxFields: Record<string, unknown>; // structured ISO 20022
  readonly valueDate: Date;
  readonly amount: number;
  readonly currency: string;
  readonly counterpartyBic: string;
  readonly status: SettlementInstructionStatus;
  readonly createdAt: Date;
  /** AI/ML recommended send time (optional) */
  readonly recommendedSendTime?: Date;
}

// ── Trade Input ────────────────────────────────────────────────────────────────

export interface TradeForSettlement {
  tradeId: TradeId;
  tenantId: string;
  assetClass: AssetClass;
  instrumentType: string;
  direction: 'BUY' | 'SELL';
  notional: number;
  currency: string;
  counterpartyCurrency?: string;
  spotRate?: number;
  valueDate: Date;
  tradeDate: Date;
  counterpartyId: string;
  tradeRef: string;
  isCorporateClient: boolean; // true → MT103; false → MT202
}

// ── AI/ML Cut-off Optimiser Hook ──────────────────────────────────────────────

export interface CutoffTimeOptimiser {
  recommendSendTime(params: {
    messageType: MessageType;
    currency: string;
    valueDate: Date;
  }): Promise<Date>;
}

// ── Generator ─────────────────────────────────────────────────────────────────

export class SettlementInstructionGenerator {
  constructor(private readonly cutoffOptimiser?: CutoffTimeOptimiser) {}

  /**
   * Generate settlement instructions for a trade.
   * Returns 1–2 instructions (e.g. FX Spot → one per currency leg).
   */
  async generate(
    trade: TradeForSettlement,
    ssi: SSIRecord | null,
  ): Promise<SettlementInstruction[]> {
    switch (trade.assetClass) {
      case AssetClass.FX:
        return this.generateFX(trade, ssi);
      case AssetClass.FIXED_INCOME:
      case AssetClass.REPO:
        return this.generateSecurities(trade, ssi);
      case AssetClass.MONEY_MARKET:
        return this.generateMoneyMarket(trade, ssi);
      default:
        return [];
    }
  }

  // ── FX Settlement ────────────────────────────────────────────────────────────

  private async generateFX(
    trade: TradeForSettlement,
    ssi: SSIRecord | null,
  ): Promise<SettlementInstruction[]> {
    const instructions: SettlementInstruction[] = [];
    const isBuy = trade.direction === 'BUY';

    // Leg 1: payment of term currency (what we pay)
    const payMsgType = trade.isCorporateClient ? MessageType.MT103 : MessageType.MT202;
    const payAmount = isBuy ? (trade.spotRate ?? 1) * trade.notional : trade.notional;
    const payCcy = isBuy ? (trade.counterpartyCurrency ?? 'USD') : trade.currency;

    const payMt = this.renderMT202orMT103(payMsgType, {
      senderBic: ssi?.correspondentBank?.bic ?? 'NEXUSTRES',
      receiverBic: ssi?.beneficiaryBank.bic ?? 'UNKNOWN',
      valueDate: trade.valueDate,
      amount: payAmount,
      currency: payCcy,
      ref: trade.tradeRef,
      beneficiaryAccount: ssi?.beneficiaryAccount ?? '',
      beneficiaryName: ssi?.beneficiaryName ?? '',
      details: `FX ${trade.direction} ${trade.currency}/${trade.counterpartyCurrency ?? 'USD'} ref: ${trade.tradeRef}`,
    });

    const recommendedSendTime = this.cutoffOptimiser
      ? await this.cutoffOptimiser.recommendSendTime({
          messageType: payMsgType,
          currency: payCcy,
          valueDate: trade.valueDate,
        })
      : undefined;

    instructions.push(
      this.buildInstruction(trade, payMsgType, payMt, payAmount, payCcy, ssi, recommendedSendTime),
    );

    // Leg 2: notice to receive of base currency (what we receive)
    const recvAmount = isBuy ? trade.notional : (trade.spotRate ?? 1) * trade.notional;
    const recvCcy = isBuy ? trade.currency : (trade.counterpartyCurrency ?? 'USD');
    const mt210 = this.renderMT210({
      receiverBic: ssi?.correspondentBank?.bic ?? 'UNKNOWN',
      valueDate: trade.valueDate,
      amount: recvAmount,
      currency: recvCcy,
      ref: trade.tradeRef,
    });

    instructions.push(
      this.buildInstruction(trade, MessageType.MT210, mt210, recvAmount, recvCcy, ssi),
    );

    return instructions;
  }

  // ── Securities Settlement ────────────────────────────────────────────────────

  private async generateSecurities(
    trade: TradeForSettlement,
    ssi: SSIRecord | null,
  ): Promise<SettlementInstruction[]> {
    // BUY: receive securities (MT541 — receive against payment)
    // SELL: deliver securities (MT543 — deliver against payment)
    const msgType = trade.direction === 'BUY' ? MessageType.MT541 : MessageType.MT543;

    const mt54x = this.renderMT54x(msgType, {
      safekeepingAccount: ssi?.beneficiaryAccount ?? '',
      counterpartyBic: ssi?.beneficiaryBank.bic ?? 'UNKNOWN',
      isin: trade.tradeRef, // trade ref carries ISIN for FI trades
      quantity: trade.notional,
      valueDate: trade.valueDate,
      amount: trade.notional,
      currency: trade.currency,
      ref: trade.tradeRef,
    });

    const recommendedSendTime = this.cutoffOptimiser
      ? await this.cutoffOptimiser.recommendSendTime({
          messageType: msgType,
          currency: trade.currency,
          valueDate: trade.valueDate,
        })
      : undefined;

    return [
      this.buildInstruction(
        trade,
        msgType,
        mt54x,
        trade.notional,
        trade.currency,
        ssi,
        recommendedSendTime,
      ),
    ];
  }

  // ── Money Market Settlement ───────────────────────────────────────────────────

  private async generateMoneyMarket(
    trade: TradeForSettlement,
    ssi: SSIRecord | null,
  ): Promise<SettlementInstruction[]> {
    const isPlacement = trade.direction === 'BUY'; // placement = lending = pay cash
    const msgType = trade.isCorporateClient ? MessageType.MT103 : MessageType.MT202;

    const mtMsg = this.renderMT202orMT103(msgType, {
      senderBic: ssi?.correspondentBank?.bic ?? 'NEXUSTRES',
      receiverBic: ssi?.beneficiaryBank.bic ?? 'UNKNOWN',
      valueDate: trade.valueDate,
      amount: trade.notional,
      currency: trade.currency,
      ref: trade.tradeRef,
      beneficiaryAccount: ssi?.beneficiaryAccount ?? '',
      beneficiaryName: ssi?.beneficiaryName ?? '',
      details: `MM ${isPlacement ? 'PLACEMENT' : 'BORROWING'} ref: ${trade.tradeRef}`,
    });

    return [this.buildInstruction(trade, msgType, mtMsg, trade.notional, trade.currency, ssi)];
  }

  // ── Message Renderers ─────────────────────────────────────────────────────────

  private renderMT202orMT103(
    type: MessageType,
    p: {
      senderBic: string;
      receiverBic: string;
      valueDate: Date;
      amount: number;
      currency: string;
      ref: string;
      beneficiaryAccount: string;
      beneficiaryName: string;
      details: string;
    },
  ): string {
    const vd = this.formatDate(p.valueDate);
    const amt = `${p.currency}${p.amount.toFixed(2)}`;
    return [
      `{1:F01${p.senderBic}0000000000}{2:I${type === MessageType.MT103 ? '103' : '202'}${p.receiverBic}N}`,
      `{4:`,
      `:20:${p.ref.slice(0, 16)}`,
      type === MessageType.MT202 ? `:21:${p.ref.slice(0, 16)}` : '',
      `:32A:${vd}${amt}`,
      `:57A:${p.receiverBic}`,
      `:58A:${p.beneficiaryAccount}`,
      `:70:${p.details.slice(0, 140)}`,
      `-}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private renderMT210(p: {
    receiverBic: string;
    valueDate: Date;
    amount: number;
    currency: string;
    ref: string;
  }): string {
    const vd = this.formatDate(p.valueDate);
    const amt = `${p.currency}${p.amount.toFixed(2)}`;
    return [
      `{1:F01NEXUSTRES0000000000}{2:I210${p.receiverBic}N}`,
      `{4:`,
      `:20:${p.ref.slice(0, 16)}`,
      `:25:NOSTRO-${p.currency}`,
      `:30:${vd}`,
      `:32B:${amt}`,
      `-}`,
    ].join('\n');
  }

  private renderMT54x(
    type: MessageType,
    p: {
      safekeepingAccount: string;
      counterpartyBic: string;
      isin: string;
      quantity: number;
      valueDate: Date;
      amount: number;
      currency: string;
      ref: string;
    },
  ): string {
    const suffix =
      type === MessageType.MT541
        ? '541'
        : type === MessageType.MT543
          ? '543'
          : type === MessageType.MT540
            ? '540'
            : '542';
    const vd = this.formatDate(p.valueDate);
    return [
      `{1:F01NEXUSTRES0000000000}{2:I${suffix}${p.counterpartyBic}N}`,
      `{4:`,
      `:16R:GENL`,
      `:20C::SEME//${p.ref.slice(0, 16)}`,
      `:23G:NEWM`,
      `:16S:GENL`,
      `:16R:TRADDET`,
      `:98A::SETT//${vd}`,
      `:35B:ISIN ${p.isin.slice(0, 12)}`,
      `:16S:TRADDET`,
      `:16R:FIAC`,
      `:97A::SAFE//${p.safekeepingAccount}`,
      `:16S:FIAC`,
      `:16R:AMT`,
      `:19A::SETT//${p.currency}${p.amount.toFixed(2)}`,
      `:16S:AMT`,
      `-}`,
    ].join('\n');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private buildInstruction(
    trade: TradeForSettlement,
    msgType: MessageType,
    mtMsg: string,
    amount: number,
    currency: string,
    ssi: SSIRecord | null,
    recommendedSendTime?: Date,
  ): SettlementInstruction {
    return {
      id: `SI-${trade.tradeRef}-${msgType}`,
      tradeId: trade.tradeId,
      tenantId: trade.tenantId,
      messageType: msgType,
      mtMessage: mtMsg,
      mxFields: {
        messageType: msgType,
        amount,
        currency,
        valueDate: trade.valueDate.toISOString(),
        tradeRef: trade.tradeRef,
        counterpartyId: trade.counterpartyId,
        ssi: ssi ? { bic: ssi.beneficiaryBank.bic, account: ssi.beneficiaryAccount } : null,
      },
      valueDate: trade.valueDate,
      amount,
      currency,
      counterpartyBic: ssi?.beneficiaryBank.bic ?? 'UNKNOWN',
      status: SettlementInstructionStatus.PENDING,
      createdAt: new Date(),
      recommendedSendTime,
    };
  }

  private formatDate(d: Date): string {
    return d.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
  }
}
