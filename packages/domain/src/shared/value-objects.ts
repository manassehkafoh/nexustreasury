/**
 * Branded type factory — prevents mixing TradeId with PositionId etc. at compile time.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TradeId = Brand<string, 'TradeId'>;
export type PositionId = Brand<string, 'PositionId'>;
export type CounterpartyId = Brand<string, 'CounterpartyId'>;
export type InstrumentId = Brand<string, 'InstrumentId'>;
export type BookId = Brand<string, 'BookId'>;
export type TraderId = Brand<string, 'TraderId'>;
export type LimitId = Brand<string, 'LimitId'>;
export type TenantId = Brand<string, 'TenantId'>;

export const TradeId = (v: string): TradeId => v as TradeId;
export const PositionId = (v: string): PositionId => v as PositionId;
export const CounterpartyId = (v: string): CounterpartyId => v as CounterpartyId;
export const InstrumentId = (v: string): InstrumentId => v as InstrumentId;
export const BookId = (v: string): BookId => v as BookId;
export const TraderId = (v: string): TraderId => v as TraderId;
export const LimitId = (v: string): LimitId => v as LimitId;
export const TenantId = (v: string): TenantId => v as TenantId;

/**
 * Money value object — immutable, currency-aware, no floating point arithmetic.
 */
export class Money {
  private constructor(
    public readonly amount: bigint, // stored as integer cents
    public readonly currency: string, // ISO 4217
    public readonly decimals: number = 2,
  ) {}

  static of(amount: number, currency: string): Money {
    const decimals = 2;
    return new Money(BigInt(Math.round(amount * 10 ** decimals)), currency, decimals);
  }

  static fromCents(cents: bigint, currency: string): Money {
    return new Money(cents, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency, this.decimals);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency, this.decimals);
  }

  negate(): Money {
    return new Money(-this.amount, this.currency, this.decimals);
  }

  toNumber(): number {
    return Number(this.amount) / 10 ** this.decimals;
  }

  toString(): string {
    return `${this.toNumber().toFixed(this.decimals)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Currency mismatch: cannot operate on ${this.currency} and ${other.currency}`,
      );
    }
  }
}

/**
 * Percentage value object — validates range [0, 100].
 */
export class Percentage {
  private constructor(public readonly value: number) {}

  static of(value: number): Percentage {
    if (value < 0 || value > 100) {
      throw new Error(`Percentage must be between 0 and 100, got ${value}`);
    }
    return new Percentage(value);
  }

  toDecimal(): number {
    return this.value / 100;
  }

  toString(): string {
    return `${this.value.toFixed(4)}%`;
  }
}

/**
 * BusinessDate — date-only value object, no time component.
 */
export class BusinessDate {
  private constructor(
    public readonly year: number,
    public readonly month: number,
    public readonly day: number,
  ) {}

  static today(): BusinessDate {
    const d = new Date();
    return new BusinessDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  static of(year: number, month: number, day: number): BusinessDate {
    return new BusinessDate(year, month, day);
  }

  static fromDate(d: Date): BusinessDate {
    return new BusinessDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  toDate(): Date {
    return new Date(this.year, this.month - 1, this.day);
  }

  isBefore(other: BusinessDate): boolean {
    return this.toDate() < other.toDate();
  }

  isAfter(other: BusinessDate): boolean {
    return this.toDate() > other.toDate();
  }

  addDays(n: number): BusinessDate {
    const d = this.toDate();
    d.setDate(d.getDate() + n);
    return BusinessDate.fromDate(d);
  }

  toString(): string {
    return `${this.year}-${String(this.month).padStart(2, '0')}-${String(this.day).padStart(2, '0')}`;
  }
}
