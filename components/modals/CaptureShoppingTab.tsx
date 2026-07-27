import React from 'react';
import { Store } from 'lucide-react';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import type { ResolvedItemDefaults } from '@/utils/grocerySmartDefaults';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
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

          <Input
            label="Store (optional)"
            type="text"
            value={effectiveStore}
            onChange={(e) => setStore(e.target.value)}
            placeholder="e.g. Costco, Trader Joe's"
            icon={<Store className="w-4 h-4" />}
          />
        </div>
      </CollapsibleSection>
    </form>
  );
};
