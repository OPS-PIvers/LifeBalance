
import React, { useState, useMemo, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Plus, Edit, Trash2, Wallet } from 'lucide-react';
import { sumMoney } from '@/utils/money';
import { BudgetBucket, Transaction, INCOME_CATEGORY } from '@/types/schema';
import BucketFormModal from '@/components/modals/BucketFormModal';
import toast from 'react-hot-toast';
import EditTransactionModal from '@/components/modals/EditTransactionModal';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import Select from '@/components/ui/Select';
import EmptyState from '@/components/ui/EmptyState';
import { SurfaceList, Row } from '@/components/ui/Section';
import { BudgetBucketCard } from './BudgetBucketCard';

const UNBUDGETED_BUCKET: BudgetBucket = {
  id: 'unbudgeted',
  name: 'Unbudgeted & Other',
  limit: 0,
  color: 'bg-brand-400',
  isVariable: true,
  isCore: false
};

const BudgetBuckets: React.FC = () => {
  const {
    buckets,
    accounts,
    safeToSpend,
    reallocateBucket,
    updateBucketLimit,
    updateAccountBalance,
    bucketSpentMap,
    transactions,
    currentPeriodId,
    deleteTransaction,
  } = useFinance();
  const fmt = useFormatCurrency();

  // ⚡ Bolt Optimization: Pre-calculate transactions grouped by bucket
  const transactionsByBucket = useMemo(() => {
    const map = new Map<string, Transaction[]>();

    // 1. Create a normalized map for Bucket Name -> Bucket ID (O(Buckets))
    const nameToIdMap = new Map<string, string>();
    buckets.forEach(b => {
      const key = b.name.toLowerCase();
      if (!nameToIdMap.has(key)) {
        nameToIdMap.set(key, b.id);
      }
    });

    // 2. Single pass: Filter & Group (O(Transactions))
    transactions.forEach(tx => {
      // Period Check
      if (currentPeriodId && tx.payPeriodId !== currentPeriodId) return;

      // Exclude Income (handled elsewhere)
      if (tx.category === INCOME_CATEGORY) return;

      let bucketId = tx.category ? nameToIdMap.get(tx.category.toLowerCase()) : undefined;

      // If no valid bucket found, assign to Unbudgeted
      if (!bucketId) {
        bucketId = UNBUDGETED_BUCKET.id;
      }

      let list = map.get(bucketId);
      if (!list) {
        list = [];
        map.set(bucketId, list);
      }
      list.push(tx);
    });

    // 3. Sort each small group independently (O(K log K))
    // Lexicographic compare works correctly on yyyy-MM-dd strings and avoids Date parsing overhead.
    map.forEach((list) => {
      list.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
    });

    return map;
  }, [transactions, currentPeriodId, buckets]);

  const [reallocateModal, setReallocateModal] = useState<{ sourceId: string | null, targetId: string | null } | null>(null);

  // Modal State
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingBucket, setEditingBucket] = useState<BudgetBucket | undefined>(undefined);

  // Edit Limit Inline State (Parent only tracks WHO is editing)
  const [editingLimitId, setEditingLimitId] = useState<string | null>(null);

  // Expandable transaction list state
  const [expandedBucketId, setExpandedBucketId] = useState<string | null>(null);

  // Edit Transaction Modal State
  const [isEditTransactionModalOpen, setIsEditTransactionModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  const [transactionToDelete, setTransactionToDelete] = useState<string | null>(null);

  // --- Memoized Handlers ---

  const handleEditBucket = useCallback((bucket: BudgetBucket) => {
    setEditingBucket(bucket);
    setIsFormModalOpen(true);
  }, []);

  const handleAddBucket = () => {
    setEditingBucket(undefined);
    setIsFormModalOpen(true);
  };

  const handleEditTransaction = useCallback((transaction: Transaction) => {
    setEditingTransaction(transaction);
    setIsEditTransactionModalOpen(true);
  }, []);

  // Close the bucket-detail sheet before opening the Edit Transaction sheet.
  // EditTransactionModal renders its own Drawer, so leaving the bucket-detail
  // Drawer open would stack two Drawers (double backdrop, competing focus
  // traps). Mirrors the old actionTransaction-drawer pattern of closing
  // itself before handing off to the edit/delete handlers.
  const handleEditTransactionFromSheet = useCallback((transaction: Transaction) => {
    setExpandedBucketId(null);
    handleEditTransaction(transaction);
  }, [handleEditTransaction]);

  const handleDeleteTransaction = useCallback((id: string) => {
    setTransactionToDelete(id);
  }, []);

  const confirmDeleteTransaction = useCallback(async () => {
    if (!transactionToDelete) return;
    await deleteTransaction(transactionToDelete);
    setTransactionToDelete(null);
  }, [deleteTransaction, transactionToDelete]);

  const startEditingLimit = useCallback((id: string) => {
    setEditingLimitId(id);
  }, []);

  const saveLimit = useCallback((id: string, val: number) => {
    // Only update if value actually changed
    const bucket = buckets.find(b => b.id === id);
    if (bucket && bucket.limit !== val) {
      updateBucketLimit(id, val);
    }
    setEditingLimitId(null);
  }, [updateBucketLimit, buckets]);

  const cancelEditLimit = useCallback(() => {
    setEditingLimitId(null);
  }, []);

  const handleExpand = useCallback((id: string) => {
    setExpandedBucketId(prev => (prev === id ? null : id));
  }, []);

  const handleReallocate = useCallback((targetId: string) => {
    if (targetId === UNBUDGETED_BUCKET.id) {
      toast.error("Please categorize these transactions to fix them.");
      return;
    }
    setReallocateModal({ sourceId: null, targetId });
  }, []);

  // Reallocation Logic
  const getSourceDetails = (sourceId: string) => {
    if (sourceId === 'safe_to_spend') {
      return { name: 'Safe to Spend (Checking)', balance: safeToSpend };
    }
    const bucket = buckets.find(b => b.id === sourceId);
    if (bucket) {
      const spent = bucketSpentMap.get(bucket.id)?.verified || 0;
      return { name: bucket.name, balance: bucket.limit - spent };
    }

    const account = accounts.find(a => a.id === sourceId);
    if (account) return { name: account.name, balance: account.balance };

    return null;
  };

  const handleReallocateConfirm = () => {
    if (!reallocateModal?.sourceId || !reallocateModal?.targetId) return;

    const { sourceId, targetId } = reallocateModal;
    const targetBucket = buckets.find(b => b.id === targetId);
    if (!targetBucket) return;

    const targetSpent = bucketSpentMap.get(targetId)?.verified || 0;
    const amountNeeded = Math.max(0, targetSpent - targetBucket.limit);
    if (amountNeeded === 0) return;

    if (sourceId === 'safe_to_spend') {
      updateBucketLimit(targetId, targetBucket.limit + amountNeeded);
    } else {
      const sourceBucket = buckets.find(b => b.id === sourceId);
      const sourceAccount = accounts.find(a => a.id === sourceId);

      if (sourceBucket) {
        reallocateBucket(sourceId, targetId, amountNeeded);
      } else if (sourceAccount) {
        updateAccountBalance(sourceId, sourceAccount.balance - amountNeeded);
        updateBucketLimit(targetId, targetBucket.limit + amountNeeded);
      }
    }
    setReallocateModal(null);
  };

  // Prepare Source Options
  const availableSourceBuckets = buckets.filter(b => {
    if (b.id === reallocateModal?.targetId) return false;
    const spent = bucketSpentMap.get(b.id)?.verified || 0;
    return b.limit > spent;
  });
  const savingsAccounts = accounts.filter(a => a.type === 'savings');

  // Preview Logic
  const targetForPreview = buckets.find(b => b.id === reallocateModal?.targetId);
  const targetPreviewSpent = targetForPreview ? bucketSpentMap.get(targetForPreview.id)?.verified || 0 : 0;
  const amountToCover = targetForPreview ? Math.max(0, targetPreviewSpent - targetForPreview.limit) : 0;
  const sourcePreview = reallocateModal?.sourceId ? getSourceDetails(reallocateModal.sourceId) : null;
  const remainingAfterTransfer = sourcePreview ? sourcePreview.balance - amountToCover : 0;


  // The bucket whose transactions the detail Drawer is currently showing.
  const expandedBucketTransactions = expandedBucketId ? (transactionsByBucket.get(expandedBucketId) || []) : [];
  const expandedBucketName = expandedBucketId === UNBUDGETED_BUCKET.id
    ? UNBUDGETED_BUCKET.name
    : buckets.find(b => b.id === expandedBucketId)?.name;

  return (
    <div className="space-y-4">
      {(transactionsByBucket.has(UNBUDGETED_BUCKET.id) || buckets.length > 0) && (
        <SurfaceList>
          {/* Unbudgeted Bucket (if any) */}
          {transactionsByBucket.has(UNBUDGETED_BUCKET.id) && (
            <BudgetBucketCard
              key={UNBUDGETED_BUCKET.id}
              bucket={UNBUDGETED_BUCKET}
              spent={{
                verified: sumMoney(transactionsByBucket.get(UNBUDGETED_BUCKET.id)!.map(t => t.amount)),
                pending: 0
              }}
              transactionCount={transactionsByBucket.get(UNBUDGETED_BUCKET.id)!.length}
              isExpanded={expandedBucketId === UNBUDGETED_BUCKET.id}
              isEditingLimit={false}
              onExpand={handleExpand}
              onEditBucket={() => {}} // No-op
              onStartEditingLimit={() => {}} // No-op
              onSaveLimit={() => {}} // No-op
              onCancelEdit={() => {}} // No-op
              onReallocate={handleReallocate}
            />
          )}

          {buckets.map(bucket => {
            const spent = bucketSpentMap.get(bucket.id) || { verified: 0, pending: 0 };
            const bucketTransactions = transactionsByBucket.get(bucket.id) || [];

            return (
              <BudgetBucketCard
                key={bucket.id}
                bucket={bucket}
                spent={spent}
                transactionCount={bucketTransactions.length}
                isExpanded={expandedBucketId === bucket.id}
                isEditingLimit={editingLimitId === bucket.id}
                onExpand={handleExpand}
                onEditBucket={handleEditBucket}
                onStartEditingLimit={startEditingLimit}
                onSaveLimit={saveLimit}
                onCancelEdit={cancelEditLimit}
                onReallocate={handleReallocate}
              />
            );
          })}
        </SurfaceList>
      )}

      {/* Empty State */}
      {buckets.length === 0 && !transactionsByBucket.has(UNBUDGETED_BUCKET.id) && (
        <EmptyState
          variant="surface"
          icon={<Wallet size={28} />}
          title="No budget buckets yet"
          description="Create spending categories to track where your money goes each pay period."
          action={
            <Button
              variant="primary"
              onClick={handleAddBucket}
              leftIcon={<Plus size={18} />}
            >
              Create Bucket
            </Button>
          }
        />
      )}

      {/* Add Bucket Button — compact inline row, not a tall full-width dashed block */}
      <Button
        variant="dashed"
        size="sm"
        onClick={handleAddBucket}
        className="w-full py-2.5 rounded-card"
        leftIcon={<Plus size={16} />}
      >
        Add Bucket
      </Button>

      {/* Bucket Form Modal (Add/Edit) */}
      <BucketFormModal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        editingBucket={editingBucket}
      />

      {/* Edit Transaction Modal */}
      <EditTransactionModal
        isOpen={isEditTransactionModalOpen}
        onClose={() => setIsEditTransactionModalOpen(false)}
        transaction={editingTransaction}
      />

      <ConfirmDialog
        isOpen={!!transactionToDelete}
        onClose={() => setTransactionToDelete(null)}
        onConfirm={confirmDeleteTransaction}
        title="Delete Transaction"
        message="Are you sure you want to delete this transaction?"
        confirmLabel="Delete"
        confirmVariant="destructive"
      />

      {/* Reallocate / Fix Overspending Drawer */}
      <Drawer
        isOpen={!!reallocateModal}
        onClose={() => setReallocateModal(null)}
        title="Fix Overspending"
      >
        <div className="mb-4 text-sm text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-700/40 p-3 rounded-card border border-brand-200 dark:border-brand-700">
          Needs <strong>{fmt(amountToCover)}</strong> to cover <span className="font-bold">{targetForPreview?.name}</span>.
        </div>

        <div className="space-y-3">
          <div>
            <Select
              label="Source of Funds"
              onChange={(e) => setReallocateModal(prev => prev ? ({ ...prev, sourceId: e.target.value }) : null)}
              defaultValue=""
            >
              <option value="" disabled>Select source...</option>

              {/* Option Group: Safe to Spend */}
              <optgroup label="Cash Flow">
                <option value="safe_to_spend">Safe to Spend (Checking)</option>
              </optgroup>

              {/* Option Group: Savings */}
              {savingsAccounts.length > 0 && (
                <optgroup label="Savings Accounts">
                  {savingsAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({fmt(a.balance)})</option>
                  ))}
                </optgroup>
              )}

              {/* Option Group: Other Buckets */}
              {availableSourceBuckets.length > 0 && (
                <optgroup label="Other Buckets">
                  {availableSourceBuckets.map(b => {
                    const bSpent = bucketSpentMap.get(b.id)?.verified || 0;
                    const avail = b.limit - bSpent;
                    return (
                      <option key={b.id} value={b.id}>{b.name} ({fmt(avail)} avail)</option>
                    );
                  })}
                </optgroup>
              )}
            </Select>
          </div>

          {/* Dynamic Balance Preview */}
          {reallocateModal?.sourceId && (
            <div className="text-xs flex justify-between items-center text-brand-500 dark:text-brand-400 px-1">
                <span>Remaining in source:</span>
                <span className={`font-mono tabular-nums font-bold ${remainingAfterTransfer < 0 ? 'text-money-neg' : 'text-brand-800 dark:text-brand-200'}`}>
                  {fmt(remainingAfterTransfer)}
                </span>
            </div>
          )}

          <div className="pt-4 flex gap-3">
            <Button
              variant="subtle"
              onClick={() => setReallocateModal(null)}
              className="flex-1 py-3"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleReallocateConfirm}
              disabled={!reallocateModal?.sourceId || remainingAfterTransfer < 0}
              className="flex-1 py-3"
            >
              Confirm
            </Button>
          </div>
        </div>
      </Drawer>

      {/* Bucket Transactions Detail Drawer — replaces the old inline accordion.
          Tapping a bucket row opens this sheet with a flat, hairline-divided
          list of its transactions instead of expanding a nested bordered panel. */}
      <Drawer
        isOpen={!!expandedBucketId}
        onClose={() => setExpandedBucketId(null)}
        title={expandedBucketName ?? 'Transactions'}
      >
        {expandedBucketTransactions.length === 0 ? (
          <EmptyState
            variant="plain"
            title="No transactions"
            description="This bucket has no transactions yet."
          />
        ) : (
          <>
            <p className="px-1 mb-2 text-xs font-semibold text-brand-400 dark:text-brand-500 uppercase tracking-wider">
              {expandedBucketTransactions.length} transaction{expandedBucketTransactions.length === 1 ? '' : 's'}
            </p>
            <SurfaceList>
              {expandedBucketTransactions.map(tx => (
                <Row key={tx.id} className="justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-brand-900 dark:text-brand-100 truncate text-sm">{tx.merchant}</p>
                    <p className="text-xs text-brand-500 dark:text-brand-400 flex items-center gap-2 mt-0.5">
                      {format(parseISO(tx.date), 'MMM d')}
                      {tx.status === 'pending_review' && (
                        <Badge variant="warning" size="sm">Pending</Badge>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`font-mono tabular-nums font-bold text-sm mr-1 ${
                      tx.status === 'pending_review' ? 'text-brand-400 dark:text-brand-500' : 'text-brand-900 dark:text-brand-100'
                    }`}>
                      {fmt(tx.amount)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleEditTransactionFromSheet(tx)}
                      className="text-brand-400 dark:text-brand-500 hover:text-brand-600 dark:hover:text-brand-300"
                      title="Edit transaction"
                      aria-label={`Edit transaction: ${tx.merchant || 'Unnamed'}`}
                    >
                      <Edit size={14} />
                    </Button>
                    <Button
                      variant="ghost-destructive"
                      size="icon-sm"
                      onClick={() => handleDeleteTransaction(tx.id)}
                      className="text-brand-400 dark:text-brand-500 hover:text-money-neg"
                      title="Delete transaction"
                      aria-label={`Delete transaction: ${tx.merchant || 'Unnamed'}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </Row>
              ))}
            </SurfaceList>
          </>
        )}
      </Drawer>
    </div>
  );
};

export default BudgetBuckets;
