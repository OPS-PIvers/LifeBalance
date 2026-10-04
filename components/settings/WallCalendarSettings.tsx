import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db, getFunctionsInstance } from '@/firebase.config';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import SectionHeading from '@/components/ui/SectionHeading';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { requestDeleteConfirmation } from '@/components/ui/confirmDialogStore';
import { syncWallCalendarsNow } from '@/components/wall/wallCalendarService';
import { wallCalendarFeedConverter } from '@/utils/firestoreConverters';
import { buildMemberColorMap, memberColorFor } from '@/utils/memberColors';
import { feedStatus } from '@/utils/wall/wallSettingsView';
import type { HouseholdMember, WallCalendarFeed, WallSettings } from '@/types/schema';

interface WallCalendarSettingsProps {
  householdId: string;
  isAdmin: boolean;
  members: HouseholdMember[];
  settings: WallSettings;
  onSave: (patch: Partial<WallSettings>) => Promise<void>;
}

interface FeedForm {
  /** The feed being edited, or null when adding. */
  feedId: string | null;
  url: string;
  label: string;
  ownerKey: string;
}

const EMPTY_FORM: FeedForm = { feedId: null, url: '', label: '', ownerKey: 'family' };

async function callable<Req, Res>(name: string, data: Req): Promise<Res> {
  const [{ httpsCallable }, functions] = await Promise.all([import('firebase/functions'), getFunctionsInstance()]);
  const { data: result } = await httpsCallable<Req, Res>(functions, name)(data);
  return result;
}

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.');

const TONE_CLASS = {
  ok: 'text-brand-500 dark:text-brand-400',
  error: 'text-warm-700 dark:text-warm-300',
  stale: 'text-money-neg',
} as const;

/**
 * Settings → Wall display → Calendars (docs/plans/wall-display-kiosk.md §5.2).
 * Admins add, edit and remove calendar links (all through Cloud Functions:
 * a link is a credential and is never readable from the client); everyone
 * can see the feeds' health, toggle holidays and bills, and sync now.
 */
const WallCalendarSettings: React.FC<WallCalendarSettingsProps> = ({ householdId, isAdmin, members, settings, onSave }) => {
  const [feeds, setFeeds] = useState<WallCalendarFeed[]>([]);
  const [form, setForm] = useState<FeedForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!householdId) return undefined;
    return onSnapshot(
      collection(db, `households/${householdId}/calendarFeeds`).withConverter(wallCalendarFeedConverter),
      snap =>
        setFeeds(
          snap.docs
            .map(d => d.data())
            // Your own calendars first, the built-in holidays last.
            .sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'holidays' ? 1 : -1))
        ),
      error => console.error('[calendarFeeds] listener failed:', error)
    );
  }, [householdId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const colors = useMemo(() => buildMemberColorMap(members), [members]);
  const ownerName = (key: string) =>
    key === 'family' ? 'Family' : members.find(m => m.uid === key)?.displayName ?? 'Someone who left';

  const submit = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (form.feedId) {
        await callable('updatewallcalendarfeed', {
          householdId,
          feedId: form.feedId,
          label: form.label,
          ownerKey: form.ownerKey,
          ...(form.url.trim() ? { url: form.url.trim() } : {}),
        });
        toast.success('Calendar updated');
      } else {
        const { eventCount } = await callable<object, { eventCount: number }>('addwallcalendarfeed', {
          householdId,
          url: form.url.trim(),
          label: form.label,
          ownerKey: form.ownerKey,
        });
        toast.success(`Calendar added: ${eventCount} ${eventCount === 1 ? 'event' : 'events'}`);
      }
      setForm(EMPTY_FORM);
    } catch (e) {
      setFormError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = (feed: WallCalendarFeed) => {
    requestDeleteConfirmation({
      itemName: 'calendar',
      title: `Remove ${feed.label}?`,
      message: 'Its events disappear from the wall. The calendar itself is not changed.',
      confirmLabel: 'Remove',
      onConfirm: async () => {
        await callable('removewallcalendarfeed', { householdId, feedId: feed.id });
        if (form.feedId === feed.id) setForm(EMPTY_FORM);
      },
    });
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const { failed } = await syncWallCalendarsNow(householdId);
      if (failed > 0) toast.error(`${failed} calendar${failed === 1 ? '' : 's'} couldn't be read.`);
      else toast.success('Calendars synced');
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSyncing(false);
    }
  };

  const editing = form.feedId !== null;

  return (
    <Section title="Calendars">
      <SurfaceList>
        {feeds.map(feed => {
          const status = feedStatus(feed, now);
          const color = feed.ownerKey === 'family' ? undefined : memberColorFor(colors, feed.ownerKey);
          return (
            <Row key={feed.id} className="flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm truncate">{feed.label}</p>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white bg-brand-500"
                    style={color ? { backgroundColor: color } : undefined}
                  >
                    {ownerName(feed.ownerKey)}
                  </span>
                </div>
                <p className={`text-xs ${TONE_CLASS[status.tone]}`}>{status.text}</p>
              </div>
              {isAdmin && feed.kind === 'ics' && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFormError('');
                      setForm({ feedId: feed.id, url: '', label: feed.label, ownerKey: feed.ownerKey });
                    }}
                  >
                    Edit
                  </Button>
                  <Button variant="ghost-danger" size="sm" onClick={() => remove(feed)}>
                    Remove
                  </Button>
                </div>
              )}
            </Row>
          );
        })}
        {feeds.length === 0 && (
          <Row>
            <p className="text-sm text-brand-500 dark:text-brand-400">No calendars yet.</p>
          </Row>
        )}
        <Row className="flex-wrap">
          <p className="flex-1 min-w-0 text-sm font-semibold text-brand-900 dark:text-brand-100">US holidays</p>
          <SegmentedControl
            name="US holidays"
            size="sm"
            options={[
              { value: 'on', label: 'Show' },
              { value: 'off', label: 'Hide' },
            ]}
            value={settings.holidaysEnabled ? 'on' : 'off'}
            onChange={v => void onSave({ holidaysEnabled: v === 'on' })}
          />
        </Row>
        <Row className="flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Bills on calendar</p>
            <p className="text-xs text-brand-500 dark:text-brand-400">Names only, never amounts</p>
          </div>
          <SegmentedControl
            name="Bills on calendar"
            size="sm"
            options={[
              { value: 'on', label: 'Show' },
              { value: 'off', label: 'Hide' },
            ]}
            value={settings.showBills ? 'on' : 'off'}
            onChange={v => void onSave({ showBills: v === 'on' })}
          />
        </Row>
      </SurfaceList>

      <div className="mt-3 px-1 flex items-center justify-between gap-3">
        <p className="text-xs text-brand-500 dark:text-brand-400">Calendars sync every 15 minutes.</p>
        <Button variant="secondary" size="sm" onClick={() => void syncNow()} isLoading={syncing}>
          Sync now
        </Button>
      </div>

      {isAdmin && (
        <form
          className="mt-4 space-y-3"
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <SectionHeading
            as="h3"
            className="px-1"
            description="Google: the calendar's settings → “Secret address in iCal format”. iCloud: share the calendar as a Public Calendar and copy its link. Schools and teams: their “Subscribe” or iCal link."
          >
            {editing ? `Edit ${form.label || 'calendar'}` : 'Add a calendar link'}
          </SectionHeading>
          <Input
            label={editing ? 'New link (leave empty to keep the current one)' : 'Calendar link'}
            inputMode="url"
            autoComplete="off"
            placeholder="https://… or webcal://…"
            value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <Input label="Name" maxLength={40} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="flex-1">
              <Select label="Whose" value={form.ownerKey} onChange={e => setForm(f => ({ ...f, ownerKey: e.target.value }))}>
                <option value="family">Family</option>
                {members.map(m => (
                  <option key={m.uid} value={m.uid}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {formError && (
            <p role="alert" className="text-sm text-money-neg px-1">
              {formError}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            {editing && (
              <Button type="button" variant="ghost" onClick={() => setForm(EMPTY_FORM)}>
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              isLoading={saving}
              disabled={!form.label.trim() || (!editing && !form.url.trim())}
            >
              {editing ? 'Save' : 'Add calendar'}
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
};

export default WallCalendarSettings;
