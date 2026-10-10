import React, { useEffect, useState } from 'react';
import { Bytes, collection, doc, onSnapshot, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db, getFunctionsInstance } from '@/firebase.config';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import SectionHeading from '@/components/ui/SectionHeading';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { requestDeleteConfirmation } from '@/components/ui/confirmDialogStore';
import { wallDisplayConverter, wallSettingsConverter } from '@/utils/firestoreConverters';
import Select from '@/components/ui/Select';
import { MODULE_TITLES } from '@/utils/wall/wallModules';
import {
  DEFAULT_WALL_SETTINGS,
  WALL_ALERT_LEADS,
  WALL_IDLE_RETURN_OPTIONS,
  WALL_MODULE_KEYS,
  WALL_ROTATION_INTERVALS,
  WALL_VOLUMES,
  normalizeModules,
  splitWakeFile,
  wakeChunkDocId,
} from '@/utils/wall/wallSettings';
import {
  countdownText,
  formatPairingCode,
  geocodeUrl,
  lastSeenText,
  parseGeocode,
  type GeocodeResult,
} from '@/utils/wall/wallSettingsView';
import type { HouseholdMember, WallDisplay, WallHome, WallLayout, WallRailMode, WallSettings } from '@/types/schema';
import { WallDisplayLayout } from './WallLayoutSettings';
import WallCalendarSettings from './WallCalendarSettings';
import WallVoiceSettings from './WallVoiceSettings';
import { useAiUsageToday } from '@/hooks/useAiUsageToday';

interface WallDisplaySettingsProps {
  householdId: string;
  isAdmin: boolean;
  members: HouseholdMember[];
}

interface PendingCode {
  code: string;
  expiresAt: string;
  did: string;
  name: string;
}

const RUNBOOK_URL = 'https://github.com/OPS-PIvers/LifeBalance/blob/main/docs/WALL_DISPLAY_RUNBOOK.md';

async function callable<Req, Res>(name: string, data: Req): Promise<Res> {
  const [{ httpsCallable }, functions] = await Promise.all([import('firebase/functions'), getFunctionsInstance()]);
  const { data: result } = await httpsCallable<Req, Res>(functions, name)(data);
  return result;
}

/** Settings' two pickers → the stored list ('none' drops a slot). */
// The panel always has a top module; 'none' (only the bottom has it) is dropped by normalizeModules.
const startingModules = (top: string, bottom: string) => normalizeModules([top, bottom]);

/** What each Home screen choice shows. */
const HOME_NOTES: Record<WallHome, string> = {
  board: 'Clock, dinner and weather across the top, next up, and today in a lane per person with their to-dos',
  week: 'Today down the left, the week and a module panel beside it',
};

/** What each Side buttons choice does on the wall. */
const RAIL_NOTES: Record<WallRailMode, string> = {
  shown: 'Views, voice and the display menu down the left',
  tap: 'A toolbar rises along the bottom on a touch',
  hidden: 'Hold the clock to open the display menu',
};

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.');

/**
 * Settings → Wall display (docs/plans/wall-display-kiosk.md §5): pair and
 * revoke displays (admins), calendar feeds, and the household's wall settings
 * (any member).
 */
const WallDisplaySettings: React.FC<WallDisplaySettingsProps> = ({ householdId, isAdmin, members }) => {
  const [displays, setDisplays] = useState<WallDisplay[]>([]);
  const [settings, setSettings] = useState<WallSettings>(DEFAULT_WALL_SETTINGS);
  const [now, setNow] = useState(() => Date.now());
  const [newName, setNewName] = useState('Kitchen iPad');
  const [pending, setPending] = useState<PendingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [place, setPlace] = useState('');
  const [places, setPlaces] = useState<GeocodeResult[]>([]);
  const [address, setAddress] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const aiUsage = useAiUsageToday();

  useEffect(() => {
    const unsubDisplays = onSnapshot(
      collection(db, `households/${householdId}/displays`).withConverter(wallDisplayConverter),
      snap => setDisplays(snap.docs.map(d => d.data()).sort((a, b) => a.name.localeCompare(b.name))),
      error => console.error('[displays] listener failed:', error)
    );
    const unsubSettings = onSnapshot(
      doc(db, `households/${householdId}/wallSettings/config`).withConverter(wallSettingsConverter),
      snap => setSettings(snap.data() ?? DEFAULT_WALL_SETTINGS),
      error => console.error('[wallSettings] listener failed:', error)
    );
    return () => {
      unsubDisplays();
      unsubSettings();
    };
  }, [householdId]);

  // Ticks the code countdown and "last seen" text.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const save = async (patch: Partial<WallSettings>) => {
    try {
      await setDoc(
        doc(db, `households/${householdId}/wallSettings/config`),
        // The wall's clock and night window follow the zone of whoever saves.
        { ...patch, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        { merge: true }
      );
    } catch (e) {
      console.error('[wallSettings] save failed:', e);
      toast.error("Couldn't save the wall settings.");
    }
  };

  /** A wall's own layout: the display listens to its doc, so it changes at once. */
  const saveLayout = async (did: string, layout: WallLayout) => {
    try {
      await updateDoc(doc(db, `households/${householdId}/displays/${did}`), { layout });
    } catch (e) {
      console.error('[displays] layout save failed:', e);
      toast.error("Couldn't save the wall's layout.");
    }
  };

  /**
   * A custom wake word: its bytes into the wake-N chunk docs and the settings
   * pointing at them, in one batch, so the wall never sees half a file.
   */
  const uploadWakeFile = async (bytes: Uint8Array, label: string) => {
    const chunks = splitWakeFile(bytes);
    const id = crypto.randomUUID();
    const batch = writeBatch(db);
    chunks.forEach((data, i) => {
      batch.set(doc(db, `households/${householdId}/wallSettings/${wakeChunkDocId(i)}`), { id, data: Bytes.fromUint8Array(data) });
    });
    batch.set(
      doc(db, `households/${householdId}/wallSettings/config`),
      {
        wakeModel: { keyword: 'custom', file: { id, chunks: chunks.length, bytes: bytes.length }, label, threshold: settings.wakeModel.threshold },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      { merge: true }
    );
    await batch.commit();
  };

  const addDisplay = async () => {
    setBusy(true);
    try {
      const result = await callable<{ householdId: string; name: string }, { code: string; expiresAt: string; did: string }>(
        'createwallpairing',
        { householdId, name: newName }
      );
      setPending({ ...result, name: newName.trim() });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = (display: WallDisplay) => {
    requestDeleteConfirmation({
      itemName: 'display',
      title: display.status === 'pending' ? `Cancel the code for ${display.name}?` : `Revoke ${display.name}?`,
      message:
        display.status === 'pending'
          ? 'The code stops working.'
          : 'The display is signed out right away and goes back to its pairing screen.',
      confirmLabel: display.status === 'pending' ? 'Cancel code' : 'Revoke',
      onConfirm: async () => {
        await callable('revokewalldisplay', { householdId, did: display.id });
        if (pending?.did === display.id) setPending(null);
      },
    });
  };

  const searchPlaces = async () => {
    if (!place.trim()) return;
    try {
      const res = await fetch(geocodeUrl(place));
      setPlaces(parseGeocode(await res.json()));
    } catch {
      toast.error("Couldn't look up that place.");
    }
  };

  const saveAddress = async (value: string) => {
    setSavingAddress(true);
    try {
      await callable('setwallhomeaddress', { householdId, address: value });
      setAddress('');
      toast.success(value ? 'Home address saved' : 'Home address removed');
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSavingAddress(false);
    }
  };

  const activeDisplays = displays.filter(d => d.status === 'active');
  const topModule = settings.defaultModules[0] ?? 'coming';
  const bottomModule = settings.defaultModules[1] ?? 'none';

  const pendingLeft = pending ? countdownText(pending.expiresAt, now) : null;
  const pendingStillWaiting = pending && displays.some(d => d.id === pending.did && d.status === 'pending');

  return (
    <>
      <Section title="Displays">
        <SurfaceList>
          {displays.filter(d => d.status !== 'revoked').map(d => {
            const seen = lastSeenText(d.lastSeenAt, now);
            return (
              <Row key={d.id}>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm">{d.name}</p>
                  <p className={seen.stale && d.status === 'active' ? 'text-xs text-money-neg' : 'text-xs text-brand-500 dark:text-brand-400'}>
                    {d.status === 'pending' ? 'Waiting for its code' : seen.text}
                  </p>
                </div>
                {isAdmin && (
                  <Button variant="ghost-danger" size="sm" onClick={() => revoke(d)}>
                    {d.status === 'pending' ? 'Cancel' : 'Revoke'}
                  </Button>
                )}
              </Row>
            );
          })}
          {displays.every(d => d.status === 'revoked') && (
            <Row>
              <p className="text-sm text-brand-500 dark:text-brand-400">No wall displays yet.</p>
            </Row>
          )}
        </SurfaceList>

        {isAdmin && (
          <div className="mt-4 space-y-3">
            <SectionHeading
              as="h3"
              className="px-1"
              description="On the iPad, open LifeBalance from its Home Screen icon and tap “Set up a wall display” on the sign-in screen."
            >
              Add a wall display
            </SectionHeading>
            {pending && pendingStillWaiting && pendingLeft ? (
              <div className="rounded-xl bg-accent-50 dark:bg-accent-900/30 p-4 text-center space-y-1">
                <p className="font-mono text-3xl tracking-widest text-accent-700 dark:text-accent-200">
                  {formatPairingCode(pending.code)}
                </p>
                <p className="text-xs text-brand-500 dark:text-brand-400">
                  Enter this on {pending.name} within {pendingLeft}.
                </p>
              </div>
            ) : (
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Input label="Display name" value={newName} maxLength={40} onChange={e => setNewName(e.target.value)} />
                </div>
                <Button onClick={() => void addDisplay()} isLoading={busy} disabled={!newName.trim()}>
                  Get a code
                </Button>
              </div>
            )}
            {pending && !pendingStillWaiting && displays.some(d => d.id === pending.did && d.status === 'active') && (
              <p className="text-sm text-money-pos px-1">{pending.name} is paired.</p>
            )}
            <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
              Mounting, Guided Access and overnight brightness are covered in the{' '}
              <a className="underline" href={RUNBOOK_URL} target="_blank" rel="noreferrer">
                setup guide
              </a>
              .
            </p>
          </div>
        )}
      </Section>

      <WallCalendarSettings householdId={householdId} isAdmin={isAdmin} members={members} settings={settings} onSave={save} />

      <Section title="Week layout">
        <div className="space-y-4">
          {activeDisplays.map(d => (
            <WallDisplayLayout
              key={d.id}
              display={d}
              settings={settings}
              onSave={layout => void saveLayout(d.id, layout)}
            />
          ))}
          <SurfaceList>
            <Row className="flex-col items-stretch gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">New walls start with</p>
                <p className="text-xs text-brand-500 dark:text-brand-400">What a newly paired wall’s panel shows</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  aria-label="Top module"
                  value={topModule}
                  onChange={e => void save({ defaultModules: startingModules(e.target.value, bottomModule) })}
                >
                  {WALL_MODULE_KEYS.map(key => (
                    <option key={key} value={key}>
                      {MODULE_TITLES[key]}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Bottom module"
                  value={bottomModule}
                  onChange={e => void save({ defaultModules: startingModules(topModule, e.target.value) })}
                >
                  <option value="none">Nothing</option>
                  {WALL_MODULE_KEYS.filter(key => key !== topModule).map(key => (
                    <option key={key} value={key}>
                      {MODULE_TITLES[key]}
                    </option>
                  ))}
                </Select>
              </div>
            </Row>
            <Row className="flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Rotate the bottom module</p>
                <p className="text-xs text-brand-500 dark:text-brand-400">Pauses when someone touches the wall</p>
              </div>
              <SegmentedControl
                name="Rotate the bottom module"
                size="sm"
                options={[
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
                value={settings.rotation.enabled ? 'on' : 'off'}
                onChange={v => void save({ rotation: { ...settings.rotation, enabled: v === 'on' } })}
              />
            </Row>
            {settings.rotation.enabled && (
              <Row className="flex-col items-stretch gap-2">
                <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Each module stays for</p>
                <SegmentedControl
                  name="Each module stays for"
                  size="sm"
                  options={WALL_ROTATION_INTERVALS.map(sec => ({ value: String(sec), label: sec < 60 ? `${sec} s` : `${sec / 60} min` }))}
                  value={String(settings.rotation.intervalSec)}
                  onChange={v => void save({ rotation: { ...settings.rotation, intervalSec: Number(v) } })}
                />
              </Row>
            )}
            <Row className="flex-col items-stretch gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Back to calendar after</p>
                <p className="text-xs text-brand-500 dark:text-brand-400">When nobody touches it</p>
              </div>
              <SegmentedControl
                name="Back to calendar after"
                size="sm"
                options={WALL_IDLE_RETURN_OPTIONS.map(sec => ({ value: String(sec), label: `${sec / 60} min` }))}
                value={String(settings.idleReturnSec)}
                onChange={v => void save({ idleReturnSec: Number(v) })}
              />
            </Row>
          </SurfaceList>
        </div>
      </Section>

      <Section title="Night & look">
        <SurfaceList>
          <Row className="flex-col items-stretch gap-2">
            <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Night screen</p>
            <div className="flex items-center gap-2 text-sm">
              <input
                type="time"
                aria-label="Night starts"
                className="rounded-lg border border-brand-300 dark:border-brand-600 bg-transparent px-2 py-1"
                value={settings.night.start}
                onChange={e => void save({ night: { ...settings.night, start: e.target.value } })}
              />
              <span>to</span>
              <input
                type="time"
                aria-label="Night ends"
                className="rounded-lg border border-brand-300 dark:border-brand-600 bg-transparent px-2 py-1"
                value={settings.night.end}
                onChange={e => void save({ night: { ...settings.night, end: e.target.value } })}
              />
            </div>
          </Row>
          <Row className="flex-wrap">
            <p className="flex-1 min-w-0 text-sm font-semibold text-brand-900 dark:text-brand-100">Theme</p>
            <SegmentedControl
              name="Wall theme"
              size="sm"
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              value={settings.theme}
              onChange={theme => void save({ theme })}
            />
          </Row>
          <Row className="flex-wrap">
            <p className="flex-1 min-w-0 text-sm font-semibold text-brand-900 dark:text-brand-100">Text size</p>
            <SegmentedControl
              name="Wall text size"
              size="sm"
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'large', label: 'Large' },
              ]}
              value={settings.textSize}
              onChange={textSize => void save({ textSize })}
            />
          </Row>
          <Row className="flex-col items-stretch gap-2">
            <div>
              <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Home screen</p>
              <p className="text-xs text-brand-500 dark:text-brand-400">{HOME_NOTES[settings.home]}</p>
            </div>
            <SegmentedControl
              name="Wall home screen"
              size="sm"
              options={[
                { value: 'board', label: 'Board' },
                { value: 'week', label: 'Week' },
              ]}
              value={settings.home}
              onChange={home => void save({ home })}
            />
          </Row>
          <Row className="flex-col items-stretch gap-2">
            <div>
              <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Side buttons</p>
              <p className="text-xs text-brand-500 dark:text-brand-400">{RAIL_NOTES[settings.rail]}</p>
            </div>
            <SegmentedControl
              name="Wall side buttons"
              size="sm"
              options={[
                { value: 'shown', label: 'Always' },
                { value: 'tap', label: 'On tap' },
                { value: 'hidden', label: 'Hidden' },
              ]}
              value={settings.rail}
              onChange={rail => void save({ rail })}
            />
          </Row>
          <Row className="flex-col items-stretch gap-2">
            <div>
              <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Weather location</p>
              <p className="text-xs text-brand-500 dark:text-brand-400">{settings.weather?.label ?? 'Not set: the wall hides the weather'}</p>
            </div>
            <form
              className="flex gap-2 items-end"
              onSubmit={e => {
                e.preventDefault();
                void searchPlaces();
              }}
            >
              <div className="flex-1">
                <Input aria-label="Search for a city" placeholder="City or town" value={place} onChange={e => setPlace(e.target.value)} />
              </div>
              <Button type="submit" variant="secondary">Search</Button>
            </form>
            {places.length > 0 && (
              <ul className="space-y-1">
                {places.map(p => (
                  <li key={`${p.lat},${p.lon}`}>
                    <button
                      type="button"
                      className="w-full text-left text-sm rounded-lg px-3 py-2 hover:bg-brand-100 dark:hover:bg-brand-800"
                      onClick={() => {
                        void save({ weather: p });
                        setPlaces([]);
                        setPlace('');
                      }}
                    >
                      {p.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Row>
        </SurfaceList>
      </Section>

      <WallVoiceSettings settings={settings} save={save} uploadWakeFile={uploadWakeFile} aiUsage={aiUsage} />

      <Section title="Starting-soon alerts">
        <SurfaceList>
          <Row className="flex-col items-stretch gap-1">
            <p className="text-sm text-brand-700 dark:text-brand-300">
              Turn alerts on for a calendar under Calendars → Edit. Events with a location get a heads-up 10 minutes before it’s time to
              leave (live traffic from home), then “Time to leave”. Others alert before they start. During night hours alerts show
              without sound.
            </p>
          </Row>
          <Row className="flex-col items-stretch gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Without travel time, alert</p>
              <p className="text-xs text-brand-500 dark:text-brand-400">Before the event starts</p>
            </div>
            <SegmentedControl
              name="Alert lead time"
              size="sm"
              options={WALL_ALERT_LEADS.map(m => ({ value: String(m), label: `${m} min` }))}
              value={String(settings.alerts.leadMin)}
              onChange={v => void save({ alerts: { leadMin: Number(v) } })}
            />
          </Row>
          <Row className="flex-col items-stretch gap-2">
            <div>
              <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Home address</p>
              <p className={settings.travelError ? 'text-xs text-money-neg' : 'text-xs text-brand-500 dark:text-brand-400'}>
                {settings.travelError ??
                  (settings.homeAddressSet
                    ? 'Saved. Only travel times reach the wall; the address stays on the server.'
                    : 'Not set: alerts use the lead time above instead of travel time.')}
              </p>
            </div>
            {isAdmin && (
              <form
                className="flex gap-2 items-end"
                onSubmit={e => {
                  e.preventDefault();
                  void saveAddress(address.trim());
                }}
              >
                <div className="flex-1">
                  <Input
                    aria-label="Home address"
                    placeholder={settings.homeAddressSet ? 'Enter a new address to replace it' : 'Street, city, state'}
                    autoComplete="street-address"
                    maxLength={200}
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                  />
                </div>
                <Button type="submit" variant="secondary" isLoading={savingAddress} disabled={!address.trim()}>
                  Save
                </Button>
                {settings.homeAddressSet && (
                  <Button type="button" variant="ghost-danger" disabled={savingAddress} onClick={() => void saveAddress('')}>
                    Remove
                  </Button>
                )}
              </form>
            )}
          </Row>
        </SurfaceList>
      </Section>

      <Section title="Sound">
        <SurfaceList>
          <Row className="flex-col items-stretch gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Volume</p>
              <p className="text-xs text-brand-500 dark:text-brand-400">On top of the iPad’s own volume. Test it from the wall’s gear menu.</p>
            </div>
            <SegmentedControl
              name="Wall volume"
              size="sm"
              options={WALL_VOLUMES.map((v, i) => ({ value: String(v), label: ['Low', 'Medium', 'High'][i] ?? String(v) }))}
              value={String(WALL_VOLUMES.includes(settings.sound.volume) ? settings.sound.volume : DEFAULT_WALL_SETTINGS.sound.volume)}
              onChange={v => void save({ sound: { ...settings.sound, volume: Number(v) } })}
            />
          </Row>
          <Row className="flex-col items-stretch gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">After a voice command</p>
              <p className="text-xs text-brand-500 dark:text-brand-400">A big card always shows what happened</p>
            </div>
            <SegmentedControl
              name="After a voice command"
              size="sm"
              options={[
                { value: 'speak', label: 'Chime + speak' },
                { value: 'chime', label: 'Chime only' },
              ]}
              value={settings.sound.confirm}
              onChange={confirm => void save({ sound: { ...settings.sound, confirm } })}
            />
          </Row>
          <Row className="flex-col items-stretch gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Starting-soon alerts</p>
              <p className="text-xs text-brand-500 dark:text-brand-400">Silent during night hours</p>
            </div>
            <SegmentedControl
              name="Alert sound"
              size="sm"
              options={[
                { value: 'speak', label: 'Chime + speak' },
                { value: 'chime', label: 'Chime only' },
              ]}
              value={settings.sound.alerts}
              onChange={alerts => void save({ sound: { ...settings.sound, alerts } })}
            />
          </Row>
        </SurfaceList>
      </Section>
    </>
  );
};

export default WallDisplaySettings;
