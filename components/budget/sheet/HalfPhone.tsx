import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Check } from 'lucide-react';
import type { CalendarItem, HalfAllocationKind, HalfPlan } from '@/types/schema';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import SheetRowDrawer, { type RowTarget } from '@/components/budget/sheet/SheetRowDrawer';
import { ALLOCATION_LABELS, useHalfSheet } from '@/components/budget/sheet/useHalfSheet';
import { cn } from '@/utils/cn';
import { sumMoney } from '@/utils/money';
import type { HalfSummary } from '@/utils/halfPlan';
import { ordinal, phoneBlocks, quietLabel } from '@/utils/sheetLayout';
import type { PayHalf } from '@/utils/payPeriodHalves';

export interface HalfPhoneProps {
  half: PayHalf;
  plan: HalfPlan;
  isSeed: boolean;
  summary: HalfSummary;
  today: string;
  /** The half switcher, shown under the paycheck card. */
  tabs: React.ReactNode;
  /** Shown above the remainder when this is the half we're in. */
  safeToSpend?: number;
  /** Footer action: paste a month from the Google Sheet. */
  pasteAction: React.ReactNode;
}

const rangeLabel = (half: PayHalf) =>
  `${format(parseISO(half.start), 'MMM d')} – ${format(parseISO(half.end), 'd')}`;

/**
 * One half on a phone: the paycheck pinned at the top, only the days that
 * have something due (quiet runs collapse to one line), the half's other
 * expenses, and the remainder pinned at the bottom. Tapping a row opens it
 * for editing.
 */
const HalfPhone: React.FC<HalfPhoneProps> = ({ half, plan, isSeed, summary, today, tabs, safeToSpend, pasteAction }) => {
  const api = useHalfSheet(half, plan, summary, isSeed);
  const fmt = useFormatCurrency();
  const [target, setTarget] = useState<RowTarget | null>(null);
  const [showPay, setShowPay] = useState(false);

  const otherTotal = sumMoney([summary.budgetTotal, summary.allocationsOut]);
  const totalExpenses = sumMoney([summary.billTotal, otherTotal]);
  const left = summary.leftToAssign;
  const signed = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${fmt(Math.abs(n))}`;
  const pay = summary.paycheckTotal;
  const billShare = pay > 0 ? Math.min(100, (summary.billTotal / pay) * 100) : 0;
  const otherShare = pay > 0 ? Math.max(0, Math.min(100 - billShare, (otherTotal / pay) * 100)) : 0;
  const plannedBudgets = api.buckets.filter(b => plan.budgets[b.id] !== undefined);
  const unplannedBuckets = api.buckets.filter(b => plan.budgets[b.id] === undefined);

  const itemLine = (item: CalendarItem) => {
    const planned = api.planned(item);
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setTarget({ kind: 'item', item })}
        aria-label={`${item.title}, ${fmt(planned)}${item.isPaid ? ', paid' : ''}`}
        className="grid w-full grid-cols-[1fr_auto] items-baseline gap-x-2 rounded-md px-2 py-1.5 text-left text-sm active:bg-brand-100 dark:active:bg-brand-800"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {item.isPaid ? (
            <Check size={14} strokeWidth={3} className="shrink-0 text-money-pos dark:text-money-posDark" aria-hidden="true" />
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-300 dark:bg-brand-600" aria-hidden="true" />
          )}
          <span className="truncate text-brand-800 dark:text-brand-100">{item.title}</span>
        </span>
        <span className="font-mono text-sm tabular-nums text-brand-800 dark:text-brand-100">{fmt(planned)}</span>
        {item.isPaid && planned !== item.amount && (
          <span className="col-start-2 text-right font-mono text-xxs tabular-nums text-brand-500 dark:text-brand-400">
            paid {fmt(item.amount)}
          </span>
        )}
      </button>
    );
  };

  const addLine = (value: string) => {
    if (!value) return;
    if (value.startsWith('bucket:')) setTarget({ kind: 'budget', bucketId: value.slice(7) });
    else api.addAllocation(value as HalfAllocationKind);
  };

  return (
    <div className="relative">
      <div className="sticky top-[var(--sheet-sticky-top,0px)] z-20 -mx-1 bg-brand-50 px-1 pb-2 dark:bg-brand-900">
        <div className="rounded-xl border border-brand-200 bg-white p-3 dark:border-brand-700 dark:bg-brand-800">
          <button
            type="button"
            aria-expanded={showPay}
            onClick={() => setShowPay(v => !v)}
            className="block w-full text-left"
          >
            <span className="block text-xxs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
              Paycheck · {rangeLabel(half)}
            </span>
            <span
              data-testid="paycheck-total"
              className="block font-display text-2xl font-semibold tabular-nums text-brand-900 dark:text-brand-50"
            >
              {fmt(pay)}
            </span>
          </button>
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-brand-200 dark:bg-brand-700" aria-hidden="true">
            <span className="h-full bg-accent-600 dark:bg-accent-400" style={{ width: `${billShare}%` }} />
            <span className="h-full bg-warm-400" style={{ width: `${otherShare}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-xs text-brand-600 dark:text-brand-300">
            <span>Bills <span className="font-mono tabular-nums">{fmt(summary.billTotal)}</span></span>
            <span>Other <span className="font-mono tabular-nums">{fmt(otherTotal)}</span></span>
          </div>
          {showPay && (
            <div className="mt-2 border-t border-brand-200 pt-1 dark:border-brand-700">
              {summary.paychecks.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-brand-500">No paycheck pays for this half.</p>
              )}
              {summary.paychecks.map(itemLine)}
            </div>
          )}
        </div>
      </div>

      {tabs}

      <div className="border-t border-brand-200 dark:border-brand-700">
        {phoneBlocks(half, summary.bills).map(block =>
          block.kind === 'quiet' ? (
            <button
              key={block.from}
              type="button"
              onClick={() => setTarget({ kind: 'add', date: block.from })}
              className="block w-full border-b border-dashed border-brand-200 py-1.5 pl-12 pr-2 text-left text-xs text-brand-500 dark:border-brand-700 dark:text-brand-400"
            >
              {quietLabel(block.from, block.to)} · nothing due
            </button>
          ) : (
            <div
              key={block.date}
              className={cn(
                'grid grid-cols-[40px_1fr] border-b border-brand-200 dark:border-brand-700',
                block.date === today && 'rounded-md bg-warm-50 dark:bg-warm-900/30'
              )}
            >
              <div className="flex flex-col items-center pt-2 font-mono text-base text-brand-900 dark:text-brand-50">
                {format(parseISO(block.date), 'd')}
                <small className="font-sans text-[0.6rem] uppercase tracking-wider text-brand-500 dark:text-brand-400">
                  {format(parseISO(block.date), 'EEE')}
                </small>
              </div>
              <div className="flex flex-col py-1">
                {block.bills.map(itemLine)}
                <button
                  type="button"
                  onClick={() => setTarget({ kind: 'add', date: block.date })}
                  className="self-start px-2 pb-1.5 pt-0.5 text-xs font-medium text-accent-700 dark:text-accent-300"
                >
                  + Add to the {ordinal(Number(format(parseISO(block.date), 'd')))}
                </button>
              </div>
            </div>
          )
        )}
      </div>

      <div className="mt-3 flex flex-col gap-0.5 rounded-xl border border-brand-200 bg-white px-3 py-2.5 dark:border-brand-700 dark:bg-brand-800">
        <span className="text-xxs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">Other expenses</span>
        {plannedBudgets.map(bucket => {
          const over = api.fixesFor(bucket.id).length > 0;
          return (
            <button
              key={bucket.id}
              type="button"
              onClick={() => setTarget({ kind: 'budget', bucketId: bucket.id })}
              className="grid grid-cols-[1fr_auto] py-1 text-left text-sm"
            >
              <span className="truncate">{bucket.name}</span>
              <span className="font-mono tabular-nums">{fmt(plan.budgets[bucket.id] ?? 0)}</span>
              {over && (
                <span className="col-span-2 text-xs text-money-neg dark:text-money-negDark">
                  {fmt(api.actuals.get(bucket.id) ?? 0)} spent, over budget
                </span>
              )}
            </button>
          );
        })}
        {plan.allocations.map(a => (
          <button
            key={a.id}
            type="button"
            onClick={() => setTarget({ kind: 'allocation', id: a.id })}
            className="grid grid-cols-[1fr_auto] py-1 text-left text-sm"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {a.done && <Check size={14} strokeWidth={3} className="shrink-0 text-money-pos dark:text-money-posDark" aria-label="done" />}
              <span className="truncate">{a.label}</span>
            </span>
            <span className={cn('font-mono tabular-nums', a.kind === 'from-savings' && 'text-money-pos dark:text-money-posDark')}>
              {a.kind === 'from-savings' ? '+' : ''}{fmt(a.amount)}
            </span>
          </button>
        ))}
        <select
          aria-label="Add another expense"
          value=""
          onChange={e => addLine(e.target.value)}
          className="-ml-1 w-fit cursor-pointer appearance-none bg-transparent px-1 py-1 text-xs font-medium text-accent-700 focus:outline-none dark:text-accent-300"
        >
          <option value="">+ Add another expense</option>
          {unplannedBuckets.length > 0 && (
            <optgroup label="Budgets">
              {unplannedBuckets.map(b => <option key={b.id} value={`bucket:${b.id}`}>{b.name}</option>)}
            </optgroup>
          )}
          <optgroup label="Other">
            {(['card-extra', 'to-savings', 'from-savings', 'other'] as const).map(kind => (
              <option key={kind} value={kind}>{ALLOCATION_LABELS[kind]}</option>
            ))}
          </optgroup>
        </select>
        <div className="mt-1 grid grid-cols-[1fr_auto] border-t border-brand-200 pt-1.5 text-sm font-semibold dark:border-brand-700">
          <span>Total expenses</span>
          <span className="font-mono tabular-nums">{fmt(totalExpenses)}</span>
        </div>
      </div>

      <div className="mt-3 flex justify-center">{pasteAction}</div>

      <div className="sticky bottom-0 z-20 -mx-1 bg-brand-50 px-1 pb-2 pt-2 dark:bg-brand-900">
        {safeToSpend !== undefined && (
          <p className="px-3 pb-1 text-xs text-brand-500 dark:text-brand-400">
            Safe-to-Spend now <span className="font-mono tabular-nums">{fmt(safeToSpend)}</span>
          </p>
        )}
        <div
          className={cn(
            'flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 font-semibold',
            left < 0 ? 'bg-money-bgNeg dark:bg-money-neg/15' : 'bg-money-bgPos dark:bg-money-pos/15'
          )}
        >
          <span className="flex flex-col">
            <span className="text-sm">Remainder</span>
            {left !== 0 && (
              <button
                type="button"
                onClick={api.balance}
                className="self-start text-xs font-medium text-accent-700 underline-offset-2 hover:underline dark:text-accent-300"
              >
                {left < 0 ? 'Cover from savings' : 'Send to savings'}
              </button>
            )}
          </span>
          <span
            data-testid="left-to-assign"
            className={cn('font-mono tabular-nums', left < 0 ? 'text-money-neg dark:text-money-negDark' : 'text-money-pos dark:text-money-posDark')}
          >
            {signed(left)}
          </span>
        </div>
      </div>

      <SheetRowDrawer target={target} onClose={() => setTarget(null)} api={api} plan={plan} range={half} />
    </div>
  );
};

export default HalfPhone;
