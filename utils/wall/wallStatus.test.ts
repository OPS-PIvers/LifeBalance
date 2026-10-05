import { describe, expect, it } from 'vitest';
import { OFFLINE_STRIP_AFTER_MS, offlineLevel } from './wallStatus';

describe('offlineLevel', () => {
  it('escalates from mark to strip at 15 minutes', () => {
    expect(offlineLevel(null, 1000)).toBe('online');
    expect(offlineLevel(0, OFFLINE_STRIP_AFTER_MS - 1)).toBe('mark');
    expect(offlineLevel(0, OFFLINE_STRIP_AFTER_MS)).toBe('strip');
  });
});
