import React from 'react';
import { CalendarDays, ListChecks, Mic, ShoppingCart, SlidersHorizontal, UtensilsCrossed, WifiOff } from 'lucide-react';
import type { OfflineLevel } from '@/utils/wall/wallStatus';

export type WallView = 'calendar' | 'shopping' | 'todos' | 'meals';

const ITEMS: { view: WallView; label: string; Icon: typeof CalendarDays }[] = [
  { view: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { view: 'shopping', label: 'Shopping', Icon: ShoppingCart },
  { view: 'todos', label: 'To-dos', Icon: ListChecks },
  { view: 'meals', label: 'Meals', Icon: UtensilsCrossed },
];

interface WallRailProps {
  view: WallView;
  onView: (view: WallView) => void;
  /** Open overdue + due-today to-dos. */
  todoBadge: number;
  offline: OfflineLevel;
  onOfflineInfo: () => void;
  /** Absent when voice is off in Settings or this browser can't listen. */
  onMic?: () => void;
  /** The mic is listening. */
  micLive: boolean;
  /** The wake word being listened for, while it is (shown under the mic). */
  wakeLabel?: string | undefined;
  onGear: () => void;
}

const WallRail: React.FC<WallRailProps> = ({ view, onView, todoBadge, offline, onOfflineInfo, onMic, micLive, wakeLabel, onGear }) => (
  <nav className="rail" aria-label="Views">
    {ITEMS.map(({ view: v, label, Icon }) => (
      <button key={v} type="button" className="nav" aria-current={v === view ? 'page' : undefined} onClick={() => onView(v)}>
        <Icon className="wi" size="1em" strokeWidth={1.75} aria-hidden="true" />
        <span>{label}</span>
        {v === 'todos' && todoBadge > 0 && <span className="badge">{todoBadge}</span>}
      </button>
    ))}
    <div className="sp" />
    {offline === 'mark' && (
      <button type="button" className="off" onClick={onOfflineInfo} aria-label="Offline details">
        <WifiOff className="wi" size="1em" aria-hidden="true" />
        Offline
      </button>
    )}
    {onMic && (
      <button
        type="button"
        className={micLive ? 'mic live' : wakeLabel ? 'mic wake' : 'mic'}
        aria-label={wakeLabel && !micLive ? `Voice command (listening for “${wakeLabel}”)` : 'Voice command'}
        aria-pressed={micLive}
        onClick={onMic}
      >
        <Mic className="wi" size="1em" strokeWidth={1.75} aria-hidden="true" />
      </button>
    )}
    {onMic && wakeLabel && !micLive && (
      <div className="wake" aria-hidden="true">
        {wakeLabel}
      </div>
    )}
    <button type="button" className="gear" aria-label="Display menu" onClick={onGear}>
      <SlidersHorizontal className="wi" size="1em" strokeWidth={1.75} aria-hidden="true" />
    </button>
  </nav>
);

export default WallRail;
