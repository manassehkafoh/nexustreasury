import { describe, it, expect } from 'vitest';
import { Money, BusinessDate, Percentage } from './value-objects.js';

describe('Money', () => {
  it('creates with positive amount and currency', () => {
    const m = Money.of(1_000, 'USD');
    expect(m.toNumber()).toBe(1_000);
    expect(m.currency).toBe('USD');
  });

  it('add() returns correct sum', () => {
    const a = Money.of(500, 'USD');
    const b = Money.of(300, 'USD');
    expect(a.add(b).toNumber()).toBe(800);
  });

  it('subtract() returns correct difference', () => {
    const a = Money.of(500, 'USD');
    const b = Money.of(200, 'USD');
    expect(a.subtract(b).toNumber()).toBe(300);
  });

  it('toString() includes amount and currency', () => {
    const m = Money.of(1234.56, 'GBP');
    expect(m.toString()).toContain('GBP');
  });

  it('throws on cross-currency add', () => {
    const usd = Money.of(100, 'USD');
    const eur = Money.of(100, 'EUR');
    expect(() => usd.add(eur)).toThrow();
  });
});

describe('BusinessDate', () => {
  it('today() returns a valid date', () => {
    const today = BusinessDate.today();
    expect(today.toDate()).toBeInstanceOf(Date);
  });

  it('fromDate() round-trips correctly', () => {
    const d = new Date(2026, 3, 7); // April 7 2026
    const bd = BusinessDate.fromDate(d);
    expect(bd.toDate().getFullYear()).toBe(2026);
    expect(bd.toDate().getMonth()).toBe(3);
    expect(bd.toDate().getDate()).toBe(7);
  });

  it('isAfter() returns true when later', () => {
    const d1 = BusinessDate.fromDate(new Date(2026, 3, 10));
    const d2 = BusinessDate.fromDate(new Date(2026, 3, 7));
    expect(d1.isAfter(d2)).toBe(true);
  });

  it('isAfter() returns false when earlier', () => {
    const d1 = BusinessDate.fromDate(new Date(2026, 3, 7));
    const d2 = BusinessDate.fromDate(new Date(2026, 3, 10));
    expect(d1.isAfter(d2)).toBe(false);
  });

  it('addDays() adds correct number of days', () => {
    const d = BusinessDate.fromDate(new Date(2026, 3, 7));
    const result = d.addDays(2);
    expect(result.toDate().getDate()).toBe(9);
  });

  it('toString() formats as YYYY-MM-DD', () => {
    const d = BusinessDate.fromDate(new Date(2026, 3, 7));
    expect(d.toString()).toBe('2026-04-07');
  });
});

describe('Percentage', () => {
  it('creates a valid percentage', () => {
    const p = Percentage.of(75);
    expect(p.value).toBe(75);
  });
});
