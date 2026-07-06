
import React, { useId, useState } from 'react';
import { Trash2, Loader2, Copy, X } from 'lucide-react';
import { Transaction, CREDIT_CARD_CATEGORY } from '@/types/schema';
import { useFinance, useShopping } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { getLocalDateString } from '@/utils/dateHelpers';
import { buildTransactionCategoryOptions } from '@/utils/categories';
import { resolveStoreName } from '@/utils/stores';
import toast from 'react-hot-toast';

interface EditTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
}

const EditTransactionModal: React.FC<EditTransactionModalProps> = ({ isOpen, onClose, transaction }) => {
  const { updateTransaction, deleteTransaction, addTransaction, buckets, accounts } = useFinance();
  const { stores } = useShopping();

  // Datalist id for the Merchant field's store-name autocomplete (see below).
  const storeListId = useId();

  // Initialize the form fields from the transaction prop. Using lazy
  // initializers (rather than a post-mount effect) means the first render is
  // already populated; the prev-tracker below re-populates on later changes.
  const [amount, setAmount] = useState(() => transaction ? transaction.amount.toString() : '');
  const [merchant, setMerchant] = useState(() => transaction?.merchant ?? '');
  const [category, setCategory] = useState(() => transaction?.category ?? '');
  const [subBucketId, setSubBucketId] = useState<string | undefined>(() => transaction?.subBucketId);
  const [accountId, setAccountId] = useState(() => transaction?.accountId || '');
  const [creditPayment, setCreditPayment] = useState(() => transaction?.creditPayment ?? false);
  const [date, setDate] = useState(() => transaction?.date ?? '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Merging Store into Merchant removed the only way to intentionally clear a
  // stored Store; this flag (set by dismissing the store chip below) requests
  // an explicit clear on save, overriding the resolve/preserve fallback.
  const [storeCleared, setStoreCleared] = useState(false);

  // Dynamic Categories from buckets
  const dynamicCategories = buildTransactionCategoryOptions(buckets);

  // Merchant now doubles as the Store field (the product owner flagged a
  // separate lower-cased "store" dropdown as redundant with the free-text
  // merchant name). A native <datalist> on the Merchant input still offers
  // known store names for autocomplete. `resolveStore` derives the stored
  // `Transaction.store` at save time: dismissing the store chip clears it;
  // otherwise an exact (case-insensitive, trimmed) match against a known store
  // snaps to that store's canonical name so the TransactionMasterList store
  // filter keeps working, else the transaction's existing store value is left
  // untouched rather than polluting it with free text. Returning `undefined`
  // on an explicit clear removes the stored field (see updateTransaction).
  const resolveStore = (merchantValue: string): string | undefined => {
    if (storeCleared) return undefined;
    return resolveStoreName(stores, merchantValue) ?? transaction?.store ?? undefined;
  };

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
      setAccountId(transaction.accountId || '');
      setCreditPayment(transaction.creditPayment ?? false);
      setDate(transaction.date);
      setStoreCleared(false);
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

    if (!category && !isSelectedAccountCredit) {
      toast.error('Please select a category');
      return;
    }

    setIsSaving(true);
    try {
      await updateTransaction(transaction.id, {
        amount: amountNum,
        merchant: merchant.trim(),
        // Credit-tagged spend carries the sentinel, never a bucket category.
        category: isSelectedAccountCredit ? CREDIT_CARD_CATEGORY : category,
        subBucketId: isSelectedAccountCredit ? undefined : (subBucketId || undefined),
        store: resolveStore(merchant),
        accountId: accountId || undefined,
        // Always pass the key so toggling Payment off on a credit transaction
        // clears the stored flag (the context removes a now-false flag via
        // deleteField). Undefined for non-credit accounts.
        creditPayment: isSelectedAccountCredit && creditPayment ? true : undefined,
        date,
        // Status is intentionally omitted — it stays whatever it was. Editing
        // it here was a second, inconsistent path into the approve flow that
        // could flip a transaction to 'verified' without going through the
        // habit-linking/points logic (and could force-verify a $0
        // needsAmount stub).
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

    if (!category && !isSelectedAccountCredit) {
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
        category: isSelectedAccountCredit ? CREDIT_CARD_CATEGORY : category,
        date: getLocalDateString(), // Default to today (local) for the copy
        status: 'verified',
        isRecurring: false,
        source: 'manual',
        autoCategorized: transaction.autoCategorized ?? false,
        subBucketId: isSelectedAccountCredit ? undefined : (subBucketId || undefined),
        store: resolveStore(merchant),
        accountId: accountId || undefined,
        creditPayment: isSelectedAccountCredit && creditPayment ? true : undefined
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
          list={storeListId}
          autoComplete="off"
        />
        {/* Known store names, offered as autocomplete on the Merchant field
            above. Typing (or picking) an exact match snaps the transaction's
            store to that canonical name on save; see resolveStore(). */}
        <datalist id={storeListId}>
          {stores.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>

        {/* Merging Store into Merchant removed the way to intentionally clear a
            stored Store, so surface it as a dismissible chip. Dismissing it
            flags an explicit clear applied on save (resolveStore). */}
        {transaction?.store && !storeCleared && (
          <div className="-mt-2">
            <span className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs font-medium bg-brand-100 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300">
              Store: {transaction.store}
              <button
                type="button"
                onClick={() => setStoreCleared(true)}
                disabled={isSaving}
                aria-label={`Clear store ${transaction.store}`}
                className="p-0.5 rounded-full hover:bg-brand-200 dark:hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={12} />
              </button>
            </span>
          </div>
        )}

        {/* Category/sub-category don't apply to credit-tagged spend — the
            Charge/Payment toggle below takes their place. */}
        {!isSelectedAccountCredit && (
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
          {/* A credit transaction re-tagged to checking has no bucket category
              yet — surface an explicit placeholder until one is picked. */}
          {!dynamicCategories.includes(category) && (
            <option value={category} disabled>
              Select category...
            </option>
          )}
          {dynamicCategories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </Select>
        )}

        {!isSelectedAccountCredit && subBuckets.length > 0 && (
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

        <Select
          id="edit-account"
          label="Account"
          disabled={isSaving}
          value={accountId}
          onChange={(e) => {
            const nextId = e.target.value;
            setAccountId(nextId);
            // Re-tagging credit → asset: the sentinel is not a bucket category,
            // so clear it and force an explicit pick (save blocks on '').
            const nextIsCredit = accounts.find(a => a.id === nextId)?.type === 'credit';
            if (!nextIsCredit && category === CREDIT_CARD_CATEGORY) {
              setCategory('');
              setSubBucketId(undefined);
            }
          }}
        >
          <option value="">(None)</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>

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
