import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useFinance, useGamification, useHouseholdCore, useShopping } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Search, Filter, X, Trash2, Loader2, Download, Layers, CheckSquare, Tag, Check, Edit, Copy, Scissors, Receipt, PlusCircle } from 'lucide-react';
import { Transaction, INCOME_CATEGORY } from '@/types/schema';
import EditTransactionModal from '@/components/modals/EditTransactionModal';
import SplitTransactionModal from '@/components/modals/SplitTransactionModal';
import BatchCategorizeModal from '@/components/modals/BatchCategorizeModal';
import { CaptureTransactionManual } from '@/components/modals/CaptureTransactionManual';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import { StatGroup, Stat } from '@/components/ui/Section';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import toast from 'react-hot-toast';
import { generateCsvExport } from '@/utils/exportUtils';
import { getLocalDateString } from '@/utils/dateHelpers';
import { roundMoney } from '@/utils/money';
import { usePowerToolsEnabled } from '@/hooks/usePowerToolsEnabled';
import { TransactionItem } from './TransactionItem';
import SavedViewChips from './SavedViewChips';
import FilterControls from './FilterControls';

// --- Main Component ---

const TransactionMasterList: React.FC = () => {
  const {
    transactions,
    deleteTransaction,
    updateTransaction,
    addTransaction,
    accounts,
    buckets: financeBuckets,
    hasMoreTransactions,
    isLoadingOlderTransactions,
    loadOlderTransactions,
    loadAllTransactions,
    transactionWindowStart,
  } = useFinance();
  const { householdId } = useHouseholdCore();
  const { stores } = useShopping();
  const { habits } = useGamification();
  const fmt = useFormatCurrency();
  const powerToolsEnabled = usePowerToolsEnabled();

  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchCategorizeOpen, setIsBatchCategorizeOpen] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [showBatchVerifyConfirm, setShowBatchVerifyConfirm] = useState(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [storeFilter, setStoreFilter] = useState<string>('all');

  // Add-first-transaction drawer state
  const [isAddingFirst, setIsAddingFirst] = useState(false);

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
    const totals = filteredTransactions.reduce(
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
    // Round the accumulated currency totals to the cent.
    return { income: roundMoney(totals.income), expense: roundMoney(totals.expense), count: totals.count };
  }, [filteredTransactions]);

  const net = roundMoney(summary.income - summary.expense);

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
        date: getLocalDateString(), // Default to today (local)
        status: 'verified',
        isRecurring: false,
        source: 'manual',
        autoCategorized: false,
        relatedHabitIds: [], // Don't carry over habit links
        // id/createdAt/createdBy/payPeriodId are assigned by addTransaction
      });
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

  const executeBatchVerify = async () => {
    if (selectedIds.size === 0) return;
    setShowBatchVerifyConfirm(false);
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

  const handleBatchVerify = () => {
    if (selectedIds.size === 0) return;
    setShowBatchVerifyConfirm(true);
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

  // Reusable filter props — memoized so the (now React.memo'd) FilterControls
  // keeps a stable props object and doesn't re-render on unrelated parent renders
  // (e.g. typing in the search box). Setters from useState are already stable.
  const filterProps = useMemo(() => ({
    categoryFilter,
    setCategoryFilter,
    sourceFilter,
    setSourceFilter,
    storeFilter,
    setStoreFilter,
    categories,
    stores,
  }), [categoryFilter, sourceFilter, storeFilter, categories, stores]);

  // Scroll container ref for the virtualizer
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Virtualizer — dynamic measurement via the library's built-in measureElement
  // which uses ResizeObserver borderBoxSize (when available) and falls back to
  // offsetHeight. estimateSize gives a reasonable first-pass so the initial
  // layout paint is close to correct; rows are remeasured once they mount.
  const virtualizer = useVirtualizer({
    count: filteredTransactions.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 84,   // ~84px per row in practice (padding + content)
    overscan: 5,
    getItemKey: (index) => filteredTransactions[index]?.id ?? index,
  });

  return (
    <div className="space-y-4 animate-in fade-in duration-(--duration-base)">
      {/* Search + Filters — flat on the page background, no wrapping card.
          Search + the mobile filter/select toggle share one row (UX audit
          Batch 3 — was 2 stacked blocks) instead of stacking. */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {/* Search Bar */}
          <div className="relative flex-1 min-w-0">
            <Input
              type="text"
              icon={<Search size={18} />}
              aria-label="Search transactions"
              placeholder="Search merchant or amount..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pr-10"
            />
            {searchTerm && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 h-auto p-0 hover:bg-transparent shadow-none"
              >
                <X size={16} />
              </Button>
            )}
          </div>

          {/* Mobile Filter & Select Toggle */}
          <div className="flex md:hidden items-center gap-2 shrink-0">
             <Button
               variant="secondary"
               size="icon"
               onClick={() => setIsFilterDrawerOpen(true)}
               aria-label="Filters"
               className="h-11 relative"
             >
               <Filter size={16} />
               {activeFilterCount > 0 && (
                 <span className="absolute -top-1 -right-1 bg-accent-600 text-white px-1 rounded-full text-xxs leading-tight min-w-[16px] text-center">
                   {activeFilterCount}
                 </span>
               )}
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

        {powerToolsEnabled && (
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
        )}
      </div>

      {/* Summary — collapsible (UX audit Batch 3): the Income/Expense/Net/Count
          figures duplicate what's recoverable from the visible list, so this
          is now a dismissible/collapsible block instead of a fixed section
          (still open by default — it's useful at-a-glance context). */}
      <CollapsibleSection
        title="Summary"
        summary={`${summary.count} txn${summary.count === 1 ? '' : 's'}`}
        defaultOpen={true}
      >
        <StatGroup>
          <Stat label="Income" value={`+${fmt(summary.income)}`} valueClassName="text-money-pos dark:text-money-posDark" />
          <Stat label="Expense" value={`-${fmt(summary.expense)}`} valueClassName="text-money-neg dark:text-money-negDark" />
          <Stat
            label="Net"
            value={`${net >= 0 ? '+' : ''}${fmt(net)}`}
            valueClassName={net >= 0 ? 'text-money-pos dark:text-money-posDark' : 'text-money-neg dark:text-money-negDark'}
          />
          <Stat label="Count" value={summary.count} />
        </StatGroup>
      </CollapsibleSection>

      {/* Select All Bar */}
      {isSelectionMode && (
        <div className="flex items-center justify-between px-2 text-sm text-brand-600 dark:text-brand-300">
          <Button
            variant="link"
            onClick={handleSelectAll}
            className="flex items-center gap-2 font-bold hover:no-underline"
          >
            <CheckSquare size={16} className={selectedIds.size === filteredTransactions.length && filteredTransactions.length > 0 ? 'text-brand-600 dark:text-brand-300' : 'text-brand-300 dark:text-brand-500'} />
            Select All ({filteredTransactions.length})
          </Button>
          <span className="text-xs">{selectedIds.size} selected</span>
        </div>
      )}

      {/* Windowing notice: filters/search only apply to the loaded window */}
      {transactionWindowStart && hasMoreTransactions && (searchTerm.trim() !== '' || activeFilterCount > 0) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 rounded-card bg-warm-50 dark:bg-warm-500/10 border border-warm-200 dark:border-warm-500/20 text-sm text-warm-800 dark:text-warm-200">
          <span>Showing recent transactions only — older ones aren’t searched yet.</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={loadAllTransactions}
            disabled={isLoadingOlderTransactions}
            leftIcon={isLoadingOlderTransactions ? <Loader2 size={14} className="animate-spin" /> : undefined}
            className="shrink-0"
          >
            Search all history
          </Button>
        </div>
      )}

      {/* Transaction List */}
      {filteredTransactions.length === 0 ? (
        transactions.length === 0 && searchTerm.trim() === '' && activeFilterCount === 0 ? (
          /* Zero-data empty state: no transactions at all and no active filters */
          <EmptyState
            variant="dashed"
            icon={<Receipt size={28} />}
            title="No transactions yet"
            description="Start tracking your spending by adding your first transaction."
            action={
              <Button
                onClick={() => setIsAddingFirst(true)}
                variant="primary"
                size="md"
                leftIcon={<PlusCircle size={16} />}
              >
                Add your first transaction
              </Button>
            }
          />
        ) : (
          /* Filter-empty state: transactions exist but none match the current search/filters */
          <EmptyState
            icon={<Filter className="w-7 h-7" />}
            title="No transactions found"
            description="Nothing matches your current search and filters."
            action={
              <Button
                variant="link"
                onClick={clearFilters}
                className="font-bold text-sm"
              >
                Clear all filters
              </Button>
            }
          />
        )
      ) : (
        /*
         * Bounded scroll container — the virtualizer needs a fixed-height
         * element to scroll inside so it can window the list.  64vh leaves
         * room for the header cards above and the bottom nav bar below.
         * pb-24 is kept on the inner spacer so the last item clears the FAB.
         */
        <div
          ref={scrollContainerRef}
          data-testid="virtual-scroll-container"
          className="surface-section overflow-y-auto"
          style={{ height: '64vh' }}
        >
          {/* Spacer that grows to the total measured height of all items */}
          <div
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const tx = filteredTransactions[virtualRow.index];
              if (!tx) return null;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingBottom: virtualRow.index === filteredTransactions.length - 1 ? '6rem' : '0.5rem',
                  }}
                >
                  <TransactionItem
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
                </div>
              );
            })}
          </div>

          {/* Load older (cursor pagination beyond the live 90-day window) */}
          {hasMoreTransactions && (
            <div className="pt-2 pb-4 flex justify-center">
              <Button
                variant="secondary"
                onClick={loadOlderTransactions}
                disabled={isLoadingOlderTransactions}
                leftIcon={isLoadingOlderTransactions ? <Loader2 size={16} className="animate-spin" /> : undefined}
              >
                {isLoadingOlderTransactions ? 'Loading…' : 'Load older transactions'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Floating Action Bar (FAB) for Batch Actions */}
      {isSelectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] left-0 right-0 px-4 md:px-0 flex justify-center z-dropdown pointer-events-none">
          <div className="bg-brand-800 text-white p-2 rounded-card shadow-raised border border-brand-700 flex items-center gap-2 pointer-events-auto animate-in slide-in-from-bottom-4 duration-(--duration-base)">
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
              className="flex-col h-auto gap-0.5 text-money-negDark hover:text-money-neg dark:hover:text-money-negDark hover:bg-white/10 rounded-btn"
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
      <ConfirmDialog
        isOpen={showBatchDeleteConfirm}
        onClose={() => { if (!isBatchProcessing) setShowBatchDeleteConfirm(false); }}
        onConfirm={handleBatchDelete}
        title="Batch Delete"
        message={
          <>
            Are you sure you want to delete <strong>{selectedIds.size}</strong> transactions? This action cannot be undone.
          </>
        }
        confirmLabel="Delete All"
        confirmVariant="destructive"
        isConfirming={isBatchProcessing}
      />

      {/* Batch Verify Confirmation */}
      <ConfirmDialog
        isOpen={showBatchVerifyConfirm}
        onClose={() => setShowBatchVerifyConfirm(false)}
        onConfirm={executeBatchVerify}
        title="Verify Transactions"
        message={
          <>
            Are you sure you want to verify <strong>{selectedIds.size}</strong> transactions?
          </>
        }
        confirmLabel="Verify"
        confirmVariant="primary"
        isConfirming={isBatchProcessing}
      />

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

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!transactionToDelete}
        onClose={() => { if (!isDeleting) setTransactionToDelete(null); }}
        onConfirm={confirmDelete}
        title="Confirm Delete"
        message={
          transactionToDelete ? (
            <>
              Are you sure you want to delete the transaction from <strong>{transactionToDelete.merchant}</strong> for <strong>{fmt(transactionToDelete.amount)}</strong>? This action cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
        isConfirming={isDeleting}
      />

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
              <div className="h-px bg-brand-200 dark:bg-brand-700 my-2" />
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

          <div className="pt-4 space-y-3 border-t border-brand-200 dark:border-brand-700">
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

      {/* Add First Transaction Drawer (opened from zero-data empty state) */}
      <Drawer
        isOpen={isAddingFirst}
        onClose={() => setIsAddingFirst(false)}
        title="Add Transaction"
      >
        <CaptureTransactionManual
          onAddTransaction={addTransaction}
          onClose={() => setIsAddingFirst(false)}
          dynamicCategories={financeBuckets.map(b => b.name)}
          habits={habits}
          transactions={transactions}
          buckets={financeBuckets}
          stores={stores}
          accounts={accounts}
        />
      </Drawer>
    </div>
  );
};

export default TransactionMasterList;
