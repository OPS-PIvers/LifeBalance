
import React, { useState, useEffect } from 'react';
import { X, Trash2, Loader2, Copy } from 'lucide-react';
import { Transaction } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Modal } from '../../components/ui/Modal';
import toast from 'react-hot-toast';

interface EditTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
}

const EditTransactionModal: React.FC<EditTransactionModalProps> = ({ isOpen, onClose, transaction }) => {
  const { updateTransaction, deleteTransaction, addTransaction, buckets } = useHousehold();

  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<'verified' | 'pending_review'>('verified');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
    if (!transaction || isSaving) return;

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

    setIsSaving(true);
    try {
      await updateTransaction(transaction.id, {
        amount: amountNum,
        merchant: merchant.trim(),
        category,
        date,
        status,
      });

      onClose();
    } catch (error) {
      console.error('Failed to save transaction:', error);
      toast.error('Failed to save transaction. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!transaction || isSaving) return;

    setIsSaving(true);
    try {
      await deleteTransaction(transaction.id);
      setShowDeleteConfirm(false);
      onClose();
    } catch (error) {
      console.error('Failed to delete transaction:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!transaction || isSaving) return;

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    const trimmedMerchant = merchant.trim();
    if (!trimmedMerchant) {
      toast.error('Please enter a merchant name');
      return;
    }

    if (!category) {
      toast.error('Please select a category');
      return;
    }

    setIsSaving(true);
    try {
      // Create new transaction with same details
      // We use the current form state so user can modify before duplicating if they want
      await addTransaction({
        amount: amountNum,
        merchant: trimmedMerchant,
        category,
        date: new Date().toISOString().split('T')[0], // Default to today for the copy
        status: 'verified',
        isRecurring: false,
        source: 'manual',
        autoCategorized: transaction.autoCategorized ?? false,
        // Let addTransaction handle ID and timestamps
      } as unknown as Transaction);

      toast.success('Transaction duplicated');
      onClose();
    } catch (error) {
      console.error('Failed to duplicate transaction:', error);
      toast.error('Failed to duplicate transaction');
    } finally {
      setIsSaving(false);
    }
  };

  if (!transaction) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="edit-transaction-title"
      disableBackdropClose={isSaving}
    >
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-brand-100 p-4 flex justify-between items-center shrink-0">
        <h2 id="edit-transaction-title" className="text-lg font-bold text-brand-800">Edit Transaction</h2>
        <button
          onClick={onClose}
          disabled={isSaving}
          className="text-brand-400 hover:text-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-lg p-1 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Close modal"
        >
          <X size={20} />
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Amount */}
        <div>
          <label htmlFor="edit-amount" className="text-xs font-bold text-brand-400 uppercase block mb-1">
            Amount
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400">$</span>
            <input
              id="edit-amount"
              type="number"
              step="0.01"
              disabled={isSaving}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full pl-7 pr-3 py-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors disabled:opacity-70 disabled:bg-gray-100"
              placeholder="0.00"
            />
          </div>
        </div>

        {/* Merchant */}
        <div>
          <label htmlFor="edit-merchant" className="text-xs font-bold text-brand-400 uppercase block mb-1">
            Merchant
          </label>
          <input
            id="edit-merchant"
            type="text"
            disabled={isSaving}
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors disabled:opacity-70 disabled:bg-gray-100"
            placeholder="Store name"
          />
        </div>

        {/* Category */}
        <div>
          <label htmlFor="edit-category" className="text-xs font-bold text-brand-400 uppercase block mb-1">
            Category
          </label>
          <select
            id="edit-category"
            disabled={isSaving}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors disabled:opacity-70 disabled:bg-gray-100"
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
          <label htmlFor="edit-date" className="text-xs font-bold text-brand-400 uppercase block mb-1">
            Date
          </label>
          <input
            id="edit-date"
            type="date"
            disabled={isSaving}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors disabled:opacity-70 disabled:bg-gray-100"
          />
        </div>

        {/* Status */}
        <div>
          <label htmlFor="edit-status" className="text-xs font-bold text-brand-400 uppercase block mb-1">
            Status
          </label>
          <select
            id="edit-status"
            disabled={isSaving}
            value={status}
            onChange={(e) => setStatus(e.target.value as 'verified' | 'pending_review')}
            className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors disabled:opacity-70 disabled:bg-gray-100"
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
            disabled={isSaving}
            className="flex-1 py-3 bg-brand-100 text-brand-600 font-bold rounded-xl hover:bg-brand-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl hover:bg-brand-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>

        {/* Secondary Actions Row */}
        {!showDeleteConfirm && (
          <div className="flex gap-2">
            <button
              onClick={handleDuplicate}
              disabled={isSaving}
              className="flex-1 py-3 bg-white border border-brand-200 text-brand-600 font-bold rounded-xl hover:bg-brand-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Copy size={16} />
              Duplicate
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isSaving}
              className="flex-1 py-3 bg-money-bgNeg text-money-neg font-bold rounded-xl hover:bg-red-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        )}

        {/* Delete Confirmation */}
        {showDeleteConfirm && (
          <div className="space-y-2 p-3 bg-money-bgNeg rounded-xl">
            <p className="text-sm text-center text-money-neg font-bold">
              Are you sure? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isSaving}
                className="flex-1 py-2 bg-white text-brand-600 font-bold rounded-lg border border-brand-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isSaving}
                className="flex-1 py-2 bg-money-neg text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default EditTransactionModal;
