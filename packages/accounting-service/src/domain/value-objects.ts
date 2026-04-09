/**
 * @module accounting-service/domain/value-objects
 * Branded types and value objects for the Accounting bounded context.
 * @see IFRS 9 Financial Instruments (IASB 2014)
 */
import type { Brand } from '@nexustreasury/domain';

// ── Branded ID Types ─────────────────────────────────────────────────────────
export type JournalEntryId = Brand<string, 'JournalEntryId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type SchemaId = Brand<string, 'SchemaId'>;
export type HedgeId = Brand<string, 'HedgeId'>;
export type ECLId = Brand<string, 'ECLId'>;

export const JournalEntryId = (v: string): JournalEntryId => v as JournalEntryId;
export const AccountId = (v: string): AccountId => v as AccountId;
export const SchemaId = (v: string): SchemaId => v as SchemaId;
export const HedgeId = (v: string): HedgeId => v as HedgeId;
export const ECLId = (v: string): ECLId => v as ECLId;

// ── IFRS 9 Classification ─────────────────────────────────────────────────────
/** IFRS 9 §4.1 — measurement category for financial assets */
export enum IFRS9Category {
  AMORTISED_COST = 'AMC', // hold-to-collect + SPPI
  FVOCI = 'FVOCI', // hold-to-collect-and-sell + SPPI
  FVPL = 'FVPL', // fair value through P&L (voluntary)
  FVPL_MANDATORY = 'FVPL_MANDATORY', // non-SPPI or trading
  FVOCI_EQUITY = 'FVOCI_EQUITY', // equity instruments, irrevocable election
}

/** IFRS 9 §5.5 — ECL impairment stage */
export enum ECLStage {
  PERFORMING = 1, // 12-month ECL
  UNDERPERFORMING = 2, // lifetime ECL — SICR trigger
  NON_PERFORMING = 3, // lifetime ECL — credit-impaired
}

// ── Hedge Accounting ─────────────────────────────────────────────────────────
/** IFRS 9 §6.5 — hedge relationship type */
export enum HedgeType {
  FAIR_VALUE = 'FAIR_VALUE',
  CASH_FLOW = 'CASH_FLOW',
  NET_INVESTMENT = 'NET_INVESTMENT',
}

export enum EffectivenessMethod {
  DOLLAR_OFFSET = 'DOLLAR_OFFSET',
  REGRESSION = 'REGRESSION',
  HYPOTHETICAL_DERIVATIVE = 'HYPOTHETICAL_DERIVATIVE',
}

// ── GL Account & Journal Entry ────────────────────────────────────────────────
export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
}

export enum EntryDirection {
  DEBIT = 'DR',
  CREDIT = 'CR',
}

export enum JournalEntryStatus {
  DRAFT = 'DRAFT',
  POSTED = 'POSTED',
  REVERSED = 'REVERSED',
}

// ── Business Model ────────────────────────────────────────────────────────────
export enum BusinessModel {
  HOLD_TO_COLLECT = 'HTC',
  HOLD_TO_COLLECT_AND_SELL = 'HTC_SELL',
  OTHER = 'OTHER',
}
