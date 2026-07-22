import React, { useMemo, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import { ShoppingItem } from '@/types/schema';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { useShopping } from '@/contexts/FirebaseHouseholdContext';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';

export interface ShoppingReviewFormProps {
  /** The held-for-review shopping item being reviewed. */
  item: ShoppingItem;
  /** Called after a successful approve (or a delete when no `onDeleted`). */
  onDone: () => void;
  /** Called after a successful delete; falls back to `onDone` when omitted. */
  onDeleted?: () => void;
}

/**
 * The per-item review form for a held-for-review shopping capture
 * (`ShoppingItem.needsReview === true` — see utils/captureReview.ts). Mounted
 * by the cycling review drawer (Layer 3b) alongside TransactionReviewForm and
 * TodoReviewForm, and shares their conventions: every field is editable
 * inline, a single primary CTA approves (persisting any edits AND clearing
 * `needsReview` in one write), and a secondary confirm-gated row deletes.
 */
const ShoppingReviewForm: React.FC<ShoppingReviewFormProps> = ({ item, onDone, onDeleted }) => {
  const { approveShoppingItem, deleteShoppingItem, stores, groceryCategories } = useShopping();

  const categoryOptions = useMemo(
    () => (groceryCategories && groceryCategories.length > 0 ? groceryCategories : [...GROCERY_CATEGORIES]),
    [groceryCategories]
  );

  const [name, setName] = useState(() => item.name);
  const [quantity, setQuantity] = useState(() => item.quantity ?? '');
  const [category, setCategory] = useState(() => item.category || 'Uncategorized');
  const [store, setStore] = useState(() => item.store ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The item's current store might not be in the household's configured list
  // (e.g. renamed/deleted since capture) — keep it selectable so approving
  // without touching the field doesn't silently drop it.
  const storeOptions = useMemo(() => {
    const names = stores.map(s => s.name);
    if (store && !names.some(n => n.toLowerCase() === store.toLowerCase())) {
      return [...names, store];
    }
    return names;
  }, [stores, store]);

  const trimmedName = name.trim();
  const canApprove = trimmedName !== '';

  const handleApprove = async () => {
    if (!trimmedName) {
      toast.error('Item name is required');
      return;
    }

    const trimmedQuantity = quantity.trim();
    const overrides: Partial<Pick<ShoppingItem, 'name' | 'quantity' | 'category' | 'store'>> = {};
    if (trimmedName !== item.name) overrides.name = trimmedName;
    if (trimmedQuantity !== (item.quantity ?? '')) overrides.quantity = trimmedQuantity;
    if (category !== (item.category || 'Uncategorized')) overrides.category = category;
    if (store !== (item.store ?? '')) overrides.store = store;

    setIsSubmitting(true);
    try {
      await approveShoppingItem(item.id, Object.keys(overrides).length > 0 ? overrides : undefined);
      onDone();
    } catch (error) {
      console.error('Failed to approve shopping item:', error);
      toast.error('Failed to approve item');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = () => {
    showDeleteConfirmation(async () => {
      setIsSubmitting(true);
      try {
        await deleteShoppingItem(item.id);
        (onDeleted ?? onDone)();
      } finally {
        setIsSubmitting(false);
      }
    }, trimmedName || 'item');
  };

  return (
    <div className="space-y-4">
      <Input
        label="Item name"
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="e.g. Milk"
        autoFocus
      />

      <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
        <Select
          label="Category"
          value={category}
          onChange={e => setCategory(e.target.value)}
        >
          {categoryOptions.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <Input
          label="Quantity"
          type="text"
          value={quantity}
          onChange={e => setQuantity(e.target.value)}
          placeholder="e.g. 2"
        />
      </div>

      <Select
        label="Store"
        value={store}
        onChange={e => setStore(e.target.value)}
      >
        <option value="">No store</option>
        {storeOptions.map(storeName => (
          <option key={storeName} value={storeName}>{storeName}</option>
        ))}
      </Select>

      {/* Approve CTA */}
      <Button
        variant="success"
        size="lg"
        onClick={handleApprove}
        disabled={!canApprove}
        isLoading={isSubmitting}
        className="w-full py-3"
        leftIcon={<Check size={18} strokeWidth={3} />}
      >
        Add to list
      </Button>

      {/* Secondary delete row */}
      <div className="flex pt-1 border-t border-brand-200 dark:border-brand-700 mt-2">
        <Button
          variant="ghost-danger"
          size="sm"
          className="flex-1 text-xs"
          leftIcon={<Trash2 size={14} />}
          onClick={handleDelete}
          disabled={isSubmitting}
        >
          Discard
        </Button>
      </div>
    </div>
  );
};

export default ShoppingReviewForm;
