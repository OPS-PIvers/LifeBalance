import React from 'react';
import { Store, ChevronDown } from 'lucide-react';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { useAutoFocus } from '@/hooks/useAutoFocus';

interface CaptureShoppingTabProps {
  name: string;
  setName: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  quantity: string;
  setQuantity: (value: string) => void;
  store: string;
  setStore: (value: string) => void;
  onSubmit: () => void;
}

export const CaptureShoppingTab: React.FC<CaptureShoppingTabProps> = ({
  name,
  setName,
  category,
  setCategory,
  quantity,
  setQuantity,
  store,
  setStore,
  onSubmit,
}) => {
  const nameInputRef = useAutoFocus<HTMLInputElement>();
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <label htmlFor="item-name" className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">Item Name</label>
        <input
          ref={nameInputRef}
          id="item-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Milk, Eggs"
          className="w-full mt-1 p-3 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-xl focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 transition-all outline-hidden"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="item-category" className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">Category</label>
          <div className="relative mt-1">
            <select
              id="item-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full appearance-none p-3 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-xl focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 transition-all outline-hidden"
            >
              {GROCERY_CATEGORIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-400 dark:text-brand-400 pointer-events-none" />
          </div>
        </div>
        <div>
          <label htmlFor="item-quantity" className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">Quantity</label>
          <input
            id="item-quantity"
            type="text"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="e.g. 2, 500g"
            className="w-full mt-1 p-3 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-xl focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 transition-all outline-hidden"
          />
        </div>
      </div>

      <div>
        <label htmlFor="item-store" className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">Store (Optional)</label>
        <div className="relative mt-1">
          <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-400 dark:text-brand-400" />
          <input
            id="item-store"
            type="text"
            value={store}
            onChange={(e) => setStore(e.target.value)}
            placeholder="e.g. Costco, Trader Joe's"
            className="w-full p-3 pl-10 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-xl focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 transition-all outline-hidden"
          />
        </div>
      </div>

      <div className="pt-2">
        <button
          onClick={onSubmit}
          disabled={!name.trim()}
          className="w-full py-3 bg-accent-600 text-white font-semibold rounded-btn shadow-btn-primary transition-all duration-(--duration-fast) ease-(--ease-standard) active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 hover:bg-accent-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:bg-accent-500 dark:hover:bg-accent-400"
        >
          Add to Shopping List
        </button>
      </div>
    </div>
  );
};
