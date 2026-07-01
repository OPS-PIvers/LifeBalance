
import React, { useState } from 'react';
import { Trash2, Loader2, Copy } from 'lucide-react';
import { Transaction } from '@/types/schema';
import { useFinance, useShopping } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { getLocalDateString } from '@/utils/dateHelpers';
import toast from 'react-hot-toast';

interface EditTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
}

const EditTransactionModal: React.FC<EditTransactionModalProps> = ({ isOpen, onClose, transaction }) => {
  const { updateTransaction, deleteTransaction, addTransaction, buckets, accounts } = useFinance();
  const { stores } = useShopping();

  // Initialize the form fields from the transaction prop. Using lazy
  // initializers (rather than a post-mount effect) means the first render is
  // already populated; the prev-tracker below re-populates on later changes.
  const [amount, setAmount] = useState(() => transaction ? transaction.amount.toString() : '');
  const [merchant, setMerchant] = useState(() => transaction?.merchant ?? '');
  const [category, setCategory] = useState(() => transaction?.category ?? '');
  const [subBucketId, setSubBucketId] = useState<string | undefined>(() => transaction?.subBucketId);
  const [store, setStore] = useState(() => transaction?.store || '');
  const [accountId, setAccountId] = useState(() => transaction?.accountId || '');
  const [creditPayment, setCreditPayment] = useState(() => transaction?.creditPayment ?? false);
  const [date, setDate] = useState(() => transaction?.date ?? '');
  const [status, setStatus] = useState<'verified' | 'pending_review'>(() => transaction?.status ?? 'verified');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Dynamic Categories from buckets
  const dynamicCategories = [...buckets.map(b => b.name), 'Budgeted in Calendar'];

  // Find selected bucket and its sub-buckets
  const selectedBucket = buckets.find(b => b.name === category);
  const subBuckets = selectedBucket?.subBuckets || [];

  // The Charge/Payment toggle only applies to a credit account.
  const isSelectedAccountCredit = accounts.find(a => a.id === accountId)?.type === 'credit';

  // Re-populate the form when the transaction prop changes. Done during render
  // (on the reference-change edge) rather than in an effect so it doesn't
  // trigger a cascading render. Mirrors the previous effect keyed on
  // `[transaction]`; the initial population is handled by the initializers above.
  const [prevTransaction, setPrevTransaction] = useState(transaction);
  if (prevTransaction !== transaction) {
    setPrevTransaction(transaction);
    if (transaction) {
      setAmount(transaction.amount.toString());
      setMerchant(transaction.merchant);
      setCategory(transaction.category);
      setSubBucketId(transaction.subBucketId);
      setStore(transaction.store || '');
      setAccountId(transaction.accountId || '');
      setCreditPayment(transaction.creditPayment ?? false);
      setDate(transaction.date);
      setStatus(transaction.status);
    }
  }

  // Reset delete confirmation when the modal closes. Done during render on the
  // open→close edge rather than in an effect (the component stays mounted).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) {
      setShowDeleteConfirm(false);
    }
  }

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
        // Always pass the key so toggling Payment off on a credit transaction
        // clears the stored flag (the context removes a now-false flag via
        // deleteField). Undefined for non-credit accounts.
        creditPayment: isSelectedAccountCredit && creditPayment ? true : undefined,
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
      toast.error('Failed to delete transaction. Please try again.');
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
        date: getLocalDateString(), // Default to today (local) for the copy
        status: 'verified',
        isRecurring: false,
        source: 'manual',
        autoCategorized: transaction.autoCategorized ?? false,
        subBucketId: subBucketId || undefined,
        store: store || undefined,
        accountId: accountId || undefined
        // Let addTransaction handle ID and timestamps
      });

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
          inputMode="decimal"
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

        {isSelectedAccountCredit && (
          <div className="flex items-center justify-between p-4 bg-brand-50 dark:bg-brand-700/50 rounded-xl border border-brand-100 dark:border-brand-700">
            <div>
              <span id="edit-credit-payment-label" className="text-sm font-medium text-brand-700 dark:text-brand-200">
                {creditPayment ? 'Payment toward card' : 'Charge to card'}
              </span>
              <p className="text-xs text-brand-400 dark:text-brand-400 mt-0.5">
                {creditPayment
                  ? 'Lowers this card’s balance (paying it down).'
                  : 'Raises this card’s balance; never affects Safe-to-Spend.'}
              </p>
            </div>
            <Switch
              checked={creditPayment}
              onCheckedChange={setCreditPayment}
              disabled={isSaving}
              aria-labelledby="edit-credit-payment-label"
            />
          </div>
        )}

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
      <div className="sticky bottom-0 bg-white dark:bg-brand-800 border-t border-brand-200 dark:border-brand-700 p-4 space-y-2">
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 py-3 bg-brand-100 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300 font-semibold rounded-btn hover:bg-brand-200 dark:hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 py-3 bg-accent-600 dark:bg-accent-500 text-white font-semibold rounded-btn hover:bg-accent-700 dark:hover:bg-accent-400 transition-colors duration-(--duration-fast) ease-(--ease-standard) flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
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
        <div className="flex gap-2">
          <button
            onClick={handleDuplicate}
            disabled={isSaving}
            className="flex-1 py-3 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 text-brand-600 dark:text-brand-300 font-semibold rounded-btn hover:bg-brand-50 dark:hover:bg-brand-700/50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Copy size={16} />
            Duplicate
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isSaving}
            className="flex-1 py-3 bg-money-bgNeg text-money-neg font-semibold rounded-btn hover:bg-money-neg/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete transaction?"
        message="Are you sure? This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="destructive"
        isConfirming={isSaving}
      />
    </Drawer>
  );
};

export default EditTransactionModal;
