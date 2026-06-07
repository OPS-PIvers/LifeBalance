import { describe, it, expect } from 'vitest';
import { roundMoney, sumMoney, addMoney, subtractMoney } from './money';

describe('roundMoney', () => {
  it('rounds to two decimal places', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.674)).toBe(2.67);
    expect(roundMoney(2.675)).toBe(2.68);
  });

  it('clears floating-point noise', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(123.45000000000002)).toBe(123.45);
  });

  it('handles negatives symmetrically', () => {
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(-0.1 - 0.2)).toBe(-0.3);
  });

  it('leaves zero alone', () => {
    expect(roundMoney(0)).toBe(0);
  });
});

describe('sumMoney', () => {
  it('sums without floating-point drift', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
  });

  it('matches a naive sum for clean values but stays exact', () => {
    const amounts = [19.99, 5.0, 0.01, 100.5];
    expect(sumMoney(amounts)).toBe(125.5);
  });

  it('handles many small amounts exactly', () => {
    const amounts = Array.from({ length: 10 }, () => 0.1);
    // Naive: 0.1 * 10 === 0.9999999999999999
    expect(sumMoney(amounts)).toBe(1);
  });

  it('returns 0 for an empty list', () => {
    expect(sumMoney([])).toBe(0);
  });

  it('supports negative amounts (refunds)', () => {
    expect(sumMoney([50, -19.99])).toBe(30.01);
  });
});

describe('addMoney', () => {
  it('adds a variadic list exactly', () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(addMoney(1.1, 2.2, 3.3)).toBe(6.6);
  });
});

describe('subtractMoney', () => {
  it('subtracts without drift', () => {
    expect(subtractMoney(0.3, 0.1)).toBe(0.2);
    expect(subtractMoney(1000.0, 0.01)).toBe(999.99);
  });

  it('can go negative', () => {
    expect(subtractMoney(10, 25.5)).toBe(-15.5);
  });
});
