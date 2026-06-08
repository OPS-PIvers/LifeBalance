import React, { useState, useEffect } from 'react';
import { Trash2, Plus, X } from 'lucide-react';
import { BudgetBucket, SubBucket } from '../../types/schema';
import { useFinance } from '../../contexts/FirebaseHouseholdContext';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';
import Input from '../ui/Input';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface BucketFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingBucket?: BudgetBucket;
}

const COLORS = ['bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-red-500', 'bg-indigo-500', 'bg-cyan-500'];

const getColorName = (colorClass: string) => {
  // e.g., "bg-emerald-500" -> "emerald"
  return colorClass.split('-')[1] ?? 'color';
};

const BucketFormModal: React.FC<BucketFormModalProps> = ({ isOpen, onClose, editingBucket }) => {
  const { addBucket, updateBucket, deleteBucket } = useFinance();

  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [color, setColor] = useState(COLORS[0] ?? 'bg-emerald-500'); // COLORS[0] is always defined
  const [subBuckets, setSubBuckets] = useState<SubBucket[]>([]);
  const [newSubBucketName, setNewSubBucketName] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (editingBucket) {
        // Reset form state when modal opens or editing item changes
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setName(editingBucket.name);
        setLimit(editingBucket.limit.toString());
        setColor(editingBucket.color);
        setSubBuckets(editingBucket.subBuckets || []);
      } else {
        setName('');
        setLimit('');
        setColor(COLORS[0] ?? 'bg-emerald-500'); // COLORS[0] is always defined
        setSubBuckets([]);
      }
      setNewSubBucketName('');
    }
  }, [isOpen, editingBucket]);

  const handleAddSubBucket = () => {
    if (!newSubBucketName.trim()) return;
    const newSubBucket: SubBucket = {
      id: crypto.randomUUID(),
      name: newSubBucketName.trim()
    };
    setSubBuckets([...subBuckets, newSubBucket]);
    setNewSubBucketName('');
  };

  const handleRemoveSubBucket = (id: string) => {
    setSubBuckets(subBuckets.filter(sb => sb.id !== id));
  };

  const handleSave = () => {
    if (!name || !limit) return;
    
    const bucketData: BudgetBucket = {
      id: editingBucket ? editingBucket.id : crypto.randomUUID(),
      name,
      limit: parseFloat(limit),
      spent: editingBucket ? editingBucket.spent : 0,
      color,
      isVariable: true,
      isCore: true,
      subBuckets
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
      setIsDeleteConfirmOpen(true);
    }
  };

  const confirmDelete = () => {
    if (editingBucket) {
      deleteBucket(editingBucket.id);
      setIsDeleteConfirmOpen(false);
      onClose();
    }
  };

  return (
    <>
    <ConfirmDialog
      isOpen={isDeleteConfirmOpen}
      onClose={() => setIsDeleteConfirmOpen(false)}
      onConfirm={confirmDelete}
      title="Delete Bucket"
      message="Delete this bucket? Transactions will remain but categorization may break."
      confirmLabel="Delete"
      confirmVariant="destructive"
    />
    <Drawer isOpen={isOpen} onClose={onClose} title={editingBucket ? 'Edit Bucket' : 'New Bucket'}>
      <div className="space-y-4">
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
          <label className="text-xs font-bold text-brand-400 dark:text-slate-400 uppercase block mb-2">Color</label>
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

        <div>
          <label className="text-xs font-bold text-brand-400 dark:text-slate-400 uppercase block mb-2">Sub-Categories (Optional)</label>
          <div className="space-y-2 mb-2">
            {subBuckets.map(sb => (
              <div key={sb.id} className="flex justify-between items-center bg-brand-50 dark:bg-slate-700/50 p-2 rounded-lg">
                <span className="text-sm font-medium text-brand-700 dark:text-slate-200">{sb.name}</span>
                <button
                  onClick={() => handleRemoveSubBucket(sb.id)}
                  className="text-brand-400 dark:text-slate-400 hover:text-money-neg"
                  aria-label={`Remove ${sb.name} sub-category`}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newSubBucketName}
              onChange={e => setNewSubBucketName(e.target.value)}
              placeholder="New sub-category..."
              className="flex-1 px-3 py-2 bg-white dark:bg-slate-800 border border-brand-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddSubBucket();
                }
              }}
            />
            <button
              onClick={handleAddSubBucket}
              disabled={!newSubBucketName.trim()}
              className="px-3 py-2 bg-brand-100 dark:bg-slate-700/50 text-brand-600 dark:text-slate-300 rounded-lg hover:bg-brand-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
              aria-label="Add sub-category"
            >
              <Plus size={20} />
            </button>
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
    </Drawer>
    </>
  );
};

export default BucketFormModal;
