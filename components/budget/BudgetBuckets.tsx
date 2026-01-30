
import React, { useState, useMemo, useCallback } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { ArrowRightLeft, Plus, Edit, Trash2 } from 'lucide-react';
import { BudgetBucket, Transaction } from '../../types/schema';
import BucketFormModal from '../modals/BucketFormModal';
import EditTransactionModal from '../modals/EditTransactionModal';
import { Modal } from '../ui/Modal';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';
import Select from '../ui/Select';
import { BudgetBucketCard } from './BudgetBucketCard';

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
  } = useHousehold();

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
      if (!tx.category) return;

      const bucketId = nameToIdMap.get(tx.category.toLowerCase());
      if (bucketId) {
        let list = map.get(bucketId);
        if (!list) {
          list = [];
          map.set(bucketId, list);
        }
        list.push(tx);
      }
    });

    // 3. Sort each small group independently (O(K log K))
    map.forEach((list) => {
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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

  // Mobile Action Drawer State
  const [actionTransaction, setActionTransaction] = useState<Transaction | null>(null);

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

  const handleDeleteTransaction = useCallback(async (id: string) => {
    if (window.confirm('Are you sure you want to delete this transaction?')) {
      await deleteTransaction(id);
    }
  }, [deleteTransaction]);

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


  return (
    <div className="space-y-4">
      {buckets.map(bucket => {
        const spent = bucketSpentMap.get(bucket.id) || { verified: 0, pending: 0 };
        const bucketTransactions = transactionsByBucket.get(bucket.id) || [];

        return (
          <BudgetBucketCard
            key={bucket.id}
            bucket={bucket}
            spent={spent}
            bucketTransactions={bucketTransactions}
            isExpanded={expandedBucketId === bucket.id}
            isEditingLimit={editingLimitId === bucket.id}
            onExpand={handleExpand}
            onEditBucket={handleEditBucket}
            onStartEditingLimit={startEditingLimit}
            onSaveLimit={saveLimit}
            onCancelEdit={cancelEditLimit}
            onReallocate={handleReallocate}
            onEditTransaction={handleEditTransaction}
            onDeleteTransaction={handleDeleteTransaction}
            onOpenTransactionActions={setActionTransaction}
          />
        );
      })}

      {/* Add Bucket Button */}
      <Button
        variant="dashed"
        onClick={handleAddBucket}
        className="w-full py-4 rounded-2xl"
        leftIcon={<Plus size={20} />}
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

      {/* Reallocate Modal */}
      <Modal
        isOpen={!!reallocateModal}
        onClose={() => setReallocateModal(null)}
        maxWidth="max-w-sm"
        ariaLabelledBy="reallocate-title"
        className="p-6"
      >
        <h3 id="reallocate-title" className="font-bold text-lg text-brand-800 mb-4 flex items-center gap-2">
          <ArrowRightLeft size={20} /> Fix Overspending
        </h3>

        <div className="mb-4 text-sm text-brand-600 bg-brand-50 p-3 rounded-xl border border-brand-100">
          Needs <strong>${amountToCover}</strong> to cover <span className="font-bold">{targetForPreview?.name}</span>.
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
                      <option key={a.id} value={a.id}>{a.name} (${a.balance})</option>
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
                      <option key={b.id} value={b.id}>{b.name} (${avail.toFixed(2)} avail)</option>
                    );
                  })}
                </optgroup>
              )}
            </Select>
          </div>

          {/* Dynamic Balance Preview */}
          {reallocateModal?.sourceId && (
            <div className="text-xs flex justify-between items-center text-brand-500 px-1">
                <span>Remaining in source:</span>
                <span className={`font-mono font-bold ${remainingAfterTransfer < 0 ? 'text-money-neg' : 'text-brand-800'}`}>
                  ${remainingAfterTransfer.toLocaleString()}
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
      </Modal>

      {/* Mobile Actions Drawer */}
      <Drawer
        isOpen={!!actionTransaction}
        onClose={() => setActionTransaction(null)}
        title="Transaction Options"
      >
        <div className="space-y-2">
          {actionTransaction && (
            <>
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Edit className="text-brand-500" />}
                onClick={() => {
                  const txToEdit = actionTransaction;
                  setActionTransaction(null);
                  handleEditTransaction(txToEdit);
                }}
              >
                Edit Transaction
              </Button>
              <div className="h-px bg-gray-100 my-2" />
              <Button
                variant="ghost-destructive"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Trash2 />}
                onClick={() => {
                  const txToDelete = actionTransaction;
                  setActionTransaction(null);
                  handleDeleteTransaction(txToDelete.id);
                }}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
};

export default BudgetBuckets;
