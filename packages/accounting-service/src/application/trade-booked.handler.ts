/**
 * @module accounting-service/application/trade-booked.handler
 *
 * TradeBookedHandler — consumes TradeCreatedEvent from Kafka and generates
 * the initial journal entries for a newly booked trade.
 *
 * Accounting entries by instrument type at trade date:
 *
 *  FX Forward (FVPL):
 *    Trade date:   No entry (off-balance-sheet until value date)
 *    Value date:   Dr Nostro/Cash XXX | Cr FX Forward Asset XXX (or reverse)
 *
 *  Bond Purchase (AMC — Held to Collect):
 *    Trade date:   Dr Bond Asset — AMC  1,000,000
 *                  Cr Trade Date Clearing        1,000,000
 *    Settlement:   Dr Trade Date Clearing        1,000,000
 *                  Cr Nostro/Cash                1,000,000
 *
 *  Bond Purchase (FVPL — Trading Book):
 *    Trade date:   Dr Bond Asset — FVPL 1,000,000
 *                  Cr Trade Date Clearing        1,000,000
 *
 *  IRS (FVPL — always):
 *    Trade date:   No entry at par (NPV = 0 at inception)
 *    MTM:          Dr/Cr IRS Asset/Liability | Cr/Dr MTM P&L
 *
 *  Money Market Deposit Placed:
 *    Trade date:   Dr MM Placement — AMC  amount
 *                  Cr Nostro/Cash         amount
 *
 * AI/ML hook: AccountingNarrativeGenerator — generates a human-readable
 * audit narrative explaining the journal entry for each trade event.
 * Useful for IFRS 9 disclosure and internal audit purposes.
 *
 * @see IFRS 9 §3.1 — Recognition of financial assets
 */

import { AssetClass, type TenantId, type TradeId } from '@nexustreasury/domain';
import { ChartOfAccounts } from '../domain/chart-of-accounts.js';
import {
  AccountingDomainError,
  JournalEntry,
  type CreateJournalEntryInput,
  type JournalEntryRepository,
} from '../domain/journal-entry.aggregate.js';
import { IFRS9Classifier, type ClassificationInput } from '../domain/ifrs9-classifier.js';
import { BusinessModel, EntryDirection, IFRS9Category } from '../domain/value-objects.js';

// ── Trade Booked Event (consumed from Kafka) ──────────────────────────────────
// Mirrors the structure emitted by trade-service

export interface TradeBookedEvent {
  eventType: 'nexus.trading.trade.booked';
  tradeId: string;
  tenantId: string;
  assetClass: AssetClass;
  instrumentType: string;
  direction: 'BUY' | 'SELL';
  notional: number;
  currency: string;
  counterpartyCurrency?: string; // for FX trades
  tradeDate: string; // ISO date
  valueDate: string; // ISO date
  settlementDate?: string;
  bookId: string;
  traderId: string;
  counterpartyId: string;
  price?: number;
  couponRate?: number;
  maturityDate?: string;
}

// ── AI/ML Narrative Generator Hook ───────────────────────────────────────────

/**
 * Optional AI hook: generates a human-readable narrative for each journal entry.
 * Useful for IFRS 9 disclosures and internal audit trails.
 *
 * @example
 * const generator: AccountingNarrativeGenerator = {
 *   generate: async (je, trade) => llm.complete(buildPrompt(je, trade)),
 * };
 */
export interface AccountingNarrativeGenerator {
  generate(params: {
    eventType: string;
    tradeId: string;
    assetClass: string;
    instrumentType: string;
    notional: number;
    currency: string;
    ifrs9Category: string;
  }): Promise<string>;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export class TradeBookedHandler {
  private readonly classifier: IFRS9Classifier;

  constructor(
    private readonly coa: ChartOfAccounts,
    private readonly journalEntryRepo: JournalEntryRepository,
    private readonly narrativeGenerator?: AccountingNarrativeGenerator,
  ) {
    this.classifier = new IFRS9Classifier();
  }

  /**
   * Handle a trade-booked event.
   * Returns the posted journal entries (1–2 entries depending on instrument).
   */
  async handle(event: TradeBookedEvent): Promise<JournalEntry[]> {
    const tenantId = event.tenantId as TenantId;
    const tradeId = event.tradeId as TradeId;

    // Classify instrument per IFRS 9
    const classification = this.classifier.classify(this.buildClassificationInput(event));

    // Generate journal entries based on asset class
    const entries = await this.generateEntries(event, classification, tenantId, tradeId);

    // Post and persist all entries
    for (const entry of entries) {
      entry.post();
      await this.journalEntryRepo.save(entry);
    }

    return entries;
  }

  // ── Entry Generation by Asset Class ───────────────────────────────────────

  private async generateEntries(
    event: TradeBookedEvent,
    classification: { category: IFRS9Category; assetAccountCode?: string },
    tenantId: TenantId,
    tradeId: TradeId,
  ): Promise<JournalEntry[]> {
    switch (event.assetClass) {
      case AssetClass.FIXED_INCOME:
        return this.bondEntries(event, classification, tenantId, tradeId);

      case AssetClass.MONEY_MARKET:
        return this.moneyMarketEntries(event, tenantId, tradeId);

      case AssetClass.REPO:
        return this.repoEntries(event, tenantId, tradeId);

      case AssetClass.INTEREST_RATE_DERIVATIVE:
        // IRS/FRA at par: NPV = 0. Record only if out-of-market (premium paid)
        return this.irsEntries(event, tenantId, tradeId);

      case AssetClass.FX:
        // FX forwards: off-balance-sheet at trade date (optional memo entry)
        return this.fxEntries(event, tenantId, tradeId);

      default:
        // For unrecognised asset classes, log but don't throw — audit trail only
        return [];
    }
  }

  // ── Bond Entries (Fixed Income) ────────────────────────────────────────────

  private async bondEntries(
    event: TradeBookedEvent,
    classification: { category: IFRS9Category; assetAccountCode?: string },
    tenantId: TenantId,
    tradeId: TradeId,
  ): Promise<JournalEntry[]> {
    const assetCode = classification.assetAccountCode ?? '1320'; // default FVPL if unknown
    const assetAcct = this.coa.requireByCode(assetCode);
    const clearing = this.coa.requireByCode('8100');

    const narrative = await this.aiNarrative('BOND_PURCHASE', event, classification.category);

    const isBuy = event.direction === 'BUY';

    const entry = JournalEntry.create(
      this.buildJEInput(tenantId, tradeId, event, classification.category, narrative, [
        {
          accountCode: isBuy ? assetCode : '8100',
          accountName: isBuy ? assetAcct.name : clearing.name,
          direction: EntryDirection.DEBIT,
          amount: event.notional,
          currency: event.currency,
          description: `${isBuy ? 'Purchase' : 'Sale'} of bond — trade date`,
        },
        {
          accountCode: isBuy ? '8100' : assetCode,
          accountName: isBuy ? clearing.name : assetAcct.name,
          direction: EntryDirection.CREDIT,
          amount: event.notional,
          currency: event.currency,
          description: `Trade date clearing — ${isBuy ? 'purchase' : 'sale'}`,
        },
      ]),
    );

    return [entry];
  }

  // ── Money Market Entries ───────────────────────────────────────────────────

  private async moneyMarketEntries(
    event: TradeBookedEvent,
    tenantId: TenantId,
    tradeId: TradeId,
  ): Promise<JournalEntry[]> {
    const isPlacement = event.direction === 'BUY'; // placing = lending = asset
    const narrative = await this.aiNarrative('MM_PLACEMENT', event, IFRS9Category.AMORTISED_COST);

    const entry = JournalEntry.create(
      this.buildJEInput(tenantId, tradeId, event, IFRS9Category.AMORTISED_COST, narrative, [
        {
          accountCode: isPlacement ? '1500' : '1100',
          accountName: isPlacement ? 'Money Market Placements — AMC' : 'Nostro / Cash Accounts',
          direction: EntryDirection.DEBIT,
          amount: event.notional,
          currency: event.currency,
          description: `MM ${isPlacement ? 'placement' : 'borrowing'} — trade date`,
        },
        {
          accountCode: isPlacement ? '1100' : '2300',
          accountName: isPlacement ? 'Nostro / Cash Accounts' : 'MM Borrowings — AMC',
          direction: EntryDirection.CREDIT,
          amount: event.notional,
          currency: event.currency,
          description: `Cash ${isPlacement ? 'outflow' : 'inflow'} — MM ${isPlacement ? 'placement' : 'borrowing'}`,
        },
      ]),
    );

    return [entry];
  }

  // ── Repo Entries ──────────────────────────────────────────────────────────

  private async repoEntries(
    event: TradeBookedEvent,
    tenantId: TenantId,
    tradeId: TradeId,
  ): Promise<JournalEntry[]> {
    // Repo = sell securities + receive cash + obligation to repurchase
    const isRepo = event.direction === 'SELL'; // repo (selling securities for cash)
    const narrative = await this.aiNarrative('REPO', event, IFRS9Category.AMORTISED_COST);

    const entry = JournalEntry.create(
      this.buildJEInput(tenantId, tradeId, event, IFRS9Category.AMORTISED_COST, narrative, [
        {
          accountCode: isRepo ? '1100' : '1600',
          accountName: isRepo ? 'Nostro / Cash Accounts' : 'Repo Securities — AMC',
          direction: EntryDirection.DEBIT,
          amount: event.notional,
          currency: event.currency,
          description: isRepo ? 'Cash received — repo' : 'Securities pledged — reverse repo',
        },
        {
          accountCode: isRepo ? '2900' : '1100',
          accountName: isRepo ? 'Clearing / Settlement Payable' : 'Nostro / Cash Accounts',
          direction: EntryDirection.CREDIT,
          amount: event.notional,
          currency: event.currency,
          description: isRepo ? 'Repo liability' : 'Cash paid — reverse repo',
        },
      ]),
    );

    return [entry];
  }

  // ── IRS Entries (at par — NPV = 0) ────────────────────────────────────────

  private async irsEntries(
    event: TradeBookedEvent,
    tenantId: TenantId,
    tradeId: TradeId,
  ): Promise<JournalEntry[]> {
    // At-market IRS has NPV = 0 at inception — no balance-sheet entry at trade date.
    // We still post a memo/description entry for audit completeness.
    // Actual balance-sheet entries are generated by PositionRevaluedHandler on MTM moves.
    //
    // If a premium was paid (out-of-market trade), generate:
    //   Dr IRS Asset  | Cr Nostro
    const hasPremium = (event.price ?? 0) !== 0;
    if (!hasPremium) return []; // at-market: no entry needed

    const narrative = await this.aiNarrative('IRS_PREMIUM', event, IFRS9Category.FVPL_MANDATORY);
    const premiumAmount = Math.abs(event.price! * event.notional);
    const irsAcct = this.coa.requireByCode('1400');

    const entry = JournalEntry.create(
      this.buildJEInput(tenantId, tradeId, event, IFRS9Category.FVPL_MANDATORY, narrative, [
        {
          accountCode: event.price! > 0 ? '1400' : '1100',
          accountName: event.price! > 0 ? irsAcct.name : 'Nostro / Cash Accounts',
          direction: EntryDirection.DEBIT,
          amount: premiumAmount,
          currency: event.currency,
          description: 'IRS premium paid',
        },
        {
          accountCode: event.price! > 0 ? '1100' : '1400',
          accountName: event.price! > 0 ? 'Nostro / Cash Accounts' : irsAcct.name,
          direction: EntryDirection.CREDIT,
          amount: premiumAmount,
          currency: event.currency,
          description: 'IRS premium received / nostro outflow',
        },
      ]),
    );

    return [entry];
  }

  // ── FX Entries ────────────────────────────────────────────────────────────

  private async fxEntries(
    event: TradeBookedEvent,
    tenantId: TenantId,
    tradeId: TradeId,
  ): Promise<JournalEntry[]> {
    // FX Spot settles T+2 — cash entry on value date
    // FX Forward: off-balance-sheet at trade date (notional disclosure only)
    const instrumentType = event.instrumentType.toUpperCase();

    if (instrumentType === 'SPOT') {
      // FX Spot: Dr base currency nostro | Cr term currency nostro
      const narrative = await this.aiNarrative('FX_SPOT', event, IFRS9Category.FVPL_MANDATORY);
      const baseNotional = event.notional;
      const termNotional = event.price ? event.price * event.notional : event.notional;
      const termCcy = event.counterpartyCurrency ?? 'USD';

      const isBuy = event.direction === 'BUY'; // BUY base ccy, SELL term ccy

      // FX Spot: 4-line entry — balanced per-currency
      // BUY base ccy: Dr base Nostro | Cr base Clearing (EUR side)
      //               Dr term Clearing | Cr term Nostro (USD side)
      const entry = JournalEntry.create(
        this.buildJEInput(tenantId, tradeId, event, IFRS9Category.FVPL_MANDATORY, narrative, [
          {
            accountCode: '1100',
            accountName: 'Nostro / Cash Accounts',
            direction: isBuy ? EntryDirection.DEBIT : EntryDirection.CREDIT,
            amount: baseNotional,
            currency: event.currency,
            description: `FX Spot — ${isBuy ? 'buy' : 'sell'} base ccy`,
          },
          {
            accountCode: '8100',
            accountName: 'Trade Date Clearing',
            direction: isBuy ? EntryDirection.CREDIT : EntryDirection.DEBIT,
            amount: baseNotional,
            currency: event.currency,
            description: `FX Spot — clearing base ccy`,
          },
          {
            accountCode: '8100',
            accountName: 'Trade Date Clearing',
            direction: isBuy ? EntryDirection.DEBIT : EntryDirection.CREDIT,
            amount: termNotional,
            currency: termCcy,
            description: `FX Spot — clearing term ccy`,
          },
          {
            accountCode: '1100',
            accountName: 'Nostro / Cash Accounts',
            direction: isBuy ? EntryDirection.CREDIT : EntryDirection.DEBIT,
            amount: termNotional,
            currency: termCcy,
            description: `FX Spot — ${isBuy ? 'sell' : 'buy'} term ccy`,
          },
        ]),
      );
      return [entry];
    }

    // FX Forward / NDF / Option: off-balance-sheet at trade date
    // No balance-sheet entry; MTM entries generated on revaluation
    return [];
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private buildClassificationInput(event: TradeBookedEvent): ClassificationInput {
    return {
      assetClass: event.assetClass,
      instrumentType: event.instrumentType,
      businessModel: BusinessModel.HOLD_TO_COLLECT, // default; overridden by book config
    };
  }

  private buildJEInput(
    tenantId: TenantId,
    tradeId: TradeId,
    event: TradeBookedEvent,
    category: IFRS9Category,
    narrative: string | undefined,
    lines: Parameters<typeof JournalEntry.create>[0]['lines'],
  ): CreateJournalEntryInput {
    return {
      tenantId,
      sourceTradeId: tradeId,
      valueDate: new Date(event.tradeDate),
      postingDate: new Date(),
      description: `Trade booked: ${event.assetClass} ${event.instrumentType} — ${event.direction} ${event.notional} ${event.currency}`,
      lines,
      ifrs9Category: category,
      sourceSystem: 'TRADE-SERVICE',
      externalRef: event.tradeId,
      aiNarrative: narrative,
    };
  }

  private async aiNarrative(
    eventType: string,
    event: TradeBookedEvent,
    category: IFRS9Category,
  ): Promise<string | undefined> {
    if (!this.narrativeGenerator) return undefined;
    try {
      return await this.narrativeGenerator.generate({
        eventType,
        tradeId: event.tradeId,
        assetClass: event.assetClass,
        instrumentType: event.instrumentType,
        notional: event.notional,
        currency: event.currency,
        ifrs9Category: category,
      });
    } catch {
      return undefined; // AI narrative failure must never block accounting
    }
  }
}
