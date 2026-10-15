import React, { useMemo, useState } from 'react';
import { addMonths, endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, ClipboardPaste } from 'lucide-react';
import { useExpandedCalendarItems, useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Button } from '@/components/ui/Button';
import HalfSheet from '@/components/budget/sheet/HalfSheet';
import SheetPasteDrawer from '@/components/budget/sheet/SheetPasteDrawer';
import { halfOf, halfTitle, halvesBetween } from '@/utils/payPeriodHalves';
import { seedHalfPlan, summarizeHalf } from '@/utils/halfPlan';
import { getLocalDateString } from '@/utils/dateHelpers';
import { cn } from '@/utils/cn';

/** Planning reaches about three months ahead; a little history stays reachable. */
const MONTHS_BACK = 2;
const MONTHS_AHEAD = 3;

/**
 * Money → Sheet: the household's spreadsheet, made of half-months (1st–15th,
 * 16th–end), each funded by the paycheck just before it. On a
 * phone it shows one half at a time; on a wide screen, the month's two halves
 * side by side, like the Google Sheet it replaces. The arrows step a half on
 * a phone and a month on a wide screen.
 */
const PayPeriodSheet: React.FC = () => {
  const { halfPlans, buckets } = useFinance();
  const isWide = useMediaQuery('(min-width: 1024px)');
  const today = getLocalDateString();

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
  const selected = halves.find(h => h.id === (selectedId ?? currentId)) ?? halves[0];

  const bucketIds = useMemo(() => new Set(buckets.map(b => b.id)), [buckets]);

  if (!selected) return null;

  const month = selected.id.slice(0, 7);
  const shown = isWide ? halves.filter(h => h.id.slice(0, 7) === month) : [selected];
  const index = halves.indexOf(selected);

  const step = (direction: 1 | -1) => {
    if (!isWide) {
      const next = halves[index + direction];
      if (next) setSelectedId(next.id);
      return;
    }
    const target = format(addMonths(parseISO(`${month}-01`), direction), 'yyyy-MM');
    const next = halves.find(h => h.id.slice(0, 7) === target);
    if (next) setSelectedId(next.id);
  };
  const canStep = (direction: 1 | -1) =>
    isWide
      ? halves.some(h => (direction === 1 ? h.id.slice(0, 7) > month : h.id.slice(0, 7) < month))
      : !!halves[index + direction];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" aria-label={isWide ? 'Previous month' : 'Previous half'} disabled={!canStep(-1)} onClick={() => step(-1)}>
          <ChevronLeft size={20} />
        </Button>
        <div className="text-center">
          <h2 className="font-display text-xl text-brand-900 dark:text-brand-50">
            {isWide ? format(parseISO(`${month}-01`), 'MMMM yyyy') : halfTitle(selected)}
          </h2>
          {!isWide && (
            <p className="text-xs text-brand-500 dark:text-brand-400">
              {format(parseISO(selected.id), 'MMMM')} · {selected.id.endsWith('-01') ? '1st half' : '2nd half'}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" aria-label={isWide ? 'Next month' : 'Next half'} disabled={!canStep(1)} onClick={() => step(1)}>
          <ChevronRight size={20} />
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {selected.id !== currentId && currentId && (
          <Button variant="link" size="sm" onClick={() => setSelectedId(currentId)}>Back to this half</Button>
        )}
        <Button variant="ghost" size="sm" leftIcon={<ClipboardPaste size={14} />} onClick={() => setPasteOpen(true)}>
          Paste {format(parseISO(`${month}-01`), 'MMMM')} from your sheet
        </Button>
      </div>
      <SheetPasteDrawer
        isOpen={pasteOpen}
        onClose={() => setPasteOpen(false)}
        month={month}
        halves={halves.filter(h => h.id.slice(0, 7) === month)}
        expanded={expanded}
      />

      <div className={cn('grid gap-6', isWide && shown.length > 1 && 'grid-cols-2')}>
        {shown.map(half => {
          const stored = halfPlans.find(p => p.id === half.id);
          // Stable ids for a seed nobody has saved, so its rows don't remount
          // on every render; the first edit saves them as they are.
          let seedLine = 0;
          const plan = stored ?? seedHalfPlan(half.id, halfPlans, () => `${half.id}-seed-${++seedLine}`);
          return (
            <div key={half.id} className="min-w-0">
              {isWide && (
                <h3 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-brand-500 dark:text-brand-400">
                  {halfTitle(half)}
                </h3>
              )}
              <HalfSheet
                half={half}
                plan={plan}
                isSeed={!stored}
                summary={summarizeHalf(half, expanded, plan, bucketIds)}
                isCurrent={half.id === currentId}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PayPeriodSheet;
