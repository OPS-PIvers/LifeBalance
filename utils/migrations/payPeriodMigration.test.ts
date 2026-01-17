import { describe, it, expect, vi } from 'vitest';
import { needsPaycheckMigration, needsMigration } from './payPeriodMigration';
import { BudgetBucket, Household } from '@/types/schema';

// Mock firebase config and firestore to prevent initialization issues
vi.mock('@/firebase.config', () => ({
  db: {}
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
  doc: vi.fn(),
  deleteField: vi.fn(),
  updateDoc: vi.fn(),
}));

describe('payPeriodMigration', () => {
  describe('needsPaycheckMigration', () => {
    it('should return true when legacy settings exist and new field is missing', () => {
      const settings: Partial<Household> = {
        payPeriodSettings: { startDate: '2023-01-01' },
        lastPaycheckDate: undefined
      };
      expect(needsPaycheckMigration(settings)).toBe(true);
    });

    it('should return false when already migrated (lastPaycheckDate exists)', () => {
      const settings: Partial<Household> = {
        payPeriodSettings: { startDate: '2023-01-01' },
        lastPaycheckDate: '2023-01-01'
      };
      expect(needsPaycheckMigration(settings)).toBe(false);
    });

    it('should return false when legacy settings are missing', () => {
      const settings: Partial<Household> = {
        payPeriodSettings: undefined,
        lastPaycheckDate: undefined
      };
      expect(needsPaycheckMigration(settings)).toBe(false);
    });

    it('should return false when legacy startDate is missing inside settings', () => {
      const settings: Partial<Household> = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payPeriodSettings: { } as any,
        lastPaycheckDate: undefined
      };
      expect(needsPaycheckMigration(settings)).toBe(false);
    });
  });

  describe('needsMigration (Buckets)', () => {
    // Helper to create a partial bucket
    const createBucket = (overrides: Partial<BudgetBucket>): BudgetBucket => ({
      id: 'test-bucket',
      name: 'Test Bucket',
      limit: 100,
      color: 'blue',
      isVariable: false,
      isCore: true,
      ...overrides
    } as BudgetBucket);

    it('should return true if any bucket is missing currentPeriodId', () => {
      const buckets = [
        createBucket({ currentPeriodId: '2023-01-01' }),
        createBucket({ currentPeriodId: undefined })
      ];
      expect(needsMigration(buckets)).toBe(true);
    });

    it('should return false if all buckets have currentPeriodId', () => {
      const buckets = [
        createBucket({ currentPeriodId: '2023-01-01' }),
        createBucket({ currentPeriodId: '2023-01-01' })
      ];
      expect(needsMigration(buckets)).toBe(false);
    });

    it('should return false for empty buckets array', () => {
      expect(needsMigration([])).toBe(false);
    });
  });
});
