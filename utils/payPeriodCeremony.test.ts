import { describe, it, expect, vi } from 'vitest';
import {
  emitPayPeriodCeremony,
  subscribePayPeriodCeremony,
  suggestBucketLimit,
  type PayPeriodCeremonyEvent,
} from './payPeriodCeremony';
import { BucketPeriodSnapshot } from '@/types/schema';

const snapshot = (overrides: Partial<BucketPeriodSnapshot>): BucketPeriodSnapshot => ({
  id: 'snap',
  bucketId: 'b1',
  bucketName: 'Groceries',
  periodId: '2026-06-01',
  periodStartDate: '2026-06-01',
  periodEndDate: '2026-06-14',
  limit: 400,
  totalSpent: 0,
  totalPending: 0,
  transactionCount: 0,
  createdAt: '2026-06-15T00:00:00.000Z',
  ...overrides,
});

describe('suggestBucketLimit', () => {
  it('returns the current limit when the bucket has no history', () => {
    expect(suggestBucketLimit('b1', 250, [])).toBe(250);
    expect(
      suggestBucketLimit('b1', 250, [snapshot({ bucketId: 'other' })]),
    ).toBe(250);
  });

  it('averages spent+pending over the most recent 3 periods, rounded up to $5', () => {
    const history = [
      snapshot({ id: 's1', periodId: '2026-06-01', totalSpent: 100, totalPending: 10 }),
      snapshot({ id: 's2', periodId: '2026-06-15', totalSpent: 200, totalPending: 0 }),
      snapshot({ id: 's3', periodId: '2026-07-01', totalSpent: 150, totalPending: 3 }),
    ];
    // avg = (110 + 200 + 153) / 3 = 154.33… → ceil to $155
    expect(suggestBucketLimit('b1', 400, history)).toBe(155);
  });

  it('uses only the 3 newest snapshots regardless of input order', () => {
    const history = [
      snapshot({ id: 'old', periodId: '2026-05-01', totalSpent: 9999 }),
      snapshot({ id: 's3', periodId: '2026-07-01', totalSpent: 100 }),
      snapshot({ id: 's1', periodId: '2026-06-01', totalSpent: 100 }),
      snapshot({ id: 's2', periodId: '2026-06-15', totalSpent: 100 }),
    ];
    // The 9999 May period is outside the 3-period lookback.
    expect(suggestBucketLimit('b1', 400, history)).toBe(100);
  });

  it('averages over fewer periods when that is all that exists, zeros included', () => {
    const history = [
      snapshot({ id: 's1', periodId: '2026-06-15', totalSpent: 0, totalPending: 0 }),
      snapshot({ id: 's2', periodId: '2026-07-01', totalSpent: 90, totalPending: 0 }),
    ];
    // avg = 45 → already a $5 multiple
    expect(suggestBucketLimit('b1', 400, history)).toBe(45);
  });

  it('is cents-safe (no float drift before rounding)', () => {
    const history = [
      snapshot({ id: 's1', periodId: '2026-07-01', totalSpent: 0.1, totalPending: 0.2 }),
    ];
    // 0.1 + 0.2 = 0.30000000000000004 in floats; cents math keeps it 0.30 → ceil to $5
    expect(suggestBucketLimit('b1', 400, history)).toBe(5);
  });
});

describe('pay-period ceremony event bus', () => {
  const event: PayPeriodCeremonyEvent = {
    kind: 'roll',
    previousPeriodId: '2026-07-01',
    newPeriodId: '2026-07-15',
    paycheckTitle: 'Paycheck',
    paycheckAmount: 2500,
  };

  it('delivers events to subscribers and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePayPeriodCeremony(listener);

    emitPayPeriodCeremony(event);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);

    unsubscribe();
    emitPayPeriodCeremony(event);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener does not prevent delivery to others', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const unsubBad = subscribePayPeriodCeremony(bad);
    const unsubGood = subscribePayPeriodCeremony(good);

    expect(() => emitPayPeriodCeremony(event)).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);

    unsubBad();
    unsubGood();
    consoleSpy.mockRestore();
  });
});
