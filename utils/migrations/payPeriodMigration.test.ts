import { describe, it, expect, vi, beforeEach } from 'vitest';
import { needsPaycheckMigration, needsMigration, migrateBucketsToPeriods, migrateToPaycheckPeriods } from './payPeriodMigration';
import { BudgetBucket, Household } from '@/types/schema';
import * as firestore from 'firebase/firestore';

// Mock firebase config and firestore to prevent initialization issues
vi.mock('@/firebase.config', () => ({
  db: {}
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  }
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
  doc: vi.fn(),
  deleteField: vi.fn(() => 'DELETE_FIELD'),
  updateDoc: vi.fn(),
  FieldValue: class {},
}));

describe('payPeriodMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  describe('migrateBucketsToPeriods', () => {
    it('should migrate buckets that are missing currentPeriodId', async () => {
      const householdId = 'household-1';
      const currentPeriodId = '2023-01-01';

      const mockBatch = {
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(firestore.writeBatch).mockReturnValue(mockBatch as any);

      // Mock buckets snapshot
      const bucket1Ref = { id: 'bucket-1' };
      const bucket2Ref = { id: 'bucket-2' }; // Already migrated
      const bucket3Ref = { id: 'bucket-3' }; // Needs migration and has 'spent'

      const mockSnapshot = {
        docs: [
          {
            data: () => ({ id: 'bucket-1', currentPeriodId: undefined }),
            ref: bucket1Ref,
          },
          {
            data: () => ({ id: 'bucket-2', currentPeriodId: '2023-01-01' }),
            ref: bucket2Ref,
          },
          {
            data: () => ({ id: 'bucket-3', currentPeriodId: undefined, spent: 50 }),
            ref: bucket3Ref,
          },
        ],
      };
      vi.mocked(firestore.getDocs).mockResolvedValue(mockSnapshot as any);

      await migrateBucketsToPeriods(householdId, currentPeriodId);

      expect(firestore.collection).toHaveBeenCalledWith(expect.anything(), `households/${householdId}/buckets`);
      expect(firestore.writeBatch).toHaveBeenCalled();

      // Should update bucket 1
      expect(mockBatch.update).toHaveBeenCalledWith(bucket1Ref, {
        currentPeriodId: currentPeriodId,
        lastResetDate: currentPeriodId,
      });

      // Should update bucket 3 and delete 'spent'
      expect(mockBatch.update).toHaveBeenCalledWith(bucket3Ref, {
        currentPeriodId: currentPeriodId,
        lastResetDate: currentPeriodId,
        spent: 'DELETE_FIELD',
      });

      // Should not update bucket 2
      expect(mockBatch.update).not.toHaveBeenCalledWith(bucket2Ref, expect.anything());

      expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('should not commit if no buckets need migration', async () => {
      const householdId = 'household-1';
      const currentPeriodId = '2023-01-01';

      const mockBatch = {
        update: vi.fn(),
        commit: vi.fn(),
      };
      vi.mocked(firestore.writeBatch).mockReturnValue(mockBatch as any);

      const mockSnapshot = {
        docs: [
          {
            data: () => ({ id: 'bucket-2', currentPeriodId: '2023-01-01' }),
            ref: {},
          },
        ],
      };
      vi.mocked(firestore.getDocs).mockResolvedValue(mockSnapshot as any);

      await migrateBucketsToPeriods(householdId, currentPeriodId);

      expect(mockBatch.update).not.toHaveBeenCalled();
      expect(mockBatch.commit).not.toHaveBeenCalled();
    });

    it('should throw error if getDocs fails', async () => {
      vi.mocked(firestore.getDocs).mockRejectedValue(new Error('Firestore error'));

      await expect(migrateBucketsToPeriods('hid', 'pid')).rejects.toThrow('Firestore error');
    });
  });

  describe('migrateToPaycheckPeriods', () => {
    it('should update household document correctly', async () => {
      const householdId = 'household-1';
      const oldStartDate = '2023-01-15';
      const mockHouseholdRef = { id: 'household-ref' };

      vi.mocked(firestore.doc).mockReturnValue(mockHouseholdRef as any);
      vi.mocked(firestore.updateDoc).mockResolvedValue(undefined);

      await migrateToPaycheckPeriods(householdId, oldStartDate);

      expect(firestore.doc).toHaveBeenCalledWith(expect.anything(), `households/${householdId}`);
      expect(firestore.updateDoc).toHaveBeenCalledWith(mockHouseholdRef, {
        lastPaycheckDate: oldStartDate,
        payPeriodSettings: 'DELETE_FIELD',
      });
    });

    it('should throw error if updateDoc fails', async () => {
      vi.mocked(firestore.updateDoc).mockRejectedValue(new Error('Update failed'));

      await expect(migrateToPaycheckPeriods('hid', 'date')).rejects.toThrow('Update failed');
    });
  });
});
