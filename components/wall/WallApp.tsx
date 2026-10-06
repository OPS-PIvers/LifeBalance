import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { WallLayout, WallModuleKey } from '@/types/schema';
import { firstEventOn, dueTodayTodos } from '@/utils/wall/wallSelectors';
import { nextRotation } from '@/utils/wall/wallModules';
import { makeWallPeople } from '@/utils/wall/wallPeople';
import { zonedDateString, zonedParts } from '@/utils/wall/wallTime';
import { useWallData } from './data/wallData';
import { useWallRuntime } from './runtime/useWallRuntime';
import { WallToastContext, useWallToastController, type WallToaster } from './wallToast';
import WallDay from './calendar/WallDay';
import WallMonth from './calendar/WallMonth';
import WallWeek from './calendar/WallWeek';
import WallAddSheet, { type AddKind } from './lists/WallAddSheet';
import WallMeals from './lists/WallMeals';
import WallShopping from './lists/WallShopping';
import WallTodos from './lists/WallTodos';
import { useWallListActions } from './lists/useWallListActions';
import WallForecastSheet from './WallForecastSheet';
import WallGearMenu from './WallGearMenu';
import WallNight from './WallNight';
import WallRail, { type WallView } from './WallRail';
import WallToast from './WallToast';
import WallTopBar from './WallTopBar';
import WallVoiceBanner from './voice/WallVoiceBanner';
import { useWallVoice, type WallVoiceFeedback } from './voice/useWallVoice';
import WallSoundChip from './sound/WallSoundChip';
import WallAlertCard from './alerts/WallAlertCard';
import { useWallAlerts } from './alerts/useWallAlerts';
import { alertWords } from '@/utils/wall/wallAlerts';
import { briefDayFor, composeBrief } from '@/utils/wall/wallBrief';
import WallBriefCard from './brief/WallBriefCard';
import { useWallBrief } from './brief/useWallBrief';
import { WallSoundContext, useSoundState, useWallSoundEngine } from './sound/useWallSound';
import type { VoiceTarget } from '@/utils/wall/wallVoice';
import './wall.css';

type Overlay = 'none' | 'weather' | 'gear';
type CalendarView = 'day' | 'week' | 'month';

const NOTES = {
  offline: "The wall can't reach the internet. It keeps showing what it last saw, and anything you change is saved and syncs when the connection is back.",
} as const;

const CAL_VIEWS: { key: CalendarView; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

interface WallAppProps {
  /** Unpair (display) or leave the wall (member preview). */
  onLeave: () => void;
}

/** The wall shell (docs/plans/wall-display-kiosk.md §4.9): rail, top bar, screens, overlays. */
const WallApp: React.FC<WallAppProps> = ({ onLeave }) => {
  const data = useWallData();
  const { toast, dismiss, toaster: slotToaster } = useWallToastController();
  // The voice banner and the toast share one slot: a new toast replaces the banner.
  const cancelVoiceRef = useRef<() => void>(() => undefined);
  const closeBriefRef = useRef<() => void>(() => undefined);
  const toaster = useMemo<WallToaster>(
    () => ({
      show: (text, undo) => {
        cancelVoiceRef.current();
        slotToaster.show(text, undo);
      },
      run: (write, text, undo) => {
        cancelVoiceRef.current();
        slotToaster.run(write, text, undo);
      },
    }),
    [slotToaster]
  );
  const [view, setView] = useState<WallView>('calendar');
  const [calView, setCalView] = useState<CalendarView>('week');
  const [dayDate, setDayDate] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [sheet, setSheet] = useState<AddKind | null>(null);
  // Day view adds a to-do for the day it shows.
  const [sheetDate, setSheetDate] = useState<string | undefined>(undefined);
  const [mealDate, setMealDate] = useState<string | null>(null);
  // Rotation: the gear can start/stop it on this wall; otherwise Settings decides.
  const [rotateOverride, setRotateOverride] = useState<boolean | null>(null);
  const [rotationPaused, setRotationPaused] = useState(false);
  // A rotation step only lasts while the saved layout it started from is current.
  const [rotated, setRotated] = useState<{ from: string; shown: WallLayout } | null>(null);

  const onIdle = useCallback(() => {
    setView('calendar');
    setCalView('week');
    setDayDate(null);
    setOverlay('none');
    setSheet(null);
    setMealDate(null);
    setRotationPaused(false);
    dismiss();
    cancelVoiceRef.current();
    closeBriefRef.current();
  }, [dismiss]);
  const listActions = useWallListActions(toaster);
  // One stable cloud-voice function: the actions object is rebuilt on every
  // list snapshot, and swapping the synthesizer would empty the audio cache.
  const synthRef = useRef(data.actions.synthesizeSpeech);
  useEffect(() => {
    synthRef.current = data.actions.synthesizeSpeech;
  }, [data.actions.synthesizeSpeech]);
  const synthesize = useCallback((text: string) => synthRef.current(text), []);
  const sound = useWallSoundEngine(data.settings.sound.volume, synthesize);
  const soundState = useSoundState(sound);
  /** A chime, then (when Settings says so) the words, timed to start as the chime fades. */
  const playFeedback = useCallback(
    (tone: 'ok' | 'error' | 'alert', speech: string, style: 'speak' | 'chime') => {
      if (style === 'speak') sound.prepare(speech);
      const wait = sound.chime(tone);
      if (style === 'speak') window.setTimeout(() => void sound.speak(speech), wait);
    },
    [sound]
  );
  const runtime = useWallRuntime({
    settings: data.settings,
    householdId: data.householdId,
    displayId: data.displayId,
    onIdle,
  });

  const today = zonedDateString(runtime.now, runtime.timeZone);
  const tomorrow = zonedDateString(new Date(runtime.now.getTime() + 24 * 60 * 60 * 1000), runtime.timeZone);
  const badge = useMemo(() => dueTodayTodos(data.todos, today).length, [data.todos, today]);
  const tomorrowFirst = useMemo(() => firstEventOn(data.wallEvents, tomorrow), [data.wallEvents, tomorrow]);
  const dark = data.settings.theme === 'dark';
  const people = useMemo(() => makeWallPeople(data.members, dark), [data.members, dark]);

  const showTarget = (target: VoiceTarget) => {
    if (target === 'week' || target === 'day' || target === 'month') {
      setView('calendar');
      setCalView(target);
      setDayDate(null);
    } else {
      setView(target);
    }
    setOverlay('none');
    setSheet(null);
    setMealDate(null);
  };
  const setRotation = (on: boolean) => {
    setRotateOverride(on);
    setRotationPaused(false);
    setRotated(null);
  };
  const alerts = useWallAlerts({
    events: data.wallEvents,
    feeds: data.calendarFeeds,
    travel: data.travel,
    leadMin: data.settings.alerts.leadMin,
    now: runtime.now,
  });
  const alert = alerts.alert;
  const alertText = alert
    ? alertWords(alert, runtime.now.getTime(), runtime.timeZone, people.firstName(alert.event.ownerKey))
    : null;
  // An alert sounds once, when it appears; never during the night window.
  const alertSound = useRef({ speech: '', style: data.settings.sound.alerts, night: false });
  useEffect(() => {
    alertSound.current = { speech: alertText?.speech ?? '', style: data.settings.sound.alerts, night: runtime.nightShowing };
  });
  const alertKey = alert?.key ?? null;
  useEffect(() => {
    if (!alertKey) return;
    // An alert outranks the brief: close it first, or the two would cut each
    // other's speech off line by line and stack two cards.
    closeBriefRef.current();
    const { speech, style, night } = alertSound.current;
    if (!night) playFeedback('alert', speech, style);
  }, [alertKey, playFeedback]);

  // "What's my day" is asked for out loud, so it's always read out (when sound is on).
  const brief = useWallBrief(sound, true);
  useEffect(() => {
    closeBriefRef.current = brief.close;
  }, [brief.close]);
  const openBrief = (asked: 'today' | 'tomorrow' | 'auto') => {
    alerts.dismiss();
    const day = briefDayFor(asked, zonedParts(runtime.now, runtime.timeZone).hour);
    brief.open(
      composeBrief({
        day,
        date: day === 'today' ? today : tomorrow,
        events: data.wallEvents,
        travel: data.travel,
        weather: runtime.weather,
        now: runtime.now.getTime(),
        timeZone: runtime.timeZone,
        person: people.firstName,
      })
    );
  };

  // Hands-free only on a paired display (never a member's phone preview), never
  // at night, and not until a touch has unlocked audio (iPadOS needs one).
  const wakeWanted = data.settings.wakeWord && data.isDisplay && !runtime.nightShowing && soundState !== 'locked';
  const voice = useWallVoice({
    setting: data.settings.voice,
    wakeModel: data.settings.wakeModel,
    wake: wakeWanted,
    onWake: () => {
      brief.close();
      dismiss();
      setSheet(null);
      setOverlay('none');
      sound.chime('wake');
    },
    today,
    timeZone: runtime.timeZone,
    onShow: showTarget,
    onRotate: setRotation,
    onBrief: openBrief,
    onFeedback: (f: WallVoiceFeedback) => playFeedback(f.tone, f.speech, data.settings.sound.confirm),
  });
  useEffect(() => {
    cancelVoiceRef.current = voice.cancel;
  }, [voice.cancel]);
  const listening = voice.state?.phase === 'listening';
  const startVoice = () => {
    brief.close();
    dismiss();
    setSheet(null);
    setOverlay('none');
    voice.start();
  };

  const rotating = rotateOverride ?? data.settings.rotation.enabled;
  // Compared by content: the providers rebuild the layout object on every snapshot.
  const savedKey = data.layout.modules.join(',');
  const shownLayout = rotated && rotated.from === savedKey ? rotated.shown : data.layout;
  const onWeek = view === 'calendar' && calView === 'week';
  const rotationLive = rotating && !rotationPaused && !runtime.nightShowing && onWeek && overlay === 'none';
  const shownRef = useRef(shownLayout);
  useEffect(() => {
    shownRef.current = shownLayout;
  }, [shownLayout]);
  // Keyed by content: every settings snapshot rebuilds the array, and an
  // unrelated settings change must not restart the rotation's timer.
  const defaultsKey = data.settings.defaultModules.join(',');
  const intervalSec = data.settings.rotation.intervalSec;
  useEffect(() => {
    if (!rotationLive) return undefined;
    const defaults = defaultsKey ? (defaultsKey.split(',') as WallModuleKey[]) : [];
    const id = window.setInterval(() => {
      setRotated({ from: savedKey, shown: nextRotation(shownRef.current, defaults) });
    }, intervalSec * 1000);
    return () => window.clearInterval(id);
  }, [rotationLive, savedKey, defaultsKey, intervalSec]);

  const changeLayout = (layout: WallLayout) => {
    setRotated(null);
    data.actions.setLayout(layout).catch(error => {
      console.error('[wall] layout save failed:', error);
      toaster.show("Couldn't save the layout.");
    });
  };

  const goCalendar = (next: CalendarView, date: string | null = null) => {
    setView('calendar');
    setCalView(next);
    setDayDate(date);
  };

  const openMeal = (date: string) => {
    setView('meals');
    setMealDate(date);
  };

  const cartCount = data.shoppingList.filter(i => i.isPurchased).length;
  let topRight: React.ReactNode = null;
  if (view === 'calendar') {
    topRight = (
      <div className="seg" role="group" aria-label="Calendar view">
        {CAL_VIEWS.map(v => (
          <button key={v.key} type="button" aria-pressed={calView === v.key} onClick={() => goCalendar(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
    );
  } else if (view === 'shopping' || view === 'todos') {
    topRight = (
      <>
        <button
          type="button"
          className="btn pri"
          onClick={() => {
            setSheetDate(undefined);
            setSheet(view === 'shopping' ? 'shopping' : 'todo');
          }}
        >
          <Plus className="wi" size="1em" aria-hidden="true" />
          Add
        </button>
        {view === 'shopping' && (
          <button type="button" className="btn" disabled={cartCount === 0} onClick={listActions.clearCart}>
            Clear ({cartCount})
          </button>
        )}
      </>
    );
  }

  const className = ['wall', dark ? 'dark' : '', data.settings.textSize === 'large' ? 'large' : ''].filter(Boolean).join(' ');

  let body: React.ReactNode;
  if (!data.ready) {
    body = (
      <section className="soon" aria-label="Loading">
        <p>Loading…</p>
      </section>
    );
  } else if (view === 'shopping') {
    body = <WallShopping key={runtime.idleEpoch} />;
  } else if (view === 'todos') {
    body = <WallTodos key={runtime.idleEpoch} today={today} timeZone={runtime.timeZone} people={people} />;
  } else if (view === 'meals') {
    body = <WallMeals today={today} openDate={mealDate} onOpen={setMealDate} />;
  } else if (calView === 'day') {
    body = (
      <WallDay
        date={dayDate ?? today}
        today={today}
        now={runtime.now}
        timeZone={runtime.timeZone}
        people={people}
        weather={runtime.weather}
        onDate={setDayDate}
        onAddTodo={date => {
          setSheetDate(date);
          setSheet('todo');
        }}
        onOpenMeal={openMeal}
      />
    );
  } else if (calView === 'month') {
    body = <WallMonth today={today} timeZone={runtime.timeZone} people={people} onOpenDay={date => goCalendar('day', date)} />;
  } else {
    body = (
      <WallWeek
        // Idle return remounts the panel: menus close, modules scroll back to the top.
        key={runtime.idleEpoch}
        today={today}
        now={runtime.now}
        timeZone={runtime.timeZone}
        people={people}
        layout={shownLayout}
        onLayout={changeLayout}
        onSeeMonth={() => goCalendar('month')}
        onOpenMeal={openMeal}
      />
    );
  }

  return (
    <WallSoundContext.Provider value={sound}>
      <WallToastContext.Provider value={toaster}>
        <div className={className} onPointerDownCapture={() => setRotationPaused(true)}>
          <WallRail
            view={view}
            onView={v => {
              if (v === 'calendar') goCalendar('week');
              else setView(v);
              setOverlay('none');
              setSheet(null);
              setMealDate(null);
            }}
            todoBadge={badge}
            offline={runtime.offline}
            onOfflineInfo={() => toaster.show(NOTES.offline)}
            {...(voice.available ? { onMic: listening ? voice.finish : startVoice } : {})}
            micLive={listening}
            wakeLabel={voice.wakeListening ? data.settings.wakeModel.label : undefined}
            onGear={() => setOverlay('gear')}
          />
          <div className="main">
            <WallTopBar
              now={runtime.now}
              timeZone={runtime.timeZone}
              weather={runtime.weather}
              offline={runtime.offline}
              onWeather={() => setOverlay('weather')}
              right={topRight}
            />
            {body}
            {sheet && (
              <WallAddSheet
                kind={sheet}
                today={today}
                people={people}
                {...(sheetDate ? { dueDate: sheetDate } : {})}
                onDone={() => {
                  setSheet(null);
                  setSheetDate(undefined);
                }}
                {...(voice.available ? { onVoice: startVoice } : {})}
              />
            )}
            {overlay === 'weather' && runtime.weather && (
              <WallForecastSheet weather={runtime.weather} place={data.settings.weather?.label} onClose={() => setOverlay('none')} />
            )}
            {soundState === 'locked' && data.ready && !runtime.nightShowing && <WallSoundChip />}
            {brief.state && <WallBriefCard state={brief.state} people={people} onClose={brief.close} />}
          {voice.state ? (
              <WallVoiceBanner
                state={voice.state}
                onFinish={voice.finish}
                onCancel={voice.cancel}
                onRetry={startVoice}
                onUndo={voice.undo}
                onShow={target => {
                  voice.cancel();
                  showTarget(target);
                }}
              />
            ) : (
              toast && <WallToast key={toast.id} toast={toast} toaster={toaster} onDismiss={dismiss} />
            )}
          </div>
          {overlay === 'gear' && (
            <WallGearMenu
              title={data.display?.name ?? data.householdName ?? 'Wall display'}
              pinHash={data.kidModePinHash}
              isDisplay={data.isDisplay}
              rotating={rotating}
              rotationIntervalSec={data.settings.rotation.intervalSec}
              onToggleRotation={() => {
                setRotation(!rotating);
                setOverlay('none');
              }}
              onClose={() => setOverlay('none')}
              onReload={() => window.location.reload()}
              onUnpair={onLeave}
              onSyncCalendars={data.actions.syncCalendarsNow}
              onTestSound={() => playFeedback('ok', 'Sound is on. This is how the wall sounds.', 'speak')}
            />
          )}
          {alert && alertText && overlay !== 'gear' && (
          <WallAlertCard alert={alert} words={alertText} night={runtime.nightShowing} onClose={alerts.dismiss} />
        )}
        {runtime.nightShowing && overlay !== 'gear' && (
            <WallNight now={runtime.now} timeZone={runtime.timeZone} tomorrowFirst={tomorrowFirst} onWake={runtime.wake} />
          )}
        </div>
      </WallToastContext.Provider>
    </WallSoundContext.Provider>
  );
};

export default WallApp;
