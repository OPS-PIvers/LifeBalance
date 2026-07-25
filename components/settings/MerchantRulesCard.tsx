import React, { useCallback, useMemo, useState } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import {
  CalendarClock,
  ChevronRight,
  FolderTree,
  Plus,
  ShieldCheck,
  Tag,
  Tags,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { Row, Section, SurfaceList } from '@/components/ui/Section';
import SectionHeading from '@/components/ui/SectionHeading';
import { useFinance, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useMerchantRules, type MerchantRuleDraft } from '@/hooks/useMerchantRules';
import { MAX_MERCHANT_RULES, type MerchantRule, type Transaction } from '@/types/schema';
import { buildTransactionCategoryOptions } from '@/utils/categories';
import { pickMerchantRule } from '@/utils/merchantRules';
import {
  suggestMerchantRules,
  SUGGESTION_MIN_OCCURRENCES,
  type MerchantRuleSuggestion,
} from '@/utils/merchantRuleSuggestions';
import MerchantRuleFormDrawer, {
  type MerchantRuleBillOption,
  type MerchantRuleSeed,
} from '@/components/settings/MerchantRuleFormDrawer';

/**
 * How close to {@link MAX_MERCHANT_RULES} the household must be before the
 * count is surfaced. Below this the cap is irrelevant noise — a household with
 * six rules does not need to be told about a ceiling of 200.
 */
const CAP_NOTICE_HEADROOM = 20;

/** `MMM d` for an ISO timestamp or `yyyy-MM-dd` date, or null when unusable. */
function formatMatchDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const parsed = parseISO(iso);
  return isValid(parsed) ? format(parsed, 'MMM d') : null;
}

/**
 * localStorage dismissal key for a rule SUGGESTION, keyed on household + the
 * proposed pattern. Shape mirrors `RecurringBillsModal`'s
 * `detectionDismissKey` (prefix, discriminator, raw text lower-cased).
 *
 * The key is built from the RAW descriptor pattern, never a friendly name: it
 * establishes identity, and identity in this codebase is always the bank's own
 * text. A later rename must not resurrect a suggestion the user dismissed.
 */
const suggestionDismissKey = (householdId: string, pattern: string) =>
  `lb_merchant_rule_dismissed_${householdId}_${pattern.toLowerCase().trim()}`;

const isSuggestionDismissed = (householdId: string, pattern: string): boolean => {
  try {
    return window.localStorage.getItem(suggestionDismissKey(householdId, pattern)) === '1';
  } catch {
    return false;
  }
};

const persistSuggestionDismiss = (householdId: string, pattern: string): void => {
  try {
    window.localStorage.setItem(suggestionDismissKey(householdId, pattern), '1');
  } catch {
    // Best-effort — the in-session state still hides the row.
  }
};

/** How much of the household's own history one rule actually claims. */
interface RuleMatchStats {
  count: number;
  /** yyyy-MM-dd of the most recent claimed transaction. */
  lastDate: string;
}

/**
 * Per-rule match counts derived from the household's OWN transactions.
 *
 * WHY NOT `MerchantRule.matchCount` / `lastMatchedAt`: those stored counters are
 * reserved for the server-side sync pipeline that stamps them where rules are
 * APPLIED — which does not exist yet. Nothing in the client ever writes them, so
 * reading them made every working rule report "never matched" and invited the
 * user to delete a rule that was renaming charges in front of them. The stored
 * fields are deliberately left untouched on the document (that pipeline still
 * owns them) and deliberately ignored here. They are also a DIFFERENT quantity —
 * "times a pipeline fired" vs. "charges this rule renames" — so summing them or
 * falling back between them would produce a number that means nothing.
 *
 * Attribution goes through `pickMerchantRule`, so each transaction is credited
 * to the ONE rule that actually wins it. Counting every rule whose pattern
 * matches would double-count: a charge claimed by an amount-pinned rule would
 * also inflate the bare rule it outranks, and the bare rule's count would then
 * promise renames it never performs.
 */
function buildRuleMatchStats(
  transactions: readonly Pick<Transaction, 'merchant' | 'amount' | 'date'>[],
  rules: readonly MerchantRule[]
): Map<string, RuleMatchStats> {
  const stats = new Map<string, RuleMatchStats>();
  if (rules.length === 0) return stats;

  for (const transaction of transactions) {
    const winner = pickMerchantRule(transaction.merchant, transaction.amount, rules);
    if (winner === null) continue;

    const existing = stats.get(winner.id);
    if (existing === undefined) {
      stats.set(winner.id, { count: 1, lastDate: transaction.date });
      continue;
    }
    existing.count += 1;
    // Dates are yyyy-MM-dd, which sorts lexicographically.
    if (transaction.date > existing.lastDate) existing.lastDate = transaction.date;
  }
  return stats;
}

interface RuleActionChipProps {
  icon: LucideIcon;
  children: React.ReactNode;
  /** Amber treatment for the "this rule does nothing" chip. */
  tone?: 'neutral' | 'caution';
}

/**
 * NOTE — these are joined by hand rather than through `cn()`. tailwind-merge
 * does not recognise the project's custom `text-xxs` (10px) as a font size, so
 * it treats it as conflicting with any `text-<color>` in the same `cn()` call
 * and drops one of the two. Plain concatenation keeps both, which is correct:
 * they set different CSS properties. (Verified: `twMerge('text-xxs',
 * 'text-brand-600')` returns only `text-brand-600`.)
 */
const CHIP_BASE =
  'inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-xxs';

const CHIP_TONES: Record<'neutral' | 'caution', string> = {
  neutral:
    'border-brand-200 bg-brand-100 text-brand-600 dark:border-brand-700 dark:bg-brand-700/50 dark:text-brand-300',
  caution:
    'border-warm-200 bg-warm-50 font-semibold text-warm-700 dark:border-warm-700 dark:bg-warm-900/40 dark:text-warm-200',
};

/** One of the four things a rule can do, as a compact pill. */
const RuleActionChip: React.FC<RuleActionChipProps> = ({ icon: Icon, children, tone = 'neutral' }) => (
  <span className={`${CHIP_BASE} ${CHIP_TONES[tone]}`}>
    <Icon size={10} className="shrink-0" aria-hidden="true" />
    <span className="truncate">{children}</span>
  </span>
);

interface MerchantRuleRowProps {
  rule: MerchantRule;
  /** This rule's share of the loaded history, or undefined when it claims none. */
  stats: RuleMatchStats | undefined;
  billTitle: string | undefined;
  formatMoney: (amount: number) => string;
  onEdit: () => void;
}

const MerchantRuleRow: React.FC<MerchantRuleRowProps> = ({
  rule,
  stats,
  billTitle,
  formatMoney,
  onEdit,
}) => {
  const name = rule.name?.trim();
  // A rule with no friendly name still needs a headline — the pattern IS the
  // rule in that case (it classifies rather than relabels).
  const primary = name || rule.pattern;

  // Measured against the household's own transactions (see buildRuleMatchStats),
  // so the copy says "your transactions" — this is not a pipeline fire count.
  const count = stats?.count ?? 0;
  const hasMatched = count > 0;
  const lastMatched = formatMatchDate(stats?.lastDate);
  // The zero case stays factual rather than prescriptive: a wrong pattern is the
  // usual cause, but a correct rule outranked on every current charge (a bare
  // rule under an amount-pinned one) also reads zero, and telling that user to
  // "check the pattern" would send them after a fault that isn't there. The
  // amber treatment is the flag; the row itself opens the editor.
  const matchLabel = hasMatched
    ? `Applies to ${count} of your transactions${lastMatched ? ` · latest ${lastMatched}` : ''}`
    : 'Matches none of your transactions';

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

          {/* Concatenated, not `cn()` — see the CHIP_BASE note: tailwind-merge
              would drop `text-xxs` against the text colour. */}
          <span
            className={`mt-1.5 block text-xxs ${
              hasMatched
                ? 'text-brand-400 dark:text-brand-450'
                : 'font-semibold text-warm-600 dark:text-warm-300'
            }`}
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

interface SuggestionRowProps {
  suggestion: MerchantRuleSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
}

/**
 * One proposed rule: the pattern it would use, the raw descriptor it was read
 * off (the evidence), and how often that descriptor has been seen. Tapping the
 * row opens the create sheet seeded from it; the trailing control dismisses it.
 */
const SuggestionRow: React.FC<SuggestionRowProps> = ({ suggestion, onAccept, onDismiss }) => {
  const lastSeen = formatMatchDate(suggestion.lastDate);
  // `p-0` (not `pl-0 pr-2`) so tailwind-merge fully drops the Row's own
  // padding — a child `pl-*` would leave `px-4` in the class list and let
  // stylesheet order, not this call site, decide the left inset.
  return (
    <Row className="p-0 gap-1">
      <button
        type="button"
        onClick={onAccept}
        aria-label={`Create a rule for ${suggestion.pattern}`}
        className="flex min-w-0 flex-1 items-start gap-3 py-3.5 pl-4 pr-1 text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset dark:hover:bg-brand-700/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold tracking-tight text-brand-900 dark:text-brand-50">
            {suggestion.pattern}
          </span>
          <span className="mt-0.5 block truncate font-mono text-xs text-brand-500 dark:text-brand-400">
            {suggestion.sampleDescriptor}
          </span>
          {suggestion.suggestedCategory && (
            <span className="mt-1.5 flex flex-wrap items-center gap-1">
              <RuleActionChip icon={FolderTree}>{suggestion.suggestedCategory}</RuleActionChip>
            </span>
          )}
          <span className="mt-1.5 block text-xxs text-brand-400 dark:text-brand-450">
            Seen {suggestion.occurrences} {suggestion.occurrences === 1 ? 'time' : 'times'}
            {lastSeen ? ` · last on ${lastSeen}` : ''}
          </span>
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDismiss}
        className="mr-2"
        aria-label={`Dismiss the suggestion for ${suggestion.pattern}`}
      >
        <X size={16} />
      </Button>
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
 * A rule that matches nothing is the feature's main failure mode, so each row
 * reports how much of the household's own history it claims — derived live (see
 * `buildRuleMatchStats`), never from the stored `matchCount` counters that no
 * client code writes.
 */
const MerchantRulesCard: React.FC = () => {
  const { rules, addRule, updateRule, deleteRule, saving } = useMerchantRules();
  const { buckets, calendarItems, transactions, hasMoreTransactions } = useFinance();
  const { householdId } = useHouseholdCore();
  const formatMoney = useFormatCurrency();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [seed, setSeed] = useState<MerchantRuleSeed | null>(null);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());

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

  /**
   * PERFORMANCE — both of these read the household's ENTIRE transaction history
   * (`suggestMerchantRules` additionally clusters), and this card sits on a
   * Settings screen that re-renders for reasons of its own. They share ONE memo
   * so the two passes are triggered by one dependency set and can never fall out
   * of step with each other. Both deps are stable against unrelated traffic:
   *  - `rules` comes from `useMerchantRules`, which memoizes on the rules'
   *    CONTENT (a JSON signature), not the array identity the household listener
   *    hands out fresh on every household-doc write. So a points update cannot
   *    churn this.
   *  - `transactions` is `useMemo(() => mergeById(recentTransactions,
   *    olderTransactions), …)` in `FirebaseHouseholdContext`, so its identity
   *    changes only when the transactions listener fires or a "load older" page
   *    lands — never on a household-doc write.
   * The dismissal filter is deliberately a SEPARATE memo below: dismissing a
   * suggestion must not re-run either pass.
   */
  const { matchStats, suggestions } = useMemo(
    () => ({
      matchStats: buildRuleMatchStats(transactions, rules),
      suggestions: suggestMerchantRules(transactions, rules),
    }),
    [transactions, rules]
  );

  const visibleSuggestions = useMemo(
    () =>
      suggestions.filter((suggestion) => {
        const key = suggestionDismissKey(householdId ?? '', suggestion.pattern);
        return !dismissedKeys.has(key) && !isSuggestionDismissed(householdId ?? '', suggestion.pattern);
      }),
    [suggestions, dismissedKeys, householdId]
  );

  const dismissSuggestion = useCallback(
    (suggestion: MerchantRuleSuggestion) => {
      const key = suggestionDismissKey(householdId ?? '', suggestion.pattern);
      persistSuggestionDismiss(householdId ?? '', suggestion.pattern);
      setDismissedKeys((prev) => new Set(prev).add(key));
    },
    [householdId]
  );

  const openCreate = () => {
    setEditingId(null);
    setSeed(null);
    setIsFormOpen(true);
  };

  const openEdit = (id: string) => {
    setEditingId(id);
    setSeed(null);
    setIsFormOpen(true);
  };

  // Accepting a suggestion opens the ordinary CREATE sheet with its fields
  // pre-filled — the user still reviews and can change anything before saving,
  // and `editingId` stays null so the save goes through `addRule`.
  const openCreateFromSuggestion = (suggestion: MerchantRuleSuggestion) => {
    setEditingId(null);
    setSeed({
      pattern: suggestion.pattern,
      ...(suggestion.suggestedCategory === undefined
        ? {}
        : { category: suggestion.suggestedCategory }),
    });
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
      <div className="space-y-4">
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
                  stats={matchStats.get(rule.id)}
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

            {/* The transaction list is a bounded live window (see
                utils/listenerWindows.ts), so the per-rule counts describe the
                history that is loaded — say so rather than let "matches none"
                read as a verdict on a rule that only fires on older charges. */}
            {hasMoreTransactions && (
              <p className="px-1 text-xs text-brand-500 dark:text-brand-400">
                Counts cover the transactions loaded so far, not your full history.
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

        {visibleSuggestions.length > 0 && (
          <div className="space-y-2">
            <SectionHeading
              as="h3"
              className="px-1"
              description={`Bank wording seen ${SUGGESTION_MIN_OCCURRENCES} or more times that no rule renames yet. A merchant you have already pinned to one amount can still appear here — its other charges are still showing raw.`}
            >
              Suggested from your history
            </SectionHeading>
            <SurfaceList>
              {visibleSuggestions.map((suggestion) => (
                <SuggestionRow
                  key={suggestion.pattern}
                  suggestion={suggestion}
                  onAccept={() => openCreateFromSuggestion(suggestion)}
                  onDismiss={() => dismissSuggestion(suggestion)}
                />
              ))}
            </SurfaceList>
          </div>
        )}
      </div>

      <MerchantRuleFormDrawer
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        rule={editingRule}
        seed={seed}
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
