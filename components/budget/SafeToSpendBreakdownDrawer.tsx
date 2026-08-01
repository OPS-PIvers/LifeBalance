import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useMerchantRules } from '@/hooks/useMerchantRules';
import { useFormatCurrency, useHouseholdCurrency } from '@/hooks/useFormatCurrency';
import { Drawer } from '@/components/ui/Drawer';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import ProgressBar from '@/components/ui/ProgressBar';
import { cn } from '@/utils/cn';
import { computeSafeToSpendDistribution } from '@/utils/safeToSpendDistribution';
import { getBucketSpendTransactions } from '@/utils/bucketSpentCalculator';
import { calculateDailyPace, calculateBucketDailyPace, getDaysLeft } from '@/utils/spendPace';
import { splitCurrencyParts } from '@/utils/currencyParts';

/** Fill color by spend ratio — same ramp as BudgetHistory's bucket drawer. */
const progressColor = (spent: number, limit: number) => {
  if (limit === 0) return 'bg-money-neg';
  const ratio = spent / limit;
  if (ratio >= 1) return 'bg-money-neg';
  if (ratio >= 0.85) return 'bg-warm-500';
  return 'bg-money-pos';
};

/** `yyyy-MM-dd` → "Jul 14". Falls back to the raw string on an unparseable date. */
const shortDate = (iso: string): string => {
  const parsed = parseISO(iso);
  return Number.isNaN(parsed.getTime()) ? iso : format(parsed, 'MMM d');
};

/**
 * Plan 016 — Safe-to-Spend breakdown drawer, opened by tapping the toolbar
 * Safe-to-Spend figure.
 *
 * Model = "pool + tracking overlay": checking is one pool and all of it is safe
 * to spend. Buckets do NOT reserve against or reduce Safe-to-Spend — they are a
 * tracking overlay that shows WHERE the pool is nominally allocated. This drawer
 * decomposes:
 *
 *   Safe to Spend = Σ max(0, bucket remaining) + Unallocated (leftover)
 *
 * The drawer is the metric's editorial moment. The figure gets a magazine-scale
 * Besley treatment (a big ink integer with a smaller, muted currency symbol +
 * cents), and the decomposition beneath reads as a bank-ledger statement —
 * hairline-ruled rows, mono/tabular figures — rather than a generic icon-chip
 * stat list. Presentation only: all math lives in
 * {@link computeSafeToSpendDistribution}. Default export so it can be
 * React.lazy-loaded (keeping the Drawer/framer-motion off the boot bundle).
 *
 * EVERY line that stands for a sum of things expands in place to itemize it —
 * unpaid bills, pending transactions, each bucket's spend, and the
 * leftover/over-allocated closing line. The itemizations are not re-derived
 * here: `unpaidBillItems` / `pendingTransactions` come off the breakdown itself
 * (one filter produces both the total and its list), and the bucket lists come
 * from `getBucketSpendTransactions`, which mirrors the spent math's exclusions.
 * A row with nothing to show is rendered inert — no chevron, no tap that opens
 * an empty panel.
 */
interface SafeToSpendBreakdownDrawerProps {
  open: boolean;
  onClose: () => void;
}

/** Only one panel is open at a time — a bottom sheet has no room for more. */
type PanelKey = string | null;

const SafeToSpendBreakdownDrawer: React.FC<SafeToSpendBreakdownDrawerProps> = ({ open, onClose }) => {
  const {
    safeToSpendBreakdown: breakdown,
    buckets,
    bucketSpentMap,
    transactions,
    currentPeriodId,
  } = useFinance();
  const { displayNameFor } = useMerchantRules();
  const currency = useHouseholdCurrency();
  const fmt = useFormatCurrency();
  const [openPanel, setOpenPanel] = useState<PanelKey>(null);

  const togglePanel = (key: string) => setOpenPanel(current => (current === key ? null : key));

  const distribution = useMemo(
    () => (breakdown ? computeSafeToSpendDistribution(breakdown, buckets, bucketSpentMap) : null),
    [breakdown, buckets, bucketSpentMap]
  );

  // One pass over transactions for every bucket, rather than a filter per row.
  const bucketTransactions = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getBucketSpendTransactions>>();
    buckets.forEach(b => {
      map.set(b.id, getBucketSpendTransactions(b.name, transactions, currentPeriodId));
    });
    return map;
  }, [buckets, transactions, currentPeriodId]);

  const daysLeft = useMemo(
    () => (breakdown ? getDaysLeft(breakdown.nextPaycheckDate) : null),
    [breakdown]
  );

  const dailyPace = useMemo(
    () => (breakdown ? calculateDailyPace(breakdown) : null),
    [breakdown]
  );

  // Guard: no breakdown yet (cold load) → render nothing (mirrors SafeToSpendDetail).
  if (breakdown === undefined || distribution === null) return null;

  const { rows, claimed, leftover, overAllocated } = distribution;
  const parts = splitCurrencyParts(breakdown.safeToSpend, currency);
  const { negative } = parts;

  // Bills dated before the paycheck that opened this period are carry-over from
  // the previous one (the 1-month overdue lookback) — they read as owed, not as
  // "due soon", so the list calls them out.
  const billItems = breakdown.unpaidBillItems ?? [];
  const pendingItems = breakdown.pendingTransactions ?? [];

  // Editorial caption under the hero figure. When a next paycheck is known we
  // reuse the exact pace string that previously sat below the waterfall (copy
  // unchanged, just relocated); otherwise a neutral sentence-case descriptor
  // that only appears when the pace line was already hidden.
  const caption = negative
    ? 'Spending has outrun this paycheck'
    : dailyPace !== null
      ? `≈ ${fmt(dailyPace)}/day until payday`
      : 'Available before your next paycheck';

  const heroTone = negative
    ? 'text-money-neg dark:text-money-negDark'
    : 'text-brand-900 dark:text-brand-50';
  const heroMuted = negative
    ? 'text-money-neg dark:text-money-negDark'
    : 'text-brand-400 dark:text-brand-450';

  const claimingRows = rows.filter(r => r.claim > 0).sort((a, b) => b.claim - a.claim);
  const overspentRows = rows.filter(r => r.isOver);

  return (
    <Drawer isOpen={open} onClose={onClose} title="Safe to spend">
      <div className="flex flex-col gap-5">
        {/* Editorial hero — the metric's signature moment. Type + spacing only:
            a magazine-scale Besley integer, a smaller muted symbol + cents, and
            a single broadsheet hairline rule beneath. No box, no shadow. */}
        <div className="border-b border-brand-200 dark:border-brand-700 pb-5">
          <div className="flex items-start gap-0.5">
            <span
              className={cn(
                'font-display font-medium leading-none tracking-tight text-2xl mt-2',
                heroMuted
              )}
            >
              {negative ? '−' : ''}
              {parts.symbolFirst ? parts.symbol : ''}
            </span>
            <span
              className={cn(
                'font-display font-semibold leading-none tracking-tight tabular-nums text-6xl',
                heroTone
              )}
            >
              {parts.integer}
            </span>
            <span
              className={cn(
                'font-display font-medium leading-none tracking-tight tabular-nums text-2xl mt-2',
                heroMuted
              )}
            >
              {parts.decimalSeparator}
              {parts.fraction}
              {!parts.symbolFirst ? ` ${parts.symbol}` : ''}
            </span>
          </div>
          <p className="mt-3 text-sm font-medium text-brand-500 dark:text-brand-400">{caption}</p>
        </div>

        {/* 1. Ledger — how the pool is computed. */}
        <Section title="How it's calculated">
          <SurfaceList>
            <LedgerRow
              label="Checking balance"
              sub="Available cash"
              value={fmt(breakdown.checkingBalance)}
            />

            <LedgerRow
              panelKey="bills"
              openPanel={openPanel}
              onToggle={togglePanel}
              itemCount={billItems.length}
              label="Unpaid bills this period"
              sub="Due before your next paycheck"
              value={breakdown.unpaidBills >= 0.005 ? `− ${fmt(breakdown.unpaidBills)}` : fmt(0)}
              negative={breakdown.unpaidBills >= 0.005}
            >
              {billItems.map(item => {
                const overdue = Boolean(currentPeriodId) && item.date < currentPeriodId;
                return (
                  <DetailLine
                    key={item.id}
                    title={item.title}
                    meta={
                      <>
                        {shortDate(item.date)}
                        {overdue && (
                          <>
                            {' · '}
                            <span className="font-semibold text-money-neg dark:text-money-negDark">
                              Overdue
                            </span>
                          </>
                        )}
                      </>
                    }
                    value={fmt(item.amount)}
                  />
                );
              })}
              <PanelFooter
                label={`${billItems.length} ${billItems.length === 1 ? 'bill' : 'bills'} still to pay`}
                value={fmt(breakdown.unpaidBills)}
              />
            </LedgerRow>

            <LedgerRow
              panelKey="pending"
              openPanel={openPanel}
              onToggle={togglePanel}
              itemCount={pendingItems.length}
              label="Pending transactions"
              sub="Spent but not yet cleared"
              value={breakdown.pendingSpend >= 0.005 ? `− ${fmt(breakdown.pendingSpend)}` : fmt(0)}
              negative={breakdown.pendingSpend >= 0.005}
            >
              {pendingItems.map(tx => (
                <DetailLine
                  key={tx.id}
                  title={displayNameFor(tx)}
                  meta={`${shortDate(tx.date)}${tx.category ? ` · ${tx.category}` : ''}`}
                  value={fmt(tx.amount)}
                />
              ))}
              <PanelFooter
                label={`${pendingItems.length} awaiting review`}
                value={fmt(breakdown.pendingSpend)}
              />
            </LedgerRow>

            <Row className="justify-between bg-brand-50 dark:bg-brand-700/30">
              <span className="font-display text-sm font-semibold tracking-tight text-brand-800 dark:text-brand-100">
                Safe to Spend
              </span>
              <span className="stat-num text-base font-bold text-brand-900 dark:text-brand-50">
                {fmt(breakdown.safeToSpend)}
              </span>
            </Row>
          </SurfaceList>
        </Section>

        {/* 2. Distribution across buckets + leftover. */}
        <Section title="Where it's allocated">
          <SurfaceList>
            {rows.map(row => {
              const percent =
                row.limit > 0 ? Math.max(0, (row.spent / row.limit) * 100) : 100;
              const bucketPace = calculateBucketDailyPace(row.remaining, daysLeft);
              const txs = bucketTransactions.get(row.id) ?? [];
              const panelKey = `bucket:${row.id}`;
              const expanded = openPanel === panelKey;
              const panelId = `sts-panel-${panelKey}`;

              const body = (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-brand-800 dark:text-brand-100">
                      {row.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span
                        className={cn(
                          'stat-num text-sm font-semibold',
                          row.isOver
                            ? 'text-money-neg dark:text-money-negDark'
                            : 'text-brand-700 dark:text-brand-200'
                        )}
                      >
                        {fmt(row.remaining)}
                      </span>
                      {txs.length > 0 && <Chevron expanded={expanded} />}
                    </span>
                  </div>
                  <ProgressBar
                    value={percent}
                    className="h-1.5 bg-brand-100 dark:bg-brand-700"
                    barClassName={progressColor(row.spent, row.limit)}
                    ariaLabel={`${row.name}: ${Math.round(percent)}% of ${fmt(row.limit)} spent`}
                  />
                  <div className="flex justify-between text-xxs text-brand-400 dark:text-brand-450">
                    <span>
                      {fmt(row.spent)} of {fmt(row.limit)} spent
                    </span>
                    <span className={row.isOver ? 'text-money-neg dark:text-money-negDark' : ''}>
                      {row.isOver
                        ? 'Over budget'
                        : bucketPace !== null
                          ? `${fmt(bucketPace)}/day until payday`
                          : 'Remaining'}
                    </span>
                  </div>
                </>
              );

              // A bucket with no spend this period has nothing to itemize, so it
              // stays an inert row rather than a tap that opens an empty panel.
              if (txs.length === 0) {
                return (
                  <Row key={row.id} className="flex-col items-stretch gap-1.5">
                    {body}
                  </Row>
                );
              }

              return (
                <React.Fragment key={row.id}>
                  <button
                    type="button"
                    onClick={() => togglePanel(panelKey)}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    className={cn(
                      'flex w-full flex-col items-stretch gap-1.5 px-4 py-3.5 text-left hairline-divider',
                      'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                      'hover:bg-brand-50 dark:hover:bg-brand-700/40',
                      'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset'
                    )}
                  >
                    {body}
                  </button>
                  {expanded && (
                    <DetailPanel id={panelId}>
                      {txs.map(tx => (
                        <DetailLine
                          key={tx.id}
                          title={displayNameFor(tx)}
                          meta={`${shortDate(tx.date)} · ${
                            tx.status === 'pending_review' ? 'Pending' : 'Approved'
                          }`}
                          value={fmt(tx.amount)}
                        />
                      ))}
                      <PanelFooter
                        label={`${txs.length} ${txs.length === 1 ? 'transaction' : 'transactions'} · ${fmt(row.limit)} limit`}
                        value={`${fmt(row.spent)} spent`}
                      />
                    </DetailPanel>
                  )}
                </React.Fragment>
              );
            })}

            {/* Leftover / over-allocated row — the ledger's closing line. */}
            <LedgerRow
              panelKey="leftover"
              openPanel={openPanel}
              onToggle={togglePanel}
              // Always expandable: the closing line is an explanation, not a
              // list, so it has something to say even with no buckets at all.
              itemCount={1}
              rowClassName="bg-brand-50 dark:bg-brand-700/30"
              label={overAllocated ? 'Over-allocated' : 'Unallocated'}
              labelClassName="font-display text-sm font-semibold tracking-tight text-brand-800 dark:text-brand-100"
              value={fmt(leftover)}
              valueClassName={cn(
                'text-base font-bold',
                overAllocated
                  ? 'text-money-neg dark:text-money-negDark'
                  : 'text-brand-900 dark:text-brand-50'
              )}
            >
              <DetailLine title="Safe to Spend" value={fmt(breakdown.safeToSpend)} />
              <DetailLine
                title="Claimed by bucket limits"
                meta={
                  overspentRows.length > 0
                    ? `${overspentRows.length} over-budget ${
                        overspentRows.length === 1 ? 'bucket claims' : 'buckets claim'
                      } nothing`
                    : undefined
                }
                value={claimed >= 0.005 ? `− ${fmt(claimed)}` : fmt(0)}
              />
              <PanelFooter
                // "Short by −$138.48" would double the negation, so the
                // shortfall reads as a magnitude under its own label.
                label={overAllocated ? 'Short by' : 'Left unallocated'}
                value={fmt(overAllocated ? Math.abs(leftover) : leftover)}
                negative={overAllocated}
              />

              {claimingRows.length > 0 && (
                <>
                  <p className="pt-2.5 text-xxs font-semibold uppercase tracking-wide text-brand-400 dark:text-brand-450">
                    What&apos;s claiming it
                  </p>
                  {claimingRows.map(r => (
                    <DetailLine
                      key={r.id}
                      title={r.name}
                      meta={`${fmt(r.limit)} limit · ${fmt(r.spent)} spent`}
                      value={fmt(r.claim)}
                    />
                  ))}
                </>
              )}

              <p className="pt-2.5 text-xxs leading-relaxed text-brand-500 dark:text-brand-400">
                {overAllocated
                  ? `Your buckets still expect to spend ${fmt(claimed)} before payday, but only ${fmt(
                      breakdown.safeToSpend
                    )} is left after bills and pending transactions. Trim a bucket limit, or move a bill to the next period, to close the ${fmt(
                      Math.abs(leftover)
                    )} gap.`
                  : `${fmt(leftover)} of your Safe-to-Spend isn't claimed by any bucket limit.`}
              </p>
            </LedgerRow>
          </SurfaceList>

          {overAllocated && (
            <p className="px-1 pt-2 text-xs text-money-neg dark:text-money-negDark">
              Your budgets exceed available cash — trim a bucket.
            </p>
          )}
        </Section>

        {/* Clarifying copy. */}
        <p className="px-1 text-xxs text-brand-400 dark:text-brand-450 leading-relaxed">
          Buckets track where your spending goes — they don&apos;t reduce Safe-to-Spend.
        </p>
      </div>
    </Drawer>
  );
};

/** The disclosure caret shared by every expandable ledger line. */
const Chevron: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <ChevronDown
    size={14}
    aria-hidden="true"
    className={cn(
      'shrink-0 text-brand-400 dark:text-brand-450',
      'transition-transform duration-(--duration-base) ease-(--ease-standard)',
      expanded && 'rotate-180'
    )}
  />
);

/**
 * The inset surface an expanded ledger line drops open. Tinted a step away from
 * the surface so the itemization reads as subordinate to the figure above it.
 */
const DetailPanel: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => (
  <div
    id={id}
    className="hairline-divider bg-brand-50 px-4 py-1.5 dark:bg-brand-700/20 animate-in fade-in slide-in-from-top-2 duration-(--duration-base)"
  >
    {children}
  </div>
);

/** One itemized line inside a `DetailPanel`. */
const DetailLine: React.FC<{
  title: React.ReactNode;
  meta?: React.ReactNode;
  value: string;
}> = ({ title, meta, value }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5">
    <div className="min-w-0">
      <p className="truncate text-xs font-medium text-brand-700 dark:text-brand-200">{title}</p>
      {meta !== undefined && (
        <p className="text-xxs text-brand-400 dark:text-brand-450">{meta}</p>
      )}
    </div>
    <span className="stat-num shrink-0 text-xs font-semibold text-brand-700 dark:text-brand-200">
      {value}
    </span>
  </div>
);

/** The panel's closing total — ties the itemization back to the row's figure. */
const PanelFooter: React.FC<{ label: string; value: string; negative?: boolean }> = ({
  label,
  value,
  negative = false,
}) => (
  <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-brand-200 py-1.5 dark:border-brand-700">
    <span className="min-w-0 truncate text-xxs font-semibold uppercase tracking-wide text-brand-400 dark:text-brand-450">
      {label}
    </span>
    <span
      className={cn(
        'stat-num shrink-0 text-xs font-bold',
        negative
          ? 'text-money-neg dark:text-money-negDark'
          : 'text-brand-800 dark:text-brand-100'
      )}
    >
      {value}
    </span>
  </div>
);

/**
 * A single bank-statement line: description + muted sub on the left, a
 * right-aligned mono figure on the right. No icon chip — the ledger reads as
 * broadsheet type, hierarchy coming from weight + the hairline rule that `Row`
 * draws between lines.
 *
 * Pass `panelKey` + `onToggle` + `children` to make the line expandable; it
 * then renders as a real `<button>` (semantics, focus and keyboard activation
 * come free) with a caret, and drops its children open in a `DetailPanel`.
 * `itemCount === 0` keeps the line inert — a row that would open an empty
 * panel should not look tappable.
 */
const LedgerRow: React.FC<{
  label: string;
  sub?: string;
  value: string;
  negative?: boolean;
  panelKey?: string;
  openPanel?: PanelKey;
  onToggle?: (key: string) => void;
  itemCount?: number;
  rowClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
  children?: React.ReactNode;
}> = ({
  label,
  sub,
  value,
  negative = false,
  panelKey,
  openPanel,
  onToggle,
  itemCount = 0,
  rowClassName,
  labelClassName,
  valueClassName,
  children,
}) => {
  const expandable = Boolean(panelKey && onToggle && itemCount > 0);
  const expanded = expandable && openPanel === panelKey;
  const panelId = `sts-panel-${panelKey}`;

  const content = (
    <>
      <div className="min-w-0">
        <p
          className={cn(
            'truncate text-sm font-medium text-brand-800 dark:text-brand-100',
            labelClassName
          )}
        >
          {label}
        </p>
        {sub && <p className="text-xxs text-brand-400 dark:text-brand-450">{sub}</p>}
      </div>
      <span className="flex shrink-0 items-center gap-1">
        <span
          className={cn(
            'stat-num text-sm font-semibold',
            negative
              ? 'text-money-neg dark:text-money-negDark'
              : 'text-brand-800 dark:text-brand-100',
            valueClassName
          )}
        >
          {value}
        </span>
        {expandable && <Chevron expanded={expanded} />}
      </span>
    </>
  );

  if (!expandable) {
    return <Row className={cn('justify-between gap-3', rowClassName)}>{content}</Row>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => onToggle?.(panelKey as string)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          'flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hairline-divider',
          'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
          'hover:bg-brand-50 dark:hover:bg-brand-700/40',
          'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset',
          rowClassName
        )}
      >
        {content}
      </button>
      {expanded && <DetailPanel id={panelId}>{children}</DetailPanel>}
    </>
  );
};

export default SafeToSpendBreakdownDrawer;
