
import React, { useState, useEffect } from 'react';
import { Trash2, Copy } from 'lucide-react';
import { Transaction } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Drawer } from '../../components/ui/Drawer';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import toast from 'react-hot-toast';

interface EditTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
}

const EditTransactionModal: React.FC<EditTransactionModalProps> = ({ isOpen, onClose, transaction }) => {
  const { updateTransaction, deleteTransaction, addTransaction, buckets, stores, accounts } = useHousehold();

  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('');
  const [subBucketId, setSubBucketId] = useState<string | undefined>(undefined);
  const [store, setStore] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<'verified' | 'pending_review'>('verified');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Dynamic Categories from buckets
  const dynamicCategories = [...buckets.map(b => b.name), 'Budgeted in Calendar'];

  // Find selected bucket and its sub-buckets
  const selectedBucket = buckets.find(b => b.name === category);
  const subBuckets = selectedBucket?.subBuckets || [];

  // Populate form when transaction changes
  useEffect(() => {
    if (transaction) {
      setAmount(transaction.amount.toString());
      setMerchant(transaction.merchant);
      setCategory(transaction.category);
      setSubBucketId(transaction.subBucketId);
      setStore(transaction.store || '');
      setAccountId(transaction.accountId || '');
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
        subBucketId: subBucketId || undefined,
        store: store || undefined,
        accountId: accountId || undefined,
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
        subBucketId: subBucketId || undefined,
        store: store || undefined,
        accountId: accountId || undefined
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
    <Drawer
      isOpen={isOpen}
      onClose={isSaving ? () => {} : onClose}
      title="Edit Transaction"
      noPadding={true}
    >
      {/* Form */}
      <div className="p-4 space-y-4">
        <Input
          id="edit-amount"
          label="Amount"
          type="number"
          step="0.01"
          disabled={isSaving}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          icon={<span>$</span>}
        />

        <Input
          id="edit-merchant"
          label="Merchant"
          type="text"
          disabled={isSaving}
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          placeholder="Store name"
        />

        <Select
          id="edit-category"
          label="Category"
          disabled={isSaving}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setSubBucketId(undefined); // Reset sub-bucket when category changes
          }}
        >
          {dynamicCategories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </Select>

        {subBuckets.length > 0 && (
          <Select
            id="edit-sub-bucket"
            label="Sub-Category"
            disabled={isSaving}
            value={subBucketId || ''}
            onChange={(e) => setSubBucketId(e.target.value || undefined)}
          >
            <option value="">(None)</option>
            {subBuckets.map((sb) => (
              <option key={sb.id} value={sb.id}>
                {sb.name}
              </option>
            ))}
          </Select>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Select
            id="edit-store"
            label="Store"
            disabled={isSaving}
            value={store}
            onChange={(e) => setStore(e.target.value)}
          >
            <option value="">(None)</option>
            {stores.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>

          <Select
            id="edit-account"
            label="Account"
            disabled={isSaving}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">(None)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>

        <Input
          id="edit-date"
          label="Date"
          type="date"
          disabled={isSaving}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />

        <Select
          id="edit-status"
          label="Status"
          disabled={isSaving}
          value={status}
          onChange={(e) => setStatus(e.target.value as 'verified' | 'pending_review')}
        >
          <option value="verified">Verified</option>
          <option value="pending_review">Pending Review</option>
        </Select>
      </div>

      {/* Actions */}
      <div className="sticky bottom-0 bg-white border-t border-brand-100 p-4 space-y-2">
        <div className="flex gap-2">
          <Button
            onClick={onClose}
            disabled={isSaving}
            variant="subtle"
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            isLoading={isSaving}
            className="flex-1"
          >
            Save Changes
          </Button>
        </div>

        {/* Secondary Actions Row */}
        {!showDeleteConfirm && (
          <div className="flex gap-2">
            <Button
              onClick={handleDuplicate}
              disabled={isSaving}
              variant="secondary"
              leftIcon={<Copy size={16} />}
              className="flex-1"
            >
              Duplicate
            </Button>
            <Button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isSaving}
              variant="danger"
              leftIcon={<Trash2 size={16} />}
              className="flex-1"
            >
              Delete
            </Button>
          </div>
        )}

        {/* Delete Confirmation */}
        {showDeleteConfirm && (
          <div className="space-y-2 p-3 bg-money-bgNeg rounded-xl">
            <p className="text-sm text-center text-money-neg font-bold">
              Are you sure? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isSaving}
                variant="outline"
                className="flex-1 py-2"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDelete}
                disabled={isSaving}
                isLoading={isSaving}
                variant="destructive"
                className="flex-1 py-2"
              >
                Confirm Delete
              </Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
};

export default EditTransactionModal;
