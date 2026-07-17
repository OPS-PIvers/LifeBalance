import React from 'react';
import { formatDistanceToNow, parseISO, isValid } from 'date-fns';
import { History, Dumbbell, Wallet, ListChecks, ShoppingCart, UtensilsCrossed, Users } from 'lucide-react';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import EmptyState from '@/components/ui/EmptyState';
import type { ActivityDomain, ActivityLogEntry } from '@/types/schema';
import { cn } from '@/utils/cn';

/**
 * Household activity log / audit trail (F-XCUT-01) — a chronological,
 * cross-domain "who did what when" feed rendered in Settings → Household.
 *
 * Read visibility is gated to admins by the caller (mirrors the `removeMember`
 * admin gate) to respect member privacy, especially for managed kid profiles.
 * This component is presentation-only; it renders whatever bounded window the
 * context's `activityLog` slice provides (newest first).
 */

const DOMAIN_ICON: Record<ActivityDomain, React.ReactNode> = {
  habit: <Dumbbell size={16} />,
  money: <Wallet size={16} />,
  todo: <ListChecks size={16} />,
  shopping: <ShoppingCart size={16} />,
  meal: <UtensilsCrossed size={16} />,
  member: <Users size={16} />,
};

const DOMAIN_TINT: Record<ActivityDomain, string> = {
  habit: 'text-habit-blue dark:text-habit-blue',
  money: 'text-money-pos dark:text-money-posDark',
  todo: 'text-accent-600 dark:text-accent-400',
  shopping: 'text-warm-600 dark:text-warm-300',
  meal: 'text-warm-600 dark:text-warm-300',
  member: 'text-brand-500 dark:text-brand-400',
};

function relativeTime(iso: string): string {
  const d = parseISO(iso);
  if (!isValid(d)) return '';
  return formatDistanceToNow(d, { addSuffix: true });
}

export interface ActivityLogCardProps {
  activityLog: ActivityLogEntry[];
}

const ActivityLogCard: React.FC<ActivityLogCardProps> = ({ activityLog }) => (
  <Section title="Activity Log">
    <div className="space-y-2">
      <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
        A private feed of recent household activity across habits, money, lists and more.
        Only admins can see this.
      </p>
      {activityLog.length === 0 ? (
        <EmptyState
          variant="surface"
          size="compact"
          icon={<History size={20} />}
          title="No activity yet"
          description="Actions like paying a bill or completing a habit will show up here."
        />
      ) : (
        <SurfaceList>
          {activityLog.map((entry) => (
            <Row key={entry.id} dense>
              <span className={cn('shrink-0', DOMAIN_TINT[entry.domain] ?? 'text-brand-500')}>
                {DOMAIN_ICON[entry.domain] ?? <History size={16} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-brand-900 dark:text-brand-50">
                  {entry.summary}
                </span>
              </span>
              {/* dark:brand-450 (not 500): brand-500 on the brand-800 card is 3.56:1;
                  brand-450 is 4.95:1 — the timestamp is small text so it needs 4.5. */}
              <span className="shrink-0 text-xs text-brand-400 dark:text-brand-450 tabular-nums">
                {relativeTime(entry.timestamp)}
              </span>
            </Row>
          ))}
        </SurfaceList>
      )}
    </div>
  </Section>
);

export default ActivityLogCard;
