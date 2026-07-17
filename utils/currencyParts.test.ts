import { describe, it, expect } from 'vitest';
import { splitCurrencyParts } from './currencyParts';
import { formatCurrency } from './formatCurrency';

describe('splitCurrencyParts', () => {
  it('splits a positive USD amount into typographic parts', () => {
    const parts = splitCurrencyParts(1700, 'USD');
    expect(parts).toEqual({
      negative: false,
      symbol: '$',
      integer: '1,700',
      fraction: '00',
      decimalSeparator: '.',
      symbolFirst: true,
    });
  });

  it('keeps cents for non-round amounts', () => {
    const parts = splitCurrencyParts(1234.56, 'USD');
    expect(parts.integer).toBe('1,234');
    expect(parts.fraction).toBe('56');
    expect(parts.negative).toBe(false);
  });

  it('flags negative amounts and strips the sign from the integer', () => {
    const parts = splitCurrencyParts(-42.5, 'USD');
    expect(parts.negative).toBe(true);
    expect(parts.symbol).toBe('$');
    expect(parts.integer).toBe('42');
    expect(parts.fraction).toBe('50');
  });

  it('clamps a sub-cent negative to a non-negative zero (no "-$0.00")', () => {
    const parts = splitCurrencyParts(-0.004, 'USD');
    expect(parts.negative).toBe(false);
    expect(parts.integer).toBe('0');
    expect(parts.fraction).toBe('00');
  });

  it('reports symbolFirst under the fixed en-US locale (symbol always leads)', () => {
    // formatCurrency pins the locale to en-US, so every currency renders
    // symbol-first (e.g. "SEK 1,000.00") — symbolFirst is therefore always
    // true here. The suffix branch is a defensive guard for a future
    // per-currency-locale change (see formatCurrency's locale note).
    const parts = splitCurrencyParts(1000, 'SEK');
    expect(parts.symbolFirst).toBe(true);
    expect(parts.integer).toBe('1,000');
  });

  it('falls back to USD for an invalid currency code instead of throwing', () => {
    const parts = splitCurrencyParts(100, 'NOPE');
    expect(parts.symbol).toBe('$');
    expect(parts.integer).toBe('100');
  });

  it.each([0, 12, 1700, 1234.56, -42.5, 1234567.89])(
    're-assembles to exactly formatCurrency(%s) for a prefix currency',
    amount => {
      const parts = splitCurrencyParts(amount, 'USD');
      const sign = parts.negative ? '-' : '';
      const reassembled = `${sign}${parts.symbol}${parts.integer}${parts.decimalSeparator}${parts.fraction}`;
      expect(reassembled).toBe(formatCurrency(amount, { currency: 'USD' }));
    }
  );
});
