import React from 'react';
import { ShoppingItem, Store as StoreType, QuickStockList } from '@/types/schema';
import { ShoppingBag, Minus, Plus, ChevronDown, Check } from 'lucide-react';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { FIELD_BASE } from '@/components/ui/fieldStyles';
import { cn } from '@/utils/cn';
import { parseQuantity, formatQuantity } from '@/utils/grocerySmartDefaults';
import type { SuggestedDefaults } from '@/utils/grocerySmartDefaults';

/**
 * The fields half of the "Edit item" sheet. The Save/Delete action bar
 * deliberately lives in the consuming `Drawer`'s `footer` prop (see
 * `ShoppingListTab`) so the CTA is pinned above the fold instead of sitting at
 * the bottom of the scrolled form.
 */
interface ShoppingItemFormProps {
  item: ShoppingItem;
  onChange: (item: ShoppingItem) => void;
  stores: StoreType[];
  categories: string[];
  quickStockLists?: QuickStockList[];
  activeQuickLists?: QuickStockList[];
  onQuickListToggle?: (item: ShoppingItem, listId: string, member: boolean) => void;
  suggestion?: SuggestedDefaults | null;
}

// O(1) lookup for quick-list icons.
const templateIconMap = new Map(TEMPLATE_ICONS.map(i => [i.id, i.icon]));

export const ShoppingItemForm: React.FC<ShoppingItemFormProps> = ({
  item,
  onChange,
  stores,
  categories,
  quickStockLists,
  activeQuickLists,
  onQuickListToggle,
  suggestion,
}) => {
  const handleFieldChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      onChange({ ...item, [e.target.name]: e.target.value });
    },
    [item, onChange]
  );

  // Apply the suggestion (category/store) once per item id, only when the
  // field is currently empty/Uncategorized. Guarded by a ref so re-renders of
  // the same item don't keep re-applying (e.g. after the user clears it back out).
  const appliedKeyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    // Key on id + name so renaming the item picks up the new suggestion,
    // while re-renders of the same item stay a no-op.
    const key = `${item.id}:${item.name}`;
    if (appliedKeyRef.current === key) return;
    appliedKeyRef.current = key;

    const needsCategory = (!item.category || item.category === 'Uncategorized') && !!suggestion?.category;
    const needsStore = !item.store && !!suggestion?.store;

    if (needsCategory || needsStore) {
      onChange({
        ...item,
        category: needsCategory ? suggestion!.category! : item.category,
        store: needsStore ? suggestion!.store! : item.store,
      });
    }
    // The id-ref guard above makes this once-per-item even with full deps.
  }, [item, suggestion, onChange]);

  const showCategorySuggestionHint =
    !!suggestion?.category && (item.category === suggestion.category);
  const showStoreSuggestionHint =
    !!suggestion?.store && (item.store === suggestion.store);

  // --- Quantity stepper ---
  // No explicit quantity set (undefined/empty — including the "1, no unit"
  // case, which formatQuantity always collapses back to '') reads as an
  // explicit "none" state (em-dash) rather than inventing a displayed "1".
  const hasQuantity = Boolean(item.quantity && String(item.quantity).trim());
  const parsedQuantity = React.useMemo(() => parseQuantity(item.quantity), [item.quantity]);

  const updateQuantity = React.useCallback(
    (next: { count?: number; unit?: string }) => {
      const merged = {
        count: next.count ?? parsedQuantity.count,
        unit: next.unit ?? parsedQuantity.unit,
      };
      onChange({ ...item, quantity: formatQuantity(merged) });
    },
    [item, onChange, parsedQuantity]
  );

  const handleDecrement = () => {
    if (parsedQuantity.count <= 1) {
      // Land on "none" in a single tap: clear the count AND the unit
      // together, instead of requiring a second action (blanking the unit
      // input by hand) to actually reach an empty/absent quantity.
      onChange({ ...item, quantity: undefined });
      return;
    }
    updateQuantity({ count: parsedQuantity.count - 1 });
  };
  const handleIncrement = () => {
    updateQuantity({ count: parsedQuantity.count + 1 });
  };
  const handleUnitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateQuantity({ unit: e.target.value });
  };

  // --- Store select (includes the item's current store if not in the list) ---
  const storeOptions = React.useMemo(() => {
    const names = stores.map(s => s.name);
    if (item.store && !names.some(n => n.toLowerCase() === item.store!.toLowerCase())) {
      return [...names, item.store];
    }
    return names;
  }, [stores, item.store]);

  // --- Quick lists dropdown ---
  const [isQuickListsOpen, setIsQuickListsOpen] = React.useState(false);
  const activeIds = React.useMemo(
    () => new Set((activeQuickLists ?? []).map(l => l.id)),
    [activeQuickLists]
  );
  const quickListsSummary =
    activeQuickLists && activeQuickLists.length > 0
      ? activeQuickLists.map(l => l.name).join(', ')
      : 'None';

  return (
    <div className="flex flex-col h-full">
        {/* px-4 matches the Drawer header/footer gutter so labels, fields, and
            the "Edit item" title all share one left edge. */}
        <div className="px-4 py-5 space-y-4 flex-1 overflow-y-auto">
            <Input
                label="Item name"
                type="text"
                name="name"
                value={item.name}
                onChange={handleFieldChange}
            />
            <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
                 <div>
                     <Select
                        label="Category"
                        name="category"
                        value={item.category || 'Uncategorized'}
                        onChange={handleFieldChange}
                     >
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </Select>
                    {showCategorySuggestionHint && (
                        <p className="text-xs text-brand-400 dark:text-brand-450 mt-1">Suggested</p>
                    )}
                 </div>
                <div>
                    <label className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider block mb-1.5">
                        Quantity
                    </label>
                    {/* One FIELD_BASE surface so it matches the selects' height exactly;
                        focus-within stands in for the inner input's focus ring. */}
                    <div
                        className={cn(
                            FIELD_BASE,
                            "flex items-stretch p-0 overflow-hidden focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/40"
                        )}
                    >
                        <button
                            type="button"
                            aria-label="Decrease quantity"
                            onClick={handleDecrement}
                            className="px-2.5 self-stretch text-brand-500 hover:bg-brand-100 dark:text-brand-400 dark:hover:bg-brand-700/50 transition-colors shrink-0"
                        >
                            <Minus size={14} />
                        </button>
                        <span
                            className="self-center font-medium min-w-[1.25rem] text-center tabular-nums"
                            aria-label={hasQuantity ? undefined : 'No quantity set'}
                        >
                            {hasQuantity ? parsedQuantity.count : '—'}
                        </span>
                        <button
                            type="button"
                            aria-label="Increase quantity"
                            onClick={handleIncrement}
                            className="px-2.5 self-stretch text-brand-500 hover:bg-brand-100 dark:text-brand-400 dark:hover:bg-brand-700/50 transition-colors shrink-0"
                        >
                            <Plus size={14} />
                        </button>
                        <span aria-hidden="true" className="w-px self-stretch bg-brand-200 dark:bg-brand-700" />
                        <input
                            type="text"
                            value={parsedQuantity.unit}
                            onChange={handleUnitChange}
                            placeholder="unit"
                            aria-label="Quantity unit"
                            className="min-w-0 flex-1 p-3 bg-transparent border-0 outline-hidden text-brand-900 dark:text-brand-100 placeholder:text-brand-400 dark:placeholder:text-brand-450"
                        />
                    </div>
                </div>
            </div>
            <div>
                <Select
                    label="Store"
                    name="store"
                    value={item.store || ''}
                    onChange={handleFieldChange}
                >
                    <option value="">No store</option>
                    {storeOptions.map(name => <option key={name} value={name}>{name}</option>)}
                </Select>
                {showStoreSuggestionHint && (
                    <p className="text-xs text-brand-400 dark:text-brand-450 mt-1">Suggested</p>
                )}
            </div>

            {/* Quick lists — compact multi-select dropdown */}
            {quickStockLists && quickStockLists.length > 0 && onQuickListToggle && (
                <div>
                    <label className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider block mb-1.5">
                        Quick lists
                    </label>
                    <button
                        type="button"
                        aria-expanded={isQuickListsOpen}
                        aria-controls="quick-lists-panel"
                        disabled={!item.name.trim()}
                        onClick={() => setIsQuickListsOpen(o => !o)}
                        className={cn(FIELD_BASE, "flex items-center justify-between text-left text-sm")}
                    >
                        <span className="truncate text-brand-900 dark:text-brand-100">{quickListsSummary}</span>
                        <ChevronDown
                            size={18}
                            className={cn(
                                "text-brand-400 dark:text-brand-450 transition-transform duration-(--duration-fast) ease-(--ease-standard) shrink-0",
                                isQuickListsOpen && "rotate-180"
                            )}
                        />
                    </button>
                    {isQuickListsOpen && (
                        <div id="quick-lists-panel" className="mt-2 border border-brand-200 dark:border-brand-700 rounded-btn overflow-hidden divide-y divide-brand-100 dark:divide-brand-700">
                            {quickStockLists.map(list => {
                                const ListIcon = (list.icon && templateIconMap.get(list.icon)) || ShoppingBag;
                                const isMember = activeIds.has(list.id);
                                return (
                                    <button
                                        key={list.id}
                                        type="button"
                                        aria-pressed={isMember}
                                        onClick={() => onQuickListToggle(item, list.id, !isMember)}
                                        className={cn(
                                            "w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left transition-colors",
                                            isMember
                                                ? "bg-accent-50 text-accent-800 dark:bg-accent-900/30 dark:text-accent-200"
                                                : "bg-white text-brand-700 hover:bg-brand-50 dark:bg-brand-800 dark:text-brand-300 dark:hover:bg-brand-700/50"
                                        )}
                                    >
                                        <ListIcon size={14} className="shrink-0" />
                                        <span className="flex-1 truncate">{list.name}</span>
                                        {isMember && <Check size={14} className="shrink-0" />}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    </div>
  );
};
