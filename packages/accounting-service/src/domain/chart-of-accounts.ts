/**
 * @module accounting-service/domain/chart-of-accounts
 *
 * Chart of Accounts (CoA) — the complete list of GL accounts for a tenant.
 *
 * NexusTreasury ships a standard banking CoA (account codes 1000–9999)
 * fully configurable per tenant. Each account carries:
 *   - A standard code (e.g. 1100 = Cash/Nostro)
 *   - An account type (Asset / Liability / Equity / Revenue / Expense)
 *   - Normal balance direction (Debit for assets; Credit for liabilities)
 *   - IFRS9 category tag (where applicable)
 *
 * Double-entry constraint: Σ(DR) = Σ(CR) per journal entry — enforced in
 * JournalEntry.post().
 *
 * @see IFRS 9 §5.7 — Presentation
 * @see IAS 1 — Presentation of Financial Statements
 */

import { AccountId, AccountType, EntryDirection, IFRS9Category } from './value-objects.js';

// ── GL Account ────────────────────────────────────────────────────────────────

export interface GLAccount {
  readonly id: AccountId;
  /** Human-readable code, e.g. "1100", "4010" */
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  /**
   * Normal balance direction.
   * Assets & Expenses → DEBIT; Liabilities, Equity, Revenue → CREDIT
   */
  readonly normalBalance: EntryDirection;
  /** IFRS 9 category (optional — relevant for financial instrument accounts) */
  readonly ifrs9Category?: IFRS9Category;
  /** Whether this account is active for the tenant */
  readonly active: boolean;
  /** Sub-ledger this account belongs to (e.g. "FX", "FIXED_INCOME", "MM") */
  readonly subLedger?: string;
}

// ── Standard Banking Chart of Accounts ────────────────────────────────────────

/**
 * Standard NexusTreasury banking CoA.
 * Banks may customise codes via tenant configuration without code changes.
 *
 * Code ranges:
 *  1000–1999: Assets
 *  2000–2999: Liabilities
 *  3000–3999: Equity
 *  4000–4999: Revenue / Income
 *  5000–5999: Expenses
 *  6000–6999: OCI (Other Comprehensive Income)
 *  7000–7999: Contra accounts
 *  8000–8999: Clearing / suspense
 */
export const STANDARD_COA: readonly GLAccount[] = [
  // ── Assets ─────────────────────────────────────────────────────────────────
  {
    id: AccountId('1100'),
    code: '1100',
    name: 'Nostro / Cash Accounts',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    active: true,
  },
  {
    id: AccountId('1200'),
    code: '1200',
    name: 'FX Forward Assets — AMC',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    ifrs9Category: IFRS9Category.AMORTISED_COST,
    active: true,
    subLedger: 'FX',
  },
  {
    id: AccountId('1210'),
    code: '1210',
    name: 'FX Forward Assets — FVPL',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    ifrs9Category: IFRS9Category.FVPL_MANDATORY,
    active: true,
    subLedger: 'FX',
  },
  {
    id: AccountId('1300'),
    code: '1300',
    name: 'Fixed Income Securities — AMC',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    ifrs9Category: IFRS9Category.AMORTISED_COST,
    active: true,
    subLedger: 'FIXED_INCOME',
  },
  {
    id: AccountId('1310'),
    code: '1310',
    name: 'Fixed Income Securities — FVOCI',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    ifrs9Category: IFRS9Category.FVOCI,
    active: true,
    subLedger: 'FIXED_INCOME',
  },
  {
    id: AccountId('1320'),
    code: '1320',
    name: 'Fixed Income Securities — FVPL',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    ifrs9Category: IFRS9Category.FVPL_MANDATORY,
    active: true,
    subLedger: 'FIXED_INCOME',
  },
  {
    id: AccountId('1400'),
    code: '1400',
    name: 'IRS / Derivatives — FVPL',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    ifrs9Category: IFRS9Category.FVPL_MANDATORY,
    active: true,
    subLedger: 'DERIVATIVES',
  },
  {
    id: AccountId('1410'),
    code: '1410',
    name: 'Options — FVPL',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    ifrs9Category: IFRS9Category.FVPL_MANDATORY,
    active: true,
    subLedger: 'DERIVATIVES',
  },
  {
    id: AccountId('1500'),
    code: '1500',
    name: 'Money Market Placements — AMC',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    ifrs9Category: IFRS9Category.AMORTISED_COST,
    active: true,
    subLedger: 'MONEY_MARKET',
  },
  {
    id: AccountId('1600'),
    code: '1600',
    name: 'Repo Securities — AMC',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    ifrs9Category: IFRS9Category.AMORTISED_COST,
    active: true,
    subLedger: 'REPO',
  },
  {
    id: AccountId('1700'),
    code: '1700',
    name: 'Accrued Interest Receivable',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    active: true,
  },
  {
    id: AccountId('1800'),
    code: '1800',
    name: 'ECL Allowance — Stage 1',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },
  {
    id: AccountId('1810'),
    code: '1810',
    name: 'ECL Allowance — Stage 2',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },
  {
    id: AccountId('1820'),
    code: '1820',
    name: 'ECL Allowance — Stage 3',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },

  // ── Liabilities ────────────────────────────────────────────────────────────
  {
    id: AccountId('2100'),
    code: '2100',
    name: 'FX Forward Liabilities — FVPL',
    type: AccountType.LIABILITY,
    normalBalance: EntryDirection.CREDIT,
    ifrs9Category: IFRS9Category.FVPL_MANDATORY,
    active: true,
    subLedger: 'FX',
  },
  {
    id: AccountId('2200'),
    code: '2200',
    name: 'IRS / Derivatives — FVPL (Liability)',
    type: AccountType.LIABILITY,
    normalBalance: EntryDirection.CREDIT,
    ifrs9Category: IFRS9Category.FVPL_MANDATORY,
    active: true,
    subLedger: 'DERIVATIVES',
  },
  {
    id: AccountId('2300'),
    code: '2300',
    name: 'MM Borrowings — AMC',
    type: AccountType.LIABILITY,
    normalBalance: EntryDirection.CREDIT,
    ifrs9Category: IFRS9Category.AMORTISED_COST,
    active: true,
    subLedger: 'MONEY_MARKET',
  },
  {
    id: AccountId('2400'),
    code: '2400',
    name: 'Accrued Interest Payable',
    type: AccountType.LIABILITY,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },
  {
    id: AccountId('2900'),
    code: '2900',
    name: 'Clearing / Settlement Payable',
    type: AccountType.LIABILITY,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },

  // ── Equity ─────────────────────────────────────────────────────────────────
  {
    id: AccountId('3100'),
    code: '3100',
    name: 'Retained Earnings',
    type: AccountType.EQUITY,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },
  {
    id: AccountId('3200'),
    code: '3200',
    name: 'OCI — FVOCI Unrealised Gains/Losses',
    type: AccountType.EQUITY,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },
  {
    id: AccountId('3300'),
    code: '3300',
    name: 'OCI — Cash Flow Hedge Reserve',
    type: AccountType.EQUITY,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },

  // ── Revenue / Income ───────────────────────────────────────────────────────
  {
    id: AccountId('4100'),
    code: '4100',
    name: 'Interest Income — AMC Instruments',
    type: AccountType.REVENUE,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },
  {
    id: AccountId('4200'),
    code: '4200',
    name: 'FX Trading Gains / Losses',
    type: AccountType.REVENUE,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },
  {
    id: AccountId('4300'),
    code: '4300',
    name: 'MTM P&L — FVPL Instruments',
    type: AccountType.REVENUE,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },
  {
    id: AccountId('4400'),
    code: '4400',
    name: 'Hedge Ineffectiveness — P&L',
    type: AccountType.REVENUE,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },

  // ── Expenses ───────────────────────────────────────────────────────────────
  {
    id: AccountId('5100'),
    code: '5100',
    name: 'Interest Expense — AMC Liabilities',
    type: AccountType.EXPENSE,
    normalBalance: EntryDirection.DEBIT,
    active: true,
  },
  {
    id: AccountId('5200'),
    code: '5200',
    name: 'ECL Impairment Charge — P&L',
    type: AccountType.EXPENSE,
    normalBalance: EntryDirection.DEBIT,
    active: true,
  },
  {
    id: AccountId('5300'),
    code: '5300',
    name: 'Realised FX Losses',
    type: AccountType.EXPENSE,
    normalBalance: EntryDirection.DEBIT,
    active: true,
  },

  // ── OCI Accounts (mapped to equity in balance sheet) ──────────────────────
  {
    id: AccountId('6100'),
    code: '6100',
    name: 'OCI — FVOCI Fair Value Movement',
    type: AccountType.EQUITY,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },
  {
    id: AccountId('6200'),
    code: '6200',
    name: 'OCI — Cash Flow Hedge Movement',
    type: AccountType.EQUITY,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },

  // ── Clearing / Suspense ───────────────────────────────────────────────────
  {
    id: AccountId('8100'),
    code: '8100',
    name: 'Trade Date Clearing — Purchases',
    type: AccountType.ASSET,
    normalBalance: EntryDirection.DEBIT,
    active: true,
  },
  {
    id: AccountId('8200'),
    code: '8200',
    name: 'Trade Date Clearing — Sales',
    type: AccountType.LIABILITY,
    normalBalance: EntryDirection.CREDIT,
    active: true,
  },
] as const;

// ── Chart of Accounts Lookup ──────────────────────────────────────────────────

/**
 * ChartOfAccounts — immutable registry of GL accounts for a tenant.
 * Supports custom overrides while preserving the standard structure.
 */
export class ChartOfAccounts {
  private readonly byId: Map<string, GLAccount>;
  private readonly byCode: Map<string, GLAccount>;

  private constructor(accounts: readonly GLAccount[]) {
    this.byId = new Map(accounts.map((a) => [a.id, a]));
    this.byCode = new Map(accounts.map((a) => [a.code, a]));
  }

  /** Build from the standard NexusTreasury banking CoA */
  static standard(): ChartOfAccounts {
    return new ChartOfAccounts(STANDARD_COA);
  }

  /**
   * Build with tenant overrides applied on top of the standard CoA.
   * Overrides that match an existing code replace the standard entry;
   * new codes are appended.
   */
  static withOverrides(overrides: readonly GLAccount[]): ChartOfAccounts {
    const overrideByCode = new Map(overrides.map((a) => [a.code, a]));
    const merged = STANDARD_COA.map((a) => overrideByCode.get(a.code) ?? a);
    const newAccounts = overrides.filter((a) => !STANDARD_COA.some((s) => s.code === a.code));
    return new ChartOfAccounts([...merged, ...newAccounts]);
  }

  findById(id: AccountId): GLAccount | undefined {
    return this.byId.get(id);
  }

  findByCode(code: string): GLAccount | undefined {
    return this.byCode.get(code);
  }

  /** Throw if account not found — used in journal entry construction */
  requireByCode(code: string): GLAccount {
    const account = this.findByCode(code);
    if (!account) throw new Error(`ChartOfAccounts: account code '${code}' not found`);
    return account;
  }

  /** All active accounts */
  activeAccounts(): GLAccount[] {
    return [...this.byId.values()].filter((a) => a.active);
  }
}
