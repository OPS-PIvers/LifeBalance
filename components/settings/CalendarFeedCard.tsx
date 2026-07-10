import React, { useState } from 'react';
import { CalendarClock, Copy, RefreshCw, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { generateCalendarFeedToken, getCalendarFeedUrl } from '@/services/calendarFeedService';
import { Button } from '@/components/ui/Button';
import { SurfaceList, Row } from '@/components/ui/Section';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/**
 * "Calendar feed" row in Settings → Data. Lets any member turn on a read-only
 * ICS subscription (`webcal://…`) of the household's unpaid bills, copy the
 * URL, or regenerate the token (rotating it, which invalidates the previous
 * URL for anyone who had it). The token itself lives on the household doc
 * (`Household.calendarFeedToken`) and reaches this component through the
 * normal Firestore listener — `generateCalendarFeedToken` only triggers the
 * server-side write and returns the fresh token immediately so the URL can
 * be shown without waiting on the listener round-trip.
 */
const CalendarFeedCard: React.FC = () => {
  const { householdId, household } = useHouseholdCore();
  const [busy, setBusy] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  // Optimistic token shown immediately after a successful callable response,
  // ahead of the household listener catching up. The listener value (once it
  // arrives) is the source of truth going forward.
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  const token = household?.calendarFeedToken ?? pendingToken ?? null;
  const feedUrl = householdId && token ? getCalendarFeedUrl(householdId, token) : null;

  const handleGenerate = async () => {
    if (!householdId) return;
    setBusy(true);
    try {
      const newToken = await generateCalendarFeedToken(householdId);
      setPendingToken(newToken);
      toast.success(token ? 'Calendar feed regenerated' : 'Calendar feed enabled');
    } catch {
      toast.error('Could not update the calendar feed');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      toast.success('Feed URL copied');
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 px-1">
        Calendar Feed
      </p>
      <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
        Subscribe from Google/Apple Calendar to see your bills on your phone&apos;s calendar.
      </p>

      {feedUrl ? (
        <>
          <SurfaceList>
            <Row
              interactive
              dense
              role="button"
              tabIndex={0}
              onClick={handleCopy}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCopy();
                }
              }}
              aria-label="Copy calendar feed URL"
            >
              <div className="w-10 h-10 rounded-full bg-accent-50 dark:bg-accent-500/15 flex items-center justify-center shrink-0">
                <CalendarClock size={18} className="text-accent-600 dark:text-accent-300" />
              </div>
              <span className="flex-1 min-w-0 text-xs font-mono text-brand-600 dark:text-brand-300 truncate">
                {feedUrl}
              </span>
              <Copy className="w-3.5 h-3.5 text-brand-400 dark:text-brand-450 shrink-0" />
            </Row>
          </SurfaceList>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirmRegenerate(true)}
            leftIcon={<RefreshCw className="w-4 h-4" />}
            isLoading={busy}
          >
            Regenerate
          </Button>
          <div className="flex items-start gap-2 px-1">
            <AlertTriangle className="w-4 h-4 text-warm-600 dark:text-warm-300 shrink-0 mt-0.5" />
            <p className="text-xs text-brand-500 dark:text-brand-400">
              Anyone with this link can see your bill calendar — regenerate to revoke it.
            </p>
          </div>
        </>
      ) : (
        <Button
          variant="secondary"
          onClick={handleGenerate}
          leftIcon={<CalendarClock className="w-4 h-4" />}
          isLoading={busy}
          className="w-full"
        >
          Enable calendar feed
        </Button>
      )}

      <ConfirmDialog
        isOpen={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        onConfirm={async () => {
          await handleGenerate();
          setConfirmRegenerate(false);
        }}
        isConfirming={busy}
        title="Regenerate calendar feed?"
        confirmLabel="Regenerate"
        message="The old feed URL will stop working immediately. Any calendar apps subscribed to it will need the new link."
      />
    </div>
  );
};

export default CalendarFeedCard;
