import React, { useMemo, useState } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import {
  CalendarClock,
  ChevronRight,
  FolderTree,
  Plus,
  ShieldCheck,
  Tag,
  Tags,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { Row, Section, SurfaceList } from '@/components/ui/Section';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useMerchantRules, type MerchantRuleDraft } from '@/hooks/useMerchantRules';
import { MAX_MERCHANT_RULES, type MerchantRule } from '@/types/schema';
import { buildTransactionCategoryOptions } from '@/utils/categories';
import { cn } from '@/utils/cn';
import MerchantRuleFormDrawer, {
  type MerchantRuleBillOption,
} from '@/components/settings/MerchantRuleFormDrawer';

/**
 * How close to {@link MAX_MERCHANT_RULES} the household must be before the
 * count is surfaced. Below this the cap is irrelevant noise — a household with
 * six rules does not need to be told about a ceiling of 200.
 */
const CAP_NOTICE_HEADROOM = 20;

/** `MMM d` for a `lastMatchedAt` ISO timestamp, or null when it is unusable. */
function formatMatchDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const parsed = parseISO(iso);
  return isValid(parsed) ? format(parsed, 'MMM d') : null;
}

interface RuleActionChipProps {
  icon: LucideIcon;
  children: React.ReactNode;
  /** Amber treatment for the "this rule does nothing" chip. */
  tone?: 'neutral' | 'caution';
}

/** One of the four things a rule can do, as a compact pill. */
const RuleActionChip: React.FC<RuleActionChipProps> = ({ icon: Icon, children, tone = 'neutral' }) => (
  <span
    className={cn(
      'inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-xxs',
      tone === 'caution'
        ? 'border-warm-200 bg-warm-50 font-semibold text-warm-700 dark:border-warm-700 dark:bg-warm-900/40 dark:text-warm-200'
        : 'border-brand-200 bg-brand-100 text-brand-600 dark:border-brand-700 dark:bg-brand-700/50 dark:text-brand-300'
    )}
  >
    <Icon size={10} className="shrink-0" aria-hidden="true" />
    <span className="truncate">{children}</span>
  </span>
);

interface MerchantRuleRowProps {
  rule: MerchantRule;
  billTitle: string | undefined;
  formatMoney: (amount: number) => string;
  onEdit: () => void;
}

const MerchantRuleRow: React.FC<MerchantRuleRowProps> = ({
  rule,
  billTitle,
  formatMoney,
  onEdit,
}) => {
  const name = rule.name?.trim();
  // A rule with no friendly name still needs a headline — the pattern IS the
  // rule in that case (it classifies rather than relabels).
  const primary = name || rule.pattern;

  const matchCount = rule.matchCount ?? 0;
  const lastMatched = formatMatchDate(rule.lastMatchedAt);
  const hasMatched = matchCount > 0;
  const matchLabel = hasMatched
    ? `Matched ${matchCount} ${matchCount === 1 ? 'time' : 'times'}${lastMatched ? ` · last on ${lastMatched}` : ''}`
    : 'Has not matched anything yet';

  const doesSomething = Boolean(name || rule.category || rule.billId || rule.exempt);

  return (
    <Row className="p-0">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit merchant rule ${primary}`}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset dark:hover:bg-brand-700/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold tracking-tight text-brand-900 dark:text-brand-50">
            {primary}
          </span>
          <span className="mt-0.5 block truncate font-mono text-xs text-brand-500 dark:text-brand-400">
            {rule.pattern}
            {/* Presence, not truthiness — a $0 qualifier is real. */}
            {rule.amount !== undefined && ` · at ${formatMoney(rule.amount)}`}
          </span>

          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {name && <RuleActionChip icon={Tag}>Renames</RuleActionChip>}
            {rule.category && <RuleActionChip icon={FolderTree}>{rule.category}</RuleActionChip>}
            {rule.billId && (
              <RuleActionChip icon={CalendarClock}>{billTitle ?? 'Linked bill'}</RuleActionChip>
            )}
            {rule.exempt && <RuleActionChip icon={ShieldCheck}>No-spend exempt</RuleActionChip>}
            {!doesSomething && (
              <RuleActionChip icon={Tag} tone="caution">
                Does nothing yet
              </RuleActionChip>
            )}
          </span>

          <span
            className={cn(
              'mt-1.5 block text-xxs',
              hasMatched
                ? 'text-brand-400 dark:text-brand-450'
                : 'font-semibold text-warm-600 dark:text-warm-300'
            )}
          >
            {matchLabel}
          </span>
        </span>
        <ChevronRight
          size={18}
          className="mt-0.5 shrink-0 text-brand-300 dark:text-brand-500"
          aria-hidden="true"
        />
      </button>
    </Row>
  );
};

/**
 * Settings surface for household-authored merchant rules (F-MONEY-14) — the
 * place a bank descriptor like "APPLE.COM/BILL 866-712-7753 CA" is taught to
 * read as "Apple".
 *
 * This card is the ONLY thing here that touches the mutation hook; the form
 * sheet takes `onSave`/`onDelete` as props so it stays independently testable.
 * A rule that never matches anything is the feature's main failure mode, so
 * each row reports its own match count rather than hiding it in the editor.
 */
const MerchantRulesCard: React.FC = () => {
  const { rules, addRule, updateRule, deleteRule, saving } = useMerchantRules();
  const { buckets, calendarItems } = useFinance();
  const formatMoney = useFormatCurrency();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingRule = editingId ? rules.find((rule) => rule.id === editingId) ?? null : null;

  const categoryOptions = useMemo(
    () => buildTransactionCategoryOptions(buckets, { sort: true }),
    [buckets]
  );

  // Bill templates and one-offs only: a `parentRecurringId` marks a generated
  // instance of a recurring bill, and linking a rule to one instance would
  // stop working the moment that instance is paid.
  const billOptions = useMemo<MerchantRuleBillOption[]>(
    () =>
      calendarItems
        .filter((item) => item.type === 'expense' && !item.isDeleted && !item.parentRecurringId)
        .map((item) => ({ id: item.id, title: item.title }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [calendarItems]
  );

  const billTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of calendarItems) map.set(item.id, item.title);
    return map;
  }, [calendarItems]);

  const atCap = rules.length >= MAX_MERCHANT_RULES;
  const showCapNotice = rules.length >= MAX_MERCHANT_RULES - CAP_NOTICE_HEADROOM;

  const openCreate = () => {
    setEditingId(null);
    setIsFormOpen(true);
  };

  const openEdit = (id: string) => {
    setEditingId(id);
    setIsFormOpen(true);
  };

  // No try/catch and no toasts here on purpose: `merchantRuleMutations` already
  // toasts both outcomes and rejects on failure. Letting the rejection through
  // is what keeps the form sheet open with the user's input intact.
  const handleSave = async (draft: MerchantRuleDraft) => {
    if (editingRule) {
      await updateRule(editingRule.id, draft);
      return;
    }
    await addRule(draft);
  };

  const handleDelete = async () => {
    if (!editingRule) return;
    await deleteRule(editingRule.id);
  };

  return (
    <Section
      title="Merchant rules"
      action={
        <Button
          variant="subtle"
          size="sm"
          leftIcon={<Plus size={16} />}
          onClick={openCreate}
          disabled={atCap}
        >
          New rule
        </Button>
      }
    >
      <div className="space-y-2">
        {rules.length === 0 ? (
          <EmptyState
            variant="surface"
            icon={<Tags />}
            title="No merchant rules yet"
            description={
              'A rule turns your bank’s wording — "APPLE.COM/BILL 866-712-7753 CA" — into a name you recognise, and applies to your whole history the moment you save it.'
            }
            action={
              <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>
                Create a rule
              </Button>
            }
          />
        ) : (
          <>
            <SurfaceList>
              {rules.map((rule) => (
                <MerchantRuleRow
                  key={rule.id}
                  rule={rule}
                  billTitle={rule.billId ? billTitleById.get(rule.billId) : undefined}
                  formatMoney={formatMoney}
                  onEdit={() => openEdit(rule.id)}
                />
              ))}
            </SurfaceList>

            {rules.length > 1 && (
              <p className="px-1 text-xs text-brand-500 dark:text-brand-400">
                When more than one rule matches a charge, the most specific wins: an amount-pinned rule
                first, then the longer pattern.
              </p>
            )}

            {showCapNotice && (
              <p className="px-1 text-xs font-semibold text-warm-600 dark:text-warm-300">
                {rules.length} of {MAX_MERCHANT_RULES} rules used
                {atCap ? ' — delete one to add another.' : '.'}
              </p>
            )}
          </>
        )}
      </div>

      <MerchantRuleFormDrawer
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        rule={editingRule}
        rules={rules}
        categoryOptions={categoryOptions}
        billOptions={billOptions}
        onSave={handleSave}
        onDelete={editingRule ? handleDelete : undefined}
        saving={saving}
      />
    </Section>
  );
};

export default MerchantRulesCard;
