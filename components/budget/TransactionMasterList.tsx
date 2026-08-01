import React, { useState, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useFinance, useGamification, useHouseholdCore, useShopping } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useMerchantRules } from '@/hooks/useMerchantRules';
import { Search, Filter, X, Trash2, Loader2, Download, Layers, CheckSquare, Tag, Check, Edit, Copy, Scissors, Receipt, PlusCircle, GitMerge } from 'lucide-react';
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
import CountBadge from '@/components/ui/CountBadge';
import { StatGroup, Stat } from '@/components/ui/Section';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import toast from 'react-hot-toast';
import { generateCsvExport, buildTransactionExportRows } from '@/utils/exportUtils';
import { getLocalDateString } from '@/utils/dateHelpers';
import { roundMoney } from '@/utils/money';
import { pickKeeper } from '@/utils/transactionMerge';
import { findSettledBill } from '@/utils/settledBillGuard';
import { usePowerToolsEnabled } from '@/hooks/usePowerToolsEnabled';
import { useScrollToHighlight } from '@/hooks/useScrollToHighlight';
import { TransactionItem } from './TransactionItem';
import SavedViewChips from './SavedViewChips';
import FilterControls from './FilterControls';

interface TransactionMasterListProps {
  /**
   * A transaction id to scroll-to + briefly flash on mount/update (global
   * search deep-link, Plan 14 v1.1 — see `useDeepLinkHighlight` in `Budget`).
   * Cleared automatically by the caller after a few seconds.
   */
  highlightId?: string | null;
}

/** Form id linking the "add your first transaction" form to its footer Save. */
const ADD_FIRST_FORM_ID = 'add-first-transaction-form';

/**
 * Keeper rule for a hand-picked merge started from the row kebab.
 *
 * `pickKeeper` knows nothing about bills, so the calendar-linked row is chosen
 * HERE (same reasoning as `TransactionReviewForm`'s settled-bill arm): the row
 * carrying `paidCalendarItemId` is wired to a paid calendar doc, deleting it
 * would orphan that bill, and `mergeTransactions` refuses outright when the
 * DUPE settled a bill. Only when both rows (or neither) settled one does the
 * shared `pickKeeper` precedence decide.
 */
const pickMergeKeeper = (a: Transaction, b: Transaction) => {
  if (!!a.paidCalendarItemId !== !!b.paidCalendarItemId) {
    return a.paidCalendarItemId ? { keeper: a, dupe: b } : { keeper: b, dupe: a };
  }
  return pickKeeper(a, b);
};

// --- Main Component ---

const TransactionMasterList: React.FC<TransactionMasterListProps> = ({ highlightId = null }) => {
  const {
    transactions,
    deleteTransaction,
    updateTransaction,
    addTransaction,
    mergeTransactions,
    accounts,
    buckets: financeBuckets,
    hasMoreTransactions,
    isLoadingOlderTransactions,
    loadOlderTransactions,
    loadAllTransactions,
    transactionWindowStart,
    calendarItems,
    defaultAccountId,
  } = useFinance();
  const { householdId, household } = useHouseholdCore();
  const { stores } = useShopping();
  const { habits } = useGamification();
  const fmt = useFormatCurrency();
  // Merchant rules resolved ONCE at the component level — never per virtualized
  // row inside the render callback, which would rebuild the helper identities on
  // every scroll frame. Rows resolve their own display name (see TransactionItem).
  const { displayNameFor, searchTermsFor, rules: merchantRules } = useMerchantRules();
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
  // Save-in-flight for the "add your first transaction" drawer; its Save
  // button lives in the Drawer footer, outside CaptureTransactionManual.
  const [isAddingFirstSubmitting, setIsAddingFirstSubmitting] = useState(false);

  // Edit Modal State
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Split Modal State
  const [transactionToSplit, setTransactionToSplit] = useState<Transaction | null>(null);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);

  // Delete Confirmation State
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Merge-selection State ("Merge with recent", from the row kebab). Lives HERE
  // and not in the row: the list is windowed, so row-local state is destroyed
  // the moment the virtualizer recycles a row out of the viewport.
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [mergePartner, setMergePartner] = useState<Transaction | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  // Mobile Action Drawer State
  const [actionTransaction, setActionTransaction] = useState<Transaction | null>(null);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

  // Export State (F-MONEY-10) — "Export all" loads the full transaction
  // history via loadAllTransactions() before generating the CSV, so it can
  // take a moment on large households.
  const [isExportingAll, setIsExportingAll] = useState(false);

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
  // Shared predicate so "Export all" can apply the same active filters to the
  // full loaded history, not just the live windowed `transactions` set.
  const matchesActiveFilters = useCallback((tx: Transaction) => {
    // Search Filter (Merchant or Amount).
    //
    // The merchant side matches EITHER spelling: the raw bank descriptor the
    // user remembers from their statement, or the friendly name a merchant rule
    // renamed it to — `searchTermsFor` returns both, so renaming a merchant
    // never makes a row unfindable by the text it was originally found by.
    // An empty query short-circuits so a rule-less scroll does no matching work.
    const query = searchTerm.trim().toLowerCase();
    const matchesSearch =
      query === '' ||
      searchTermsFor({ merchant: tx.merchant, amount: tx.amount })
        .some(term => term.toLowerCase().includes(query)) ||
      tx.amount.toString().includes(query);

    // Category Filter
    const matchesCategory = categoryFilter === 'all' || tx.category === categoryFilter;

    // Source Filter
    const matchesSource = sourceFilter === 'all' ||
      (sourceFilter === 'recurring' && tx.isRecurring) ||
      (sourceFilter === 'manual' && tx.source === 'manual') ||
      (sourceFilter === 'image-capture' && tx.source === 'image-capture') ||
      (sourceFilter === 'camera-scan' && tx.source === 'camera-scan') ||
      (sourceFilter === 'file-upload' && tx.source === 'file-upload') ||
      // Bank rows created before the dedicated 'bank-sync' source value (PR
      // #1047) were stamped source 'shortcut' + a bankRef, so bankRef presence
      // is the authoritative bank-sync signal and legacy rows must not
      // pollute the Shortcut filter.
      (sourceFilter === 'bank-sync' && (tx.source === 'bank-sync' || tx.bankRef !== undefined)) ||
      (sourceFilter === 'shortcut' && tx.source === 'shortcut' && tx.bankRef === undefined) ||
      (sourceFilter === 'plaid' && tx.source === 'plaid');

    // Store Filter
    const matchesStore = storeFilter === 'all' || tx.store === storeFilter;

    return matchesSearch && matchesCategory && matchesSource && matchesStore;
    // `searchTermsFor` is memoized on the rules array identity, so editing a
    // merchant rule re-runs the filter (and the memos below it) exactly once.
  }, [searchTerm, categoryFilter, sourceFilter, storeFilter, searchTermsFor]);

  const filteredTransactions = useMemo(() => {
    return transactions
      .filter(matchesActiveFilters)
      // Optimize sort: String comparison of ISO dates is ~12x faster than parsing Date objects
      .sort((a, b) => {
        if (b.date > a.date) return 1;
        if (b.date < a.date) return -1;
        return 0;
      });
  }, [transactions, matchesActiveFilters]);

  // Account id -> name lookup for the CSV export's Account column.
  const accountsById = useMemo(() => new Map(accounts.map(a => [a.id, a.name])), [accounts]);

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

  // Resolved from the live `transactions` list (not the filtered one) so the
  // source survives a filter/search change while merge mode is active.
  const mergeSource = useMemo(
    () => (mergeSourceId ? transactions.find(t => t.id === mergeSourceId) ?? null : null),
    [transactions, mergeSourceId]
  );

  const cancelMerge = useCallback(() => {
    setMergeSourceId(null);
    setMergePartner(null);
  }, []);

  const handleMergeStart = useCallback((tx: Transaction) => {
    setIsSelectionMode(false);
    setMergePartner(null);
    setMergeSourceId(tx.id);
  }, []);

  const handleMergeSelect = useCallback((tx: Transaction) => {
    setMergePartner(tx);
  }, []);

  const confirmMerge = async () => {
    if (!mergeSource || !mergePartner || isMerging) return;
    setIsMerging(true);
    try {
      const { keeper, dupe } = pickMergeKeeper(mergeSource, mergePartner);
      const merged = await mergeTransactions(keeper.id, dupe.id);
      // A refusal (e.g. the mutation's settled-bill guard) writes nothing and
      // toasts its own reason — stay in merge mode so another pick is possible.
      setMergePartner(null);
      if (merged) setMergeSourceId(null);
    } catch (error) {
      console.error('Failed to merge transactions:', error);
      toast.error('Failed to merge transactions');
    } finally {
      setIsMerging(false);
    }
  };

  // Entering selection mode leaves merge mode (and vice versa) — the two modes
  // recolor the same rows and must never be active at once.
  const toggleSelectionMode = useCallback(() => {
    cancelMerge();
    setIsSelectionMode(prev => !prev);
  }, [cancelMerge]);

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

      // Rules add the friendly `Name` column alongside the untouched raw
      // `Merchant` column, so the sheet is readable AND still reconcilable
      // against the bank statement.
      const exportData = buildTransactionExportRows(filteredTransactions, accountsById, household?.currency, merchantRules);
      generateCsvExport(exportData, 'transactions-export');
      toast.success('Export started');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export transactions');
    }
  };

  // "Export all" (F-MONEY-10): loads the household's complete transaction
  // history — beyond the live windowed `transactions` set — then applies the
  // same active filters before generating the CSV.
  const handleExportAll = async () => {
    setIsExportingAll(true);
    try {
      const allTransactions = await loadAllTransactions();
      const scoped = allTransactions.filter(matchesActiveFilters);

      if (scoped.length === 0) {
        toast.error('No transactions to export');
        return;
      }

      const exportData = buildTransactionExportRows(scoped, accountsById, household?.currency, merchantRules);
      generateCsvExport(exportData, 'transactions-export-all');
      toast.success(`Exported ${scoped.length} transactions`);
    } catch (error) {
      console.error('Export all failed:', error);
      toast.error('Failed to export transactions');
    } finally {
      setIsExportingAll(false);
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

  // List wrapper ref — used only to measure the list's offset within the page
  // scroller (scrollMargin); the wrapper itself no longer scrolls.
  const listWrapperRef = useRef<HTMLDivElement>(null);

  // Offset of the list wrapper inside the page scroller. Stored in a ref (the
  // standard tanstack "scrolling a parent element" pattern) and read on every
  // render — 0 until the first re-render AFTER layout (the effect updates the
  // ref but doesn't itself re-render); data/filter renders pick it up almost
  // immediately, and overscan absorbs the brief window.
  const listOffsetRef = useRef(0);
  useLayoutEffect(() => {
    listOffsetRef.current = listWrapperRef.current?.offsetTop ?? 0;
  });

  // Stable identity: a new getScrollElement reference makes the virtualizer
  // detach/re-attach its scroll listener on every render.
  const getScrollElement = useCallback(
    () =>
      (document.getElementById('main-content') ??
        document.scrollingElement ??
        document.documentElement) as HTMLElement,
    [],
  );

  // Virtualizer — the app uses a single page scroller (MainLayout's
  // <main id="main-content">), so the virtualizer windows against the PAGE
  // scroll element rather than a nested overflow container. scrollMargin
  // tells it how far the list wrapper sits from the top of that scroller.
  // In unit tests (rendered without MainLayout) #main-content is absent —
  // fall back to the document's scrolling element so the virtualizer still
  // has a valid scroll element and never throws.
  //
  // Dynamic measurement via the library's built-in measureElement which uses
  // ResizeObserver borderBoxSize (when available) and falls back to
  // offsetHeight. estimateSize gives a reasonable first-pass so the initial
  // layout paint is close to correct; rows are remeasured once they mount.
  const virtualizer = useVirtualizer({
    count: filteredTransactions.length,
    getScrollElement,
    scrollMargin: listOffsetRef.current,
    estimateSize: () => 84,   // ~84px per row in practice (padding + content)
    overscan: 5,
    getItemKey: (index) => filteredTransactions[index]?.id ?? index,
  });

  // Global search deep-link (Plan 14 v1.1): the target row may not be in the
  // virtualizer's currently-rendered window, so scroll it into range first
  // (onBeforeScroll) — useScrollToHighlight then queries the DOM a frame
  // later, by which point the row has mounted.
  const scrollToHighlightedIndex = useCallback(() => {
    if (!highlightId) return;
    const index = filteredTransactions.findIndex((tx) => tx.id === highlightId);
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: 'center' });
    }
  }, [highlightId, filteredTransactions, virtualizer]);
  useScrollToHighlight(highlightId, scrollToHighlightedIndex);

  return (
    <div className="space-y-4 animate-in fade-in duration-(--duration-base)">
      {/* Summary — hero content: the Income/Expense/Net/Count figures lead the
          tab so the at-a-glance totals sit above the search/filter controls and
          the list. Still collapsible (open by default) so power users can
          reclaim the space. */}
      <CollapsibleSection
        title="Summary"
        summary={`${summary.count} transaction${summary.count === 1 ? '' : 's'}`}
        defaultOpen={true}
      >
        <StatGroup>
          <Stat label="Income" value={`+${fmt(summary.income)}`} valueClassName="text-money-pos dark:text-money-posDark" />
          <Stat label="Expense" value={`-${fmt(summary.expense)}`} valueClassName="text-money-neg dark:text-money-negDark" />
          {/* The transaction count rides as the Net stat's caption instead of a
              fourth Stat — at 375px a "Count" figure wrapped alone onto its own
              orphan line under the three money figures. */}
          <Stat
            label={`Net · ${summary.count} transaction${summary.count === 1 ? '' : 's'}`}
            value={`${net >= 0 ? '+' : ''}${fmt(net)}`}
            valueClassName={net >= 0 ? 'text-money-pos dark:text-money-posDark' : 'text-money-neg dark:text-money-negDark'}
          />
        </StatGroup>
      </CollapsibleSection>

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
              placeholder="Search transactions"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-11 pr-10 truncate"
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
               aria-label={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
               className="h-11 relative"
             >
               <Filter size={16} />
               <CountBadge count={activeFilterCount} className="bg-accent-600" />
             </Button>

             <Button
              onClick={toggleSelectionMode}
              variant={isSelectionMode ? 'primary' : 'subtle'}
              size="icon"
              aria-label="Toggle selection mode"
              aria-pressed={isSelectionMode}
              className="h-11"
            >
              <Layers size={16} />
            </Button>
          </div>

          {/* Saved views (power tools) — a compact bookmark popover beside the
              filter/select icons, so saved presets never occupy a row of their
              own below the filters (previously a permanent "Save View" row). */}
          {powerToolsEnabled && (
            <SavedViewChips
              key={householdId}
              householdId={householdId}
              currentFilters={{ searchTerm, categoryFilter, sourceFilter }}
              onApply={(filters) => {
                setSearchTerm(filters.searchTerm);
                setCategoryFilter(filters.categoryFilter);
                setSourceFilter(filters.sourceFilter);
              }}
            />
          )}
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
            onClick={toggleSelectionMode}
            leftIcon={<Layers size={16} />}
            title="Toggle selection mode"
            aria-label="Toggle selection mode"
            aria-pressed={isSelectionMode}
            className="ml-auto"
          >
            <span className="hidden sm:inline">{isSelectionMode ? 'Done' : 'Select'}</span>
          </Button>

          {/* Export Button (filtered / current window) */}
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

          {/* Export All Button (full history, F-MONEY-10) */}
          <Button
            variant="subtle"
            size="sm"
            onClick={handleExportAll}
            disabled={isSelectionMode || isExportingAll}
            leftIcon={isExportingAll ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            className={isSelectionMode ? 'hidden sm:flex' : ''}
            title="Export full transaction history to CSV"
            aria-label="Export full transaction history to CSV"
          >
            <span className="hidden sm:inline">{isExportingAll ? 'Exporting…' : 'Export all'}</span>
          </Button>
        </div>
      </div>

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

      {/* Merge-selection banner — makes the active mode obvious and carries the
          only way out of it besides completing the merge. */}
      {mergeSource && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 rounded-card bg-accent-50 dark:bg-accent-900/30 border border-accent-200 dark:border-accent-700 text-sm text-accent-800 dark:text-accent-100">
          <span>
            Pick the transaction to merge with{' '}
            <strong>{displayNameFor({ merchant: mergeSource.merchant, amount: mergeSource.amount })}</strong>.
          </span>
          <Button variant="secondary" size="sm" onClick={cancelMerge} className="shrink-0">
            Cancel merge
          </Button>
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
         * List wrapper — no nested scroller: the list occupies its natural
         * (total-size) height and the PAGE scroller (#main-content) does the
         * scrolling. The virtualizer positions rows relative to the page
         * scroller, so each row subtracts scrollMargin (the wrapper's offset
         * within the scroller) from its absolute start.
         */
        <div
          ref={listWrapperRef}
          data-testid="virtual-scroll-container"
          className="surface-section"
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
                  // Search deep-link target (see useScrollToHighlight) — flash
                  // applied imperatively via DOM classList so TransactionItem's
                  // narrow memo comparator doesn't need a highlight prop.
                  data-highlight-target={tx.id}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
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
                    isMergeMode={!!mergeSource}
                    isMergeSource={tx.id === mergeSourceId}
                    onMergeSelect={handleMergeSelect}
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
        <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-0 right-0 px-4 md:px-0 flex justify-center z-dropdown pointer-events-none">
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
          transactionToDelete ? (() => {
            // Deleting a row that settled a bill now ALSO un-pays that bill in
            // the same batch (see makeDeleteTransaction). That reopens it in
            // unpaid bills and moves Safe-to-Spend, so it has to be said before
            // the user confirms — not discovered afterwards in a toast.
            const settledBill = findSettledBill(transactionToDelete, calendarItems);
            return (
              <>
                Are you sure you want to delete the transaction from <strong>{displayNameFor({ merchant: transactionToDelete.merchant, amount: transactionToDelete.amount })}</strong> for <strong>{fmt(transactionToDelete.amount)}</strong>? This action cannot be undone.
                {settledBill && (
                  <> This also marks <strong>{settledBill.title}</strong> unpaid on the calendar.</>
                )}
              </>
            );
          })() : null
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
        isConfirming={isDeleting}
      />

      {/* Merge Confirmation — nothing is written until this is confirmed. */}
      <ConfirmDialog
        isOpen={!!mergeSource && !!mergePartner}
        onClose={() => { if (!isMerging) setMergePartner(null); }}
        onConfirm={confirmMerge}
        title="Merge Transactions"
        message={
          mergeSource && mergePartner ? (() => {
            // Name the row that ACTUALLY survives. `pickMergeKeeper` can choose
            // the partner (a calendar-linked row always wins), so phrasing this
            // as "partner into source" would promise the wrong survivor exactly
            // when the two rows differ most — which is the whole reason to merge.
            const { keeper, dupe } = pickMergeKeeper(mergeSource, mergePartner);
            return (
              <>
                Merge <strong>{displayNameFor({ merchant: dupe.merchant, amount: dupe.amount })}</strong> ({fmt(dupe.amount)}) into{' '}
                <strong>{displayNameFor({ merchant: keeper.merchant, amount: keeper.amount })}</strong> ({fmt(keeper.amount)})?{' '}
                {displayNameFor({ merchant: keeper.merchant, amount: keeper.amount })} survives and the other row is removed.
              </>
            );
          })() : null
        }
        confirmLabel="Merge"
        confirmVariant="primary"
        isConfirming={isMerging}
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
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={<GitMerge className="text-brand-500" />}
                onClick={() => {
                  handleMergeStart(actionTransaction);
                  setActionTransaction(null);
                }}
              >
                Merge with recent
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

            {/* Export All Button (full history, F-MONEY-10) */}
            <Button
               variant="subtle"
               className="w-full justify-center py-4"
               leftIcon={isExportingAll ? <Loader2 className="animate-spin" /> : <Download />}
               onClick={async () => {
                 await handleExportAll();
                 setIsFilterDrawerOpen(false);
               }}
               disabled={isExportingAll}
            >
              {isExportingAll ? 'Exporting…' : 'Export all history to CSV'}
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

      {/* Add First Transaction Drawer (opened from zero-data empty state).
          Save lives in the Drawer's fixed footer (never a scroll away) and is
          associated back to the form by `form={ADD_FIRST_FORM_ID}` — the same
          pattern the Capture drawer and ToDosPage use. */}
      <Drawer
        isOpen={isAddingFirst}
        onClose={() => setIsAddingFirst(false)}
        title="Add Transaction"
        footer={
          <div className="bg-white dark:bg-brand-800 border-t border-brand-200 dark:border-brand-700 p-4">
            <Button
              type="submit"
              form={ADD_FIRST_FORM_ID}
              variant="primary"
              isLoading={isAddingFirstSubmitting}
              className="w-full py-3.5"
            >
              Save transaction
            </Button>
          </div>
        }
      >
        <CaptureTransactionManual
          formId={ADD_FIRST_FORM_ID}
          onSubmittingChange={setIsAddingFirstSubmitting}
          onAddTransaction={addTransaction}
          onClose={() => setIsAddingFirst(false)}
          dynamicCategories={financeBuckets.map(b => b.name)}
          habits={habits}
          transactions={transactions}
          stores={stores}
          accounts={accounts}
          defaultAccountId={defaultAccountId}
        />
      </Drawer>
    </div>
  );
};

export default TransactionMasterList;
