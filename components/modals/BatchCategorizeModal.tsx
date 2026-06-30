import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import Select from '@/components/ui/Select';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface BatchCategorizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (category: string) => Promise<void>;
  count: number;
  categories: string[];
}

const BatchCategorizeModal: React.FC<BatchCategorizeModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  count,
  categories,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const handleConfirm = async () => {
    if (!selectedCategory) {
      toast.error('Please select a category');
      return;
    }

    setIsSaving(true);
    try {
      await onConfirm(selectedCategory);
      onClose();
      setSelectedCategory('');
    } catch (error) {
      console.error('Batch categorize failed:', error);
      toast.error('Failed to categorize transactions');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Batch Categorize"
      disableClose={isSaving}
      noPadding={true}
    >
      {/* Content */}
      <div className="p-4 space-y-4">
        <p className="text-brand-600 dark:text-brand-300">
          Select a new category for the <strong>{count}</strong> selected transactions.
        </p>

        <Select
          label="New Category"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          disabled={isSaving}
        >
          <option value="">Select Category...</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </Select>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 p-4 border-t border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 flex gap-3">
        <button
          onClick={onClose}
          disabled={isSaving}
          className="flex-1 py-3 bg-brand-100 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300 font-semibold rounded-btn hover:bg-brand-200 dark:hover:bg-brand-700 transition-colors duration-(--duration-fast) ease-(--ease-standard) disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={isSaving || !selectedCategory}
          className="flex-1 py-3 bg-accent-600 dark:bg-accent-500 text-white font-semibold rounded-btn hover:bg-accent-700 dark:hover:bg-accent-400 transition-colors duration-(--duration-fast) ease-(--ease-standard) flex items-center justify-center gap-2 disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
        >
          {isSaving ? <Loader2 className="animate-spin w-5 h-5" /> : 'Apply Category'}
        </button>
      </div>
    </Drawer>
  );
};

export default BatchCategorizeModal;
