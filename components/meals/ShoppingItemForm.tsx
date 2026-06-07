import React from 'react';
import { ShoppingItem, Store as StoreType } from '../../types/schema';
import { Store } from 'lucide-react';

interface ShoppingItemFormProps {
  item: ShoppingItem;
  onChange: (item: ShoppingItem) => void;
  onSave: () => void;
  stores: StoreType[];
  categories: string[];
}

export const ShoppingItemForm: React.FC<ShoppingItemFormProps> = ({ item, onChange, onSave, stores, categories }) => {
  const handleFieldChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      onChange({ ...item, [e.target.name]: e.target.value });
    },
    [item, onChange]
  );

  return (
    <div className="flex flex-col h-full">
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            <div>
                <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Item Name</label>
                <input
                    type="text"
                    name="name"
                    value={item.name}
                    onChange={handleFieldChange}
                    className="w-full mt-1 p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 text-slate-900 font-medium dark:bg-slate-700/50 dark:border-slate-600 dark:text-slate-100"
                />
            </div>
            <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Category</label>
                    <select
                        name="category"
                        value={item.category || 'Uncategorized'}
                        onChange={handleFieldChange}
                        className="w-full mt-1 p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 text-slate-700 dark:bg-slate-700/50 dark:border-slate-600 dark:text-slate-200"
                    >
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Quantity</label>
                    <input
                        type="text"
                        name="quantity"
                        value={item.quantity || ''}
                        onChange={handleFieldChange}
                        className="w-full mt-1 p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 text-slate-700 dark:bg-slate-700/50 dark:border-slate-600 dark:text-slate-200"
                    />
                </div>
            </div>
            <div>
                <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Store</label>
                <input
                    type="text"
                    name="store"
                    value={item.store || ''}
                    onChange={handleFieldChange}
                    placeholder="Optional"
                    className="w-full mt-1 p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 text-slate-700 dark:bg-slate-700/50 dark:border-slate-600 dark:text-slate-200 dark:placeholder:text-slate-500"
                />
                 {/* Quick Store Chips in Edit Modal */}
                 {stores.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                        {stores.map(store => (
                            <button
                                key={store.id}
                                type="button"
                                onClick={() => onChange({...item, store: store.name})}
                                className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors flex items-center gap-1 ${
                                    item.store === store.name
                                    ? 'bg-brand-100 text-brand-800 border-brand-200 dark:bg-brand-700/40 dark:text-brand-200 dark:border-brand-500/40'
                                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 dark:bg-slate-700/50 dark:text-slate-400 dark:border-slate-600 dark:hover:bg-slate-700'
                                }`}
                            >
                                <Store size={10} /> {store.name}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
        <div className="p-4 border-t border-slate-200/50 dark:border-slate-700 bg-white/50 dark:bg-slate-800/40 shrink-0">
            <button
                onClick={onSave}
                disabled={!item.name.trim()}
                className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 disabled:opacity-50 hover:bg-brand-900 transition-all dark:bg-brand-600 dark:hover:bg-brand-500"
            >
                Save Changes
            </button>
        </div>
    </div>
  );
};
