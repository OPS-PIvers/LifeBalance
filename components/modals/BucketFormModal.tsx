import React, { useState, useEffect } from 'react';
import { Trash2, Plus, X } from 'lucide-react';
import { BudgetBucket, SubBucket } from '@/types/schema';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  BUCKET_COLORS,
  BUCKET_COLOR_KEYS,
  DEFAULT_BUCKET_COLOR,
  normalizeBucketColorKey,
  type BucketColorKey,
} from '@/data/bucketColors';

interface BucketFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingBucket?: BudgetBucket;
}

const BucketFormModal: React.FC<BucketFormModalProps> = ({ isOpen, onClose, editingBucket }) => {
  const { addBucket, updateBucket, deleteBucket } = useFinance();

  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [color, setColor] = useState<BucketColorKey>(DEFAULT_BUCKET_COLOR);
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
        setColor(normalizeBucketColorKey(editingBucket.color));
        setSubBuckets(editingBucket.subBuckets || []);
      } else {
        setName('');
        setLimit('');
        setColor(DEFAULT_BUCKET_COLOR);
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
          <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase block mb-2">Color</label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Bucket color">
            {BUCKET_COLOR_KEYS.map(key => {
              const { label, bg } = BUCKET_COLORS[key];
              const isSelected = color === key;
              return (
                <button
                  key={key}
                  onClick={() => setColor(key)}
                  className={`w-8 h-8 rounded-full ${bg} ${isSelected ? 'ring-2 ring-brand-800 ring-offset-2' : ''} focus:outline-hidden focus:ring-2 focus:ring-brand-800 focus:ring-offset-1 transition-all`}
                  aria-label={`Select ${label}`}
                  aria-checked={isSelected}
                  role="radio"
                  title={label}
                  type="button"
                />
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase block mb-2">Sub-Categories (Optional)</label>
          <div className="space-y-2 mb-2">
            {subBuckets.map(sb => (
              <div key={sb.id} className="flex justify-between items-center bg-brand-50 dark:bg-brand-700/50 p-2 rounded-lg">
                <span className="text-sm font-medium text-brand-700 dark:text-brand-200">{sb.name}</span>
                <button
                  onClick={() => handleRemoveSubBucket(sb.id)}
                  className="text-brand-400 dark:text-brand-400 hover:text-money-neg"
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
              aria-label="New sub-category name"
              className="flex-1 px-3 py-2 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-accent-500/30"
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
              className="px-3 py-2 bg-brand-100 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300 rounded-lg hover:bg-brand-200 dark:hover:bg-brand-700 disabled:opacity-50 transition-colors"
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
