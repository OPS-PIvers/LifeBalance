import { describe, it, expect } from 'vitest';
import type { HouseholdMember } from '@/types/schema';
import { convertToCSV, buildExportPayload, type ExportPayloadInput } from './exportUtils';

describe('exportUtils', () => {
  describe('convertToCSV', () => {
    it('should convert simple data to CSV format', () => {
      const data = [
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
      ];
      const csv = convertToCSV(data);
      expect(csv).toBe('name,age\n"John","30"\n"Jane","25"');
    });

    it('should handle null or undefined values', () => {
      const data: Record<string, unknown>[] = [
        { name: 'John', age: null },
        { name: 'Jane', age: undefined },
      ];
      const csv = convertToCSV(data);
      expect(csv).toBe('name,age\n"John",""\n"Jane",""');
    });

    it('should escape double quotes', () => {
      const data = [
        { name: 'John "The Rock" Doe' },
      ];
      const csv = convertToCSV(data);
      expect(csv).toBe('name\n"John ""The Rock"" Doe"');
    });

    // This test ensures CSV injection protection is working
    it('should sanitize CSV injection attempts', () => {
      const data = [
        { formula: '=1+1', malicious: '+cmd|' },
        { formula: '@SUM(1,1)', malicious: '-dangerous' },
        { formula: ' =1+1', malicious: '|DDE' }, // Leading whitespace and pipe
      ];
      const csv = convertToCSV(data);

      // Expect single quote prepended to dangerous characters
      expect(csv).toContain('"\'+cmd|"');
      expect(csv).toContain('"\'-dangerous"');

      // For formula starting with =, we expect prepended '
      expect(csv).toContain('"' + "'=1+1" + '"');
      expect(csv).toContain('"' + "'@SUM(1,1)" + '"');

      // Whitespace and DDE protection
      expect(csv).toContain('"' + "' =1+1" + '"');
      expect(csv).toContain('"' + "'|DDE" + '"');
    });

    it('should sanitize edge cases for CSV injection', () => {
      const data = [
        { char: '=' },
        { char: '+' },
        { char: '-' },
        { char: '@' },
        { char: '|' },
        { char: '   @' },
      ];
      const csv = convertToCSV(data);

      expect(csv).toContain('"' + "'=" + '"');
      expect(csv).toContain('"' + "'+" + '"');
      expect(csv).toContain('"' + "'-" + '"');
      expect(csv).toContain('"' + "'@" + '"');
      expect(csv).toContain('"' + "'|" + '"');
      expect(csv).toContain('"' + "'   @" + '"');
    });
  });

  describe('buildExportPayload', () => {
    const member = (overrides: Partial<HouseholdMember> = {}): HouseholdMember => ({
      uid: 'member-1',
      displayName: 'Test Member',
      role: 'admin',
      points: { daily: 0, weekly: 0, total: 0 },
      email: 'member@example.com',
      fcmTokens: ['token-1', 'token-2'],
      ...overrides,
    });

    const baseInput: ExportPayloadInput = {
      householdId: 'household-1',
      exportedBy: 'uid-1',
      household: null,
      members: [member()],
      habits: [],
      transactions: [],
      buckets: [],
      calendarItems: [],
      meals: [],
      shoppingList: [],
      todos: [],
      mealPlan: [],
      challenges: [],
      rewards: [],
      stores: [],
    };

    it('includes all expected top-level keys', () => {
      const payload = buildExportPayload(baseInput);

      expect(Object.keys(payload).sort()).toEqual(
        [
          'meta',
          'household',
          'members',
          'habits',
          'transactions',
          'buckets',
          'calendarItems',
          'meals',
          'shoppingList',
          'todos',
          'mealPlan',
          'challenges',
          'rewards',
          'stores',
        ].sort()
      );
    });

    it('strips fcmTokens and email from members', () => {
      const payload = buildExportPayload(baseInput);
      const [exportedMember] = payload.members;

      expect(exportedMember).toBeDefined();
      expect(exportedMember).not.toHaveProperty('fcmTokens');
      expect(exportedMember).not.toHaveProperty('email');
      expect(exportedMember?.uid).toBe('member-1');
      expect(exportedMember?.displayName).toBe('Test Member');
    });

    it('passes empty collections through as empty arrays, not undefined', () => {
      const payload = buildExportPayload(baseInput);

      expect(payload.todos).toEqual([]);
      expect(payload.mealPlan).toEqual([]);
      expect(payload.challenges).toEqual([]);
      expect(payload.rewards).toEqual([]);
      expect(payload.stores).toEqual([]);
    });

    it('populates meta from the given householdId/exportedBy', () => {
      const payload = buildExportPayload(baseInput);

      expect(payload.meta.householdId).toBe('household-1');
      expect(payload.meta.exportedBy).toBe('uid-1');
      expect(typeof payload.meta.exportedAt).toBe('string');
    });
  });
});
