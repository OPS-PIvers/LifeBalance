import React, { useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Pencil } from 'lucide-react';
import type { CalendarItem, HalfAllocationKind, HalfPlan } from '@/types/schema';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Button } from '@/components/ui/Button';
import MoneyCell from '@/components/budget/sheet/MoneyCell';
import SheetRowDrawer, { type RowTarget } from '@/components/budget/sheet/SheetRowDrawer';
import { ALLOCATION_LABELS, useHalfSheet, type HalfSheetApi } from '@/components/budget/sheet/useHalfSheet';
import { cn } from '@/utils/cn';
import { sumMoney } from '@/utils/money';
import type { HalfSummary } from '@/utils/halfPlan';
import { billsByDate, halfDates, ordinal } from '@/utils/sheetLayout';
import { halfTitle, type PayHalf } from '@/utils/payPeriodHalves';

export interface HalfSheetProps {
  half: PayHalf;
  /** The plan shown: the stored one, or the seed copied from last month. */
  plan: HalfPlan;
  /** True when `plan` is a seed nobody has saved yet. */
  isSeed: boolean;
  summary: HalfSummary;
  today: string;
  /** "+ Add" in the month bar: open a new row on this date (changes each tap). */
  addRequest?: { date: string; at: number };
}

/** The cells of a row (no borders or padding of their own beyond the inputs'). */
const CELL = 'h-7 align-middle';
const quietCell = 'border-b-transparent placeholder:text-transparent focus:placeholder:text-brand-300';
const halfName = (half: PayHalf) => (half.id.endsWith('-01') ? '1st half' : '2nd half');

/** The paid mark before a row's name; a ring to tap while it isn't paid. */
const PaidDot: React.FC<{ paid: boolean; label: string; onPay: () => void }> = ({ paid, label, onPay }) =>
  paid ? (
    <span role="img" aria-label={label} className="flex h-4 w-4 shrink-0 items-center justify-center">
      <span className="h-2 w-2 rounded-full bg-money-pos dark:bg-money-posDark" />
    </span>
  ) : (
    <button
      type="button"
      aria-label={label}
      onClick={onPay}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
    >
      <span className="h-2 w-2 rounded-full border border-brand-400 dark:border-brand-500" />
    </button>
  );

/** A name typed straight into its cell; Enter saves it and adds a row below. */
const NameCell: React.FC<{ value: string; label: string; onCommit: (v: string) => void; onEnter?: () => void }> = ({
  value,
  label,
  onCommit,
  onEnter,
}) => (
  <input
    type="text"
    aria-label={label}
    defaultValue={value}
    key={value}
    onBlur={e => onCommit(e.target.value)}
    onKeyDown={e => {
      if (e.key === 'Enter') {
        e.currentTarget.blur();
        onEnter?.();
      }
      if (e.key === 'Escape') {
        e.currentTarget.value = value;
        e.currentTarget.blur();
      }
    }}
    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-brand-800 hover:border-brand-200 focus:border-accent-500 focus:bg-white focus:outline-none dark:text-brand-100 dark:hover:border-brand-700 dark:focus:bg-brand-800"
  />
);

/** An empty row to type a new bill into. Saved once it has a name and an amount. */
const NewBillRow: React.FC<{
  date: string;
  showDay: boolean;
  isToday: boolean;
  autoFocus?: boolean;
  api: HalfSheetApi;
  onDone?: () => void;
}> = ({ date, showDay, isToday, autoFocus, api, onDone }) => {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);
  const day = format(parseISO(date), 'd');

  const value = Number(amount.replace(/[$,\s]/g, ''));
  const ready = title.trim() !== '' && amount.trim() !== '' && Number.isFinite(value) && value > 0;
  const commit = () => {
    if (!ready) return;
    void api.addBill(date, title, value).then(() => {
      setTitle('');
      setAmount('');
      onDone?.();
    }, () => undefined);
  };

  const input =
    'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-brand-200 focus:border-accent-500 focus:bg-white focus:outline-none dark:hover:border-brand-700 dark:focus:bg-brand-800';
  return (
    <tr
      className={cn('border-b border-brand-200 dark:border-brand-700', isToday && 'bg-warm-50 dark:bg-warm-900/30')}
      onBlur={e => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (ready) commit();
        else if (!title && !amount) onDone?.();
      }}
    >
      <td className={cn(CELL, 'pl-3 font-mono text-xs text-brand-500 dark:text-brand-400')}>{showDay ? day : ''}</td>
      <td className={cn(CELL, 'pl-5')}>
        <input
          type="text"
          aria-label={`New bill on the ${ordinal(Number(day))}`}
          value={title}
          autoFocus={autoFocus}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (ready) commit();
              else amountRef.current?.focus();
            }
            if (e.key === 'Escape') onDone?.();
          }}
          className={input}
        />
      </td>
      <td className={CELL}>
        <input
          ref={amountRef}
          type="text"
          inputMode="decimal"
          aria-label={`New bill on the ${ordinal(Number(day))} amount`}
          value={amount}
          onChange={e => setAmount(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') onDone?.();
          }}
          className={cn(input, 'text-right font-mono tabular-nums')}
        />
      </td>
      <td className={CELL} />
    </tr>
  );
};

/**
 * One half of the month as a spreadsheet table, like the household's Google
 * Sheet: the paycheck total in the header, a row for every day (extra bills on
 * a busy day stack below with no day number), the half's other expenses, and
 * the totals down to the remainder. Cells are typed into directly: Tab moves
 * to the next cell, Enter adds a row on that day.
 */
const HalfSheet: React.FC<HalfSheetProps> = ({ half, plan, isSeed, summary, today, addRequest }) => {
  const api = useHalfSheet(half, plan, summary, isSeed);
  const fmt = useFormatCurrency();
  const [target, setTarget] = useState<RowTarget | null>(null);
  const [showPay, setShowPay] = useState(false);
  /** New rows opened with Enter (or "+ Add"), per date. */
  const [extraRows, setExtraRows] = useState<{ id: number; date: string }[]>([]);
  const nextRow = useRef(0);

  const addRowOn = (date: string) => setExtraRows(rows => [...rows, { id: ++nextRow.current, date }]);
  const dropRow = (id: number) => setExtraRows(rows => rows.filter(r => r.id !== id));

  // "+ Add" in the month bar: each new request opens one row (adjusting state
  // while rendering, React's pattern for responding to a changed prop).
  const [handledRequest, setHandledRequest] = useState(addRequest?.at);
  if (addRequest && addRequest.at !== handledRequest) {
    setHandledRequest(addRequest.at);
    // Negative ids never collide with the Enter-key rows' counter.
    setExtraRows(rows => [...rows, { id: -addRequest.at, date: addRequest.date }]);
  }

  const name = halfName(half);
  const byDate = billsByDate(summary.bills);
  const otherTotal = sumMoney([summary.budgetTotal, summary.allocationsOut]);
  const totalExpenses = sumMoney([summary.billTotal, otherTotal]);
  const left = summary.leftToAssign;
  const signed = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${fmt(Math.abs(n))}`;
  const amountText = 'text-right font-mono text-sm tabular-nums';
  const plannedBudgets = api.buckets.filter(b => plan.budgets[b.id] !== undefined);
  const unplannedBuckets = api.buckets.filter(b => plan.budgets[b.id] === undefined);

  const itemRow = (item: CalendarItem, showDay: boolean, isToday: boolean, dayLabel: string) => {
    const income = item.type === 'income';
    const planned = api.planned(item);
    return (
      <React.Fragment key={item.id}>
        <tr className={cn('group border-b border-brand-200 dark:border-brand-700', isToday && 'bg-warm-50 dark:bg-warm-900/30')}>
          <td className={cn(CELL, 'pl-3 font-mono text-xs text-brand-500 dark:text-brand-400')}>{showDay ? dayLabel : ''}</td>
          <td className={CELL}>
            <div className="flex items-center gap-1">
              <PaidDot
                paid={item.isPaid}
                label={item.isPaid ? `${item.title} ${income ? 'received' : 'paid'}` : `Mark ${item.title} ${income ? 'received' : 'paid'}`}
                onPay={() => api.pay(item)}
              />
              <NameCell
                value={item.title}
                label={`${item.title} name`}
                onCommit={v => api.rename(item, v)}
                onEnter={income ? undefined : () => addRowOn(item.date)}
              />
              <button
                type="button"
                aria-label={`Edit ${item.title}`}
                onClick={() => setTarget({ kind: 'item', item })}
                className="shrink-0 rounded p-1 text-brand-400 opacity-0 transition-opacity hover:text-accent-700 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Pencil size={12} />
              </button>
            </div>
          </td>
          <td className={CELL}>
            {item.isPaid ? (
              <div className={cn(amountText, 'px-2 text-brand-700 dark:text-brand-200')}>{fmt(planned)}</div>
            ) : (
              <MoneyCell
                label={`${item.title} amount`}
                value={item.amount}
                onCommit={a => api.changeAmount(item, a)}
                onEnter={income ? undefined : () => addRowOn(item.date)}
                className={cn('w-full py-0.5', quietCell)}
              />
            )}
          </td>
          <td className={CELL}>
            {item.isPaid ? (
              <div className={cn(amountText, 'px-2 text-brand-500 dark:text-brand-400')}>{fmt(item.amount)}</div>
            ) : (
              <MoneyCell
                label={`${item.title} actual`}
                value={undefined}
                onCommit={a => a !== undefined && api.pay(item, a)}
                className={cn('w-full py-0.5', quietCell)}
              />
            )}
          </td>
        </tr>
        {api.pending?.item.id === item.id && (
          <tr className="bg-accent-50 dark:bg-accent-900/30">
            <td colSpan={4} className="px-3 py-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto text-xs text-brand-700 dark:text-brand-200">
                  Change {item.title} to {fmt(api.pending.amount)} for:
                </span>
                <Button size="sm" variant="secondary" onClick={() => void api.applyPending('one')}>
                  Just {api.pendingMonth}
                </Button>
                <Button size="sm" onClick={() => void api.applyPending('future')}>This and future months</Button>
                <Button size="sm" variant="ghost" onClick={() => api.setPending(null)}>Keep {fmt(item.amount)}</Button>
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  const addLine = (value: string) => {
    if (!value) return;
    if (value.startsWith('bucket:')) api.setBudget(value.slice(7), 0);
    else api.addAllocation(value as HalfAllocationKind);
  };

  return (
    <div className="min-w-0">
      <table className="w-full table-fixed border-collapse text-sm text-brand-800 dark:text-brand-100">
        <caption className="sr-only">{`${name} · ${halfTitle(half)}`}</caption>
        <colgroup>
          <col className="w-11" />
          <col />
          <col className="w-28" />
          <col className="w-28" />
        </colgroup>
        <thead>
          <tr className="border-b border-accent-200 bg-accent-50 dark:border-accent-800 dark:bg-accent-900/30">
            <th scope="col" className="py-2.5 pl-3 text-left text-xxs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
              Pay
            </th>
            <th scope="col" className="py-2.5 text-left font-normal">
              <button
                type="button"
                aria-expanded={showPay}
                onClick={() => setShowPay(v => !v)}
                className="rounded px-1 text-left hover:text-accent-700 dark:hover:text-accent-300"
              >
                <span className="font-semibold">Paycheck</span>{' '}
                <span className="text-xs text-brand-500 dark:text-brand-400">
                  {name} · {halfTitle(half)}
                </span>
              </button>
            </th>
            <th scope="col" className="py-2.5 pr-2 text-right font-mono font-semibold tabular-nums text-money-pos dark:text-money-posDark">
              <span data-testid="paycheck-total">{fmt(summary.paycheckTotal)}</span>
            </th>
            <th scope="col" />
          </tr>
          {showPay &&
            summary.paychecks.map(p => itemRow(p, true, false, format(parseISO(p.date), 'MMM d')))}
          {showPay && summary.paychecks.length === 0 && (
            <tr className="border-b border-brand-200 dark:border-brand-700">
              <td colSpan={4} className="px-3 py-1.5 text-xs text-brand-500">No paycheck pays for this half.</td>
            </tr>
          )}
          <tr className="border-b border-brand-200 text-xxs uppercase tracking-wider text-brand-500 dark:border-brand-700 dark:text-brand-400">
            <th scope="col" className="py-1 pl-3 text-left font-medium">Day</th>
            <th scope="col" className="py-1 pl-5 text-left font-medium">Expense</th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">Projected</th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">Actual</th>
          </tr>
        </thead>
        <tbody>
          {halfDates(half).map(date => {
            const bills = byDate.get(date) ?? [];
            const isToday = date === today;
            const day = format(parseISO(date), 'd');
            const extras = extraRows.filter(r => r.date === date);
            return (
              <React.Fragment key={date}>
                {bills.map((bill, i) => itemRow(bill, i === 0, isToday, day))}
                {bills.length === 0 && extras.length === 0 && (
                  <NewBillRow key={`empty-${date}`} date={date} showDay isToday={isToday} api={api} />
                )}
                {extras.map((r, i) => (
                  <NewBillRow
                    key={r.id}
                    date={date}
                    showDay={bills.length === 0 && i === 0}
                    isToday={isToday}
                    autoFocus
                    api={api}
                    onDone={() => dropRow(r.id)}
                  />
                ))}
              </React.Fragment>
            );
          })}

          <tr>
            <td colSpan={4} className="px-3 pb-1 pt-3 text-xxs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
              Other expenses
            </td>
          </tr>
          {plannedBudgets.map(bucket => {
            const spent = api.actuals.get(bucket.id) ?? 0;
            const fixes = api.fixesFor(bucket.id);
            const over = fixes.length > 0;
            return (
              <React.Fragment key={bucket.id}>
                <tr className="group border-b border-brand-200 dark:border-brand-700">
                  <td className={CELL} />
                  <td className={cn(CELL, 'pl-5')}>
                    <button
                      type="button"
                      onClick={() => setTarget({ kind: 'budget', bucketId: bucket.id })}
                      className="truncate px-1 text-left hover:text-accent-700 dark:hover:text-accent-300"
                    >
                      {bucket.name}
                    </button>
                  </td>
                  <td className={CELL}>
                    <MoneyCell
                      label={`${bucket.name} planned for this half`}
                      value={plan.budgets[bucket.id]}
                      onCommit={a => api.setBudget(bucket.id, a)}
                      className={cn('w-full py-0.5', quietCell)}
                    />
                  </td>
                  <td className={cn(CELL, amountText, 'px-2', over ? 'font-semibold text-money-neg dark:text-money-negDark' : 'text-brand-500 dark:text-brand-400')}>
                    {spent > 0 ? fmt(spent) : ''}
                  </td>
                </tr>
                {over && (
                  <tr className="bg-money-bgNeg dark:bg-money-neg/10">
                    <td colSpan={4} className="px-3 py-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mr-auto text-xs text-brand-700 dark:text-brand-200">
                          {bucket.name} is {fmt(sumMoney([spent, -(plan.budgets[bucket.id] ?? 0)]))} over this half.
                        </span>
                        {fixes.slice(0, 3).map(fix => (
                          <Button key={fix.fromBucketId ?? fix.kind} size="sm" variant="secondary" onClick={() => api.save(fix.plan)}>
                            {fix.kind === 'savings'
                              ? 'Cover from savings'
                              : `Take from ${api.buckets.find(b => b.id === fix.fromBucketId)?.name ?? 'another budget'}`}
                          </Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {plan.allocations.map(a => {
            const incoming = a.kind === 'from-savings';
            return (
              <tr key={a.id} className="group border-b border-brand-200 dark:border-brand-700">
                <td className={CELL} />
                <td className={CELL}>
                  <div className="flex items-center gap-1">
                    {isSeed ? (
                      <span className="w-4 shrink-0" />
                    ) : (
                      <PaidDot
                        paid={!!a.done}
                        label={a.done ? `${a.label} done` : `Mark ${a.label} done`}
                        onPay={() => api.setDone(a.id, true)}
                      />
                    )}
                    <NameCell value={a.label} label={`${a.label} name`} onCommit={v => v.trim() && v !== a.label && api.updateAllocation(a.id, { label: v.trim() })} />
                    <button
                      type="button"
                      aria-label={`Edit ${a.label}`}
                      onClick={() => setTarget({ kind: 'allocation', id: a.id })}
                      className="shrink-0 rounded p-1 text-brand-400 opacity-0 transition-opacity hover:text-accent-700 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                </td>
                <td className={CELL}>
                  {a.done ? (
                    <div className={cn(amountText, 'px-2', incoming && 'text-money-pos dark:text-money-posDark')}>
                      {incoming ? '+' : ''}{fmt(a.amount)}
                    </div>
                  ) : (
                    <MoneyCell
                      label={`${a.label} amount`}
                      value={a.amount}
                      // Clearing the amount removes the line.
                      onCommit={v => (v === undefined ? api.removeAllocation(a.id) : api.updateAllocation(a.id, { amount: v }))}
                      className={cn('w-full py-0.5', quietCell, incoming && 'text-money-pos dark:text-money-posDark')}
                    />
                  )}
                </td>
                <td className={cn(CELL, amountText, 'px-2 text-brand-500 dark:text-brand-400')}>
                  {a.done ? fmt(a.amount) : ''}
                </td>
              </tr>
            );
          })}
          <tr className="border-b border-brand-200 dark:border-brand-700">
            <td className={CELL} />
            <td colSpan={3} className={cn(CELL, 'pl-5')}>
              <select
                aria-label="Add another expense"
                value=""
                onChange={e => addLine(e.target.value)}
                className="cursor-pointer appearance-none bg-transparent px-1 text-xs text-accent-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:text-accent-300"
              >
                <option value="">+ Add another expense</option>
                {unplannedBuckets.length > 0 && (
                  <optgroup label="Budgets">
                    {unplannedBuckets.map(b => (
                      <option key={b.id} value={`bucket:${b.id}`}>{b.name}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Other">
                  {(['card-extra', 'to-savings', 'from-savings', 'other'] as const).map(kind => (
                    <option key={kind} value={kind}>{ALLOCATION_LABELS[kind]}</option>
                  ))}
                </optgroup>
              </select>
            </td>
          </tr>
        </tbody>
        <tfoot className="text-sm">
          <tr className="border-t border-brand-200 dark:border-brand-700">
            <td colSpan={3} className="px-3 py-1.5">Bills</td>
            <td className={cn(amountText, 'px-2')}>{fmt(summary.billTotal)}</td>
          </tr>
          <tr className="border-t border-brand-200 dark:border-brand-700">
            <td colSpan={3} className="px-3 py-1.5">Other expenses</td>
            <td className={cn(amountText, 'px-2')}>{fmt(otherTotal)}</td>
          </tr>
          <tr className="border-t border-brand-200 dark:border-brand-700">
            <td colSpan={3} className="px-3 py-1.5">{name} total expenses</td>
            <td className={cn(amountText, 'px-2')}>{fmt(totalExpenses)}</td>
          </tr>
          {summary.fromSavings > 0 && (
            <tr className="border-t border-brand-200 dark:border-brand-700">
              <td colSpan={3} className="px-3 py-1.5">From savings</td>
              <td className={cn(amountText, 'px-2 text-money-pos dark:text-money-posDark')}>+{fmt(summary.fromSavings)}</td>
            </tr>
          )}
          <tr className="border-t-2 border-brand-900 font-semibold dark:border-brand-100">
            <td colSpan={2} className="px-3 py-2">{name} remainder</td>
            <td className="py-2 text-right">
              {left !== 0 && (
                <button
                  type="button"
                  onClick={api.balance}
                  className="text-xs font-medium text-accent-700 hover:underline dark:text-accent-300"
                >
                  {left < 0 ? 'Cover from savings' : 'Send to savings'}
                </button>
              )}
            </td>
            <td
              data-testid="left-to-assign"
              className={cn(
                amountText,
                'px-2 py-2',
                left < 0 ? 'text-money-neg dark:text-money-negDark' : 'text-money-pos dark:text-money-posDark'
              )}
            >
              {signed(left)}
            </td>
          </tr>
        </tfoot>
      </table>
      <SheetRowDrawer target={target} onClose={() => setTarget(null)} api={api} plan={plan} range={half} />
    </div>
  );
};

export default HalfSheet;
