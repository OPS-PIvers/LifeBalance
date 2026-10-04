import { describe, expect, it } from 'vitest';
import { OFFLINE_STRIP_AFTER_MS, isMaintenanceDue, offlineLevel } from './wallStatus';

describe('offlineLevel', () => {
  it('escalates from mark to strip at 15 minutes', () => {
    expect(offlineLevel(null, 1000)).toBe('online');
    expect(offlineLevel(0, OFFLINE_STRIP_AFTER_MS - 1)).toBe('mark');
    expect(offlineLevel(0, OFFLINE_STRIP_AFTER_MS)).toBe('strip');
  });
});

describe('isMaintenanceDue', () => {
  it('runs once per date during the 3 am hour', () => {
    expect(isMaintenanceDue(3, '2026-10-04', null)).toBe(true);
    expect(isMaintenanceDue(3, '2026-10-04', '2026-10-03')).toBe(true);
    expect(isMaintenanceDue(3, '2026-10-04', '2026-10-04')).toBe(false);
    expect(isMaintenanceDue(2, '2026-10-04', null)).toBe(false);
    expect(isMaintenanceDue(4, '2026-10-04', null)).toBe(false);
  });
});
