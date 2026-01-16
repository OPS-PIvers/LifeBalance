import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { X, Loader2, Tag } from 'lucide-react';
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="batch-categorize-title"
      disableBackdropClose={isSaving}
    >
      <div className="flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="p-4 border-b border-brand-100 flex justify-between items-center bg-white shrink-0 rounded-t-2xl">
          <h2 id="batch-categorize-title" className="text-lg font-bold text-brand-800 flex items-center gap-2">
            <Tag size={20} className="text-brand-600" />
            Batch Categorize
          </h2>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="text-brand-400 hover:text-brand-600 p-1 rounded-lg transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 bg-white">
          <p className="text-brand-600">
            Select a new category for the <strong>{count}</strong> selected transactions.
          </p>

          <div>
            <label htmlFor="batch-category" className="block text-xs font-bold text-brand-400 uppercase mb-1">
              New Category
            </label>
            <select
              id="batch-category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              disabled={isSaving}
              className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors disabled:opacity-70"
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
        <div className="p-4 border-t border-brand-100 bg-white rounded-b-2xl flex gap-3">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 py-3 bg-brand-100 text-brand-600 font-bold rounded-xl hover:bg-brand-200 transition-colors disabled:opacity-50"
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
      </div>
    </Modal>
  );
};

export default BatchCategorizeModal;
