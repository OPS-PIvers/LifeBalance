import React from 'react';
import { Store } from 'lucide-react';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';

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
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-(--duration-base)">
      <Input
        ref={nameInputRef}
        label="Item Name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Milk, Eggs"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {GROCERY_CATEGORIES.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <Input
          label="Quantity"
          type="text"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="e.g. 2, 500g"
        />
      </div>

      <Input
        label="Store (Optional)"
        type="text"
        value={store}
        onChange={(e) => setStore(e.target.value)}
        placeholder="e.g. Costco, Trader Joe's"
        icon={<Store className="w-4 h-4" />}
      />

      <div className="pt-2">
        <Button
          onClick={onSubmit}
          disabled={!name.trim()}
          size="lg"
          className="w-full"
        >
          Add to Shopping List
        </Button>
      </div>
    </div>
  );
};
