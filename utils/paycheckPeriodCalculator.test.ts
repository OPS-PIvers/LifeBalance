import { describe, it, expect } from 'vitest';
import { getPayPeriodForTransaction } from './paycheckPeriodCalculator';

describe('getPayPeriodForTransaction', () => {
  it('returns empty string when no paycheck has been approved (lastPaycheckDate is undefined)', () => {
    expect(getPayPeriodForTransaction('2024-01-20', undefined)).toBe('');
  });

  it('returns the paycheck date when the transaction is on the same day as the paycheck', () => {
    expect(getPayPeriodForTransaction('2024-01-15', '2024-01-15')).toBe('2024-01-15');
  });

  it('returns the paycheck date when the transaction is after the paycheck', () => {
    expect(getPayPeriodForTransaction('2024-01-20', '2024-01-15')).toBe('2024-01-15');
  });

  it('returns empty string when the transaction is before the current paycheck', () => {
    // Transaction pre-dates the paycheck → belongs to a previous period (not tracked)
    expect(getPayPeriodForTransaction('2024-01-10', '2024-01-15')).toBe('');
  });

  it('handles transactions many days after the paycheck', () => {
    expect(getPayPeriodForTransaction('2024-02-28', '2024-01-01')).toBe('2024-01-01');
  });

  it('handles transactions on the day before the paycheck (boundary, should be excluded)', () => {
    expect(getPayPeriodForTransaction('2024-01-14', '2024-01-15')).toBe('');
  });
});
