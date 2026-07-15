import { describe, it, expect } from 'vitest';
import { formatMonthLabel } from './monthLabel';

describe('formatMonthLabel', () => {
  it('formats a yyyy-MM into a full month + year label', () => {
    expect(formatMonthLabel('2026-06')).toBe('June 2026');
    expect(formatMonthLabel('2026-01')).toBe('January 2026');
    expect(formatMonthLabel('2025-12')).toBe('December 2025');
  });

  it('returns the raw input for a malformed month id', () => {
    expect(formatMonthLabel('2026-6')).toBe('2026-6');
    expect(formatMonthLabel('not-a-month')).toBe('not-a-month');
    expect(formatMonthLabel('')).toBe('');
  });
});
