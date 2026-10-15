import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import type { CalendarItem, HalfPlan } from '@/types/schema';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { isRecurringId } from '@/utils/calendarRecurrence';
import { roundMoney } from '@/utils/money';
import type { HalfSheetApi } from '@/components/budget/sheet/useHalfSheet';

/** What the panel is open on. */
export type RowTarget =
  | { kind: 'item'; item: CalendarItem }
  | { kind: 'add'; date: string }
  | { kind: 'budget'; bucketId: string }
  | { kind: 'allocation'; id: string };

interface SheetRowDrawerProps {
  target: RowTarget | null;
  onClose: () => void;
  api: HalfSheetApi;
  plan: HalfPlan;
  /** The half's first and last day: where a new bill can go. */
  range: { start: string; end: string };
}

const parseAmount = (text: string): number | undefined => {
  const n = Number(text.replace(/[$,\s]/g, ''));
  return text.trim() !== '' && Number.isFinite(n) ? roundMoney(Math.abs(n)) : undefined;
};
const asText = (n: number | undefined) => (n === undefined ? '' : String(roundMoney(n)));

/** Rename, move, change or delete one row of the sheet, or add a bill. */
const SheetRowDrawer: React.FC<SheetRowDrawerProps> = ({ target, onClose, api, plan, range }) => (
  <Drawer
    isOpen={target !== null}
    onClose={onClose}
    title={
      !target
        ? ''
        : target.kind === 'add'
          ? `Add to ${format(parseISO(target.date), 'MMM d')}`
          : target.kind === 'item'
            ? target.item.title
            : target.kind === 'budget'
              ? (api.buckets.find(b => b.id === target.bucketId)?.name ?? 'Budget')
              : (plan.allocations.find(a => a.id === target.id)?.label ?? 'Line')
    }
  >
    {target && (
      // Keyed so each opening starts from that row's own values.
      <Body
        key={target.kind === 'item' ? target.item.id : target.kind === 'add' ? target.date : target.kind === 'budget' ? target.bucketId : target.id}
        target={target}
        onClose={onClose}
        api={api}
        plan={plan}
        range={range}
      />
    )}
  </Drawer>
);

const Body: React.FC<Required<Pick<SheetRowDrawerProps, 'onClose' | 'api' | 'plan' | 'range'>> & { target: RowTarget }> = ({
  target,
  onClose,
  api,
  plan,
  range,
}) => {
  const fmt = useFormatCurrency();
  const item = target.kind === 'item' ? target.item : undefined;
  const allocation = target.kind === 'allocation' ? plan.allocations.find(a => a.id === target.id) : undefined;
  const bucketId = target.kind === 'budget' ? target.bucketId : undefined;

  const [title, setTitle] = useState(item?.title ?? allocation?.label ?? '');
  const [date, setDate] = useState(item?.date ?? (target.kind === 'add' ? target.date : ''));
  const [amount, setAmount] = useState(
    asText(item?.amount ?? allocation?.amount ?? (bucketId ? plan.budgets[bucketId] : undefined))
  );

  const asking = item && api.pending?.item.id === item.id;
  const month = date ? format(parseISO(date), 'MMMM') : '';

  if (asking) {
    return (
      <div className="space-y-3 pb-2">
        <p className="text-sm text-brand-700 dark:text-brand-200">
          Change {item.title} to {fmt(api.pending?.amount ?? 0)} for:
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={() => void api.applyPending('one').then(onClose)}>
            Just {api.pendingMonth}
          </Button>
          <Button onClick={() => void api.applyPending('future').then(onClose)}>This and future months</Button>
          <Button variant="ghost" onClick={() => api.setPending(null)}>
            Keep {fmt(item.amount)}
          </Button>
        </div>
      </div>
    );
  }

  if (target.kind === 'add') {
    const value = parseAmount(amount);
    const ready = title.trim() !== '' && value !== undefined && value > 0 && date !== '';
    const add = () => {
      if (!ready || value === undefined) return;
      void api.addBill(date, title, value).then(onClose, () => undefined);
    };
    return (
      <form className="space-y-3 pb-2" onSubmit={e => { e.preventDefault(); add(); }}>
        <Input label="Name" value={title} autoFocus onChange={e => setTitle(e.target.value)} />
        <Input label="Amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
        <Input label="Date" type="date" value={date} min={range.start} max={range.end} onChange={e => setDate(e.target.value)} />
        <Button type="submit" className="w-full" disabled={!ready}>Add</Button>
      </form>
    );
  }

  if (item) {
    const recurring = isRecurringId(item.id);
    const income = item.type === 'income';
    const saveItem = async () => {
      const changes = {
        ...(title.trim() && title.trim() !== item.title ? { title: title.trim() } : {}),
        ...(date && date !== item.date ? { date } : {}),
      };
      try {
        if (changes.title || changes.date) await api.editCalendarEntry(item.id, changes);
      } catch {
        return;
      }
      const value = parseAmount(amount);
      if (!item.isPaid && value !== undefined && value !== item.amount) {
        api.changeAmount(item, value);
        // A repeating row now asks which months; anything else is done.
        if (recurring) return;
      }
      onClose();
    };
    return (
      <form className="space-y-3 pb-2" onSubmit={e => { e.preventDefault(); void saveItem(); }}>
        <Input label="Name" value={title} onChange={e => setTitle(e.target.value)} />
        <Input
          label="Date"
          type="date"
          value={date}
          // A paid row never moves into the future.
          max={item.isPaid ? item.date : undefined}
          onChange={e => setDate(e.target.value)}
        />
        {item.isPaid ? (
          <p className="text-sm text-brand-600 dark:text-brand-300">
            {income ? 'Received' : 'Paid'} <span className="font-mono">{fmt(item.amount)}</span>
            {api.planned(item) !== item.amount && (
              <span className="text-brand-500 dark:text-brand-400"> · planned {fmt(api.planned(item))}</span>
            )}
          </p>
        ) : (
          <Input label="Amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
        )}
        <Button type="submit" className="w-full">Save</Button>
        {!item.isPaid && (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              api.pay(item, parseAmount(amount));
              onClose();
            }}
          >
            {income ? 'Mark received' : 'Mark paid'}
          </Button>
        )}
        {!item.isPaid && (
          <Button
            type="button"
            variant="ghost-danger"
            className="w-full"
            onClick={() => void api.deleteCalendarItem(item.id).then(onClose, () => undefined)}
          >
            {recurring ? `Delete ${month}'s` : 'Delete'}
          </Button>
        )}
      </form>
    );
  }

  if (bucketId) {
    const spent = api.actuals.get(bucketId) ?? 0;
    const fixes = api.fixesFor(bucketId);
    const bucketName = (id: string) => api.buckets.find(b => b.id === id)?.name ?? 'another budget';
    return (
      <form
        className="space-y-3 pb-2"
        onSubmit={e => {
          e.preventDefault();
          api.setBudget(bucketId, parseAmount(amount));
          onClose();
        }}
      >
        <Input label="Planned this half" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
        <p className="text-sm text-brand-600 dark:text-brand-300">
          Spent so far <span className="font-mono">{fmt(spent)}</span>
        </p>
        {fixes.slice(0, 3).map(fix => (
          <Button
            key={fix.fromBucketId ?? fix.kind}
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              api.save(fix.plan);
              onClose();
            }}
          >
            {fix.kind === 'savings' ? 'Cover from savings' : `Take from ${bucketName(fix.fromBucketId ?? '')}`}
          </Button>
        ))}
        <Button type="submit" className="w-full">Save</Button>
        <Button
          type="button"
          variant="ghost-danger"
          className="w-full"
          onClick={() => {
            api.setBudget(bucketId, undefined);
            onClose();
          }}
        >
          Remove from this half
        </Button>
      </form>
    );
  }

  if (!allocation) return null;
  const cards = api.accounts.filter(a => a.type === 'credit' && !a.archived);
  return (
    <form
      className="space-y-3 pb-2"
      onSubmit={e => {
        e.preventDefault();
        api.updateAllocation(allocation.id, {
          ...(title.trim() ? { label: title.trim() } : {}),
          ...(!allocation.done ? { amount: parseAmount(amount) ?? 0 } : {}),
        });
        onClose();
      }}
    >
      <Input label="Name" value={title} onChange={e => setTitle(e.target.value)} />
      <Input
        label="Amount"
        inputMode="decimal"
        value={amount}
        disabled={!!allocation.done}
        onChange={e => setAmount(e.target.value)}
      />
      {allocation.kind === 'card-extra' && cards.length > 0 && (
        <label className="block text-sm text-brand-700 dark:text-brand-200">
          Card
          <select
            value={allocation.accountId ?? ''}
            onChange={e => api.updateAllocation(allocation.id, { accountId: e.target.value || undefined })}
            className="mt-1 block w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-base dark:border-brand-700 dark:bg-brand-800"
          >
            <option value="">Pick a card</option>
            {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      <Button type="submit" className="w-full">Save</Button>
      {!api.isSeed && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => {
            api.setDone(allocation.id, !allocation.done);
            onClose();
          }}
        >
          {allocation.done ? 'Not done yet' : 'Mark done'}
        </Button>
      )}
      {!allocation.done && (
        <Button
          type="button"
          variant="ghost-danger"
          className="w-full"
          onClick={() => {
            api.removeAllocation(allocation.id);
            onClose();
          }}
        >
          Remove
        </Button>
      )}
    </form>
  );
};

export default SheetRowDrawer;
