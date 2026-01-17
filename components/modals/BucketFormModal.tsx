
/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import { BudgetBucket } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Modal } from '../ui/Modal';

interface BucketFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingBucket?: BudgetBucket;
}

const COLORS = ['bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-red-500', 'bg-indigo-500', 'bg-cyan-500'];

const BucketFormModal: React.FC<BucketFormModalProps> = ({ isOpen, onClose, editingBucket }) => {
  const { addBucket, updateBucket, deleteBucket } = useHousehold();

  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [color, setColor] = useState(COLORS[0]);

  useEffect(() => {
    if (editingBucket) {
      setName(editingBucket.name);
      setLimit(editingBucket.limit.toString());
      setColor(editingBucket.color);
    } else {
      setName('');
      setLimit('');
      setColor(COLORS[0]);
    }
  }, [editingBucket, isOpen]);

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
          aria-label="Close modal"
          className="p-2 text-brand-400 hover:bg-brand-50 rounded-full focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div>
          <label htmlFor="bucket-name" className="block text-xs font-bold text-brand-500 uppercase tracking-wider mb-1">Bucket Name</label>
          <input
            id="bucket-name"
            type="text"
            placeholder="e.g. Coffee"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
            autoFocus={!editingBucket}
          />
        </div>

        <div>
          <label htmlFor="bucket-limit" className="block text-xs font-bold text-brand-500 uppercase tracking-wider mb-1">Monthly Limit</label>
          <input
            id="bucket-limit"
            type="number"
            placeholder="0.00"
            value={limit}
            onChange={e => setLimit(e.target.value)}
            className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl font-mono focus:ring-2 focus:ring-brand-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-brand-500 uppercase tracking-wider mb-2">Color</label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Select color">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Select color ${c.replace('bg-', '')}`}
                aria-pressed={color === c}
                className={`w-8 h-8 rounded-full ${c} ${color === c ? 'ring-2 ring-brand-800 ring-offset-2' : ''} focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2`}
              />
            ))}
          </div>
        </div>

        <button
            onClick={handleSave}
            className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl mt-2 active:scale-95 transition-transform"
          >
            {editingBucket ? 'Save Changes' : 'Create Bucket'}
          </button>

          {editingBucket && (
            <button
              onClick={handleDelete}
              className="w-full py-3 text-money-neg font-bold rounded-xl mt-1 flex items-center justify-center gap-2 hover:bg-money-bgNeg transition-colors"
            >
              <Trash2 size={16} /> Delete Bucket
            </button>
          )}
      </div>
    </Modal>
  );
};

export default BucketFormModal;
