
import React, { useState, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import { Transaction } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import toast from 'react-hot-toast';

interface EditTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
}

const EditTransactionModal: React.FC<EditTransactionModalProps> = ({ isOpen, onClose, transaction }) => {
  const { updateTransaction, deleteTransaction, buckets } = useHousehold();

  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<'verified' | 'pending_review'>('verified');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Dynamic Categories from buckets
  const dynamicCategories = [...buckets.map(b => b.name), 'Budgeted in Calendar'];

  // Populate form when transaction changes
  useEffect(() => {
    if (transaction) {
      setAmount(transaction.amount.toString());
      setMerchant(transaction.merchant);
      setCategory(transaction.category);
      setDate(transaction.date);
      setStatus(transaction.status);
    }
  }, [transaction]);

  // Reset delete confirmation when modal closes
  useEffect(() => {
    if (!isOpen) {
      setShowDeleteConfirm(false);
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (!transaction) return;

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (!merchant.trim()) {
      toast.error('Please enter a merchant name');
      return;
    }

    if (!category) {
      toast.error('Please select a category');
      return;
    }

    await updateTransaction(transaction.id, {
      amount: amountNum,
      merchant: merchant.trim(),
      category,
      date,
      status,
    });

    onClose();
  };

  const handleDelete = async () => {
    if (!transaction) return;

    await deleteTransaction(transaction.id);
    setShowDeleteConfirm(false);
    onClose();
  };

  if (!isOpen || !transaction) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl max-h-[calc(100dvh-10rem)] sm:max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-brand-100 p-4 flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-brand-800">Edit Transaction</h2>
          <button onClick={onClose} className="text-brand-400 hover:text-brand-600">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Amount */}
          <div>
            <label className="text-xs font-bold text-brand-400 uppercase block mb-1">
              Amount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400">$</span>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Merchant */}
          <div>
            <label className="text-xs font-bold text-brand-400 uppercase block mb-1">
              Merchant
            </label>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors"
              placeholder="Store name"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-xs font-bold text-brand-400 uppercase block mb-1">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors"
            >
              {dynamicCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="text-xs font-bold text-brand-400 uppercase block mb-1">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors"
            />
          </div>

          {/* Status */}
          <div>
            <label className="text-xs font-bold text-brand-400 uppercase block mb-1">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'verified' | 'pending_review')}
              className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors"
            >
              <option value="verified">Verified</option>
              <option value="pending_review">Pending Review</option>
            </select>
          </div>
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 bg-white border-t border-brand-100 p-4 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-brand-100 text-brand-600 font-bold rounded-xl hover:bg-brand-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl hover:bg-brand-900 transition-colors"
            >
              Save Changes
            </button>
          </div>

          {/* Delete Button */}
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full py-3 bg-money-bgNeg text-money-neg font-bold rounded-xl hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 size={16} />
              Delete Transaction
            </button>
          ) : (
            <div className="space-y-2 p-3 bg-money-bgNeg rounded-xl">
              <p className="text-sm text-center text-money-neg font-bold">
                Are you sure? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2 bg-white text-brand-600 font-bold rounded-lg border border-brand-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-2 bg-money-neg text-white font-bold rounded-lg"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EditTransactionModal;
