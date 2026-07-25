import React, { useMemo, useState } from 'react';
import { AlertTriangle, Scissors } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Drawer } from '@/components/ui/Drawer';
import Eyebrow from '@/components/ui/Eyebrow';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import type { MerchantRuleDraft } from '@/hooks/useMerchantRules';
import type { MerchantRule } from '@/types/schema';
import {
  findShadowingRule,
  normalizeForRuleMatch,
  suggestPatternFromDescriptor,
} from '@/utils/merchantRules';

/** A bill this rule can be linked to (a `CalendarItem` reduced to what the picker shows). */
export interface MerchantRuleBillOption {
  id: string;
  title: string;
}

export interface MerchantRuleFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** The saved rule being edited, or null/undefined to author a new one. */
  rule?: MerchantRule | null;
  /**
   * Every saved rule, used ONLY for the duplicate-pattern warning
   * ({@link findShadowingRule}). Includes the rule being edited — the engine
   * excludes it by `id`.
   */
  rules: readonly MerchantRule[];
  /** Category names the household actually uses (bucket names + the calendar sentinel). */
  categoryOptions: readonly string[];
  /** Bills the rule may auto-link matching charges to. */
  billOptions: readonly MerchantRuleBillOption[];
  /**
   * Persists the draft. Owned by the parent (the only place that touches the
   * mutation hook), which keeps this drawer renderable — and testable — on its
   * own. Rejecting leaves the sheet open with the user's input intact.
   */
  onSave: (draft: MerchantRuleDraft) => Promise<void>;
  /** Present only when editing — omitted for a new rule. */
  onDelete?: () => Promise<void>;
  /** True while the parent's save is in flight. */
  saving?: boolean;
}

// Field ids are static: exactly one of these drawers is mounted at a time, and
// stable ids let the helper/error text be wired with `aria-describedby`.
const PATTERN_ID = 'merchant-rule-pattern';
const AMOUNT_ID = 'merchant-rule-amount';
const NAME_ID = 'merchant-rule-name';
const CATEGORY_ID = 'merchant-rule-category';
const BILL_ID = 'merchant-rule-bill';
const EXEMPT_LABEL_ID = 'merchant-rule-exempt-label';

/**
 * Identity given to the unsaved draft when it is checked for shadowing. Real
 * ids come from the mutation layer, so this can never collide with a saved rule
 * (and therefore never excludes one from the check).
 */
const DRAFT_RULE_ID = '__merchant-rule-draft__';

/**
 * `createdAt` given to the unsaved draft: the newest instant expressible, so a
 * brand-new rule LOSES every specificity tie to an existing one — which is
 * exactly what will happen once it is saved a moment from now. Using a literal
 * (rather than `Date.now()`) keeps the check pure and deterministic in tests.
 */
const DRAFT_CREATED_AT = '9999-12-31T23:59:59.999Z';

interface FormState {
  pattern: string;
  /** Raw text, not a number — '' means "no amount qualifier". */
  amount: string;
  name: string;
  category: string;
  billId: string;
  exempt: boolean;
  /** Errors stay hidden until the first save attempt, so a blank form is calm. */
  submitAttempted: boolean;
}

const toFormState = (rule: MerchantRule | null | undefined): FormState => ({
  pattern: rule?.pattern ?? '',
  // Presence, never truthiness: `0` is a legitimate qualifier (an Apple Pay
  // pre-authorization stub), and `rule.amount && …` would drop it.
  amount: rule?.amount !== undefined ? String(rule.amount) : '',
  name: rule?.name ?? '',
  category: rule?.category ?? '',
  billId: rule?.billId ?? '',
  exempt: rule?.exempt ?? false,
  submitAttempted: false,
});

/**
 * Parse the optional amount qualifier. `undefined` value + `ok: true` means the
 * user left it blank (no qualifier). `0` is VALID and must survive the round
 * trip, so this returns a discriminated result instead of a falsy number.
 */
function parseAmountInput(raw: string): { ok: boolean; value?: number } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return { ok: false };
  return { ok: true, value };
}

/** The label to show for a rule in the duplicate warning. */
const ruleLabel = (rule: MerchantRule): string => rule.name?.trim() || rule.pattern;

const HELP_TEXT = 'text-xs text-brand-500 dark:text-brand-400 mt-1.5';

/**
 * Create / edit sheet for one {@link MerchantRule}.
 *
 * The two halves of a rule are separated on purpose: what it MATCHES (a
 * contains-pattern, plus an optional cent-exact amount) and what it then DOES
 * (rename, categorize, link to a bill, exempt from no-spend days). A rule may
 * do any subset — a category-only rule leaves the bank's text alone.
 */
const MerchantRuleFormDrawer: React.FC<MerchantRuleFormDrawerProps> = ({
  isOpen,
  onClose,
  rule,
  rules,
  categoryOptions,
  billOptions,
  onSave,
  onDelete,
  saving = false,
}) => {
  const [form, setForm] = useState<FormState>(() => toFormState(rule));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset the draft whenever the sheet opens, or switches to a different rule.
  // Done during render on that edge (not in an effect) so there is no extra
  // commit — the same pattern NotificationSettings uses to mirror a prop.
  const formKey = `${isOpen ? 'open' : 'closed'}:${rule?.id ?? 'new'}`;
  const [prevFormKey, setPrevFormKey] = useState(formKey);
  if (prevFormKey !== formKey) {
    setPrevFormKey(formKey);
    setForm(toFormState(rule));
    setConfirmDelete(false);
  }

  const isEditing = Boolean(rule);
  const amountParse = parseAmountInput(form.amount);
  const amountValue = amountParse.value;

  const patternError = normalizeForRuleMatch(form.pattern)
    ? undefined
    : 'Enter the text to look for in the bank description.';
  const amountError = amountParse.ok
    ? undefined
    : 'Enter an amount like 2.99, or leave this blank to match any amount.';
  const showPatternError = form.submitAttempted ? patternError : undefined;
  const showAmountError = form.submitAttempted ? amountError : undefined;

  /**
   * The saved rule that would always beat this one. Structurally this only
   * fires on a DUPLICATE pattern (see `findShadowingRule` — a broader rule
   * loses to a narrower one rather than shadowing it), so the copy below says
   * "duplicate" and nothing more general.
   */
  const shadowingRule = useMemo(() => {
    if (!normalizeForRuleMatch(form.pattern)) return null;
    const candidate: MerchantRule = {
      id: rule?.id ?? DRAFT_RULE_ID,
      pattern: form.pattern,
      createdAt: rule?.createdAt ?? DRAFT_CREATED_AT,
      ...(amountValue !== undefined ? { amount: amountValue } : {}),
    };
    return findShadowingRule(candidate, rules);
  }, [form.pattern, amountValue, rule, rules]);

  /**
   * When the field holds a whole bank descriptor, offer the trimmed prefix —
   * the trailing reference/phone/date/store numbers are what make one
   * merchant's descriptors differ from each other, so keeping them would pin
   * the rule to a single charge.
   */
  const trimSuggestion = useMemo(() => {
    const normalized = normalizeForRuleMatch(form.pattern);
    if (!normalized) return null;
    const suggested = suggestPatternFromDescriptor(form.pattern);
    return suggested && suggested !== normalized ? suggested : null;
  }, [form.pattern]);

  // Keep a stored value the household has since renamed/deleted selectable, so
  // opening an old rule can't silently reset its category or bill link.
  const categoryChoices = useMemo(() => {
    const stored = form.category;
    return stored && !categoryOptions.includes(stored)
      ? [...categoryOptions, stored]
      : [...categoryOptions];
  }, [categoryOptions, form.category]);

  const billChoices = useMemo(() => {
    const stored = form.billId;
    return stored && !billOptions.some((bill) => bill.id === stored)
      ? [...billOptions, { id: stored, title: 'Linked bill (no longer exists)' }]
      : [...billOptions];
  }, [billOptions, form.billId]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (patternError || amountError) {
      setForm((prev) => ({ ...prev, submitAttempted: true }));
      return;
    }
    setForm((prev) => ({ ...prev, submitAttempted: true }));

    // Blank optional fields are OMITTED, never sent as ''. That is what lets a
    // previously-set name/category/bill be cleared: the mutation layer treats
    // an absent key as "remove this effect".
    const draft: MerchantRuleDraft = { pattern: form.pattern.trim() };
    if (amountValue !== undefined) draft.amount = amountValue;
    const name = form.name.trim();
    if (name) draft.name = name;
    if (form.category) draft.category = form.category;
    if (form.billId) draft.billId = form.billId;
    if (form.exempt) draft.exempt = true;

    try {
      await onSave(draft);
      onClose();
    } catch {
      // The parent surfaces the failure; keep the sheet open with the input.
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      setConfirmDelete(false);
      onClose();
    } catch {
      // The parent surfaces the failure; just drop out of the confirm.
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={isEditing ? 'Edit merchant rule' : 'New merchant rule'}
        footer={
          <div className="flex gap-2 border-t border-brand-200 dark:border-brand-700 p-4">
            <Button variant="secondary" size="lg" className="flex-1" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" className="flex-1" onClick={handleSave} isLoading={saving}>
              {isEditing ? 'Save rule' : 'Create rule'}
            </Button>
          </div>
        }
      >
        <div className="space-y-6">
          <p className="text-sm text-brand-500 dark:text-brand-400">
            A rule cleans up how a charge reads across the whole app. Your bank&apos;s original wording is
            kept, so deleting the rule brings it straight back.
          </p>

          {/* ---- What it matches ------------------------------------------ */}
          <div className="space-y-4">
            {/* h4: the Drawer's own title renders as the h3 above these groups. */}
            <Eyebrow as="h4">When the charge matches</Eyebrow>

            <div>
              <Input
                id={PATTERN_ID}
                label="Bank description contains"
                type="text"
                required
                value={form.pattern}
                onChange={(e) => update('pattern', e.target.value)}
                placeholder="APPLE.COM/BILL"
                className="font-mono"
                error={showPatternError}
                aria-describedby={
                  showPatternError ? `${PATTERN_ID}-error ${PATTERN_ID}-help` : `${PATTERN_ID}-help`
                }
                // The focus trap prefers [data-autofocus]; a plain autoFocus is
                // clobbered by the trap and focus lands on the close button.
                data-autofocus
              />
              <p id={`${PATTERN_ID}-help`} className={HELP_TEXT}>
                Plain text, matched anywhere in the description and ignoring capitalisation. There are no
                wildcards — punctuation counts.
              </p>
            </div>

            {trimSuggestion && (
              <div className="rounded-card border border-brand-200 bg-brand-50 p-3 dark:border-brand-700 dark:bg-brand-800/60">
                <p className="text-xs text-brand-600 dark:text-brand-300">
                  That looks like one whole charge line. Trimming the trailing reference numbers lets the
                  rule catch every charge from this merchant, not just this one.
                </p>
                <Button
                  variant="subtle"
                  size="sm"
                  className="mt-2"
                  leftIcon={<Scissors size={14} />}
                  onClick={() => update('pattern', trimSuggestion)}
                >
                  Trim to {trimSuggestion}
                </Button>
              </div>
            )}

            <div>
              <Input
                id={AMOUNT_ID}
                label="Only at this amount"
                type="text"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => update('amount', e.target.value)}
                placeholder="Any amount"
                className="font-mono"
                icon={<span aria-hidden="true">$</span>}
                error={showAmountError}
                aria-describedby={
                  showAmountError ? `${AMOUNT_ID}-error ${AMOUNT_ID}-help` : `${AMOUNT_ID}-help`
                }
              />
              <p id={`${AMOUNT_ID}-help`} className={HELP_TEXT}>
                Optional, and exact to the cent — a price change will stop it matching. Leave blank to
                match any amount. $0 is allowed, for Apple Pay holds.
              </p>
            </div>

            {shadowingRule && (
              <div
                className="flex items-start gap-2 rounded-card border border-warm-200 bg-warm-50 p-3 dark:border-warm-700 dark:bg-warm-900/40"
                role="status"
              >
                <AlertTriangle
                  size={16}
                  className="mt-0.5 shrink-0 text-warm-600 dark:text-warm-300"
                  aria-hidden="true"
                />
                <p className="text-xs text-warm-700 dark:text-warm-200">
                  <span className="font-semibold">Duplicate pattern.</span>{' '}
                  <span className="font-semibold">{ruleLabel(shadowingRule)}</span> already matches on this
                  exact text
                  {shadowingRule.amount !== undefined ? ' at the same amount' : ''}. The older rule always
                  wins, so this one would never fire. You can still save it.
                </p>
              </div>
            )}

            <p className="text-xs text-brand-500 dark:text-brand-400">
              If several rules match one charge, the most specific wins: an amount-pinned rule first, then
              the longer pattern.
            </p>
          </div>

          {/* ---- What it does --------------------------------------------- */}
          <div className="space-y-4">
            <Eyebrow as="h4">Then</Eyebrow>

            <div>
              <Input
                id={NAME_ID}
                label="Show it as"
                type="text"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Apple"
                aria-describedby={`${NAME_ID}-help`}
              />
              <p id={`${NAME_ID}-help`} className={HELP_TEXT}>
                Leave blank to keep the bank&apos;s wording and only apply the settings below.
              </p>
            </div>

            <Select
              id={CATEGORY_ID}
              label="Category"
              value={form.category}
              onChange={(e) => update('category', e.target.value)}
            >
              <option value="">Leave the category alone</option>
              {categoryChoices.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>

            <Select
              id={BILL_ID}
              label="Link to a bill"
              value={form.billId}
              onChange={(e) => update('billId', e.target.value)}
            >
              <option value="">Not linked to a bill</option>
              {billChoices.map((bill) => (
                <option key={bill.id} value={bill.id}>
                  {bill.title}
                </option>
              ))}
            </Select>

            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p
                  id={EXEMPT_LABEL_ID}
                  className="text-sm font-semibold tracking-tight text-brand-900 dark:text-brand-100"
                >
                  Ignore on no-spend days
                </p>
                <p className="text-xs text-brand-500 dark:text-brand-400">
                  Matching charges are treated as planned, so they will not break a no-spend day.
                </p>
              </div>
              <Switch
                id="merchant-rule-exempt"
                aria-labelledby={EXEMPT_LABEL_ID}
                checked={form.exempt}
                onCheckedChange={(value) => update('exempt', value)}
              />
            </div>
          </div>

          {onDelete && (
            <div className="border-t border-brand-200 pt-4 dark:border-brand-700">
              <Button
                variant="ghost-danger"
                size="lg"
                className="w-full"
                onClick={() => setConfirmDelete(true)}
                disabled={saving || deleting}
              >
                Delete rule
              </Button>
            </div>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        isConfirming={deleting}
        title="Delete this rule?"
        confirmLabel="Delete"
        message="Charges it renamed go back to your bank's original wording everywhere in the app. Nothing else about them changes."
      />
    </>
  );
};

export default MerchantRuleFormDrawer;
