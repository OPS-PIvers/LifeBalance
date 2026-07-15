import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { useFinance, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { usePlaidEnabled } from '@/hooks/usePlaidEnabled';
import { track } from '@/services/analytics';
import { cn } from '@/utils/cn';
import { Section, SurfaceList, DisclosureRow } from '@/components/ui/Section';
import { computeSetupChecklistItems, isSetupChecklistComplete } from '@/utils/setupChecklist';

/** How long after first render the card keeps showing itself, even if items remain undone. */
const AUTO_HIDE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const dismissKey = (householdId: string) => `lb_setup_checklist_dismissed_${householdId}`;
const firstSeenKey = (householdId: string) => `lb_setup_checklist_first_seen_${householdId}`;

/**
 * Reads (and lazily seeds) the "first seen" timestamp for this household's
 * checklist, used purely to auto-hide the card ~2 weeks after a household
 * first encounters it. `Household` has no `onboardingComplete` timestamp to
 * anchor on, so this stands in for one — localStorage (not Firestore), since
 * it's advisory UI state only.
 */
function getOrSeedFirstSeen(householdId: string): number {
  try {
    const existing = window.localStorage.getItem(firstSeenKey(householdId));
    if (existing) {
      const parsed = Number(existing);
      if (Number.isFinite(parsed)) return parsed;
    }
    const now = Date.now();
    window.localStorage.setItem(firstSeenKey(householdId), String(now));
    return now;
  } catch {
    return Date.now();
  }
}

function readDismissed(householdId: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(householdId)) === '1';
  } catch {
    return false;
  }
}

function persistDismiss(householdId: string): void {
  try {
    window.localStorage.setItem(dismissKey(householdId), '1');
  } catch {
    // Best-effort — in-session state still hides the card.
  }
}

/** Whether the auto-hide window has elapsed since first seen (module helper,
 *  matching `WeeklyRecapCard`'s `shouldShowCard` idiom, so the impure clock
 *  read isn't inlined directly in the component body). */
function isPastAutoHideWindow(firstSeenAt: number): boolean {
  return Date.now() - firstSeenAt > AUTO_HIDE_WINDOW_MS;
}

/**
 * Dismissible activation-depth checklist card (F-PLAT-03). Surfaces a few
 * high-value setup actions the onboarding wizard doesn't cover — connect a
 * bank (when Plaid is enabled), enable push notifications, add a budget
 * bucket, invite a second member. Everything is derived from existing
 * context/browser state, no new Firestore fields. Self-clears once every
 * item is done, once dismissed, or after ~2 weeks.
 */
export const SetupChecklistCard: React.FC = () => {
  const navigate = useNavigate();
  const { householdId, members } = useHouseholdCore();
  const { buckets, accounts } = useFinance();
  const plaidEnabled = usePlaidEnabled();

  // Session-level dismissal; persisted copy is read via `readDismissed` so a
  // re-mount (e.g. route change) stays hidden without waiting for state.
  const [sessionDismissed, setSessionDismissed] = useState(false);

  const notificationsEnabled = 'Notification' in window && Notification.permission === 'granted';
  const plaidConnected = (accounts ?? []).some(
    (account) => account.plaidBalanceUpdatedAt !== undefined
  );

  const items = useMemo(
    () =>
      computeSetupChecklistItems({
        hasBucket: buckets.length > 0,
        notificationsEnabled,
        hasSecondMember: members.length > 1,
        plaidEnabled,
        plaidConnected,
      }),
    [buckets.length, notificationsEnabled, members.length, plaidEnabled, plaidConnected]
  );

  // Fire `setup_checklist_item_completed` exactly once per item, the moment it
  // transitions from undone to done (not on every render/click).
  const previousDoneRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const nowDone = new Set(items.filter((item) => item.done).map((item) => item.id));
    for (const id of nowDone) {
      if (!previousDoneRef.current.has(id) && previousDoneRef.current.size > 0) {
        track('setup_checklist_item_completed', { item: id });
      }
    }
    previousDoneRef.current = nowDone;
  }, [items]);

  if (!householdId) return null;
  if (sessionDismissed || readDismissed(householdId)) return null;
  if (isSetupChecklistComplete(items)) return null;

  const firstSeenAt = getOrSeedFirstSeen(householdId);
  if (isPastAutoHideWindow(firstSeenAt)) return null;

  const dismiss = () => {
    persistDismiss(householdId);
    setSessionDismissed(true);
  };

  return (
    <Section
      title="Finish setting up"
      action={
        <button
          onClick={dismiss}
          className="p-1 min-h-6 text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300"
          aria-label="Dismiss setup checklist"
        >
          <X size={16} />
        </button>
      }
    >
      <SurfaceList>
        {items.map((item) => (
          <DisclosureRow
            key={item.id}
            icon={
              item.done ? (
                <CheckCircle2
                  size={20}
                  className="text-accent-600 dark:text-accent-400"
                  aria-hidden="true"
                />
              ) : (
                <Circle size={20} className="text-brand-300 dark:text-brand-600" aria-hidden="true" />
              )
            }
            title={
              <span className={cn(item.done && 'line-through text-brand-400 dark:text-brand-500')}>
                {item.title}
              </span>
            }
            subtitle={item.done ? undefined : item.description}
            onClick={() => navigate(item.route)}
          />
        ))}
      </SurfaceList>
    </Section>
  );
};
