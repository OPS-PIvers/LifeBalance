import React, { useMemo, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { Sparkles } from 'lucide-react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Drawer } from '@/components/ui/Drawer';
import { Section, SurfaceList, Row, Stat, StatGroup } from '@/components/ui/Section';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { FIELD_ERROR } from '@/components/ui/fieldStyles';
import { cn } from '@/utils/cn';
import { roundMoney } from '@/utils/money';
import { suggestBucketLimit, type PayPeriodCeremonyEvent } from '@/utils/payPeriodCeremony';

/**
 * Pay-period reset ceremony — opened (device-locally, for the approving
 * member only) right after a confirmed paycheck rolls the pay period.
 *
 * Two jobs:
 *  1. Confirm what just happened: the closed period's dates, per-bucket
 *     over/under recap (from the bucketHistory snapshots the roll just wrote),
 *     period totals, and the new Safe-to-Spend.
 *  2. Prompt the user to set bucket budgets for the NEW period — prefilled
 *     with last period's limits ("keep the same" is the zero-effort path;
 *     dismissing the drawer means exactly that, since limits already carried
 *     over), with per-bucket suggestions from recent spending history.
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
  const { buckets, bucketHistory, safeToSpend, setBucketLimits } = useFinance();
  const fmt = useFormatCurrency();

  // Draft limits keyed by bucket id, prefilled with the carried-over limits.
  // Lazy init is enough: the parent keys this component on the event's period
  // so a later roll remounts with fresh drafts.
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(buckets.map(b => [b.id, String(b.limit)])),
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

  const parseDraft = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? roundMoney(n) : null;
  };

  const hasInvalidDraft = buckets.some(b => parseDraft(drafts[b.id] ?? '') === null);
  const changedUpdates = useMemo(
    () =>
      buckets.flatMap(b => {
        const parsed = parseDraft(drafts[b.id] ?? '');
        return parsed !== null && parsed !== b.limit ? [{ id: b.id, limit: parsed }] : [];
      }),
    [buckets, drafts],
  );

  const applySuggestions = () => {
    setDrafts(Object.fromEntries(buckets.map(b => [b.id, String(suggestions.get(b.id) ?? b.limit)])));
  };
  const resetToLast = () => {
    setDrafts(Object.fromEntries(buckets.map(b => [b.id, String(b.limit)])));
  };

  const handleSave = async () => {
    if (changedUpdates.length === 0 || hasInvalidDraft) return;
    setIsSaving(true);
    try {
      await setBucketLimits(changedUpdates);
      onClose();
    } catch {
      // setBucketLimits already toasted; keep the drawer open so the user
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
            {event.paycheckTitle} · <span className="font-mono font-semibold tabular-nums text-money-pos">+{fmt(event.paycheckAmount)}</span>
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
            disabled={changedUpdates.length === 0 || hasInvalidDraft}
            isLoading={isSaving}
          >
            Save budgets
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

        <Section
          title="Set your budgets for this period"
          action={
            <div className="flex gap-3">
              <Button variant="link" size="sm" onClick={resetToLast}>
                Reset to last
              </Button>
              <Button variant="link" size="sm" leftIcon={<Sparkles size={14} />} onClick={applySuggestions}>
                Use suggestions
              </Button>
            </div>
          }
        >
          <SurfaceList>
            {buckets.map(b => {
              const suggestion = suggestions.get(b.id) ?? b.limit;
              const lastSpent = closedSnapshots.find(s => s.bucketId === b.id);
              const invalid = parseDraft(drafts[b.id] ?? '') === null;
              return (
                <Row key={b.id} className="flex-col items-stretch gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <label
                      htmlFor={`ceremony-limit-${b.id}`}
                      className="min-w-0 truncate text-sm font-medium text-brand-800 dark:text-brand-100"
                    >
                      {b.name}
                    </label>
                    <div className="w-28 shrink-0">
                      <Input
                        id={`ceremony-limit-${b.id}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="1"
                        value={drafts[b.id] ?? ''}
                        onChange={e => setDrafts(prev => ({ ...prev, [b.id]: e.target.value }))}
                        className={cn('text-right font-mono tabular-nums', invalid && FIELD_ERROR)}
                        aria-label={`${b.name} budget for this period`}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-xxs text-brand-400 dark:text-brand-450">
                    <span>
                      Last: {fmt(b.limit, { decimals: 0 })}
                      {lastSpent
                        ? ` · Spent: ${fmt(roundMoney(lastSpent.totalSpent + lastSpent.totalPending), { decimals: 0 })}`
                        : ''}
                    </span>
                    <button
                      type="button"
                      className="text-accent-600 dark:text-accent-300 hover:underline"
                      onClick={() => setDrafts(prev => ({ ...prev, [b.id]: String(suggestion) }))}
                    >
                      Suggested: {fmt(suggestion, { decimals: 0 })}
                    </button>
                  </div>
                </Row>
              );
            })}
          </SurfaceList>
          <p className="px-1 pt-2 text-xxs text-brand-400 dark:text-brand-450 leading-relaxed">
            Suggestions average your spending over the last few periods. Dismissing this keeps
            last period&apos;s budgets unchanged.
          </p>
        </Section>
      </div>
    </Drawer>
  );
};

export default PayPeriodCeremonyDrawer;
