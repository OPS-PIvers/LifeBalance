import React from 'react';
import { ShoppingItem, Store as StoreType, QuickStockList } from '@/types/schema';
import { Store, Trash2, ShoppingBag } from 'lucide-react';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';

interface ShoppingItemFormProps {
  item: ShoppingItem;
  onChange: (item: ShoppingItem) => void;
  onSave: () => void;
  onDelete?: () => void;
  stores: StoreType[];
  categories: string[];
  quickStockLists?: QuickStockList[];
  activeQuickList?: QuickStockList;
  onQuickListChange?: (item: ShoppingItem, newListId: string) => void;
}

// O(1) lookup for quick-list icons.
const templateIconMap = new Map(TEMPLATE_ICONS.map(i => [i.id, i.icon]));

export const ShoppingItemForm: React.FC<ShoppingItemFormProps> = ({ item, onChange, onSave, onDelete, stores, categories, quickStockLists, activeQuickList, onQuickListChange }) => {
  const handleFieldChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      onChange({ ...item, [e.target.name]: e.target.value });
    },
    [item, onChange]
  );

  return (
    <div className="flex flex-col h-full">
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            <Input
                label="Item name"
                type="text"
                name="name"
                value={item.name}
                onChange={handleFieldChange}
            />
            <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
                 <Select
                    label="Category"
                    name="category"
                    value={item.category || 'Uncategorized'}
                    onChange={handleFieldChange}
                 >
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
                <Input
                    label="Quantity"
                    type="text"
                    name="quantity"
                    value={item.quantity || ''}
                    onChange={handleFieldChange}
                />
            </div>
            <div>
                <Input
                    label="Store"
                    type="text"
                    name="store"
                    value={item.store || ''}
                    onChange={handleFieldChange}
                    placeholder="Optional"
                />
                 {/* Quick Store Chips in Edit Modal */}
                 {stores.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                        {stores.map(store => (
                            <button
                                key={store.id}
                                type="button"
                                onClick={() => onChange({...item, store: store.name})}
                                className={`px-2.5 py-2 rounded-sm text-xs font-medium border transition-colors duration-(--duration-fast) ease-(--ease-standard) flex items-center gap-1 ${
                                    item.store?.toLowerCase() === store.name.toLowerCase()
                                    ? 'bg-accent-100 text-accent-800 border-accent-200 dark:bg-accent-900/40 dark:text-accent-200 dark:border-accent-700'
                                    : 'bg-white text-brand-500 border-brand-200 hover:bg-brand-50 dark:bg-brand-700/50 dark:text-brand-400 dark:border-brand-600 dark:hover:bg-brand-700'
                                }`}
                            >
                                <Store size={10} /> {store.name}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Quick List assignment — moved out of the row to keep the list dense. */}
            {quickStockLists && quickStockLists.length > 0 && onQuickListChange && (
                <div>
                    <label className="text-xs font-bold text-brand-400 dark:text-brand-500 uppercase tracking-wider">Quick list</label>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {quickStockLists.map(list => {
                            const ListIcon = (list.icon && templateIconMap.get(list.icon)) || ShoppingBag;
                            const isActive = activeQuickList?.id === list.id;
                            return (
                                <button
                                    key={list.id}
                                    type="button"
                                    // Empty string toggles the item OFF the list (matches the row's prior behaviour).
                                    onClick={() => onQuickListChange(item, isActive ? '' : list.id)}
                                    className={`px-2.5 py-2 rounded-sm text-xs font-medium border transition-colors duration-(--duration-fast) ease-(--ease-standard) flex items-center gap-1 ${
                                        isActive
                                        ? 'bg-accent-100 text-accent-800 border-accent-200 dark:bg-accent-900/40 dark:text-accent-200 dark:border-accent-700'
                                        : 'bg-white text-brand-500 border-brand-200 hover:bg-brand-50 dark:bg-brand-700/50 dark:text-brand-400 dark:border-brand-600 dark:hover:bg-brand-700'
                                    }`}
                                >
                                    <ListIcon size={10} /> {list.name}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {onDelete && (
                <Button
                    type="button"
                    variant="ghost-danger"
                    size="sm"
                    leftIcon={<Trash2 size={16} />}
                    onClick={onDelete}
                    className="-mx-1"
                >
                    Delete item
                </Button>
            )}
        </div>
        <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800 shrink-0">
            <Button
                variant="primary"
                size="lg"
                onClick={onSave}
                disabled={!item.name.trim()}
                className="w-full"
            >
                Save changes
            </Button>
        </div>
    </div>
  );
};
