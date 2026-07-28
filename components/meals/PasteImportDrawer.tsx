import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardPaste, Loader2 } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import { useShopping } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';
import Textarea from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { ShoppingItem } from '@/types/schema';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { parsePastedIngredientList, MAX_PASTE_IMPORT_ITEMS } from '@/utils/parsePastedIngredientList';
import type { OptimizableItem } from '@/services/geminiService.types';

interface PasteImportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  householdId: string | null;
}

/**
 * "Import list" — paste a block of text (e.g. a recipe's copied ingredient
 * list) and turn it into shopping-list items in one shot (F-MEALS-09).
 *
 * Client-side only: `parsePastedIngredientList` splits the paste into raw
 * candidate names, `optimizeGroceryList()` (Gemini) normalizes each name and
 * assigns a category, then everything lands in one atomic `addShoppingItems`
 * batch write. Items already on the list (case-insensitive name match) are
 * skipped, matching the existing "smart filtering" duplicate-prevention
 * convention used elsewhere in the shopping list.
 */
export const PasteImportDrawer: React.FC<PasteImportDrawerProps> = ({ isOpen, onClose, householdId }) => {
  const { shoppingList, addShoppingItems, groceryCategories, stores } = useShopping();
  const [text, setText] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  const categories = groceryCategories && groceryCategories.length > 0
    ? groceryCategories
    : [...GROCERY_CATEGORIES];

  const handleClose = () => {
    if (isImporting) return;
    setText('');
    onClose();
  };

  const handleImport = async () => {
    if (!householdId) {
      toast.error('Household ID missing');
      return;
    }

    const rawNames = parsePastedIngredientList(text);
    if (rawNames.length === 0) {
      toast.error('Paste an ingredient list to import');
      return;
    }

    // Skip anything already pending on the list (case-insensitive), same
    // "don't re-add what's already there" convention as the rest of the
    // shopping list.
    const existingNames = new Set(shoppingList.map(i => i.name.toLowerCase()));
    const newNames = rawNames.filter(name => !existingNames.has(name.toLowerCase()));

    if (newNames.length === 0) {
      toast('Everything on that list is already on your shopping list', { icon: toastIcon(ClipboardPaste) });
      setText('');
      onClose();
      return;
    }

    setIsImporting(true);
    try {
      const optimizableItems: OptimizableItem[] = newNames.map((name, index) => ({
        id: String(index),
        name,
      }));

      let optimized: OptimizableItem[];
      try {
        const { optimizeGroceryList } = await import('@/services/geminiService');
        optimized = await optimizeGroceryList(
          householdId,
          optimizableItems,
          categories,
          stores.map(s => s.name)
        );
      } catch (error) {
        // AI normalization is best-effort — fall back to the raw parsed names
        // (Uncategorized) rather than blocking the import entirely.
        console.error('[PasteImportDrawer] optimizeGroceryList failed, falling back to raw names:', error);
        optimized = optimizableItems;
      }

      const optimizedById = new Map(optimized.map(item => [item.id, item]));
      const maxOrder = shoppingList.length > 0 ? Math.max(...shoppingList.map(i => i.order || 0)) : 0;

      const itemsToAdd: Omit<ShoppingItem, 'id'>[] = optimizableItems.map((original, index) => {
        const opt = optimizedById.get(original.id);
        return {
          name: opt?.name || original.name,
          category: opt?.category || 'Uncategorized',
          quantity: opt?.quantity,
          isPurchased: false,
          order: maxOrder + index + 1,
        };
      });

      await addShoppingItems(itemsToAdd);
      toast.success(`Added ${itemsToAdd.length} item${itemsToAdd.length === 1 ? '' : 's'} to your shopping list`, {
        icon: toastIcon(ClipboardPaste),
      });
      setText('');
      onClose();
    } catch (error) {
      console.error('[PasteImportDrawer] Import failed:', error);
      toast.error('Failed to import list');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      title="Import list"
      footer={
        <div className="flex justify-end gap-2 border-t border-brand-200 dark:border-brand-700 p-4">
          <Button variant="secondary" onClick={handleClose} disabled={isImporting}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={isImporting || !text.trim()}
            leftIcon={isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardPaste className="w-4 h-4" />}
          >
            {isImporting ? 'Importing…' : 'Import'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-4 pb-4">
        <p className="text-sm text-brand-500 dark:text-brand-400">
          Paste an ingredient list or grocery list — one item per line (or comma-separated) — and we&rsquo;ll clean it
          up and add it to your shopping list.
        </p>
        <Textarea
          label="Paste list"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'2 cups flour\n1 lb ground beef\nmilk\neggs'}
          rows={8}
          disabled={isImporting}
          maxLength={4000}
          autoFocus
        />
        <p className="text-xxs text-brand-400 dark:text-brand-450">
          Up to {MAX_PASTE_IMPORT_ITEMS} items per import.
        </p>
      </div>
    </Drawer>
  );
};

export default PasteImportDrawer;
