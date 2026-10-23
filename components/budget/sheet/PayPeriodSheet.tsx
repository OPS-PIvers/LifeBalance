import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addMonths, endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { useExpandedCalendarItems, useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Button } from '@/components/ui/Button';
import HalfSheet from '@/components/budget/sheet/HalfSheet';
import HalfPhone from '@/components/budget/sheet/HalfPhone';
import SheetPasteDrawer from '@/components/budget/sheet/SheetPasteDrawer';
import { halfOf, halvesBetween, type PayHalf } from '@/utils/payPeriodHalves';
import { seedHalfPlan, summarizeHalf } from '@/utils/halfPlan';
import { getLocalDateString } from '@/utils/dateHelpers';
import { sumMoney } from '@/utils/money';
import { cn } from '@/utils/cn';
import type { HalfPlan } from '@/types/schema';

/** Planning reaches about three months ahead; a little history stays reachable. */
const MONTHS_BACK = 2;
const MONTHS_AHEAD = 3;

const pillLabel = (half: PayHalf) =>
  `${format(parseISO(half.start), 'MMM d')}–${format(parseISO(half.end), 'd')}`;

/**
 * Money → Sheet: the household's spreadsheet, made of half-months (1st–15th,
 * 16th–end), each funded by the paycheck just before it. A wide screen shows
 * the month's two halves side by side as one spreadsheet; a phone shows one
 * half, with only the days that have something due.
 */
const PayPeriodSheet: React.FC = () => {
  const { halfPlans, buckets, safeToSpend } = useFinance();
  const isWide = useMediaQuery('(min-width: 1024px)');
  const fmt = useFormatCurrency();
  const today = getLocalDateString();
  const rootRef = useRef<HTMLDivElement>(null);

  // A month of padding on each side: the paycheck that funds a half can land
  // up to a week before it starts.
  const [windowStart, windowEnd] = useMemo(() => {
    const t = parseISO(today);
    return [subMonths(startOfMonth(t), MONTHS_BACK + 1), endOfMonth(addMonths(t, MONTHS_AHEAD + 1))];
  }, [today]);
  const expanded = useExpandedCalendarItems(windowStart, windowEnd);

  const halves = useMemo(
    () =>
      halvesBetween(
        format(subMonths(parseISO(today), MONTHS_BACK), 'yyyy-MM'),
        format(addMonths(parseISO(today), MONTHS_AHEAD), 'yyyy-MM')
      ),
    [today]
  );

  const currentId = halfOf(today).id;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [addRequest, setAddRequest] = useState<{ date: string; at: number } | undefined>(undefined);
  const selected = halves.find(h => h.id === (selectedId ?? currentId)) ?? halves[0];
  const bucketIds = useMemo(() => new Set(buckets.map(b => b.id)), [buckets]);

  // The phone's paycheck card pins just below the Money tab strip, which is
  // itself pinned to the top of the page scroller.
  useEffect(() => {
    const root = rootRef.current;
    const strip = root?.closest('[data-sheet-host]')?.querySelector<HTMLElement>('[data-sticky-tabs]');
    if (!root || !strip) return;
    const sync = () => root.style.setProperty('--sheet-sticky-top', `${strip.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [isWide]);

  // The switcher opens on the half we're in (earlier halves are a swipe back).
  const pillsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = pillsRef.current;
    const pill = strip?.querySelector<HTMLElement>('[data-current]');
    if (strip && pill) strip.scrollLeft = pill.offsetLeft - strip.offsetLeft - 3;
  }, [isWide]);

  if (!selected) return null;

  const month = selected.id.slice(0, 7);
  const monthHalves = halves.filter(h => h.id.slice(0, 7) === month);

  const view = (half: PayHalf) => {
    const stored = halfPlans.find(p => p.id === half.id);
    // Stable ids for a seed nobody has saved, so its rows don't remount on
    // every render; the first edit saves them as they are.
    let seedLine = 0;
    const plan: HalfPlan = stored ?? seedHalfPlan(half.id, halfPlans, () => `${half.id}-seed-${++seedLine}`);
    return { plan, isSeed: !stored, summary: summarizeHalf(half, expanded, plan, bucketIds) };
  };

  const pasteDrawer = (
    <SheetPasteDrawer
      isOpen={pasteOpen}
      onClose={() => setPasteOpen(false)}
      month={month}
      halves={monthHalves}
      expanded={expanded}
    />
  );

  if (!isWide) {
    const { plan, isSeed, summary } = view(selected);
    const tabs = (
      <div
        ref={pillsRef}
        role="group"
        aria-label="Choose a half"
        className="mb-2 flex gap-1 overflow-x-auto rounded-lg bg-brand-200 p-[3px] [scrollbar-width:none] dark:bg-brand-700"
      >
        {halves.map(h => (
          <button
            key={h.id}
            type="button"
            aria-pressed={h.id === selected.id}
            data-current={h.id === currentId || undefined}
            onClick={() => setSelectedId(h.id)}
            className={cn(
              'min-w-[calc((100%-0.5rem)/3)] shrink-0 rounded-md px-2 py-1 text-xs tabular-nums transition-colors',
              h.id === selected.id
                ? 'bg-white font-semibold text-brand-900 shadow-sm dark:bg-brand-900 dark:text-brand-50'
                : 'text-brand-600 dark:text-brand-300'
            )}
          >
            {pillLabel(h)}
          </button>
        ))}
      </div>
    );
    return (
      <div ref={rootRef}>
        <HalfPhone
          key={selected.id}
          half={selected}
          plan={plan}
          isSeed={isSeed}
          summary={summary}
          today={today}
          tabs={tabs}
          safeToSpend={selected.id === currentId ? safeToSpend : undefined}
          pasteAction={
            <Button variant="link" size="sm" onClick={() => setPasteOpen(true)}>
              Paste {format(parseISO(`${month}-01`), 'MMMM')} from Google Sheets
            </Button>
          }
        />
        {pasteDrawer}
      </div>
    );
  }

  const shown = monthHalves.map(h => ({ half: h, ...view(h) }));
  const monthNet = sumMoney(shown.map(s => s.summary.leftToAssign));
  const monthIndex = (delta: 1 | -1) => format(addMonths(parseISO(`${month}-01`), delta), 'yyyy-MM');
  const stepTo = (delta: 1 | -1) => halves.find(h => h.id.slice(0, 7) === monthIndex(delta));
  const prev = stepTo(-1);
  const next = stepTo(1);
  const signed = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${fmt(Math.abs(n))}`;
  const addDate = today.slice(0, 7) === month ? today : `${month}-01`;

  return (
    <div ref={rootRef} className="overflow-hidden rounded-xl border border-brand-300 bg-white dark:border-brand-600 dark:bg-brand-800">
      <div className="flex items-center justify-between gap-3 border-b border-brand-200 px-4 py-3 dark:border-brand-700">
        <div className="flex items-baseline gap-4">
          <h2 className="font-display text-xl font-semibold text-brand-900 dark:text-brand-50">
            {format(parseISO(`${month}-01`), 'MMMM yyyy')}
          </h2>
          <span className="text-sm text-brand-600 dark:text-brand-300">
            Month net{' '}
            <span
              data-testid="month-net"
              className={cn('font-mono tabular-nums', monthNet < 0 ? 'text-money-neg dark:text-money-negDark' : 'text-money-pos dark:text-money-posDark')}
            >
              {signed(monthNet)}
            </span>
          </span>
          {today.slice(0, 7) === month && (
            <span className="text-sm text-brand-500 dark:text-brand-400">
              Safe-to-Spend now <span className="font-mono tabular-nums">{fmt(safeToSpend)}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setPasteOpen(true)}>
            Paste from Google Sheets
          </Button>
          <Button variant="outline" size="sm" disabled={!prev} onClick={() => prev && setSelectedId(prev.id)} aria-label="Previous month">
            ‹ {format(parseISO(`${monthIndex(-1)}-01`), 'MMM')}
          </Button>
          <Button variant="outline" size="sm" disabled={!next} onClick={() => next && setSelectedId(next.id)} aria-label="Next month">
            {format(parseISO(`${monthIndex(1)}-01`), 'MMM')} ›
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAddRequest({ date: addDate, at: Date.now() })}>
            + Add
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2">
        {shown.map(({ half, plan, isSeed, summary }, i) => (
          <div key={half.id} className={cn('min-w-0', i === 0 && 'border-r border-brand-300 dark:border-brand-600')}>
            <HalfSheet
              half={half}
              plan={plan}
              isSeed={isSeed}
              summary={summary}
              today={today}
              addRequest={addRequest && addRequest.date >= half.start && addRequest.date <= half.end ? addRequest : undefined}
            />
          </div>
        ))}
      </div>
      {pasteDrawer}
    </div>
  );
};

export default PayPeriodSheet;
