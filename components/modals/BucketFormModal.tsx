import React, { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { BudgetBucket } from '@/types/schema';
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
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (editingBucket) {
        // Reset form state when modal opens or editing item changes
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setName(editingBucket.name);
        setLimit(editingBucket.limit.toString());
        setColor(normalizeBucketColorKey(editingBucket.color));
      } else {
        setName('');
        setLimit('');
        setColor(DEFAULT_BUCKET_COLOR);
      }
    }
  }, [isOpen, editingBucket]);

  const handleSave = () => {
    if (!name || !limit) return;
    
    const bucketData: BudgetBucket = {
      id: editingBucket ? editingBucket.id : crypto.randomUUID(),
      name,
      limit: parseFloat(limit),
      color,
      isVariable: true,
      isCore: true,
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
        {/* This drawer is the ONE edit entry per bucket (impeccable r6), and
            changing the limit is by far the most common edit — so when editing,
            the limit leads and takes focus. Creating keeps name-first (you name
            a thing before you budget it). */}
        {editingBucket && (
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
            // data-autofocus: the Drawer's focus trap prefers this element over
            // its default first-focusable (the close button) — plain autoFocus
            // gets clobbered by the trap's open effect.
            data-autofocus
          />
        )}

        <Input
          id="bucket-name"
          label="Bucket Name"
          type="text"
          placeholder="e.g. Coffee"
          value={name}
          onChange={e => setName(e.target.value)}
          // Same data-autofocus mechanism as the limit field below: the focus
          // trap clobbers plain autoFocus, so the creation path must mark its
          // first field too or focus lands on the drawer's close button.
          data-autofocus={!editingBucket ? true : undefined}
        />

        {!editingBucket && (
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
        )}

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

        {/* Danger row — separated from Save by a hairline + air (echoes the
            Settings Danger Zone idiom) so a thumb aiming at Save can't land on
            Delete. The ConfirmDialog above stays as the second gate. */}
        {editingBucket && (
          <div className="mt-6 pt-4 border-t border-brand-200 dark:border-brand-700">
            <Button
              onClick={handleDelete}
              variant="ghost-danger"
              className="w-full py-3"
            >
              <Trash2 size={16} /> Delete Bucket
            </Button>
          </div>
        )}
      </div>
    </Drawer>
    </>
  );
};

export default BucketFormModal;
