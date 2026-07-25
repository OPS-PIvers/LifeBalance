import { describe, it, expect } from 'vitest';
import type { HouseholdMember, MerchantRule, Transaction } from '@/types/schema';
import { convertToCSV, buildExportPayload, buildTransactionExportRows, type ExportPayloadInput } from './exportUtils';

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

  describe('buildTransactionExportRows', () => {
    const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({
      id: 'tx-1',
      date: '2026-07-01',
      merchant: 'Coffee Shop',
      amount: 4.5,
      category: 'Dining',
      status: 'verified',
      source: 'manual',
      isRecurring: false,
      autoCategorized: false,
      ...overrides,
    });

    it('maps core fields and resolves the account name by id', () => {
      const accountsById = new Map([['acct-1', 'Checking']]);
      const rows = buildTransactionExportRows([makeTx({ accountId: 'acct-1' })], accountsById);

      expect(rows).toEqual([{
        Date: '2026-07-01',
        Merchant: 'Coffee Shop',
        Name: 'Coffee Shop',
        Category: 'Dining',
        Amount: 4.5,
        Currency: 'USD',
        Status: 'verified',
        Account: 'Checking',
        Source: 'manual',
        'Pay Period': 'N/A',
      }]);
    });

    it('falls back to "Unassigned" when accountId is missing or unknown', () => {
      const accountsById = new Map([['acct-1', 'Checking']]);

      const [noAccountId] = buildTransactionExportRows([makeTx()], accountsById);
      expect(noAccountId?.Account).toBe('Unassigned');

      const [unknownAccountId] = buildTransactionExportRows(
        [makeTx({ accountId: 'does-not-exist' })],
        accountsById
      );
      expect(unknownAccountId?.Account).toBe('Unassigned');
    });

    it('carries the pay period id through when present', () => {
      const [row] = buildTransactionExportRows(
        [makeTx({ payPeriodId: 'period-42' })],
        new Map()
      );
      expect(row?.['Pay Period']).toBe('period-42');
    });

    it('preserves raw decimal-dollar amounts (not formatted currency strings)', () => {
      const [row] = buildTransactionExportRows([makeTx({ amount: 1234.56 })], new Map());
      expect(row?.Amount).toBe(1234.56);
      expect(typeof row?.Amount).toBe('number');
    });

    it('defaults to USD but respects an explicit household currency', () => {
      const [defaultRow] = buildTransactionExportRows([makeTx()], new Map());
      expect(defaultRow?.Currency).toBe('USD');

      const [eurRow] = buildTransactionExportRows([makeTx()], new Map(), 'EUR');
      expect(eurRow?.Currency).toBe('EUR');
    });

    describe('merchant rules (the additive Name column)', () => {
      const makeRule = (overrides: Partial<MerchantRule> = {}): MerchantRule => ({
        id: 'rule-1',
        pattern: 'APPLE.COM/BILL',
        name: 'Apple',
        createdAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
      });

      const rawTx = makeTx({ merchant: 'APPLE.COM/BILL 866-712-7753 CA' });

      it('emits both columns: the raw descriptor in Merchant, the friendly name in Name', () => {
        const [row] = buildTransactionExportRows([rawTx], new Map(), 'USD', [makeRule()]);

        expect(row?.Merchant).toBe('APPLE.COM/BILL 866-712-7753 CA');
        expect(row?.Name).toBe('Apple');
      });

      it('puts Name adjacent to Merchant in the CSV header', () => {
        const rows = buildTransactionExportRows([rawTx], new Map(), 'USD', [makeRule()]);
        const header = convertToCSV(rows).split('\n')[0];

        expect(header).toBe('Date,Merchant,Name,Category,Amount,Currency,Status,Account,Source,Pay Period');
      });

      it('repeats the raw descriptor in Name when rules are omitted or empty', () => {
        const [omitted] = buildTransactionExportRows([rawTx], new Map());
        const [empty] = buildTransactionExportRows([rawTx], new Map(), 'USD', []);

        expect(omitted?.Name).toBe('APPLE.COM/BILL 866-712-7753 CA');
        expect(empty).toEqual(omitted);
      });

      it('repeats the raw descriptor in Name when no rule matches the row', () => {
        const [row] = buildTransactionExportRows(
          [makeTx({ merchant: 'SQ *BLUE BOTTLE' })],
          new Map(),
          'USD',
          [makeRule()]
        );
        expect(row?.Name).toBe('SQ *BLUE BOTTLE');
      });

      it('leaves every non-merchant column byte-identical to the no-rules export', () => {
        const [withRules] = buildTransactionExportRows([rawTx], new Map(), 'EUR', [makeRule()]);
        const [withoutRules] = buildTransactionExportRows([rawTx], new Map(), 'EUR');

        expect({ ...withRules, Name: undefined }).toEqual({ ...withoutRules, Name: undefined });
      });

      it('honours an amount-qualified rule only at the matching amount', () => {
        const rule = makeRule({ pattern: 'APPLE.COM', name: 'Apple iCloud', amount: 2.99 });

        const [matching] = buildTransactionExportRows(
          [makeTx({ merchant: 'APPLE.COM/BILL', amount: 2.99 })],
          new Map(),
          'USD',
          [rule]
        );
        const [nonMatching] = buildTransactionExportRows(
          [makeTx({ merchant: 'APPLE.COM/BILL', amount: 79 })],
          new Map(),
          'USD',
          [rule]
        );

        expect(matching?.Name).toBe('Apple iCloud');
        expect(nonMatching?.Name).toBe('APPLE.COM/BILL');
      });
    });
  });
});
