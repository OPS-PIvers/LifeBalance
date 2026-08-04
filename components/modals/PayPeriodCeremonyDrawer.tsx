import React, { useMemo, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Drawer } from '@/components/ui/Drawer';
import { Section, SurfaceList, Row, Stat, StatGroup } from '@/components/ui/Section';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { FIELD_ERROR } from '@/components/ui/fieldStyles';
import BucketPlanEditor from '@/components/budget/BucketPlanEditor';
import { cn } from '@/utils/cn';
import { roundMoney } from '@/utils/money';
import { projectedAvailable, resolvePlanDrafts } from '@/utils/bucketPlanPreview';
import { parseBalanceDraft, suggestBucketLimit, type PayPeriodCeremonyEvent } from '@/utils/payPeriodCeremony';

/**
 * Pay-period reset ceremony — opened (device-locally, for the approving
 * member only) right after a confirmed paycheck rolls the pay period.
 *
 * Three jobs:
 *  1. Confirm what just happened: the closed period's dates, per-bucket
 *     over/under recap (from the bucketHistory snapshots the roll just wrote),
 *     period totals, and the new Safe-to-Spend.
 *  2. Prompt the user to TRUE-UP account balances for the new period —
 *     balances are entered manually and Safe-to-Spend derives from them, so
 *     this comes before the budget editor. Unchanged drafts write nothing.
 *  3. Prompt the user to set bucket budgets for the NEW period — prefilled
 *     with last period's limits ("keep the same" is the zero-effort path;
 *     dismissing the drawer means exactly that, since limits already carried
 *     over), with per-bucket suggestions from recent spending history. This is
 *     where over-allocation is BORN, so the editor (`BucketPlanEditor`) carries
 *     a live fit meter measured against the cash the plan will actually have —
 *     Safe-to-Spend PLUS the balance edits sitting unsaved in step 2, since
 *     nothing is written until Save and the context figure is otherwise stale.
 *     The meter WARNS and never blocks: Save stays enabled while the plan
 *     doesn't fit, because at this exact moment the balances are half-entered
 *     and the projected cash is unsettled by design.
 *
 * `kind === 'first'` (period tracking just initialized) renders a trimmed
 * welcome variant: no recap, just the budget prompt.
 *
 * Default export so it can be React.lazy-loaded from MainLayout (keeps
 * Drawer/framer-motion off the boot bundle).
 */
interface PayPeriodCeremonyDrawerProps {
  event: PayPeriodCeremonyEvent;
  isOpen: boolean;
  onClose: () => void;
}

const fmtDay = (iso: string) => format(parseISO(iso), 'MMM d');

const PayPeriodCeremonyDrawer: React.FC<PayPeriodCeremonyDrawerProps> = ({ event, isOpen, onClose }) => {
  const { accounts, buckets, bucketHistory, bucketSpentMap, safeToSpend, saveCeremonyChanges } =
    useFinance();
  const fmt = useFormatCurrency();

  // Archived accounts are excluded everywhere active balances matter
  // (net worth, Safe-to-Spend) — same filter as BudgetAccounts.
  const activeAccounts = useMemo(() => accounts.filter(a => !a.archived), [accounts]);

  // Draft limits keyed by bucket id, prefilled with the carried-over limits.
  // Lazy init is enough: the parent keys this component on the event's period
  // so a later roll remounts with fresh drafts.
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(buckets.map(b => [b.id, String(b.limit)])),
  );
  // Balance drafts keyed by account id, prefilled with the current balances
  // (credit debt is stored positive, same convention as the account cards —
  // drafts pass the stored value straight through, no sign flipping).
  const [balanceDrafts, setBalanceDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(accounts.filter(a => !a.archived).map(a => [a.id, String(a.balance)])),
  );
  const [isSaving, setIsSaving] = useState(false);

  const suggestions = useMemo(
    () => new Map(buckets.map(b => [b.id, suggestBucketLimit(b.id, b.limit, bucketHistory)])),
    [buckets, bucketHistory],
  );

  // Recap of the period that just closed — the snapshots the roll batch wrote.
  const closedSnapshots = useMemo(
    () =>
      event.kind === 'roll' && event.previousPeriodId
        ? bucketHistory.filter(s => s.periodId === event.previousPeriodId)
        : [],
    [bucketHistory, event],
  );
  const recapTotals = useMemo(() => {
    const budgeted = roundMoney(closedSnapshots.reduce((sum, s) => sum + s.limit, 0));
    const spent = roundMoney(
      closedSnapshots.reduce((sum, s) => sum + s.totalSpent + s.totalPending, 0),
    );
    return { budgeted, spent };
  }, [closedSnapshots]);

  // One derivation for the whole limits half of the form: what a save would
  // write, and whether any field is unparseable. Shared with `BucketPlanEditor`
  // (which measures its fit meter from the same helper), so the meter and the
  // Save button can never describe different plans. A bucket added in the
  // background (live listener) after mount has no draft yet — `resolvePlanDrafts`
  // falls back to its current limit rather than '' so it can't wedge Save as
  // "invalid", exactly as the previous inline `draftFor` did.
  const { changed: changedUpdates, hasInvalid: hasInvalidDraft } = useMemo(
    () => resolvePlanDrafts(buckets, drafts),
    [buckets, drafts],
  );

  // Same live-listener fallback as draftFor: an account added after mount
  // renders with its current balance rather than wedging Save as invalid.
  const balanceDraftFor = (a: { id: string; balance: number }) =>
    balanceDrafts[a.id] ?? String(a.balance);
  const hasInvalidBalanceDraft = activeAccounts.some(a => parseBalanceDraft(balanceDraftFor(a)) === null);
  const changedBalanceUpdates = useMemo(
    () =>
      activeAccounts.flatMap(a => {
        const parsed = parseBalanceDraft(balanceDrafts[a.id] ?? String(a.balance));
        return parsed !== null && parsed !== a.balance ? [{ id: a.id, balance: parsed }] : [];
      }),
    [activeAccounts, balanceDrafts],
  );

  const hasAnyInvalid = hasInvalidDraft || hasInvalidBalanceDraft;
  const changeCount = changedUpdates.length + changedBalanceUpdates.length;

  // The cash the budget plan will actually have, INCLUDING the balance edits
  // still sitting unsaved in the section above — nothing is written until Save,
  // so the context's `safeToSpend` is computed from the old balances the whole
  // time this drawer is open.
  const planAvailable = useMemo(
    () => projectedAvailable(safeToSpend, activeAccounts, balanceDrafts),
    [safeToSpend, activeAccounts, balanceDrafts],
  );

  const handleSave = async () => {
    if (changeCount === 0 || hasAnyInvalid) return;
    setIsSaving(true);
    try {
      // ONE writeBatch for balances + limits (all-or-nothing).
      await saveCeremonyChanges({
        bucketLimits: changedUpdates,
        accountBalances: changedBalanceUpdates,
      });
      onClose();
    } catch {
      // saveCeremonyChanges already toasted; keep the drawer open so the user
      // can retry without losing their edits.
    } finally {
      setIsSaving(false);
    }
  };

  const closedEnd = subDays(parseISO(event.newPeriodId), 1);
  const title = event.kind === 'first' ? 'Pay period tracking started' : 'New pay period';

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      height="tall"
      header={
        <div className="px-4 pb-3 pt-1">
          <p className="text-sm text-brand-600 dark:text-brand-300">
            {event.paycheckTitle} · <span className="font-mono font-semibold tabular-nums text-money-pos dark:text-money-posDark">+{fmt(event.paycheckAmount)}</span>
          </p>
          <p className="text-xs text-brand-400 dark:text-brand-450 mt-0.5">
            {event.kind === 'roll' && event.previousPeriodId
              ? `${fmtDay(event.previousPeriodId)} – ${format(closedEnd, 'MMM d')} closed · New period starts ${fmtDay(event.newPeriodId)}`
              : `Your first period starts ${fmtDay(event.newPeriodId)}`}
          </p>
        </div>
      }
      footer={
        <div className="flex gap-2 px-4 pt-3 border-t border-brand-200 dark:border-brand-700">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={isSaving}>
            Keep same as last
          </Button>
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={changeCount === 0 || hasAnyInvalid}
            isLoading={isSaving}
          >
            Save changes
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {event.kind === 'roll' && closedSnapshots.length > 0 && (
          <Section title="Last period">
            <StatGroup className="px-1 pb-3">
              <Stat label="Spent" value={fmt(recapTotals.spent)} />
              <Stat label="Budgeted" value={fmt(recapTotals.budgeted)} />
              <Stat
                label="Safe to spend now"
                value={fmt(safeToSpend)}
                valueClassName={safeToSpend < 0 ? 'text-money-neg dark:text-money-negDark' : undefined}
              />
            </StatGroup>
            <SurfaceList>
              {closedSnapshots.map(s => {
                const spent = roundMoney(s.totalSpent + s.totalPending);
                const over = spent > s.limit;
                return (
                  <Row key={s.id} dense className="justify-between">
                    <span className="min-w-0 truncate text-sm font-medium text-brand-800 dark:text-brand-100">
                      {s.bucketName}
                    </span>
                    <span
                      className={`font-mono text-sm tabular-nums shrink-0 ${
                        over ? 'text-money-neg dark:text-money-negDark font-semibold' : 'text-brand-600 dark:text-brand-300'
                      }`}
                    >
                      {fmt(spent)} of {fmt(s.limit)}
                    </span>
                  </Row>
                );
              })}
            </SurfaceList>
          </Section>
        )}

        {activeAccounts.length > 0 && (
          <Section title="Update your balances">
            <SurfaceList>
              {activeAccounts.map(a => {
                const invalid = parseBalanceDraft(balanceDraftFor(a)) === null;
                const lastUpdatedDate = a.lastUpdated ? new Date(a.lastUpdated) : null;
                const lastUpdatedLabel =
                  lastUpdatedDate && !Number.isNaN(lastUpdatedDate.getTime())
                    ? format(lastUpdatedDate, 'MMM d, yyyy')
                    : null;
                return (
                  <Row key={a.id} className="flex-col items-stretch gap-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <label
                        htmlFor={`ceremony-balance-${a.id}`}
                        className="min-w-0 truncate text-sm font-medium text-brand-800 dark:text-brand-100"
                      >
                        {a.name}
                        <span className="ml-1.5 text-xxs font-normal text-brand-400 dark:text-brand-450">
                          {a.type === 'credit' ? 'Credit card' : a.type === 'savings' ? 'Savings' : 'Checking'}
                        </span>
                      </label>
                      <div className="w-28 shrink-0">
                        <Input
                          id={`ceremony-balance-${a.id}`}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          value={balanceDraftFor(a)}
                          onChange={e =>
                            setBalanceDrafts(prev => ({ ...prev, [a.id]: e.target.value }))
                          }
                          className={cn('text-right font-mono tabular-nums', invalid && FIELD_ERROR)}
                          aria-label={`${a.name} balance`}
                        />
                      </div>
                    </div>
                    {lastUpdatedLabel && (
                      <div className="text-xxs text-brand-400 dark:text-brand-450">
                        Last updated {lastUpdatedLabel}
                      </div>
                    )}
                  </Row>
                );
              })}
            </SurfaceList>
            <p className="px-1 pt-2 text-xxs text-brand-400 dark:text-brand-450 leading-relaxed">
              Balances are entered manually — a quick true-up keeps Safe-to-Spend accurate for
              the new period. Unchanged balances aren&apos;t written.
            </p>
          </Section>
        )}

        <BucketPlanEditor
          buckets={buckets}
          drafts={drafts}
          onDraftsChange={setDrafts}
          bucketSpentMap={bucketSpentMap}
          available={planAvailable}
          suggestions={suggestions}
          idPrefix="ceremony"
          metaFor={b => {
            const lastSpent = closedSnapshots.find(s => s.bucketId === b.id);
            return `Last: ${fmt(b.limit, { decimals: 0 })}${
              lastSpent
                ? ` · Spent: ${fmt(roundMoney(lastSpent.totalSpent + lastSpent.totalPending), { decimals: 0 })}`
                : ''
            }`;
          }}
          footnote="Suggestions average your spending over the last few periods. Dismissing this keeps last period's budgets unchanged."
        />
      </div>
    </Drawer>
  );
};

export default PayPeriodCeremonyDrawer;
