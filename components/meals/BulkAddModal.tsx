import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ClipboardList, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface BulkAddModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BulkAddModal: React.FC<BulkAddModalProps> = ({ isOpen, onClose }) => {
  const { addShoppingItems, shoppingList } = useHousehold();
  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSave = async () => {
    if (!text.trim()) return;
    setIsProcessing(true);

    try {
      // Parse lines
      const lines = text
        .split(/\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);

      // Deduplicate within the input
      const uniqueLines = Array.from(new Set(lines));

      if (uniqueLines.length === 0) {
        setIsProcessing(false);
        return;
      }

      // Calculate starting order
      const maxOrder = shoppingList.length > 0
        ? Math.max(...shoppingList.map(i => i.order || 0))
        : 0;

      // Prepare items
      const itemsToAdd = uniqueLines.map((line, index) => ({
        name: line,
        category: 'Uncategorized',
        quantity: '1',
        isPurchased: false,
        order: maxOrder + 1 + index
      }));

      await addShoppingItems(itemsToAdd);

      toast.success(`Added ${itemsToAdd.length} items`);
      setText('');
      onClose();
    } catch (error) {
      console.error('Bulk add failed:', error);
      toast.error('Failed to add items');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="p-6"
    >
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-brand-800 flex items-center gap-2">
          <ClipboardList className="w-6 h-6" />
          Bulk Add Items
        </h2>
        <button
          onClick={onClose}
          className="p-2 hover:bg-brand-50 rounded-full transition-colors"
          aria-label="Close dialog"
        >
          <X size={20} className="text-brand-400" />
        </button>
      </div>

      <p className="text-sm text-slate-500 mb-4">
        Paste a list of items (one per line). Duplicates will be removed.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Milk\nEggs\nBread\n...`}
        rows={10}
        className="w-full p-3 bg-white/80 backdrop-blur-sm border border-slate-200/60 rounded-xl outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20 transition-all shadow-sm placeholder:text-slate-400 disabled:opacity-50 disabled:bg-slate-50 mb-4 font-medium"
        autoFocus
      />

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose} disabled={isProcessing}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!text.trim() || isProcessing}
          isLoading={isProcessing}
        >
          Add Items
        </Button>
      </div>
    </Modal>
  );
};

export default BulkAddModal;
