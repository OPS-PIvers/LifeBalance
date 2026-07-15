import { describe, it, expect } from 'vitest';
import { computeSetupChecklistItems, isSetupChecklistComplete } from '@/utils/setupChecklist';

describe('computeSetupChecklistItems', () => {
  it('marks items done/undone from the given inputs', () => {
    const items = computeSetupChecklistItems({
      hasBucket: true,
      notificationsEnabled: false,
      hasSecondMember: true,
      plaidEnabled: false,
      plaidConnected: false,
    });

    expect(items.map((i) => i.id)).toEqual(['bucket', 'notifications', 'invite']);
    expect(items.find((i) => i.id === 'bucket')?.done).toBe(true);
    expect(items.find((i) => i.id === 'notifications')?.done).toBe(false);
    expect(items.find((i) => i.id === 'invite')?.done).toBe(true);
  });

  it('omits the bank item when Plaid is not enabled', () => {
    const items = computeSetupChecklistItems({
      hasBucket: false,
      notificationsEnabled: false,
      hasSecondMember: false,
      plaidEnabled: false,
      plaidConnected: true,
    });
    expect(items.some((i) => i.id === 'bank')).toBe(false);
  });

  it('includes the bank item, honoring plaidConnected, when Plaid is enabled', () => {
    const itemsConnected = computeSetupChecklistItems({
      hasBucket: false,
      notificationsEnabled: false,
      hasSecondMember: false,
      plaidEnabled: true,
      plaidConnected: true,
    });
    expect(itemsConnected.find((i) => i.id === 'bank')?.done).toBe(true);

    const itemsUnconnected = computeSetupChecklistItems({
      hasBucket: false,
      notificationsEnabled: false,
      hasSecondMember: false,
      plaidEnabled: true,
      plaidConnected: false,
    });
    expect(itemsUnconnected.find((i) => i.id === 'bank')?.done).toBe(false);
  });
});

describe('isSetupChecklistComplete', () => {
  it('is false when any item is undone', () => {
    const items = computeSetupChecklistItems({
      hasBucket: true,
      notificationsEnabled: false,
      hasSecondMember: true,
      plaidEnabled: false,
      plaidConnected: false,
    });
    expect(isSetupChecklistComplete(items)).toBe(false);
  });

  it('is true when every item is done', () => {
    const items = computeSetupChecklistItems({
      hasBucket: true,
      notificationsEnabled: true,
      hasSecondMember: true,
      plaidEnabled: false,
      plaidConnected: false,
    });
    expect(isSetupChecklistComplete(items)).toBe(true);
  });

  it('is false for an empty list', () => {
    expect(isSetupChecklistComplete([])).toBe(false);
  });
});
