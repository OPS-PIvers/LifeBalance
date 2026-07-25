import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useFinance, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useMerchantRules } from '@/hooks/useMerchantRules';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { getSessionBaseline } from '@/utils/lastVisit';
import { selectPartnerActivity, partnerNames } from '@/utils/partnerActivity';

/**
 * PartnerActivityWidget — the "since you were here" moment (impeccable r5).
 *
 * LifeBalance is a household app, but the second adult never gets a designed
 * moment of discovering what their partner did — a transaction someone else
 * added is only ever an undifferentiated row in a list. This warm, dismissible
 * card greets the viewer with the attributed spending their housemates added
 * since this device last opened the app ("Jordan added Costco · $120").
 *
 * - "Last visit" is a per-device localStorage timestamp (utils/lastVisit): the
 *   baseline is captured once at mount, then advanced to now, so each open shows
 *   only what's new since the previous one. A first-ever visit shows nothing.
 * - Attribution comes from `Transaction.createdBy`; only attributed, above-
 *   threshold, non-income spend from OTHER members is surfaced (utils/
 *   partnerActivity). The viewer's own actions are always filtered out.
 * - Empty → renders nothing (no empty state — it's a note from the household,
 *   not a persistent panel).
 */
export const PartnerActivityWidget: React.FC = () => {
  const { currentUser, members } = useHouseholdCore();
  const { transactions } = useFinance();
  const { isModuleEnabled } = useModuleVisibility();
  const fmt = useFormatCurrency();
  // Friendly merchant name (household rules, display-time only). Applied when
  // each row renders rather than inside the `items` memo below, so a rule saved
  // on another device relabels this digest without re-selecting the activity.
  const { displayNameFor } = useMerchantRules();

  // Capture the previous visit ONCE per app session and advance the marker.
  // getSessionBaseline is module-cached, so StrictMode's remount (and any later
  // Dashboard remount this session) gets the SAME frozen baseline instead of
  // re-reading the "just now" value the first mount wrote.
  const [baselineVisit] = useState<string | null>(() => getSessionBaseline(new Date().toISOString()));
  const [dismissed, setDismissed] = useState(false);

  const items = useMemo(
    () =>
      selectPartnerActivity({
        transactions,
        members,
        lastVisitISO: baselineVisit,
        currentMemberId: currentUser?.uid,
      }),
    [transactions, members, baselineVisit, currentUser?.uid]
  );

  // Money module off → nothing to show (these are transactions). Empty digest or
  // dismissed → render nothing; this is a greeting, not a standing panel.
  if (!isModuleEnabled('money') || dismissed || items.length === 0) return null;

  const names = partnerNames(items);
  const who =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names[0]} and ${names.length - 1} others`;

  return (
    <Section
      title="Since you were here"
      action={
        <button
          onClick={() => setDismissed(true)}
          className="flex items-center justify-center min-h-11 min-w-11 -m-3 text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 rounded-full focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
          aria-label="Dismiss household activity"
        >
          <X size={16} />
        </button>
      }
    >
      <SurfaceList>
        {/* Warm household lead-in — a note from the house, not an audit header. */}
        <Row className="bg-warm-50/60 dark:bg-warm-500/10">
          <p className="text-sm text-brand-700 dark:text-brand-200">
            <span className="font-semibold text-warm-700 dark:text-warm-300">{who}</span>{' '}
            {names.length === 1 ? 'was' : 'were'} busy while you were away.
          </p>
        </Row>
        {items.map(item => {
          const initial = item.memberName.trim().charAt(0).toUpperCase() || '?';
          return (
            <Row key={item.id} className="justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-warm-100 text-warm-700 dark:bg-warm-500/20 dark:text-warm-200 font-display text-sm font-semibold"
                  aria-hidden="true"
                >
                  {initial}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-800 dark:text-brand-100 truncate max-w-[160px] md:max-w-[240px]">
                    {displayNameFor(item)}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <p className="text-xxs font-medium text-brand-400 dark:text-brand-450 truncate max-w-[110px]">
                      {item.memberName} added
                    </p>
                    <span className="w-1 h-1 rounded-full bg-brand-300 dark:bg-brand-600" aria-hidden="true" />
                    <p className="text-xxs text-brand-400 dark:text-brand-450 font-medium">
                      {formatDistanceToNow(parseISO(item.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </div>
              <span className="font-mono font-bold tabular-nums text-brand-900 dark:text-brand-50 text-sm shrink-0">
                {fmt(item.amount, { decimals: 0 })}
              </span>
            </Row>
          );
        })}
      </SurfaceList>
    </Section>
  );
};

PartnerActivityWidget.displayName = 'PartnerActivityWidget';
