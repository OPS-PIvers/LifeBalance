import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Reorder } from 'framer-motion';
import { ChevronDown, Clock } from 'lucide-react';
import { ShoppingItem } from '@/types/schema';
import { ShoppingItemRow } from '@/components/meals/ShoppingItemRow';
import { QuickAddBar } from '@/components/ui/QuickAddBar';
import {
  ShoppingSortMode,
  sortShoppingItems,
  shoppingGroupLabel,
} from '@/utils/shoppingSort';
import { cn } from '@/utils/cn';

// ShoppingItemRow requires onCheck even in 'parked' mode (it's a no-op there
// — see the row's own guard); a stable module-level no-op keeps the memo
// comparator from seeing a "changed" prop on every render.
const noop = () => {};

interface SavedForLaterShoppingSectionProps {
  /** Raw parked items (`savedForLaterShopping`), UNSORTED/UNFILTERED — this
   *  component applies the page's active sort/filter itself, mirroring the
   *  main list, so the two sections can never silently disagree about what
   *  a given sort/filter combination means. */
  items: ShoppingItem[];
  sortMode: ShoppingSortMode;
  filterStore: string | null;
  categories: readonly string[];
  storeOrder: ReadonlyMap<string, number>;
  onPromote: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
  onEdit: (item: ShoppingItem) => void;
  /** Reorder.Group's onReorder — the same `reorderShoppingItems` mutation the
   *  main list uses; it just writes sequential `order` values over whatever
   *  array it's given, so reusing it here is safe (the two sections never
   *  share items, and each section's own sort only ever compares within
   *  itself). */
  onReorder: (items: ShoppingItem[]) => void;
  addValue: string;
  onAddValueChange: (value: string) => void;
  onAddSubmit: (e: React.FormEvent) => void;
  /**
   * The active deep-link/search highlight target (PR-5 makes parked items
   * findable in global search). A collapsed section renders its content with
   * `hidden` (display:none) rather than unmounting it — `scrollIntoView` and
   * the flash class on a `display:none` subtree are a SILENT no-op — so a
   * highlight naming one of this section's own rows must force it open. See
   * the render-phase edge check below.
   */
  highlightId?: string | null;
}

const CONTENT_ID = 'saved-for-later-shopping-content';

/**
 * "Saved for later" shopping section (PR-2 of the Saved-for-later feature —
 * see SAVED_FOR_LATER_SPEC.md). Renders BELOW the main shopping list, always
 * (header + add bar), even when there is nothing parked, so direct-add is
 * always reachable. Obeys the page's active store filter and sort mode —
 * including the drag-reorder gate (only 'entry' sort, no filter, exactly the
 * main list's rule) and the grouped-header rendering for the other modes.
 */
export const SavedForLaterShoppingSection: React.FC<SavedForLaterShoppingSectionProps> = ({
  items,
  sortMode,
  filterStore,
  categories,
  storeOrder,
  onPromote,
  onDelete,
  onEdit,
  onReorder,
  addValue,
  onAddValueChange,
  onAddSubmit,
  highlightId = null,
}) => {
  // Session-only collapse (deliberately NOT persisted) — mirrors ToDosPage's
  // `collapsedCategories` precedent: collapsing this section is a momentary
  // "get this out of my way", not a saved view.
  const [collapsed, setCollapsed] = useState(false);

  // Render-phase edge check (ToDosPage's `CompletedSection` precedent): the
  // FIRST render that receives a NEW `highlightId` naming a row IN THIS
  // SECTION forces it open, synchronously — before `useScrollToHighlight`'s
  // rAF looks for the row in the DOM. A plain `useEffect` here would be too
  // late (effects run after commit/paint, but so does the state update they
  // schedule — the parent's `useScrollToHighlight` effect can already have
  // queried the DOM by then). Checked against the RAW `items` prop, not the
  // filtered/sorted view, so a filtered-out target still opens the section
  // (the parent's own filter-clearing runs independently off the same
  // `highlightId`). Deliberately does NOT re-collapse when the highlight
  // fades — matches the ToDosPage precedent.
  const [consumedHighlightId, setConsumedHighlightId] = useState<string | null>(null);
  if (highlightId !== consumedHighlightId) {
    setConsumedHighlightId(highlightId);
    if (highlightId && collapsed && items.some(item => item.id === highlightId)) {
      setCollapsed(false);
    }
  }

  const filteredSorted = useMemo(() => {
    let sorted = sortShoppingItems(items, sortMode, categories, storeOrder);
    if (filterStore) sorted = sorted.filter(item => item.store === filterStore);
    return sorted;
  }, [items, sortMode, filterStore, categories, storeOrder]);

  // Drag-reorder is only live in 'entry' sort with no store filter — EXACTLY
  // the main list's rule (the other sorts are derived views that never write
  // `order`).
  const isReorderable = sortMode === 'entry' && !filterStore;

  // Local mirror for Reorder.Group, same isDraggingRef pattern the main list
  // uses for its own `items` state — kept independent so dragging in one
  // section never clobbers the other's live-sync effect.
  const [rows, setRows] = useState<ShoppingItem[]>([]);
  const isDraggingRef = useRef(false);
  useEffect(() => {
    if (isDraggingRef.current) return;
    setRows(filteredSorted);
  }, [filteredSorted]);

  const handleReorder = useCallback((newOrder: ShoppingItem[]) => {
    setRows(newOrder);
    onReorder(newOrder);
  }, [onReorder]);
  const handleReorderDragStart = useCallback(() => { isDraggingRef.current = true; }, []);
  const handleReorderDragEnd = useCallback(() => { isDraggingRef.current = false; }, []);

  // "Saved for later · 3 of 12" when the active filter narrows the section,
  // plain "Saved for later · 12" when it does not — the agreed mitigation
  // for the fact that parked items usually have no store/category and so
  // filter out easily.
  const totalCount = items.length;
  const filteredCount = filteredSorted.length;
  const countLabel = filteredCount < totalCount ? `${filteredCount} of ${totalCount}` : `${totalCount}`;

  return (
    <div>
      <h2>
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          aria-expanded={!collapsed}
          aria-controls={CONTENT_ID}
          className="w-full min-h-11 flex items-center gap-1.5 px-1 py-2 text-left rounded-card focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
        >
          <Clock size={14} aria-hidden="true" className="text-brand-400 dark:text-brand-450" />
          <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">
            Saved for later
          </span>
          <span className="text-xs tabular-nums text-brand-500 dark:text-brand-400">
            · {countLabel}
          </span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cn(
              'ml-auto shrink-0 text-brand-400 dark:text-brand-450 transition-transform duration-(--duration-fast) ease-(--ease-standard)',
              collapsed && '-rotate-90'
            )}
          />
        </button>
      </h2>

      {/* One rounded card: the add bar as its (borderless) first row, the row
          list below it — each row supplies its own hairline-divider, so the
          seam between the add bar and the first row is a single line, not a
          doubled one (no [&>*:first-child]:border-t-0 override needed, since
          — unlike the main list — this isn't split into two stacked/sticky
          cards). Always MOUNTED (hidden when collapsed) so the header
          button's aria-controls never references an absent id — but `hidden`
          is on THIS card itself (mirrors `SurfaceList`'s own precedent, e.g.
          ToDosPage's category sections), not on some inner wrapper: the add
          bar collapses along with the rows, and no empty bordered sliver is
          left behind under the header. */}
      <div id={CONTENT_ID} hidden={collapsed} className="surface-section overflow-hidden">
        <QuickAddBar
          attached
          onSubmit={onAddSubmit}
          value={addValue}
          onChange={onAddValueChange}
          placeholder="Save something for later..."
          disabled={!addValue.trim()}
          submitLabel="Add to saved for later"
        />

        {filteredSorted.length === 0 ? (
          <div className="hairline-divider px-3 py-4 text-sm text-brand-400 dark:text-brand-450">
            {totalCount === 0 ? 'Nothing saved for later.' : 'No parked items match this store filter.'}
          </div>
        ) : !isReorderable ? (
          filteredSorted.map((item, index) => {
            const label = shoppingGroupLabel(item, sortMode);
            const prev = index > 0 ? filteredSorted[index - 1] : undefined;
            const prevLabel = prev ? shoppingGroupLabel(prev, sortMode) : null;
            const isNewGroup = label !== null &&
              label.toLowerCase() !== prevLabel?.toLowerCase();
            return (
              <React.Fragment key={item.id}>
                {isNewGroup && (
                  <h3 className="hairline-divider px-3 pt-2.5 pb-1 text-xxs font-semibold uppercase tracking-wide text-brand-500 dark:text-brand-400 bg-brand-50/60 dark:bg-brand-900/40">
                    {label}
                  </h3>
                )}
                <ShoppingItemRow
                  item={item}
                  variant="parked"
                  onCheck={noop}
                  onPromote={onPromote}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  isReorderable={false}
                />
              </React.Fragment>
            );
          })
        ) : (
          <Reorder.Group axis="y" values={rows} onReorder={handleReorder} as="ul" className="list-none">
            {rows.map(item => (
              <ShoppingItemRow
                key={item.id}
                item={item}
                variant="parked"
                onCheck={noop}
                onPromote={onPromote}
                onDelete={onDelete}
                onEdit={onEdit}
                onReorderDragStart={handleReorderDragStart}
                onReorderDragEnd={handleReorderDragEnd}
              />
            ))}
          </Reorder.Group>
        )}
      </div>
    </div>
  );
};

export default SavedForLaterShoppingSection;
