import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
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
        <p className="text-brand-600 dark:text-slate-300">
          Select a new category for the <strong>{count}</strong> selected transactions.
        </p>

        <div>
          <label htmlFor="batch-category" className="block text-xs font-bold text-brand-400 dark:text-slate-400 uppercase mb-1">
            New Category
          </label>
          <select
            id="batch-category"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            disabled={isSaving}
            className="w-full p-3 bg-brand-50 dark:bg-slate-700/50 border border-brand-200 dark:border-slate-700 rounded-xl outline-none focus:border-brand-400 transition-colors disabled:opacity-70"
          >
            <option value="">Select Category...</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 p-4 border-t border-brand-100 dark:border-slate-700 bg-white dark:bg-slate-800 flex gap-3">
        <button
          onClick={onClose}
          disabled={isSaving}
          className="flex-1 py-3 bg-brand-100 dark:bg-slate-700/50 text-brand-600 dark:text-slate-300 font-bold rounded-xl hover:bg-brand-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={isSaving || !selectedCategory}
          className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl hover:bg-brand-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="animate-spin w-5 h-5" /> : 'Apply Category'}
        </button>
      </div>
    </Drawer>
  );
};

export default BatchCategorizeModal;
