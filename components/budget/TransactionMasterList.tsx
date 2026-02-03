import React, { useState, useMemo, useCallback } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Search, Filter, X, Trash2, Download, Layers, CheckSquare, Tag, Check, Edit, Copy, Scissors } from 'lucide-react';
import { Transaction, INCOME_CATEGORY, CURRENCY_FORMAT_OPTIONS } from '../../types/schema';
import EditTransactionModal from '../modals/EditTransactionModal';
import SplitTransactionModal from '../modals/SplitTransactionModal';
import BatchCategorizeModal from '../modals/BatchCategorizeModal';
import { Modal } from '../ui/Modal';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';
import toast from 'react-hot-toast';
import { generateCsvExport } from '../../utils/exportUtils';
import { TransactionItem } from './TransactionItem';
import SavedViewChips from './SavedViewChips';

// --- Main Component ---

const TransactionMasterList: React.FC = () => {
  const { transactions, deleteTransaction, updateTransaction, addTransaction, householdId, stores } = useHousehold();

  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchCategorizeOpen, setIsBatchCategorizeOpen] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [storeFilter, setStoreFilter] = useState<string>('all');

  // Edit Modal State
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Split Modal State
  const [transactionToSplit, setTransactionToSplit] = useState<Transaction | null>(null);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);

  // Delete Confirmation State
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Mobile Action Drawer State
  const [actionTransaction, setActionTransaction] = useState<Transaction | null>(null);

  // Clear selection when mode is toggled off
  React.useEffect(() => {
    if (!isSelectionMode) {
      setSelectedIds(new Set());
    }
  }, [isSelectionMode]);

  // Derived State: Unique Categories
  const categories = useMemo(() => {
    const cats = new Set(transactions.map(t => t.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [transactions]);

  // Derived State: Filtered & Sorted Transactions
  const filteredTransactions = useMemo(() => {
    return transactions
      .filter(tx => {
        // Search Filter (Merchant or Amount)
        const matchesSearch =
          tx.merchant.toLowerCase().includes(searchTerm.toLowerCase()) ||
          tx.amount.toString().includes(searchTerm);

        // Category Filter
        const matchesCategory = categoryFilter === 'all' || tx.category === categoryFilter;

        // Source Filter
        const matchesSource = sourceFilter === 'all' ||
          (sourceFilter === 'recurring' && tx.isRecurring) ||
          (sourceFilter === 'manual' && tx.source === 'manual') ||
          (sourceFilter === 'camera-scan' && tx.source === 'camera-scan') ||
          (sourceFilter === 'file-upload' && tx.source === 'file-upload');

        // Store Filter
        const matchesStore = storeFilter === 'all' || tx.store === storeFilter;

        return matchesSearch && matchesCategory && matchesSource && matchesStore;
      })
      // Optimize sort: String comparison of ISO dates is ~12x faster than parsing Date objects
      .sort((a, b) => {
        if (b.date > a.date) return 1;
        if (b.date < a.date) return -1;
        return 0;
      });
  }, [transactions, searchTerm, categoryFilter, sourceFilter, storeFilter]);

  // Derived State: Summary Statistics
  const summary = useMemo(() => {
    return filteredTransactions.reduce(
      (acc, tx) => {
        if (tx.category === INCOME_CATEGORY) {
          acc.income += tx.amount;
        } else {
          acc.expense += tx.amount;
        }
        acc.count += 1;
        return acc;
      },
      { income: 0, expense: 0, count: 0 }
    );
  }, [filteredTransactions]);

  const net = summary.income - summary.expense;

  // Handlers (Memoized for stable references)
  const handleEdit = useCallback((tx: Transaction) => {
    setEditingTransaction(tx);
    setIsEditModalOpen(true);
  }, []);

  const handleSplitClick = useCallback((tx: Transaction) => {
    setTransactionToSplit(tx);
    setIsSplitModalOpen(true);
  }, []);

  const handleDeleteClick = useCallback((tx: Transaction) => {
    setTransactionToDelete(tx);
  }, []);

  const handleMoreClick = useCallback((tx: Transaction) => {
    setActionTransaction(tx);
  }, []);

  const handleDuplicate = useCallback(async (tx: Transaction) => {
    try {
      await addTransaction({
        ...tx,
        date: new Date().toISOString().split('T')[0], // Default to today
        status: 'verified',
        isRecurring: false,
        source: 'manual',
        autoCategorized: false,
        payPeriodId: undefined, // Let context logic handle pay period assignment
        relatedHabitIds: [], // Don't carry over habit links
      } as unknown as Transaction);
      toast.success('Transaction duplicated');
    } catch (error) {
      console.error('Failed to duplicate transaction:', error);
      toast.error('Failed to duplicate transaction');
    }
  }, [addTransaction]);

  const confirmDelete = async () => {
    if (!transactionToDelete || isDeleting) return;

    setIsDeleting(true);
    try {
      await deleteTransaction(transactionToDelete.id);
      toast.success('Transaction deleted');
      setTransactionToDelete(null);
    } catch (error) {
      console.error('Failed to delete transaction:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to delete transaction: ${errorMessage}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setCategoryFilter('all');
    setSourceFilter('all');
    setStoreFilter('all');
  };

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = () => {
    if (selectedIds.size === filteredTransactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTransactions.map(t => t.id)));
    }
  };

  const handleBatchCategorize = async (category: string) => {
    if (selectedIds.size === 0) return;
    setIsBatchProcessing(true);
    try {
      const promises = Array.from(selectedIds).map(id =>
        updateTransaction(id, { category, status: 'verified' })
      );
      const results = await Promise.allSettled(promises);
      const failed = results.filter(r => r.status === 'rejected');

      if (failed.length > 0) {
        console.error('Batch categorize failures:', failed);
        toast.error(`Updated ${selectedIds.size - failed.length}, failed ${failed.length}`);
      } else {
        toast.success(`Updated ${selectedIds.size} transactions`);
      }

      setSelectedIds(new Set());
      setIsSelectionMode(false);
    } catch (error) {
      console.error('Batch categorize failed:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchVerify = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Mark ${selectedIds.size} transactions as Verified?`)) return;

    setIsBatchProcessing(true);
    try {
      const promises = Array.from(selectedIds).map(id =>
        updateTransaction(id, { status: 'verified' })
      );
      const results = await Promise.allSettled(promises);
      const failed = results.filter(r => r.status === 'rejected');

      if (failed.length > 0) {
        console.error('Batch verify failures:', failed);
        toast.error(`Verified ${selectedIds.size - failed.length}, failed ${failed.length}`);
      } else {
        toast.success(`Verified ${selectedIds.size} transactions`);
      }

      setSelectedIds(new Set());
      setIsSelectionMode(false);
    } catch (error) {
      console.error('Batch verify failed:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsBatchProcessing(true);
    try {
      const promises = Array.from(selectedIds).map(id => deleteTransaction(id));
      const results = await Promise.allSettled(promises);
      const failed = results.filter(r => r.status === 'rejected');

      if (failed.length > 0) {
        console.error('Batch delete failures:', failed);
        toast.error(`Deleted ${selectedIds.size - failed.length}, failed ${failed.length}`);
      } else {
        toast.success(`Deleted ${selectedIds.size} transactions`);
      }

      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setShowBatchDeleteConfirm(false);
    } catch (error) {
      console.error('Batch delete failed:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleExport = () => {
    try {
      if (filteredTransactions.length === 0) {
        toast.error('No transactions to export');
        return;
      }

      // Transform data for user-friendly export
      const exportData = filteredTransactions.map(tx => ({
        Date: tx.date,
        Merchant: tx.merchant,
        Amount: tx.amount,
        Category: tx.category,
        Status: tx.status,
        Source: tx.source,
        'Pay Period': tx.payPeriodId || 'N/A',
        isRecurring: tx.isRecurring ?? false,
        autoCategorized: tx.autoCategorized ?? false,
      }));

      generateCsvExport(exportData, 'transactions-export');
      toast.success('Export started');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export transactions');
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Filters Card */}
      <div className="bg-white p-4 rounded-2xl border border-brand-100 shadow-sm space-y-3">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400" size={18} />
          <input
            type="text"
            placeholder="Search merchant or amount..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 hover:text-brand-600"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Filter Chips / Dropdowns */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 bg-brand-50 border border-brand-200 rounded-lg text-sm text-brand-700 outline-none focus:border-brand-400 min-w-[120px]"
          >
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-3 py-2 bg-brand-50 border border-brand-200 rounded-lg text-sm text-brand-700 outline-none focus:border-brand-400 min-w-[120px]"
          >
            <option value="all">All Sources</option>
            <option value="recurring">Recurring</option>
            <option value="manual">Manual Entry</option>
            <option value="camera-scan">Camera Scan</option>
            <option value="file-upload">File Upload</option>
          </select>

          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="px-3 py-2 bg-brand-50 border border-brand-200 rounded-lg text-sm text-brand-700 outline-none focus:border-brand-400 min-w-[120px]"
          >
            <option value="all">All Stores</option>
            {stores.map(s => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>

          {(categoryFilter !== 'all' || sourceFilter !== 'all' || storeFilter !== 'all') && (
            <Button
              variant="subtle"
              size="sm"
              onClick={clearFilters}
              className="whitespace-nowrap"
            >
              Clear
            </Button>
          )}

          {/* Select Mode Toggle */}
          <Button
            variant={isSelectionMode ? 'primary' : 'subtle'}
            size="sm"
            onClick={() => setIsSelectionMode(!isSelectionMode)}
            className="ml-auto whitespace-nowrap"
            leftIcon={<Layers size={16} />}
            title="Toggle selection mode"
          >
            <span className="hidden sm:inline">{isSelectionMode ? 'Done' : 'Select'}</span>
          </Button>

          {/* Export Button */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleExport}
            disabled={filteredTransactions.length === 0 || isSelectionMode}
            className={isSelectionMode ? 'hidden sm:flex' : ''}
            title="Export filtered transactions to CSV"
            aria-label="Export filtered transactions to CSV"
            leftIcon={<Download size={16} />}
          >
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>

        <SavedViewChips
          key={householdId}
          householdId={householdId}
          currentFilters={{
            searchTerm,
            categoryFilter,
            sourceFilter
          }}
          onApply={(filters) => {
            setSearchTerm(filters.searchTerm);
            setCategoryFilter(filters.categoryFilter);
            setSourceFilter(filters.sourceFilter);
          }}
        />
      </div>

      {/* Summary Widget */}
      <div className="bg-white p-4 rounded-2xl border border-brand-100 shadow-sm">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-brand-50 p-3 rounded-xl">
            <p className="text-xs font-bold text-brand-400 uppercase tracking-wider mb-1">Income</p>
            <p className="text-lg font-bold text-money-pos font-mono">
              +${summary.income.toLocaleString(undefined, CURRENCY_FORMAT_OPTIONS)}
            </p>
          </div>
          <div className="bg-brand-50 p-3 rounded-xl">
            <p className="text-xs font-bold text-brand-400 uppercase tracking-wider mb-1">Expense</p>
            <p className="text-lg font-bold text-money-neg font-mono">
              -${summary.expense.toLocaleString(undefined, CURRENCY_FORMAT_OPTIONS)}
            </p>
          </div>
          <div className="bg-brand-50 p-3 rounded-xl">
            <p className="text-xs font-bold text-brand-400 uppercase tracking-wider mb-1">Net</p>
            <p className={`text-lg font-bold font-mono ${net >= 0 ? 'text-money-pos' : 'text-money-neg'}`}>
              {net >= 0 ? '+' : ''}${net.toLocaleString(undefined, CURRENCY_FORMAT_OPTIONS)}
            </p>
          </div>
          <div className="bg-brand-50 p-3 rounded-xl">
            <p className="text-xs font-bold text-brand-400 uppercase tracking-wider mb-1">Count</p>
            <p className="text-lg font-bold text-brand-700 font-mono">
              {summary.count}
            </p>
          </div>
        </div>
      </div>

      {/* Select All Bar */}
      {isSelectionMode && (
        <div className="flex items-center justify-between px-2 text-sm text-brand-600">
          <button
            onClick={handleSelectAll}
            className="flex items-center gap-2 font-bold hover:text-brand-800"
          >
            <CheckSquare size={16} className={selectedIds.size === filteredTransactions.length && filteredTransactions.length > 0 ? 'text-brand-600' : 'text-brand-300'} />
            Select All ({filteredTransactions.length})
          </button>
          <span className="text-xs">{selectedIds.size} selected</span>
        </div>
      )}

      {/* Transaction List */}
      <div className="space-y-2 pb-24">
        {filteredTransactions.length === 0 ? (
          <div className="text-center py-10 text-brand-400">
            <Filter className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>No transactions found matching your filters.</p>
            <button onClick={clearFilters} className="mt-2 text-brand-600 font-bold text-sm hover:underline">
              Clear all filters
            </button>
          </div>
        ) : (
          filteredTransactions.map(tx => (
            <TransactionItem
              key={tx.id}
              transaction={tx}
              onEdit={handleEdit}
              onDelete={handleDeleteClick}
              onDuplicate={handleDuplicate}
              onSplit={handleSplitClick}
              onMore={handleMoreClick}
              isSelectionMode={isSelectionMode}
              isSelected={selectedIds.has(tx.id)}
              onToggleSelection={toggleSelection}
            />
          ))
        )}
      </div>

      {/* Floating Action Bar (FAB) for Batch Actions */}
      {isSelectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-20 left-0 right-0 px-4 md:px-0 flex justify-center z-dropdown pointer-events-none">
          <div className="bg-brand-900 text-white p-2 rounded-2xl shadow-xl flex items-center gap-2 pointer-events-auto animate-in slide-in-from-bottom-4">
            <div className="px-3 font-bold text-sm border-r border-brand-700">
              {selectedIds.size} selected
            </div>

            <button
              onClick={() => setIsBatchCategorizeOpen(true)}
              disabled={isBatchProcessing}
              className="flex flex-col items-center gap-0.5 px-3 py-1 hover:bg-brand-800 rounded-lg transition-colors disabled:opacity-50"
            >
              <Tag size={18} />
              <span className="text-xxs font-medium">Categorize</span>
            </button>

            <button
              onClick={handleBatchVerify}
              disabled={isBatchProcessing}
              className="flex flex-col items-center gap-0.5 px-3 py-1 hover:bg-brand-800 rounded-lg transition-colors disabled:opacity-50"
            >
              <Check size={18} />
              <span className="text-xxs font-medium">Verify</span>
            </button>

            <button
              onClick={() => setShowBatchDeleteConfirm(true)}
              disabled={isBatchProcessing}
              className="flex flex-col items-center gap-0.5 px-3 py-1 hover:bg-red-900 text-red-300 hover:text-red-200 rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 size={18} />
              <span className="text-xxs font-medium">Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* Batch Categorize Modal */}
      <BatchCategorizeModal
        isOpen={isBatchCategorizeOpen}
        onClose={() => setIsBatchCategorizeOpen(false)}
        onConfirm={handleBatchCategorize}
        count={selectedIds.size}
        categories={categories}
      />

      {/* Batch Delete Confirmation */}
      {showBatchDeleteConfirm && (
        <Modal
          isOpen={true}
          onClose={() => !isBatchProcessing && setShowBatchDeleteConfirm(false)}
          disableBackdropClose={isBatchProcessing}
        >
          <div className="p-4 space-y-4">
            <h3 className="text-lg font-bold text-brand-800">Batch Delete</h3>
            <p className="text-brand-600">
              Are you sure you want to delete <strong>{selectedIds.size}</strong> transactions?
            </p>
            <p className="text-sm text-money-neg font-bold">
              This action cannot be undone.
            </p>

            <div className="flex gap-3 pt-2">
              <Button
                variant="subtle"
                size="lg"
                onClick={() => setShowBatchDeleteConfirm(false)}
                disabled={isBatchProcessing}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={handleBatchDelete}
                isLoading={isBatchProcessing}
                leftIcon={<Trash2 size={18} />}
                className="flex-1"
              >
                Delete All
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Modal - Conditionally Rendered */}
      {editingTransaction && (
        <EditTransactionModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          transaction={editingTransaction}
        />
      )}

      {/* Split Modal - Conditionally Rendered */}
      {transactionToSplit && (
        <SplitTransactionModal
          isOpen={isSplitModalOpen}
          onClose={() => setIsSplitModalOpen(false)}
          transaction={transactionToSplit}
        />
      )}

      {/* Delete Confirmation Modal */}
      {transactionToDelete && (
        <Modal
          isOpen={true}
          onClose={() => !isDeleting && setTransactionToDelete(null)}
          disableBackdropClose={isDeleting}
        >
          <div className="p-4 space-y-4">
            <h3 className="text-lg font-bold text-brand-800">Confirm Delete</h3>
            <p className="text-brand-600">
              Are you sure you want to delete the transaction from <strong>{transactionToDelete.merchant}</strong> for <strong>${transactionToDelete.amount.toFixed(2)}</strong>?
            </p>
            <p className="text-sm text-money-neg font-bold">
              This action cannot be undone.
            </p>

            <div className="flex gap-3 pt-2">
              <Button
                variant="subtle"
                size="lg"
                onClick={() => setTransactionToDelete(null)}
                disabled={isDeleting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={confirmDelete}
                isLoading={isDeleting}
                leftIcon={<Trash2 size={18} />}
                className="flex-1"
              >
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      )}

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
                  handleEdit(actionTransaction);
                  setActionTransaction(null);
                }}
              >
                Edit Transaction
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Copy className="text-brand-500" />}
                onClick={() => {
                  handleDuplicate(actionTransaction);
                  setActionTransaction(null);
                }}
              >
                Duplicate
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Scissors className="text-brand-500" />}
                onClick={() => {
                  handleSplitClick(actionTransaction);
                  setActionTransaction(null);
                }}
              >
                Split Transaction
              </Button>
              <div className="h-px bg-gray-100 my-2" />
              <Button
                variant="ghost-destructive"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Trash2 />}
                onClick={() => {
                  handleDeleteClick(actionTransaction);
                  setActionTransaction(null);
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

export default TransactionMasterList;
