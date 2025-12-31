
import React, { useState, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import { BudgetBucket } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-10">
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100">
          <h2 className="text-lg font-bold text-brand-800">
            {editingBucket ? 'Edit Bucket' : 'New Bucket'}
          </h2>
          <button onClick={onClose} className="p-2 text-brand-400 hover:bg-brand-50 rounded-full">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <input 
             type="text" 
             placeholder="Name (e.g. Coffee)" 
             value={name} 
             onChange={e => setName(e.target.value)}
             className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl"
             autoFocus={!editingBucket}
          />
          
          <input 
             type="number" 
             placeholder="Monthly Limit" 
             value={limit} 
             onChange={e => setLimit(e.target.value)}
             className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl font-mono"
          />
          
          <div>
            <label className="text-xs font-bold text-brand-400">Color</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {COLORS.map(c => (
                <button 
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full ${c} ${color === c ? 'ring-2 ring-brand-800 ring-offset-2' : ''}`}
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
      </div>
    </div>
  );
};

export default BucketFormModal;
