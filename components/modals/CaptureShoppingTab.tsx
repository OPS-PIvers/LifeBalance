import React from 'react';
import { Store as StoreIcon } from 'lucide-react';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import type { ResolvedItemDefaults } from '@/utils/grocerySmartDefaults';
import type { Store as StoreType } from '@/types/schema';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';

interface CaptureShoppingTabProps {
  /** Id put on the `<form>` so the Drawer's footer Save button can target it. */
  formId: string;
  name: string;
  setName: (value: string) => void;
  /**
   * Detail overrides. `undefined` means UNTOUCHED — the smart default for the
   * typed name is used instead, and keeps updating as the name changes. Any
   * other value (including `''`) is an explicit user choice and wins.
   */
  category: string | undefined;
  setCategory: (value: string) => void;
  quantity: string | undefined;
  setQuantity: (value: string) => void;
  store: string | undefined;
  setStore: (value: string) => void;
  /** The household's user-defined stores (F-MEALS-07), for the Store picker. */
  stores: StoreType[];
  /**
   * Persists a newly minted store name to the household's shared store list
   * (the same `addStore` mutation path used elsewhere), resolving it against
   * any existing store first so a case/whitespace variant reuses the
   * existing one instead of creating a duplicate. Resolves to the canonical
   * store name to select.
   */
  onAddStore: (name: string) => Promise<string | undefined>;
  /** Category/quantity/store inferred from the typed name (shared helper). */
  smartDefaults: ResolvedItemDefaults;
  onSubmit: (e: React.FormEvent) => void;
}

/**
 * Capture drawer → Shopping tab.
 *
 * ONE field is the whole fast path, matching the Shopping list page's
 * "Add item…" bar: type a name, hit Save, and category/quantity/store are
 * inferred from the grocery catalog by the SAME `resolveItemDefaults` helper
 * the page uses. The three detail fields live behind a collapsed "Add details"
 * disclosure that shows the inferred values, so nothing is hidden — editing
 * one pins it, leaving one alone keeps it following the name.
 */
export const CaptureShoppingTab: React.FC<CaptureShoppingTabProps> = ({
  formId,
  name,
  setName,
  category,
  setCategory,
  quantity,
  setQuantity,
  store,
  setStore,
  stores,
  onAddStore,
  smartDefaults,
  onSubmit,
}) => {
  const nameInputRef = useAutoFocus<HTMLInputElement>();

  // Effective values: explicit override if the user touched the field, else
  // whatever the typed name currently infers.
  const effectiveCategory = category ?? smartDefaults.category;
  const effectiveQuantity = quantity ?? smartDefaults.quantity ?? '';
  const effectiveStore = store ?? smartDefaults.store ?? '';

  const detailSummary = [effectiveCategory, effectiveQuantity, effectiveStore]
    .filter(Boolean)
    .join(' · ');

  // --- Store picker (household stores, plus an inline "add new" flow) ---
  // Options: the household's stores, plus the current/inferred value if it
  // isn't one of them yet (an AI/history-suggested store, or a legacy typed
  // value) — mirrors ShoppingItemForm's storeOptions so it's never silently
  // dropped from the field.
  const storeOptions = React.useMemo(() => {
    const names = stores.map(s => s.name);
    if (effectiveStore && !names.some(n => n.toLowerCase() === effectiveStore.toLowerCase())) {
      return [...names, effectiveStore];
    }
    return names;
  }, [stores, effectiveStore]);

  const [isAddingStore, setIsAddingStore] = React.useState(false);
  const [newStoreDraft, setNewStoreDraft] = React.useState('');
  const [isAddStoreBusy, setIsAddStoreBusy] = React.useState(false);
  const [addStoreError, setAddStoreError] = React.useState<string | null>(null);

  const closeAddStore = () => {
    setIsAddingStore(false);
    setNewStoreDraft('');
    setAddStoreError(null);
  };

  const confirmAddStore = async () => {
    if (isAddStoreBusy) return;
    const trimmed = newStoreDraft.trim();
    // Empty → just close the editor (no write), matching CategoryChipPicker.
    if (!trimmed) {
      closeAddStore();
      return;
    }
    setIsAddStoreBusy(true);
    try {
      const canonical = await onAddStore(trimmed);
      setStore(canonical ?? trimmed);
      closeAddStore();
    } catch (err) {
      console.error('[CaptureShoppingTab] Add store failed:', err);
      // Keep the editor open with the typed name so the user can retry.
      setAddStoreError("That didn't save. Check your connection and try again.");
    } finally {
      setIsAddStoreBusy(false);
    }
  };

  return (
    <form
      id={formId}
      onSubmit={onSubmit}
      className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-(--duration-base)"
      noValidate
    >
      <Input
        ref={nameInputRef}
        label="Item"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Add item…"
        autoComplete="off"
      />

      <CollapsibleSection
        title="Add details"
        subtitle="Category, quantity & store"
        summary={detailSummary}
        defaultOpen={false}
      >
        <div className="space-y-4">
          <Select
            label="Category"
            value={effectiveCategory}
            onChange={(e) => setCategory(e.target.value)}
          >
            {GROCERY_CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>

          <Input
            label="Quantity"
            type="text"
            value={effectiveQuantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="e.g. 2, 500g"
          />

          {/* The picker renders even when the household has no stores yet.
              Falling back to a free-text field there would strand the exact
              case this field exists for: a household's FIRST store gets typed
              most often at capture time, and a text field records it on the
              item without ever adding it to the shared list — so the next
              capture offers nothing again. An empty dropdown sitting above
              "+ Add a new store" is the honest state, and the way out of it
              is one tap. */}
          <div>
            <Select
              label="Store (optional)"
              value={effectiveStore}
              onChange={(e) => {
                // Picking a store while the "+ Add" editor is open is a
                // change of mind, so dismiss it (mirrors CategoryChipPicker).
                if (isAddingStore) closeAddStore();
                setStore(e.target.value);
              }}
              icon={<StoreIcon className="w-4 h-4" />}
            >
              <option value="">No store</option>
              {storeOptions.map(storeName => (
                <option key={storeName} value={storeName}>{storeName}</option>
              ))}
            </Select>

            {!isAddingStore ? (
              <button
                type="button"
                onClick={() => setIsAddingStore(true)}
                className="mt-1.5 text-xs font-semibold text-accent-600 dark:text-accent-300 hover:underline"
              >
                + Add a new store
              </button>
            ) : (
              <div className="mt-2 flex items-start gap-1.5">
                <Input
                  value={newStoreDraft}
                  onChange={(e) => {
                    setNewStoreDraft(e.target.value);
                    if (addStoreError) setAddStoreError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void confirmAddStore();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      closeAddStore();
                    }
                  }}
                  placeholder="New store name"
                  aria-label="New store name"
                  autoFocus
                  disabled={isAddStoreBusy}
                  error={addStoreError ?? undefined}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void confirmAddStore()}
                  disabled={isAddStoreBusy}
                  aria-label="Confirm new store"
                >
                  Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={closeAddStore}
                  disabled={isAddStoreBusy}
                  aria-label="Cancel adding store"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      </CollapsibleSection>
    </form>
  );
};
