import React, { useState, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import { BudgetBucket } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import Input from '../ui/Input';

interface BucketFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingBucket?: BudgetBucket;
}

const COLORS = ['bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-red-500', 'bg-indigo-500', 'bg-cyan-500'];

const getColorName = (colorClass: string) => {
  // e.g., "bg-emerald-500" -> "emerald"
  return colorClass.split('-')[1] || 'color';
};

const BucketFormModal: React.FC<BucketFormModalProps> = ({ isOpen, onClose, editingBucket }) => {
  const { addBucket, updateBucket, deleteBucket } = useHousehold();

  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [color, setColor] = useState(COLORS[0]);

  useEffect(() => {
    if (isOpen) {
      if (editingBucket) {
        // Reset form state when modal opens or editing item changes
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setName(editingBucket.name);
        setLimit(editingBucket.limit.toString());
        setColor(editingBucket.color);
      } else {
        setName('');
        setLimit('');
        setColor(COLORS[0]);
      }
    }
  }, [isOpen, editingBucket]);

  const handleSave = () => {
    if (!name || !limit) return;
    
    const bucketData: BudgetBucket = {
      id: editingBucket ? editingBucket.id : crypto.randomUUID(),
      name,
      limit: parseFloat(limit),
      spent: editingBucket ? editingBucket.spent : 0,
      color,
      isVariable: true,
      isCore: true
    };

    if (editingBucket) {
      updateBucket(bucketData);
    } else {
      addBucket(bucketData);
    }
    onClose();
  };

  const handleDelete = () => {
    if (editingBucket) {
      if (window.confirm('Delete this bucket? Transactions will remain but categorization may break.')) {
        deleteBucket(editingBucket.id);
        onClose();
      }
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-sm" ariaLabelledBy="bucket-form-modal-title">
      <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 shrink-0">
        <h2 id="bucket-form-modal-title" className="text-lg font-bold text-brand-800">
          {editingBucket ? 'Edit Bucket' : 'New Bucket'}
        </h2>
        <button
          onClick={onClose}
          className="p-2 text-brand-400 hover:bg-brand-50 rounded-full focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="Close modal"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <Input
          id="bucket-name"
          label="Bucket Name"
          type="text"
          placeholder="e.g. Coffee"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus={!editingBucket}
        />

        <Input
          id="bucket-limit"
          label="Monthly Limit"
          type="number"
          placeholder="0.00"
          min={0}
          step="0.01"
          value={limit}
          onChange={e => setLimit(e.target.value)}
          className="font-mono"
          icon={<span>$</span>}
        />

        <div>
          <label className="text-xs font-bold text-brand-400 uppercase block mb-2">Color</label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Bucket color">
            {COLORS.map(c => {
              const colorName = getColorName(c);
              const isSelected = color === c;
              return (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full ${c} ${isSelected ? 'ring-2 ring-brand-800 ring-offset-2' : ''} focus:outline-none focus:ring-2 focus:ring-brand-800 focus:ring-offset-1 transition-all`}
                  aria-label={`Select ${colorName}`}
                  aria-checked={isSelected}
                  role="radio"
                  title={colorName}
                  type="button"
                />
              );
            })}
          </div>
        </div>

        <Button
          onClick={handleSave}
          className="w-full py-3 mt-2"
          disabled={
            !name ||
            !limit ||
            isNaN(parseFloat(limit)) ||
            parseFloat(limit) <= 0
          }
        >
          {editingBucket ? 'Save Changes' : 'Create Bucket'}
        </Button>

        {editingBucket && (
          <Button
            onClick={handleDelete}
            variant="ghost-danger"
            className="w-full py-3 mt-1"
          >
            <Trash2 size={16} /> Delete Bucket
          </Button>
        )}
      </div>
    </Modal>
  );
};

export default BucketFormModal;
