import React, { useCallback, useMemo, useState } from 'react';
import { firstEventOn, dueTodayTodos } from '@/utils/wall/wallSelectors';
import { zonedDateString } from '@/utils/wall/wallTime';
import { useWallData } from './data/wallData';
import { useWallRuntime } from './runtime/useWallRuntime';
import WallForecastSheet from './WallForecastSheet';
import WallGearMenu from './WallGearMenu';
import WallNight from './WallNight';
import WallRail, { type WallView } from './WallRail';
import WallTopBar from './WallTopBar';
import './wall.css';

type Overlay = 'none' | 'weather' | 'gear';

const NOTES = {
  offline: "The wall can't reach the internet. It keeps showing what it last saw, and anything you change is saved and syncs when the connection is back.",
  voice: 'Voice commands are coming in a later update.',
} as const;

const SOON: Record<WallView, { title: string; body: string }> = {
  calendar: { title: 'Calendar', body: 'The week, day and month views arrive in the next update.' },
  shopping: { title: 'Shopping', body: 'The shopping list arrives in a later update.' },
  todos: { title: 'To-dos', body: 'To-dos arrive in a later update.' },
  meals: { title: 'Meals', body: 'Meals arrive in a later update.' },
};

interface WallAppProps {
  /** Unpair (display) or leave the wall (member preview). */
  onLeave: () => void;
}

/** The wall shell (docs/plans/wall-display-kiosk.md §4.9): rail, top bar, screens, overlays. */
const WallApp: React.FC<WallAppProps> = ({ onLeave }) => {
  const data = useWallData();
  const [view, setView] = useState<WallView>('calendar');
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [note, setNote] = useState<keyof typeof NOTES | null>(null);

  const onIdle = useCallback(() => {
    setView('calendar');
    setOverlay('none');
    setNote(null);
  }, []);
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

  const showNote = (key: keyof typeof NOTES) => {
    setNote(key);
    window.setTimeout(() => setNote(current => (current === key ? null : current)), 8000);
  };

  const className = ['wall', data.settings.theme === 'dark' ? 'dark' : '', data.settings.textSize === 'large' ? 'large' : '']
    .filter(Boolean)
    .join(' ');
  const soon = SOON[view];

  return (
    <div className={className}>
      <WallRail
        view={view}
        onView={v => {
          setView(v);
          setOverlay('none');
        }}
        todoBadge={badge}
        offline={runtime.offline}
        onOfflineInfo={() => showNote('offline')}
        onMic={() => showNote('voice')}
        onGear={() => setOverlay('gear')}
      />
      <div className="main">
        <WallTopBar
          now={runtime.now}
          timeZone={runtime.timeZone}
          weather={runtime.weather}
          offline={runtime.offline}
          onWeather={() => setOverlay('weather')}
          right={
            view === 'calendar' ? (
              <div className="seg" role="group" aria-label="Calendar view">
                <button type="button" aria-pressed="false" disabled>Day</button>
                <button type="button" aria-pressed="true">Week</button>
                <button type="button" aria-pressed="false" disabled>Month</button>
              </div>
            ) : undefined
          }
        />
        <section className="soon" aria-label={soon.title}>
          <div>
            <h2>{soon.title}</h2>
            <p>{data.ready ? soon.body : 'Loading…'}</p>
          </div>
        </section>
        {overlay === 'weather' && runtime.weather && (
          <WallForecastSheet weather={runtime.weather} place={data.settings.weather?.label} onClose={() => setOverlay('none')} />
        )}
        {note && (
          <div className="note" role="status">
            {NOTES[note]}
          </div>
        )}
      </div>
      {overlay === 'gear' && (
        <WallGearMenu
          title={data.display?.name ?? data.householdName ?? 'Wall display'}
          pinHash={data.kidModePinHash}
          isDisplay={data.isDisplay}
          onClose={() => setOverlay('none')}
          onReload={() => window.location.reload()}
          onUnpair={onLeave}
        />
      )}
      {runtime.nightShowing && overlay !== 'gear' && (
        <WallNight now={runtime.now} timeZone={runtime.timeZone} tomorrowFirst={tomorrowFirst} onWake={runtime.wake} />
      )}
    </div>
  );
};

export default WallApp;
