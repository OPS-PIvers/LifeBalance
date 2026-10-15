import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Check, Plus, X } from 'lucide-react';
import { CalendarItem, HalfAllocation, HalfAllocationKind, HalfPlan } from '@/types/schema';
import { useFinance, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { HapticCheck } from '@/components/ui/HapticCheck';
import { Button } from '@/components/ui/Button';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import MoneyCell from '@/components/budget/sheet/MoneyCell';
import { cn } from '@/utils/cn';
import { balancingPlan, dueDays, halfBucketActuals, overrunFixes, type HalfSummary } from '@/utils/halfPlan';
import { isRecurringId, parseRecurringId } from '@/utils/calendarRecurrence';
import { resolveTargetAccount } from '@/utils/accountImpact';
import { halfTitle, type PayHalf } from '@/utils/payPeriodHalves';

export interface HalfSheetProps {
  half: PayHalf & { end: string };
  /** The plan shown: the stored one, or the seed copied from last month. */
  plan: HalfPlan;
  /** True when `plan` is a seed nobody has saved yet. */
  isSeed: boolean;
  summary: HalfSummary;
  isCurrent: boolean;
}

const ALLOCATION_LABELS: Record<HalfAllocationKind, string> = {
  'to-savings': 'To savings',
  'from-savings': 'From savings',
  'card-extra': 'Extra card payment',
  other: 'Other',
};

const newId = () => crypto.randomUUID();

/** The check-off box used by bills, paychecks and allocation lines. */
const CheckBox: React.FC<{ checked: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void }> = ({
  checked,
  label,
  disabled,
  onChange,
}) => (
  <HapticCheck checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled} className="shrink-0 p-1 -m-1">
    <span
      className={cn(
        'flex h-5 w-5 items-center justify-center rounded border transition-colors',
        checked
          ? 'border-accent-600 bg-accent-600 text-white'
          : 'border-brand-300 dark:border-brand-600 group-hover:border-accent-500'
      )}
    >
      {checked && <Check size={14} strokeWidth={3} />}
    </span>
  </HapticCheck>
);

/**
 * One pay period as a sheet: paychecks at the top, the days that have bills
 * down the left with each bill on its day, then spending budgets, allocation
 * lines, and the totals ending in Left to assign. Every amount is a cell you
 * type into; bills and allocation lines check off.
 */
const HalfSheet: React.FC<HalfSheetProps> = ({ half, plan, isSeed, summary, isCurrent }) => {
  const {
    accounts,
    buckets,
    calendarItems,
    transactions,
    defaultAccountId,
    safeToSpend,
    addCalendarItem,
    updateCalendarItem,
    setOccurrenceAmount,
    editCalendarEntry,
    deleteCalendarItem,
    payCalendarItem,
    saveHalfPlan,
    setAllocationDone,
  } = useFinance();
  const { members } = useHouseholdCore();
  const fmt = useFormatCurrency();

  /** A recurring bill whose new amount is waiting on "which months?". */
  const [pendingAmount, setPendingAmount] = useState<{ item: CalendarItem; amount: number } | null>(null);
  /** The day a new bill row is being typed into, and whether it opened from
   *  the section's Add (shown at the top) or a day's "+ Add on" (shown there). */
  const [addingOn, setAddingOn] = useState<string | null>(null);
  const [addAtTop, setAddAtTop] = useState(false);
  /** The row whose name was tapped: editing its name and date. */
  const [editing, setEditing] = useState<{ item: CalendarItem; title: string; date: string } | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newDate, setNewDate] = useState(half.start);

  const save = (next: HalfPlan) => saveHalfPlan(next).catch(() => undefined);

  // Actual spending fills in as transactions arrive.
  const actuals = useMemo(
    () => halfBucketActuals(buckets, transactions, half),
    [buckets, transactions, half]
  );
  const bucketName = (id: string) => buckets.find(b => b.id === id)?.name ?? 'another budget';

  const payItem = (item: CalendarItem) => {
    const account = resolveTargetAccount(item.accountId, accounts, defaultAccountId);
    if (!account) return;
    void payCalendarItem(item.id, account.id).catch(() => undefined);
  };

  const changeBillAmount = (item: CalendarItem, amount: number | undefined) => {
    if (amount === undefined) return;
    if (isRecurringId(item.id)) {
      setPendingAmount({ item, amount });
    } else {
      void updateCalendarItem({ ...item, amount }).catch(() => undefined);
    }
  };

  const applyPendingAmount = async (scope: 'one' | 'future') => {
    if (!pendingAmount) return;
    const { item, amount } = pendingAmount;
    setPendingAmount(null);
    try {
      if (scope === 'one') {
        await setOccurrenceAmount(item.id, amount);
        return;
      }
      const template = calendarItems.find(i => i.id === parseRecurringId(item.id)?.templateId);
      if (template) await updateCalendarItem({ ...template, amount }, { amountFrom: item.date });
    } catch {
      // The mutation already told the user.
    }
  };

  const startAdding = (date: string, atTop = false) => {
    setEditing(null);
    setAddAtTop(atTop);
    setAddingOn(date);
    setNewDate(date);
    setNewTitle('');
    setNewAmount('');
  };

  const addBill = async () => {
    const amount = Number(newAmount.replace(/[$,\s]/g, ''));
    if (!newTitle.trim() || !Number.isFinite(amount) || amount <= 0 || !newDate) return;
    try {
      await addCalendarItem({
        id: newId(),
        title: newTitle.trim(),
        amount: Math.abs(amount),
        date: newDate,
        type: 'expense',
        isPaid: false,
      });
      setAddingOn(null);
    } catch {
      // The mutation already told the user.
    }
  };

  const startEditing = (item: CalendarItem) => {
    setAddingOn(null);
    setEditing(editing?.item.id === item.id ? null : { item, title: item.title, date: item.date });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const { item, title, date } = editing;
    try {
      await editCalendarEntry(item.id, {
        ...(title.trim() && title.trim() !== item.title ? { title } : {}),
        ...(date && date !== item.date ? { date } : {}),
      });
      setEditing(null);
    } catch {
      // The mutation already told the user.
    }
  };

  const deleteEdited = async () => {
    if (!editing) return;
    try {
      await deleteCalendarItem(editing.item.id);
      setEditing(null);
    } catch {
      // The mutation already told the user.
    }
  };

  const setBudget = (bucketId: string, amount: number | undefined) => {
    const budgets = { ...plan.budgets };
    if (amount === undefined) delete budgets[bucketId];
    else budgets[bucketId] = amount;
    void save({ ...plan, budgets });
  };

  const updateAllocation = (id: string, patch: Partial<HalfAllocation>) =>
    void save({ ...plan, allocations: plan.allocations.map(a => (a.id === id ? { ...a, ...patch } : a)) });

  const addAllocation = (kind: HalfAllocationKind) => {
    const card = kind === 'card-extra' ? accounts.find(a => a.type === 'credit' && !a.archived) : undefined;
    void save({
      ...plan,
      allocations: [
        ...plan.allocations,
        { id: newId(), kind, label: ALLOCATION_LABELS[kind], amount: 0, ...(card ? { accountId: card.id } : {}) },
      ],
    });
  };

  const removeAllocation = (id: string) =>
    void save({ ...plan, allocations: plan.allocations.filter(a => a.id !== id) });

  const balance = () => {
    const next = balancingPlan(plan, summary, newId);
    if (next) void save(next);
  };

  const earnerName = (item: CalendarItem) => {
    const template = calendarItems.find(i => i.id === (item.parentRecurringId ?? parseRecurringId(item.id)?.templateId));
    const earnerId = item.earnerId ?? template?.earnerId;
    return members.find(m => m.uid === earnerId)?.displayName;
  };

  const left = summary.leftToAssign;
  const minus = (n: number) => (n === 0 ? fmt(0) : `−${fmt(n)}`);
  const days = dueDays(summary);
  const creditCards = accounts.filter(a => a.type === 'credit' && !a.archived);

  const billRow = (item: CalendarItem, showDate: boolean) => (
    <React.Fragment key={item.id}>
      <Row dense className="gap-2">
        <span className="w-12 shrink-0 text-xs font-mono text-brand-500 dark:text-brand-400">
          {showDate ? format(parseISO(item.date), 'EEE d') : ''}
        </span>
        <CheckBox
          checked={item.isPaid}
          disabled={item.isPaid}
          label={item.isPaid ? `${item.title} paid` : `Mark ${item.title} paid`}
          onChange={() => payItem(item)}
        />
        <button
          type="button"
          onClick={() => startEditing(item)}
          aria-label={`Edit ${item.title}`}
          className={cn(
            'min-w-0 flex-1 truncate text-left text-sm hover:text-accent-700 dark:hover:text-accent-300',
            item.isPaid && 'text-brand-400 line-through dark:text-brand-500'
          )}
        >
          {item.title}
        </button>
        <MoneyCell
          label={`${item.title} amount`}
          value={item.amount}
          disabled={item.isPaid}
          onCommit={amount => changeBillAmount(item, amount)}
        />
      </Row>
      {editing?.item.id === item.id && editRow}
      {pendingAmount?.item.id === item.id && (
        <Row dense className="flex-wrap justify-end gap-2 bg-accent-50 dark:bg-accent-900/30">
          <span className="mr-auto text-xs text-brand-600 dark:text-brand-300">
            Change {item.title} to {fmt(pendingAmount.amount)} for…
          </span>
          <Button size="sm" variant="secondary" onClick={() => void applyPendingAmount('one')}>
            Just {format(parseISO(item.date), 'MMMM')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => void applyPendingAmount('future')}>
            This and future months
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPendingAmount(null)} aria-label="Keep the old amount">
            <X size={16} />
          </Button>
        </Row>
      )}
    </React.Fragment>
  );

  const editRow = editing && (
    <Row dense className="flex-wrap gap-2 bg-brand-50 dark:bg-brand-800/60">
      <input
        type="text"
        aria-label="Name"
        value={editing.title}
        autoFocus
        onChange={e => setEditing({ ...editing, title: e.target.value })}
        onKeyDown={e => e.key === 'Enter' && void saveEdit()}
        className="w-full min-w-0 rounded-md border border-brand-200 bg-white px-2 py-1 text-base sm:text-sm dark:border-brand-700 dark:bg-brand-800"
      />
      <input
        type="date"
        aria-label="Date"
        value={editing.date}
        onChange={e => setEditing({ ...editing, date: e.target.value })}
        className="min-w-0 flex-1 rounded-md border border-brand-200 bg-white px-2 py-1 text-base sm:text-sm dark:border-brand-700 dark:bg-brand-800"
      />
      <p className="w-full text-xs text-brand-500 dark:text-brand-400">
        {editing.item.isPaid
          ? 'Paid. You can fix its name or date; the amount is what was paid.'
          : isRecurringId(editing.item.id)
            ? `Repeats: a new name renames every month; a new date moves just ${format(parseISO(editing.item.date), 'MMMM')}'s. Type in the amount to change it.`
            : 'Type in the amount to change it.'}
      </p>
      <Button size="sm" onClick={() => void saveEdit()}>Save</Button>
      {!editing.item.isPaid && (
        <Button size="sm" variant="ghost-danger" onClick={() => void deleteEdited()}>
          {isRecurringId(editing.item.id) ? `Delete ${format(parseISO(editing.item.date), 'MMMM')}'s` : 'Delete'}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setEditing(null)} aria-label="Cancel editing">
        <X size={16} />
      </Button>
    </Row>
  );

  const addRow = (
    <Row dense className="flex-wrap gap-2 bg-brand-50 dark:bg-brand-800/60">
      <input
        type="text"
        aria-label="New bill name"
        placeholder="Bill or expense"
        autoFocus
        value={newTitle}
        onChange={e => setNewTitle(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && void addBill()}
        className="w-full min-w-0 rounded-md border border-brand-200 bg-white px-2 py-1 text-base sm:text-sm dark:border-brand-700 dark:bg-brand-800"
      />
      <input
        type="date"
        aria-label="Due date"
        value={newDate}
        min={half.start}
        max={half.end}
        onChange={e => setNewDate(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-brand-200 bg-white px-2 py-1 text-base sm:text-sm dark:border-brand-700 dark:bg-brand-800"
      />
      <input
        type="text"
        inputMode="decimal"
        aria-label="New bill amount"
        placeholder="0.00"
        value={newAmount}
        onChange={e => setNewAmount(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && void addBill()}
        className="w-24 rounded-md border border-brand-200 bg-white px-2 py-1 text-right font-mono text-base sm:text-sm dark:border-brand-700 dark:bg-brand-800"
      />
      <Button size="sm" onClick={() => void addBill()}>Add</Button>
      <Button size="sm" variant="ghost" onClick={() => setAddingOn(null)} aria-label="Cancel new bill">
        <X size={16} />
      </Button>
    </Row>
  );

  return (
    <div className="space-y-5">
      <Section title="Paychecks">
        <SurfaceList>
          {summary.paychecks.length === 0 && (
            <Row dense className="text-sm text-brand-500">No paycheck lands in this half.</Row>
          )}
          {summary.paychecks.map(p => (
            <React.Fragment key={p.id}>
            <Row dense className="gap-2">
              <span className="w-12 shrink-0 text-xs font-mono text-brand-500 dark:text-brand-400">
                {format(parseISO(p.date), 'EEE d')}
              </span>
              <CheckBox
                checked={p.isPaid}
                disabled={p.isPaid}
                label={p.isPaid ? `${p.title} received` : `Mark ${p.title} received`}
                onChange={() => payItem(p)}
              />
              <button
                type="button"
                onClick={() => startEditing(p)}
                aria-label={`Edit ${p.title}`}
                className="min-w-0 flex-1 truncate text-left text-sm hover:text-accent-700 dark:hover:text-accent-300"
              >
                {p.title}
                {earnerName(p) && <span className="text-brand-500 dark:text-brand-400"> · {earnerName(p)}</span>}
              </button>
              <MoneyCell label={`${p.title} amount`} value={p.amount} disabled={p.isPaid} onCommit={a => changeBillAmount(p, a)} />
            </Row>
            {editing?.item.id === p.id && editRow}
            </React.Fragment>
          ))}
        </SurfaceList>
      </Section>

      <Section
        title="Bills"
        action={
          <Button size="sm" variant="ghost" onClick={() => startAdding(half.start, true)} leftIcon={<Plus size={14} />}>
            Add
          </Button>
        }
      >
        <SurfaceList>
          {addingOn !== null && addAtTop && addRow}
          {days.length === 0 && addingOn === null && (
            <Row dense className="text-sm text-brand-500">No bills due this half.</Row>
          )}
          {days.map(day => (
            <React.Fragment key={day.date}>
              {day.bills.map((bill, i) => billRow(bill, i === 0))}
              <Row dense className="py-1">
                <span className="w-12 shrink-0" />
                <button
                  type="button"
                  onClick={() => startAdding(day.date)}
                  className="text-xs text-brand-400 hover:text-accent-600 dark:text-brand-500"
                >
                  + Add on {format(parseISO(day.date), 'MMM d')}
                </button>
              </Row>
              {addingOn === day.date && !addAtTop && addRow}
            </React.Fragment>
          ))}
          {addingOn !== null && !addAtTop && !days.some(d => d.date === addingOn) && addRow}
        </SurfaceList>
      </Section>

      <Section title="Spending budgets">
        <SurfaceList>
          {buckets.length === 0 && <Row dense className="text-sm text-brand-500">No budget buckets yet.</Row>}
          {buckets.map(bucket => {
            const spent = actuals.get(bucket.id) ?? 0;
            const planned = plan.budgets[bucket.id];
            const fixes = isSeed ? [] : overrunFixes(plan, bucket.id, actuals, newId);
            const over = fixes.length > 0;
            return (
              <React.Fragment key={bucket.id}>
                <Row dense className="gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{bucket.name}</span>
                  {spent > 0 && (
                    <span
                      className={cn(
                        'shrink-0 font-mono text-xs tabular-nums',
                        over ? 'font-semibold text-money-neg dark:text-money-negDark' : 'text-brand-500 dark:text-brand-400'
                      )}
                    >
                      {fmt(spent)} spent
                    </span>
                  )}
                  <MoneyCell
                    label={`${bucket.name} planned for this half`}
                    value={planned}
                    onCommit={amount => setBudget(bucket.id, amount)}
                  />
                </Row>
                {over && (
                  <Row dense className="flex-wrap gap-2 bg-money-bgNeg dark:bg-money-neg/10">
                    <span className="w-full text-xs text-brand-700 dark:text-brand-200">
                      {bucket.name} is {fmt(spent - (planned ?? 0))} over this half.
                    </span>
                    {fixes.slice(0, 3).map(fix => (
                      <Button
                        key={fix.fromBucketId ?? fix.kind}
                        size="sm"
                        variant="secondary"
                        onClick={() => void save(fix.plan)}
                      >
                        {fix.kind === 'savings' ? 'Cover from savings' : `Move from ${bucketName(fix.fromBucketId ?? '')}`}
                      </Button>
                    ))}
                  </Row>
                )}
              </React.Fragment>
            );
          })}
        </SurfaceList>
      </Section>

      <Section title="Every dollar a job">
        <SurfaceList>
          {plan.allocations.map(a => (
            <Row dense key={a.id} className="flex-wrap gap-2">
              <CheckBox
                checked={!!a.done}
                disabled={isSeed}
                label={a.done ? `Undo ${a.label}` : `Mark ${a.label} done`}
                onChange={done => void setAllocationDone(plan, a.id, done).catch(() => undefined)}
              />
              <input
                type="text"
                aria-label="Line name"
                defaultValue={a.label}
                key={`${a.id}-${a.label}`}
                onBlur={e => e.target.value.trim() && e.target.value !== a.label && updateAllocation(a.id, { label: e.target.value })}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-base sm:text-sm hover:border-brand-200 focus:border-accent-500 focus:outline-none dark:hover:border-brand-700"
              />
              {a.kind === 'card-extra' && creditCards.length > 0 && (
                <select
                  aria-label="Which card"
                  value={a.accountId ?? ''}
                  onChange={e => updateAllocation(a.id, { accountId: e.target.value || undefined })}
                  className="rounded-md border border-brand-200 bg-transparent px-1 py-1 text-base sm:text-xs dark:border-brand-700"
                >
                  <option value="">Card…</option>
                  {creditCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <span className={cn('text-xs', a.kind === 'from-savings' ? 'text-money-pos' : 'text-brand-400')}>
                {a.kind === 'from-savings' ? '+' : '−'}
              </span>
              <MoneyCell
                label={`${a.label} amount`}
                value={a.amount || undefined}
                disabled={!!a.done}
                onCommit={amount => updateAllocation(a.id, { amount: amount ?? 0 })}
              />
              <button
                type="button"
                aria-label={`Remove ${a.label}`}
                disabled={!!a.done}
                onClick={() => removeAllocation(a.id)}
                className="p-1 text-brand-300 hover:text-money-neg disabled:opacity-30 dark:text-brand-600"
              >
                <X size={14} />
              </button>
            </Row>
          ))}
          <Row dense className="flex-wrap gap-1.5">
            {(['to-savings', 'card-extra', 'from-savings', 'other'] as const).map(kind => (
              <Button key={kind} size="sm" variant="ghost-brand" onClick={() => addAllocation(kind)} leftIcon={<Plus size={12} />}>
                {ALLOCATION_LABELS[kind]}
              </Button>
            ))}
          </Row>
        </SurfaceList>
      </Section>

      <SurfaceList aria-label={`${halfTitle(half)} totals`}>
        <Row dense className="justify-between text-sm"><span>Paychecks</span><span className="font-mono">{fmt(summary.paycheckTotal)}</span></Row>
        <Row dense className="justify-between text-sm"><span>Bills</span><span className="font-mono">{minus(summary.billTotal)}</span></Row>
        <Row dense className="justify-between text-sm"><span>Spending budgets</span><span className="font-mono">{minus(summary.budgetTotal)}</span></Row>
        <Row dense className="justify-between text-sm"><span>Savings &amp; extra payments</span><span className="font-mono">{minus(summary.allocationsOut)}</span></Row>
        {summary.fromSavings > 0 && (
          <Row dense className="justify-between text-sm"><span>From savings</span><span className="font-mono">+{fmt(summary.fromSavings)}</span></Row>
        )}
        <Row className="flex-wrap justify-between gap-2">
          <span className="font-display text-lg">Left to assign</span>
          <span
            data-testid="left-to-assign"
            className={cn(
              'font-mono text-lg font-semibold tabular-nums',
              left === 0 ? 'text-money-pos dark:text-money-posDark' : left < 0 ? 'text-money-neg dark:text-money-negDark' : 'text-warm-700 dark:text-warm-300'
            )}
          >
            {fmt(left)}
          </span>
          {left !== 0 && (
            <Button size="sm" variant="secondary" className="w-full" onClick={balance}>
              {left < 0 ? `Cover ${fmt(-left)} from savings` : `Send ${fmt(left)} to savings`}
            </Button>
          )}
        </Row>
      </SurfaceList>
      {isSeed && plan.allocations.length + Object.keys(plan.budgets).length > 0 && (
        <p className="px-1 text-xs text-brand-500 dark:text-brand-400">
          Copied from the same half last month. Change anything to keep it.
        </p>
      )}
      {isCurrent && (
        <p className="px-1 text-xs text-brand-500 dark:text-brand-400">
          Safe-to-Spend right now: <span className="font-mono">{fmt(safeToSpend)}</span> — the live figure, kept separate from this plan.
        </p>
      )}
    </div>
  );
};

export default HalfSheet;
