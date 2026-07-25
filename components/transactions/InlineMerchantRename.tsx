import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useMerchantRules } from '@/hooks/useMerchantRules';
import { looksLikeBankDescriptor } from '@/utils/bankDescriptor';
import { suggestPatternFromDescriptor } from '@/utils/merchantRules';

/**
 * F-MONEY-14 — the inline half of rule authoring: rename a merchant from the
 * transaction you're already looking at, instead of memorising the bank's
 * spelling and retyping it in Settings.
 *
 * Deliberately NOT a nested Drawer. Both hosts (`EditTransactionModal`,
 * `TransactionReviewForm`) are themselves Drawers, and opening the full
 * `MerchantRuleFormDrawer` from inside one would put two focus traps and two
 * exit animations against each other. This writes the ONE field that covers the
 * case people actually hit here — a friendly name — and leaves amount
 * qualifiers, category, bill links and no-spend exemptions to the Settings
 * editor, which is linked from the helper text.
 */

export interface InlineMerchantRenameProps {
  /** The RAW bank descriptor, exactly as stored on the transaction. */
  merchant: string;
  /** The row's amount, so an existing amount-qualified rule resolves correctly. */
  amount?: number;
  /** Host form is mid-save — don't let a rule write race it. */
  disabled?: boolean;
}

const InlineMerchantRename: React.FC<InlineMerchantRenameProps> = ({
  merchant,
  amount,
  disabled = false,
}) => {
  const { ruleFor, addRule, saving } = useMerchantRules();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  // A rule that already NAMES this row is the end state this control exists to
  // reach, so once one applies the control retires and the host's "Your bank
  // calls this …" caption takes over. A rule that only sets a category/bill
  // leaves the descriptor unnamed, so the offer stands.
  const existingName = ruleFor({ merchant, amount })?.name?.trim();
  const pattern = suggestPatternFromDescriptor(merchant);

  if (existingName || !pattern || !looksLikeBankDescriptor(merchant)) return null;

  const close = () => {
    setIsOpen(false);
    setName('');
    setError(null);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter the name you want to see instead.');
      return;
    }
    setError(null);
    try {
      await addRule({ pattern, name: trimmed });
      // On success the new rule makes `existingName` truthy, so this component
      // unmounts itself on the next render — no success message needed here,
      // the mutation layer already toasts.
      close();
    } catch {
      // The mutation layer toasts the reason and rejects. Keep the editor open
      // with what they typed so a retry doesn't start from scratch.
      setError("That didn't save. Try again.");
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        className="-mt-2 self-start text-xxs text-accent-600 dark:text-accent-500 underline underline-offset-2 rounded-btn outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 disabled:opacity-50"
      >
        Always call this something else
      </button>
    );
  }

  return (
    <div className="-mt-2 rounded-card border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800/50 p-3">
      <Input
        id={fieldId}
        label="Show this merchant as"
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        error={error ?? undefined}
        placeholder="e.g. AmEx payment"
        disabled={disabled || saving}
        autoComplete="off"
        data-autofocus
        aria-describedby={`${fieldId}-help`}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
        }}
      />
      <p id={`${fieldId}-help`} className="mt-1.5 text-xxs text-brand-450">
        Renames every charge containing{' '}
        <span className="font-mono text-brand-500 dark:text-brand-400">{pattern}</span>. Your bank&apos;s
        wording is never changed — this only affects what you see. Add an amount, category or bill
        link in Settings.
      </p>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" onClick={() => void save()} disabled={disabled || saving}>
          {saving ? 'Saving…' : 'Save name'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={close} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default InlineMerchantRename;
