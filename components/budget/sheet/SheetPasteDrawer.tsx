import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { cn } from '@/utils/cn';
import { CalendarItem, HalfAllocationKind } from '@/types/schema';
import { halfTitle, type PayHalf } from '@/utils/payPeriodHalves';
import { seedHalfPlan, summarizeHalf } from '@/utils/halfPlan';
import {
  applyOthers,
  guessOtherTarget,
  matchBills,
  parseSheetPaste,
  type OtherTarget,
} from '@/utils/sheetPaste';

type ClosedHalf = PayHalf & { end: string };

interface SheetPasteDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** yyyy-MM: the month the pasted sheet is for. */
  month: string;
  /** That month's halves, in order: the 1st-half panel fills [0], the 2nd [1]. */
  halves: ClosedHalf[];
  /** Expanded calendar items covering the month (and a few days around it). */
  expanded: CalendarItem[];
}

const ALLOCATION_TARGETS: { value: HalfAllocationKind; label: string }[] = [
  { value: 'to-savings', label: 'To savings' },
  { value: 'card-extra', label: 'Extra card payment' },
  { value: 'from-savings', label: 'From savings' },
  { value: 'other', label: 'Other line' },
];

const encode = (t: OtherTarget) =>
  t.kind === 'bucket' ? `bucket:${t.bucketId}` : t.kind === 'allocation' ? `alloc:${t.allocation}` : 'skip';

const PLACEHOLDER = 'In Google Sheets, select the month (both halves, from the Date headers down to the Remainder rows), copy, and paste here.';

/**
 * Money → Sheet → "Paste from your sheet": brings a month in from the
 * household's Google Sheet. Nothing is written until Import; the preview
 * shows which bills LifeBalance already has (skipped, so nothing is added
 * twice), which are new, which amounts differ, what each Other Expenses line
 * becomes, and what Left to assign will read afterwards.
 */
const SheetPasteDrawer: React.FC<SheetPasteDrawerProps> = ({ isOpen, onClose, month, halves, expanded }) => {
  const { buckets, accounts, halfPlans, importSheetMonth } = useFinance();
  const fmt = useFormatCurrency();
  const [text, setText] = useState('');
  /** Unticked rows, by key; everything starts ticked. */
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  /** Other Expenses lines whose target the user changed, by key. */
  const [targets, setTargets] = useState<Record<string, OtherTarget>>({});
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => parseSheetPaste(text), [text]);
  const matches = useMemo(() => matchBills(parsed.bills, month, expanded), [parsed, month, expanded]);

  const billKey = (i: number) => `bill:${i}`;
  const otherKey = (i: number) => `other:${i}`;
  const isOn = (key: string) => !skipped.has(key);
  const toggle = (key: string) =>
    setSkipped(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const others = parsed.others.map((o, i) => ({
    ...o,
    key: otherKey(i),
    target: targets[otherKey(i)] ?? guessOtherTarget(o.label, buckets, accounts),
  }));

  const newBills = matches.flatMap((m, i) => (!m.existing && isOn(billKey(i)) ? [{ m, i }] : []));
  const changes = matches.flatMap((m, i) =>
    m.existing && !m.existing.isPaid && m.existing.amount !== m.bill.amount && isOn(billKey(i)) ? [{ m, i }] : []
  );

  // Each panel's half (1st, 2nd) and its plan with the sheet's lines applied.
  const panels = ([0, 1] as const).map(panel => {
    const half = halves[panel];
    const lines = others.filter(o => o.panel === panel);
    const plan =
      half &&
      applyOthers(
        halfPlans.find(p => p.id === half.id) ?? seedHalfPlan(half.id, halfPlans, () => crypto.randomUUID()),
        lines,
        () => crypto.randomUUID()
      );
    return { panel, half, lines, plan };
  });
  const plans = panels.flatMap(p => (p.plan && p.lines.length > 0 ? [p.plan] : []));

  // What the halves will read after import: new bills added, amounts changed.
  const changed = new Map(changes.map(({ m }) => [m.existing?.id, m.bill.amount]));
  const projected: CalendarItem[] = [
    ...expanded.map(i => (changed.has(i.id) ? { ...i, amount: changed.get(i.id) ?? i.amount } : i)),
    ...newBills.map(({ m, i }): CalendarItem => ({
      id: `new-${i}`,
      title: m.bill.title,
      amount: m.bill.amount,
      date: m.date,
      type: 'expense',
      isPaid: false,
    })),
  ];
  const bucketIds = new Set(buckets.map(b => b.id));

  const hasContent = parsed.bills.length + parsed.others.length > 0;

  const close = () => {
    setText('');
    setSkipped(new Set());
    setTargets({});
    onClose();
  };

  const runImport = async () => {
    setBusy(true);
    try {
      await importSheetMonth({
        newBills: newBills.map(({ m }) => ({ title: m.bill.title, amount: m.bill.amount, date: m.date })),
        amountChanges: changes.flatMap(({ m }) => (m.existing ? [{ item: m.existing, amount: m.bill.amount }] : [])),
        plans,
      });
      close();
    } catch {
      // importSheetMonth already told the user; keep the preview to retry.
    } finally {
      setBusy(false);
    }
  };

  const monthName = format(parseISO(`${month}-01`), 'MMMM');

  return (
    <Drawer
      isOpen={isOpen}
      onClose={close}
      title={`Paste ${monthName} from your sheet`}
      height="tall"
      footer={
        <div className="flex gap-2 border-t border-brand-200 p-4 dark:border-brand-700">
          <Button variant="secondary" className="flex-1" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => void runImport()} disabled={!hasContent} isLoading={busy}>
            Import
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <textarea
          aria-label="Pasted sheet"
          value={text}
          onChange={e => {
            setText(e.target.value);
            setSkipped(new Set());
            setTargets({});
          }}
          placeholder={PLACEHOLDER}
          rows={hasContent ? 3 : 8}
          className="w-full rounded-lg border border-brand-200 bg-white p-3 font-mono text-base sm:text-xs dark:border-brand-700 dark:bg-brand-800"
        />
        {text.trim() !== '' && !hasContent && (
          <p className="text-sm text-money-neg dark:text-money-negDark">
            Couldn&apos;t find any bills in that. Copy the cells straight from Google Sheets, including the Date and Expense Name columns.
          </p>
        )}

        {panels.map(({ panel, half, lines, plan }) => {
          const rows = matches.map((m, i) => ({ m, i })).filter(({ m }) => m.bill.panel === panel);
          if (rows.length + lines.length === 0) return null;
          const known = rows.filter(({ m }) => m.existing);
          const fresh = rows.filter(({ m }) => !m.existing);
          const after = half && plan ? summarizeHalf(half, projected, plan, bucketIds).leftToAssign : null;
          return (
            <Section key={panel} title={half ? halfTitle(half) : panel === 0 ? '1st half' : '2nd half'}>
              <SurfaceList>
                {fresh.length > 0 && (
                  <Row dense className="text-xs font-semibold uppercase tracking-wide text-brand-500">
                    New: added for that date only
                  </Row>
                )}
                {fresh.map(({ m, i }) => (
                  <Row dense key={billKey(i)} className="gap-2">
                    <input
                      type="checkbox"
                      aria-label={`Add ${m.bill.title} on ${m.date}`}
                      checked={isOn(billKey(i))}
                      onChange={() => toggle(billKey(i))}
                    />
                    <span className="w-12 shrink-0 font-mono text-xs text-brand-500">{format(parseISO(m.date), 'MMM d')}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{m.bill.title}</span>
                    <span className="font-mono text-sm tabular-nums">{fmt(m.bill.amount)}</span>
                  </Row>
                ))}
                {known.length > 0 && (
                  <Row dense className="text-xs font-semibold uppercase tracking-wide text-brand-500">
                    Already in LifeBalance: not added again
                  </Row>
                )}
                {known.map(({ m, i }) => {
                  const existing = m.existing;
                  if (!existing) return null;
                  const differs = existing.amount !== m.bill.amount;
                  return (
                    <Row dense key={billKey(i)} className="flex-wrap gap-2 text-brand-500 dark:text-brand-400">
                      <span className="w-12 shrink-0 font-mono text-xs">{format(parseISO(existing.date), 'MMM d')}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{existing.title}</span>
                      <span className="font-mono text-sm tabular-nums">{fmt(existing.amount)}</span>
                      {differs && !existing.isPaid && (
                        <label className="flex w-full items-center gap-2 pl-14 text-xs text-brand-700 dark:text-brand-200">
                          <input type="checkbox" checked={isOn(billKey(i))} onChange={() => toggle(billKey(i))} />
                          Change to the sheet&apos;s {fmt(m.bill.amount)} for {monthName} only
                        </label>
                      )}
                      {differs && existing.isPaid && (
                        <span className="w-full pl-14 text-xs">Paid {fmt(existing.amount)}; the sheet says {fmt(m.bill.amount)}. Paid amounts aren&apos;t changed.</span>
                      )}
                    </Row>
                  );
                })}
                {lines.length > 0 && (
                  <Row dense className="text-xs font-semibold uppercase tracking-wide text-brand-500">
                    {half ? 'Other expenses' : 'Other expenses: add a repeating paycheck so this half has a plan'}
                  </Row>
                )}
                {lines.map(o => (
                  <Row dense key={o.key} className="gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{o.label}</span>
                    <select
                      aria-label={`${o.label} goes to`}
                      value={encode(o.target)}
                      onChange={e => {
                        const [kind, value] = e.target.value.split(':');
                        const allocation = ALLOCATION_TARGETS.find(t => t.value === value)?.value;
                        const target: OtherTarget =
                          kind === 'bucket' && value
                            ? { kind: 'bucket', bucketId: value }
                            : kind === 'alloc' && allocation
                              ? {
                                  kind: 'allocation',
                                  allocation,
                                  ...(o.target.kind === 'allocation' && o.target.accountId ? { accountId: o.target.accountId } : {}),
                                }
                              : { kind: 'skip' };
                        setTargets(prev => ({ ...prev, [o.key]: target }));
                      }}
                      className="max-w-[45%] rounded-md border border-brand-200 bg-transparent px-1 py-1 text-base sm:text-xs dark:border-brand-700"
                    >
                      <optgroup label="Budget">
                        {buckets.map(b => <option key={b.id} value={`bucket:${b.id}`}>{b.name}</option>)}
                      </optgroup>
                      <optgroup label="Line">
                        {ALLOCATION_TARGETS.map(t => <option key={t.value} value={`alloc:${t.value}`}>{t.label}</option>)}
                      </optgroup>
                      <option value="skip">Skip</option>
                    </select>
                    <span className={cn('w-20 text-right font-mono text-sm tabular-nums', o.target.kind === 'skip' && 'text-brand-400 line-through')}>
                      {fmt(o.amount)}
                    </span>
                  </Row>
                ))}
                {after !== null && (
                <Row className="justify-between">
                  <span className="text-sm">Left to assign after import</span>
                  <span
                    className={cn(
                      'font-mono font-semibold tabular-nums',
                      after === 0 ? 'text-money-pos dark:text-money-posDark' : after < 0 ? 'text-money-neg dark:text-money-negDark' : 'text-warm-700 dark:text-warm-300'
                    )}
                  >
                    {fmt(after)}
                  </span>
                </Row>
                )}
              </SurfaceList>
            </Section>
          );
        })}
      </div>
    </Drawer>
  );
};

export default SheetPasteDrawer;
