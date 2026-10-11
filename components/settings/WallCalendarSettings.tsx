import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db, getFunctionsInstance } from '@/firebase.config';
import { ChevronRight, Plus } from 'lucide-react';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { Drawer } from '@/components/ui/Drawer';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/utils/cn';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { requestDeleteConfirmation } from '@/components/ui/confirmDialogStore';
import { syncWallCalendarsNow } from '@/components/wall/wallCalendarService';
import { wallCalendarFeedConverter } from '@/utils/firestoreConverters';
import { buildMemberColorMap, memberColorFor } from '@/utils/memberColors';
import { feedStatus } from '@/utils/wall/wallSettingsView';
import type { HouseholdMember, WallCalendarFeed, WallSettings, WallTravelMode } from '@/types/schema';

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
  alerts: boolean;
  travelMode: WallTravelMode;
}

const EMPTY_FORM: FeedForm = { feedId: null, url: '', label: '', ownerKey: 'family', alerts: false, travelMode: 'drive' };

const FORM_ID = 'wall-calendar-form';

const TRAVEL_LABELS: Record<WallTravelMode, string> = { drive: 'Drive', walk: 'Walk', bike: 'Bike', transit: 'Transit' };

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
  const [formOpen, setFormOpen] = useState(false);
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
          alerts: form.alerts,
          travelMode: form.travelMode,
          ...(form.url.trim() ? { url: form.url.trim() } : {}),
        });
        toast.success('Calendar updated');
      } else {
        const { eventCount } = await callable<object, { eventCount: number }>('addwallcalendarfeed', {
          householdId,
          url: form.url.trim(),
          label: form.label,
          ownerKey: form.ownerKey,
          alerts: form.alerts,
          travelMode: form.travelMode,
        });
        toast.success(`Calendar added: ${eventCount} ${eventCount === 1 ? 'event' : 'events'}`);
      }
      setFormOpen(false);
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
        if (form.feedId === feed.id) setFormOpen(false);
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
  const editingFeed = editing ? feeds.find(f => f.id === form.feedId) : undefined;
  const calendars = feeds.filter(f => f.kind === 'ics');
  const holidaysFeed = feeds.find(f => f.kind === 'holidays');
  const holidaysStatus = settings.holidaysEnabled && holidaysFeed ? feedStatus(holidaysFeed, now) : null;

  const openEditor = (next: FeedForm) => {
    setFormError('');
    setForm(next);
    setFormOpen(true);
  };
  const closeEditor = () => {
    if (!saving) setFormOpen(false);
  };

  const statusLines = (feed: WallCalendarFeed) => {
    const status = feedStatus(feed, now);
    return (
      <>
        <span className={`block text-xs ${TONE_CLASS[status.tone]}`}>{status.text}</span>
        {feed.alerts && (
          <span className="block text-xs text-brand-500 dark:text-brand-400">
            Starting-soon alerts on · {TRAVEL_LABELS[feed.travelMode ?? 'drive'].toLowerCase()}
          </span>
        )}
      </>
    );
  };

  const titleLine = (feed: WallCalendarFeed) => {
    const color = feed.ownerKey === 'family' ? undefined : memberColorFor(colors, feed.ownerKey);
    return (
      <span className="flex items-center gap-2 min-w-0">
        <span className="font-semibold text-brand-900 dark:text-brand-100 text-sm truncate">{feed.label}</span>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white bg-brand-500"
          style={color ? { backgroundColor: color } : undefined}
        >
          {ownerName(feed.ownerKey)}
        </span>
      </span>
    );
  };

  return (
    <Section title="Calendars">
      <SurfaceList>
        {calendars.map(feed =>
          isAdmin ? (
            // The whole row opens the editor: on a phone a pair of small text
            // buttons read as labels, and the old in-page form opened far below
            // the fold, so tapping Edit looked like it did nothing.
            <button
              key={feed.id}
              type="button"
              aria-label={`Edit ${feed.label}`}
              onClick={() =>
                openEditor({
                  feedId: feed.id,
                  url: '',
                  label: feed.label,
                  ownerKey: feed.ownerKey,
                  alerts: feed.alerts === true,
                  travelMode: feed.travelMode ?? 'drive',
                })
              }
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3.5 text-left hairline-divider',
                'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                'hover:bg-brand-50 dark:hover:bg-brand-700/40 active:bg-brand-50 dark:active:bg-brand-700/40',
                'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset'
              )}
            >
              <span className="flex-1 min-w-0">
                {titleLine(feed)}
                {statusLines(feed)}
              </span>
              <span className="shrink-0 text-sm font-semibold text-accent-700 dark:text-accent-300">Edit</span>
              <ChevronRight size={18} aria-hidden="true" className="-ml-2 shrink-0 text-brand-300 dark:text-brand-500" />
            </button>
          ) : (
            <Row key={feed.id}>
              <div className="flex-1 min-w-0">
                {titleLine(feed)}
                {statusLines(feed)}
              </div>
            </Row>
          )
        )}
        {calendars.length === 0 && (
          <Row>
            <p className="text-sm text-brand-500 dark:text-brand-400">No calendars yet.</p>
          </Row>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => openEditor(EMPTY_FORM)}
            className={cn(
              'flex w-full items-center gap-3 px-4 py-3.5 text-left hairline-divider',
              'text-sm font-semibold text-accent-700 dark:text-accent-300',
              'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
              'hover:bg-brand-50 dark:hover:bg-brand-700/40 active:bg-brand-50 dark:active:bg-brand-700/40',
              'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset'
            )}
          >
            <Plus size={18} aria-hidden="true" className="shrink-0" />
            Add a calendar
          </button>
        )}
      </SurfaceList>

      <SurfaceList className="mt-3">
        <Row className="flex-wrap">
          {/* The built-in holidays feed is this toggle; its health shows here, not as a second row. */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">US holidays</p>
            {holidaysStatus && <p className={`text-xs ${TONE_CLASS[holidaysStatus.tone]}`}>{holidaysStatus.text}</p>}
          </div>
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
        <Drawer
          isOpen={formOpen}
          onClose={closeEditor}
          title={editing ? `Edit ${editingFeed?.label ?? 'calendar'}` : 'Add a calendar'}
          footer={
            <div className="flex gap-2 border-t border-brand-200 dark:border-brand-700 p-4">
              <Button variant="secondary" size="lg" className="flex-1" onClick={closeEditor} disabled={saving}>
                Cancel
              </Button>
              <Button
                type="submit"
                form={FORM_ID}
                size="lg"
                className="flex-1"
                isLoading={saving}
                disabled={!form.label.trim() || (!editing && !form.url.trim())}
              >
                {editing ? 'Save' : 'Add calendar'}
              </Button>
            </div>
          }
        >
          <form
            id={FORM_ID}
            className="space-y-5"
            onSubmit={e => {
              e.preventDefault();
              void submit();
            }}
          >
            {!editing && <LinkField editing={false} value={form.url} onChange={url => setForm(f => ({ ...f, url }))} />}
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <Input label="Name" maxLength={40} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
              </div>
              <div className="flex-1 min-w-0">
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

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p id={`${FORM_ID}-alerts`} className="text-sm font-semibold text-brand-900 dark:text-brand-100">
                    Starting-soon alerts
                  </p>
                  <p className="text-xs text-brand-500 dark:text-brand-400">The wall gives a heads-up before its events start</p>
                </div>
                <Switch
                  checked={form.alerts}
                  onCheckedChange={alerts => setForm(f => ({ ...f, alerts }))}
                  aria-labelledby={`${FORM_ID}-alerts`}
                />
              </div>
              {form.alerts && (
                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Getting there</p>
                    <p className="text-xs text-brand-500 dark:text-brand-400">
                      Sets the travel time for events with a location
                    </p>
                  </div>
                  <SegmentedControl
                    name="Getting there"
                    size="sm"
                    className="w-full"
                    options={(Object.keys(TRAVEL_LABELS) as WallTravelMode[]).map(m => ({ value: m, label: TRAVEL_LABELS[m] }))}
                    value={form.travelMode}
                    onChange={travelMode => setForm(f => ({ ...f, travelMode }))}
                  />
                </div>
              )}
            </div>

            {editing && <LinkField editing value={form.url} onChange={url => setForm(f => ({ ...f, url }))} />}

            {formError && (
              <p role="alert" className="text-sm text-money-neg">
                {formError}
              </p>
            )}

            {editingFeed && (
              <div className="pt-1">
                <Button type="button" variant="ghost-danger" className="w-full" onClick={() => remove(editingFeed)}>
                  Remove this calendar
                </Button>
              </div>
            )}
          </form>
        </Drawer>
      )}
    </Section>
  );
};

const LINK_HELP =
  'Google: the calendar’s settings → “Secret address in iCal format”. iCloud: share the calendar as a Public Calendar and copy its link. Schools and teams: their “Subscribe” or iCal link.';

/** The link is a credential the client never reads back, so editing can only replace it. */
const LinkField: React.FC<{ editing: boolean; value: string; onChange: (url: string) => void }> = ({ editing, value, onChange }) => (
  <div className="space-y-1.5">
    <Input
      label={editing ? 'Replace the link (optional)' : 'Calendar link'}
      inputMode="url"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      placeholder="https://… or webcal://…"
      value={value}
      onChange={e => onChange(e.target.value)}
    />
    <p className="text-xs text-brand-500 dark:text-brand-400">
      {editing ? 'Leave it empty to keep the current link. ' : ''}
      {LINK_HELP}
    </p>
  </div>
);

export default WallCalendarSettings;
