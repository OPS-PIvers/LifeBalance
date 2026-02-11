import React, { useState, useMemo, useCallback } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Search, Filter, X, Trash2, Loader2, Download, Layers, CheckSquare, Tag, Check, Edit, Copy, Scissors } from 'lucide-react';
import { Transaction, INCOME_CATEGORY, CURRENCY_FORMAT_OPTIONS } from '../../types/schema';
import EditTransactionModal from '../modals/EditTransactionModal';
import SplitTransactionModal from '../modals/SplitTransactionModal';
import BatchCategorizeModal from '../modals/BatchCategorizeModal';
import { Modal } from '../ui/Modal';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import toast from 'react-hot-toast';
import { generateCsvExport } from '../../utils/exportUtils';
import { TransactionItem } from './TransactionItem';
import SavedViewChips from './SavedViewChips';

interface FilterControlsProps {
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
  sourceFilter: string;
  setSourceFilter: (value: string) => void;
  storeFilter: string;
  setStoreFilter: (value: string) => void;
  categories: string[];
  stores: { id: string; name: string }[];
  layout: 'row' | 'stack';
}

const FilterControls: React.FC<FilterControlsProps> = ({
  categoryFilter,
  setCategoryFilter,
  sourceFilter,
  setSourceFilter,
  storeFilter,
  setStoreFilter,
  categories,
  stores,
  layout
}) => {
  const isRow = layout === 'row';
  // Use slightly more compact styling for row layout, standard for stack
  const selectClass = isRow ? "py-2 min-w-[140px] text-sm" : "";

  return (
    <>
      {/* Category Filter */}
      <div className={isRow ? "" : "space-y-1"}>
        <Select
          label={!isRow ? "Category" : undefined}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className={selectClass}
        >
          <option value="all">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </Select>
      </div>

      {/* Source Filter */}
      <div className={isRow ? "" : "space-y-1"}>
        <Select
          label={!isRow ? "Source" : undefined}
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className={selectClass}
        >
          <option value="all">All Sources</option>
          <option value="recurring">Recurring</option>
          <option value="manual">Manual Entry</option>
          <option value="camera-scan">Camera Scan</option>
          <option value="file-upload">File Upload</option>
        </Select>
      </div>

      {/* Store Filter */}
      <div className={isRow ? "" : "space-y-1"}>
        <Select
          label={!isRow ? "Store" : undefined}
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          className={selectClass}
        >
          <option value="all">All Stores</option>
          {stores.map(s => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </Select>
      </div>
    </>
  );
};

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
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

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

  const activeFilterCount = useMemo(() =>
    (categoryFilter !== 'all' ? 1 : 0) + (sourceFilter !== 'all' ? 1 : 0) + (storeFilter !== 'all' ? 1 : 0),
    [categoryFilter, sourceFilter, storeFilter]
  );

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

  // Reusable filter props
  const filterProps = {
    categoryFilter,
    setCategoryFilter,
    sourceFilter,
    setSourceFilter,
    storeFilter,
    setStoreFilter,
    categories,
    stores,
  };


  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Filters Card */}
      <div className="bg-white/80 backdrop-blur-xl p-5 rounded-2xl border border-white/20 ring-1 ring-black/5 shadow-glass space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Input
            placeholder="Search merchant or amount..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            icon={<Search size={18} />}
            className="bg-white/50 border-slate-200/60 focus:bg-white transition-all"
          />
          {searchTerm && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 h-auto p-1 hover:bg-slate-100/50 shadow-none rounded-full"
            >
              <X size={14} />
            </Button>
          )}
        </div>

        {/* Mobile Filter & Select Toggle */}
        <div className="flex md:hidden items-center gap-2 mb-2">
           <Button
             variant="secondary"
             className="flex-1 justify-center"
             onClick={() => setIsFilterDrawerOpen(true)}
           >
             <Filter size={16} className="mr-2" />
             Filters {activeFilterCount > 0 && <span className="ml-1 bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full text-xs">{activeFilterCount}</span>}
           </Button>

           <Button
            onClick={() => setIsSelectionMode(!isSelectionMode)}
            variant={isSelectionMode ? 'primary' : 'subtle'}
            size="icon"
            aria-label="Toggle selection mode"
            className="h-11"
          >
            <Layers size={16} />
          </Button>
        </div>

        {/* Filter Chips / Dropdowns */}
        <div className="hidden md:flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <FilterControls {...filterProps} layout="row" />

          {(categoryFilter !== 'all' || sourceFilter !== 'all' || storeFilter !== 'all') && (
            <Button
              variant="subtle"
              size="sm"
              onClick={clearFilters}
            >
              Clear
            </Button>
          )}

          {/* Select Mode Toggle */}
          <Button
            variant={isSelectionMode ? 'primary' : 'subtle'}
            size="sm"
            onClick={() => setIsSelectionMode(!isSelectionMode)}
            leftIcon={<Layers size={16} />}
            title="Toggle selection mode"
            aria-label="Toggle selection mode"
            className="ml-auto"
          >
            <span className="hidden sm:inline">{isSelectionMode ? 'Done' : 'Select'}</span>
          </Button>

          {/* Export Button */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleExport}
            disabled={filteredTransactions.length === 0 || isSelectionMode}
            leftIcon={<Download size={16} />}
            className={isSelectionMode ? 'hidden sm:flex' : ''}
            title="Export filtered transactions to CSV"
            aria-label="Export filtered transactions to CSV"
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
      <div className="bg-white/80 backdrop-blur-xl p-6 rounded-2xl border border-white/20 ring-1 ring-black/5 shadow-glass">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 md:gap-8">

          <div className="grid grid-cols-2 md:grid-cols-4 w-full gap-4 md:gap-8 divide-x-0 md:divide-x divide-slate-100">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Income</p>
              <p className="text-2xl font-bold text-emerald-600 tracking-tight">
                +${summary.income.toLocaleString(undefined, CURRENCY_FORMAT_OPTIONS)}
              </p>
            </div>

            <div className="flex flex-col gap-1 md:pl-8">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Expense</p>
              <p className="text-2xl font-bold text-rose-600 tracking-tight">
                -${summary.expense.toLocaleString(undefined, CURRENCY_FORMAT_OPTIONS)}
              </p>
            </div>

            <div className="flex flex-col gap-1 md:pl-8">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Net</p>
              <p className={`text-2xl font-bold tracking-tight ${net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {net >= 0 ? '+' : ''}${net.toLocaleString(undefined, CURRENCY_FORMAT_OPTIONS)}
              </p>
            </div>

            <div className="flex flex-col gap-1 md:pl-8">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Count</p>
              <p className="text-2xl font-bold text-slate-700 tracking-tight">
                {summary.count}
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* Select All Bar */}
      {isSelectionMode && (
        <div className="flex items-center justify-between px-4 py-3 bg-brand-50/50 rounded-xl border border-brand-100/50 text-sm text-brand-700 animate-in fade-in slide-in-from-top-2">
          <Button
            variant="link"
            onClick={handleSelectAll}
            className="flex items-center gap-2 font-semibold hover:no-underline text-brand-700 hover:text-brand-900 p-0 h-auto"
          >
            <CheckSquare size={18} className={selectedIds.size === filteredTransactions.length && filteredTransactions.length > 0 ? 'text-brand-600' : 'text-brand-300'} />
            Select All ({filteredTransactions.length})
          </Button>
          <span className="text-xs font-medium bg-white px-2 py-1 rounded-md shadow-sm border border-brand-100">
            {selectedIds.size} selected
          </span>
        </div>
      )}

      {/* Transaction List */}
      <div className="space-y-2 pb-24">
        {filteredTransactions.length === 0 ? (
          <div className="text-center py-10 text-brand-400">
            <Filter className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>No transactions found matching your filters.</p>
            <Button
              variant="link"
              onClick={clearFilters}
              className="mt-2 font-bold text-sm"
            >
              Clear all filters
            </Button>
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

            <Button
              variant="ghost-inverted"
              onClick={() => setIsBatchCategorizeOpen(true)}
              disabled={isBatchProcessing}
              className="flex-col h-auto gap-0.5"
            >
              <Tag size={18} />
              <span className="text-xxs font-medium">Categorize</span>
            </Button>

            <Button
              variant="ghost-inverted"
              onClick={handleBatchVerify}
              disabled={isBatchProcessing}
              className="flex-col h-auto gap-0.5"
            >
              <Check size={18} />
              <span className="text-xxs font-medium">Verify</span>
            </Button>

            <Button
              variant="ghost-inverted"
              onClick={() => setShowBatchDeleteConfirm(true)}
              disabled={isBatchProcessing}
              className="flex-col h-auto gap-0.5 text-red-300 hover:text-red-200 hover:bg-white/10"
            >
              <Trash2 size={18} />
              <span className="text-xxs font-medium">Delete</span>
            </Button>
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
                disabled={isBatchProcessing}
                className="flex-1"
                leftIcon={isBatchProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 size={18} />}
              >
                <span>Delete All</span>
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
                disabled={isDeleting}
                className="flex-1"
                leftIcon={isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 size={18} />}
              >
                <span>Delete</span>
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

      {/* Mobile Filter Drawer */}
      <Drawer
        isOpen={isFilterDrawerOpen}
        onClose={() => setIsFilterDrawerOpen(false)}
        title="Filter Transactions"
      >
        <div className="space-y-4 pt-2">
          <FilterControls {...filterProps} layout="stack" />

          <div className="pt-4 space-y-3 border-t border-gray-100">
            {/* Export Button */}
            <Button
               variant="primary"
               className="w-full justify-center py-4"
               leftIcon={<Download />}
               onClick={() => {
                 handleExport();
                 setIsFilterDrawerOpen(false);
               }}
               disabled={filteredTransactions.length === 0}
            >
              Export to CSV
            </Button>

            {/* Clear Filters */}
            {(categoryFilter !== 'all' || sourceFilter !== 'all' || storeFilter !== 'all') && (
              <Button
                variant="ghost-destructive"
                className="w-full justify-center py-4"
                onClick={() => {
                  clearFilters();
                  setIsFilterDrawerOpen(false);
                }}
              >
                Clear All Filters
              </Button>
            )}
          </div>
        </div>
      </Drawer>
    </div>
  );
};

export default TransactionMasterList;
