
import React, { useState } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { AlertTriangle, ArrowRightLeft, Plus, X, Pencil, Check, MoreVertical, ChevronDown, ChevronUp } from 'lucide-react';
import { BudgetBucket } from '../../types/schema';
import BucketFormModal from '../modals/BucketFormModal';
import { getTransactionsForBucket } from '../../utils/bucketSpentCalculator';
import { format, parseISO } from 'date-fns';

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
  } = useHousehold();

  const [reallocateModal, setReallocateModal] = useState<{ sourceId: string | null, targetId: string | null } | null>(null);

  // Modal State
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingBucket, setEditingBucket] = useState<BudgetBucket | undefined>(undefined);

  // Edit Limit Inline State
  const [editingLimitId, setEditingLimitId] = useState<string | null>(null);
  const [editLimitValue, setEditLimitValue] = useState('');

  // Expandable transaction list state
  const [expandedBucketId, setExpandedBucketId] = useState<string | null>(null);

  const handleEditBucket = (bucket: BudgetBucket) => {
    setEditingBucket(bucket);
    setIsFormModalOpen(true);
  };

  const handleAddBucket = () => {
    setEditingBucket(undefined);
    setIsFormModalOpen(true);
  };

  const startEditingLimit = (id: string, limit: number) => {
    setEditingLimitId(id);
    setEditLimitValue(limit.toString());
  };

  const saveLimit = (id: string) => {
    const val = parseFloat(editLimitValue);
    if (!isNaN(val)) {
      updateBucketLimit(id, val);
    }
    setEditingLimitId(null);
  };

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
      // Logic: Just increase the limit. Safe-to-Spend naturally decreases as liabilities increase.
      updateBucketLimit(targetId, targetBucket.limit + amountNeeded);
    } else {
      const sourceBucket = buckets.find(b => b.id === sourceId);
      const sourceAccount = accounts.find(a => a.id === sourceId);

      if (sourceBucket) {
        reallocateBucket(sourceId, targetId, amountNeeded);
      } else if (sourceAccount) {
        // Logic: Reduce Account Balance (Spent Savings), Increase Bucket Limit
        updateAccountBalance(sourceId, sourceAccount.balance - amountNeeded);
        updateBucketLimit(targetId, targetBucket.limit + amountNeeded);
      }
    }
    setReallocateModal(null);
  };

  // Prepare Source Options
  // 1. Buckets with remaining funds
  // 2. Savings Accounts
  // 3. Safe to Spend
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
        const totalCommitted = spent.verified + spent.pending;
        const percent = Math.min(100, (totalCommitted / bucket.limit) * 100);
        const isOverspent = totalCommitted > bucket.limit;
        const isEditingLimit = editingLimitId === bucket.id;
        const isExpanded = expandedBucketId === bucket.id;

        // Get transactions for this bucket in current period
        const bucketTransactions = getTransactionsForBucket(bucket.name, transactions, currentPeriodId);

        return (
          <div key={bucket.id} className="bg-white p-4 rounded-2xl border border-brand-100 shadow-sm relative group">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${bucket.color}`} />
                <span className="font-bold text-brand-800">{bucket.name}</span>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-sm font-mono flex flex-col items-end">
                  <div className={`flex items-center gap-1 ${isOverspent ? 'text-money-neg font-bold' : 'text-brand-600'}`}>
                    <span>${spent.verified}</span>
                    {spent.pending > 0 && (
                      <span className="text-brand-400">
                        +${spent.pending}*
                      </span>
                    )}
                    <span className="text-brand-300">/</span>

                    {isEditingLimit ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={editLimitValue}
                          onChange={e => setEditLimitValue(e.target.value)}
                          className="w-16 p-1 bg-brand-50 border border-brand-200 rounded text-right font-bold"
                          autoFocus
                        />
                        <button onClick={() => saveLimit(bucket.id)} className="text-money-pos"><Check size={14} /></button>
                      </div>
                    ) : (
                      <span
                        onClick={() => startEditingLimit(bucket.id, bucket.limit)}
                        className="text-brand-400 border-b border-dashed border-brand-200 cursor-pointer hover:text-brand-600"
                      >
                        ${bucket.limit}
                      </span>
                    )}
                  </div>
                  {spent.pending > 0 && (
                    <span className="text-[10px] text-brand-400">
                      *pending review
                    </span>
                  )}
                </div>

                {/* Expand/Collapse button */}
                {bucketTransactions.length > 0 && (
                  <button
                    onClick={() => setExpandedBucketId(isExpanded ? null : bucket.id)}
                    className="text-brand-400 hover:text-brand-600 p-1"
                  >
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                )}

                {/* Edit Button */}
                <button
                  onClick={() => handleEditBucket(bucket)}
                  className="text-brand-300 hover:text-brand-600 p-1"
                >
                  <Pencil size={14} />
                </button>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="h-3 w-full bg-brand-100 rounded-full overflow-hidden mb-2">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isOverspent ? 'bg-money-neg' : bucket.color}`}
                style={{ width: `${percent}%` }}
              />
            </div>

            {/* Expandable Transaction List */}
            {isExpanded && bucketTransactions.length > 0 && (
              <div className="mt-3 pt-3 border-t border-brand-100 space-y-2 animate-in fade-in slide-in-from-top-2">
                <p className="text-xs font-bold text-brand-400 uppercase mb-2">
                  Transactions This Period ({bucketTransactions.length})
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {bucketTransactions.map(tx => (
                    <div
                      key={tx.id}
                      className="flex justify-between items-center text-sm py-2 px-3 bg-brand-50 rounded-lg"
                    >
                      <div className="flex-1">
                        <p className="font-medium text-brand-800">{tx.merchant}</p>
                        <p className="text-xs text-brand-400">
                          {format(parseISO(tx.date), 'MMM d, yyyy')}
                          {tx.status === 'pending_review' && (
                            <span className="ml-2 text-amber-600">• Pending</span>
                          )}
                        </p>
                      </div>
                      <span className={`font-mono font-bold ${
                        tx.status === 'pending_review' ? 'text-brand-400' : 'text-brand-800'
                      }`}>
                        ${tx.amount}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Overspend Action */}
            {isOverspent && (
              <div className="mt-3 bg-money-bgNeg p-3 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-2 text-money-neg text-xs font-bold">
                  <AlertTriangle size={14} />
                  <span>Over by ${totalCommitted - bucket.limit}</span>
                </div>
                <button
                  onClick={() => setReallocateModal({ sourceId: null, targetId: bucket.id })}
                  className="bg-white text-money-neg text-xs font-bold px-3 py-1.5 rounded-lg border border-rose-200 shadow-sm active:scale-95 transition-transform"
                >
                  Fix
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Add Bucket Button */}
      <button 
        onClick={handleAddBucket}
        className="w-full py-4 border-2 border-dashed border-brand-200 rounded-2xl flex items-center justify-center text-brand-400 font-bold hover:bg-brand-50 hover:border-brand-300 transition-colors"
      >
        <Plus size={20} className="mr-2" /> Add Bucket
      </button>

      {/* Bucket Form Modal (Add/Edit) */}
      <BucketFormModal 
        isOpen={isFormModalOpen} 
        onClose={() => setIsFormModalOpen(false)} 
        editingBucket={editingBucket} 
      />

      {/* Reallocate Modal */}
      {reallocateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl">
            <h3 className="font-bold text-lg text-brand-800 mb-4 flex items-center gap-2">
              <ArrowRightLeft size={20} /> Fix Overspending
            </h3>
            
            <div className="mb-4 text-sm text-brand-600 bg-brand-50 p-3 rounded-xl border border-brand-100">
              Needs <strong>${amountToCover}</strong> to cover <span className="font-bold">{targetForPreview?.name}</span>.
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-brand-400 uppercase">Source of Funds</label>
                <select 
                  className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors"
                  onChange={(e) => setReallocateModal({ ...reallocateModal, sourceId: e.target.value })}
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
                          <option key={b.id} value={b.id}>{b.name} (${avail} avail)</option>
                        );
                      })}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Dynamic Balance Preview */}
              {reallocateModal.sourceId && (
                <div className="text-xs flex justify-between items-center text-brand-500 px-1">
                   <span>Remaining in source:</span>
                   <span className={`font-mono font-bold ${remainingAfterTransfer < 0 ? 'text-money-neg' : 'text-brand-800'}`}>
                     ${remainingAfterTransfer.toLocaleString()}
                   </span>
                </div>
              )}
              
              <div className="pt-4 flex gap-3">
                <button 
                  onClick={() => setReallocateModal(null)}
                  className="flex-1 py-3 text-brand-500 font-bold bg-brand-100 rounded-xl"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleReallocateConfirm}
                  disabled={!reallocateModal.sourceId || remainingAfterTransfer < 0}
                  className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetBuckets;
