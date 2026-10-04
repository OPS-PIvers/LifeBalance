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
  onMic: () => void;
  onGear: () => void;
}

const WallRail: React.FC<WallRailProps> = ({ view, onView, todoBadge, offline, onOfflineInfo, onMic, onGear }) => (
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
    {/* Voice ships in Phase 6; until then the button explains itself. */}
    <button type="button" className="mic" aria-disabled="true" aria-label="Voice commands (coming soon)" onClick={onMic}>
      <Mic className="wi" size="1em" strokeWidth={1.75} aria-hidden="true" />
    </button>
    <button type="button" className="gear" aria-label="Display menu" onClick={onGear}>
      <SlidersHorizontal className="wi" size="1em" strokeWidth={1.75} aria-hidden="true" />
    </button>
  </nav>
);

export default WallRail;
