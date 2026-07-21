import React from 'react';

export interface FilterControlsProps {
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

/**
 * Category / Source / Store filter dropdowns for the transaction list.
 *
 * Extracted from TransactionMasterList and wrapped in React.memo so it doesn't
 * re-render on every parent render (e.g. each keystroke in the search box). The
 * parent passes a memoized props object with stable setter references, so this
 * component only re-renders when a filter value, the category/store options, or
 * the layout actually change.
 */
const FilterControls: React.FC<FilterControlsProps> = ({
  categoryFilter,
  setCategoryFilter,
  sourceFilter,
  setSourceFilter,
  storeFilter,
  setStoreFilter,
  categories,
  stores,
  layout,
}) => {
  const isRow = layout === 'row';
  const selectClass = isRow
    ? 'px-3 py-2 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-btn text-sm text-brand-700 dark:text-brand-200 outline-hidden focus:border-accent-500 focus:ring-2 focus:ring-accent-500/40 min-w-[120px]'
    : 'w-full px-4 py-3 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-btn text-base text-brand-700 dark:text-brand-200 outline-hidden focus:border-accent-500 focus:ring-2 focus:ring-accent-500/40';

  return (
    <>
      {/* Category Filter */}
      <div className={isRow ? '' : 'space-y-1'}>
        {!isRow && <label className="text-sm font-medium text-brand-600 dark:text-brand-300">Category</label>}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className={selectClass}
        >
          <option value="all">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* Source Filter */}
      <div className={isRow ? '' : 'space-y-1'}>
        {!isRow && <label className="text-sm font-medium text-brand-600 dark:text-brand-300">Source</label>}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className={selectClass}
        >
          <option value="all">All Sources</option>
          <option value="recurring">Recurring</option>
          <option value="manual">Manual Entry</option>
          <option value="camera-scan">Camera Scan</option>
          <option value="file-upload">File Upload</option>
          <option value="bank-sync">Bank Sync</option>
        </select>
      </div>

      {/* Store Filter */}
      <div className={isRow ? '' : 'space-y-1'}>
        {!isRow && <label className="text-sm font-medium text-brand-600 dark:text-brand-300">Store</label>}
        <select
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          className={selectClass}
        >
          <option value="all">All Stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </select>
      </div>
    </>
  );
};

export default React.memo(FilterControls);
