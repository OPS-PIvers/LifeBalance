import React from 'react';
import { CalendarDays, Clock, CloudSun, ListChecks, UtensilsCrossed } from 'lucide-react';
import type { BriefIcon } from '@/utils/wall/wallBrief';
import type { WallPeople } from '@/utils/wall/wallPeople';
import WallSpotlight from '@/components/wall/WallSpotlight';
import type { BriefState } from './useWallBrief';

interface WallBriefCardProps {
  state: BriefState;
  people: WallPeople;
  onClose: () => void;
}

const ICONS: Record<BriefIcon, React.ComponentType<{ className?: string; size?: string }>> = {
  calendar: CalendarDays,
  weather: CloudSun,
  meal: UtensilsCrossed,
  list: ListChecks,
  clock: Clock,
};

/** The day brief and spoken answers on screen (plan §12): each line lights up as it's read. */
const WallBriefCard: React.FC<WallBriefCardProps> = ({ state, people, onClose }) => {
  const { brief, line, speaking } = state;
  const Icon = ICONS[brief.icon];
  return (
    <WallSpotlight
      tone="brief"
      icon={<Icon className="wi" size="1em" />}
      kicker={brief.kicker}
      title={brief.title}
      label={brief.label}
      onClose={onClose}
      actions={
        <button type="button" className="btn" onClick={onClose}>
          {speaking ? 'Stop' : 'Close'}
        </button>
      }
    >
      <ul className="brf">
        {brief.lines.map((l, i) => (
          <li
            key={`${l.kind}-${i}`}
            className={[l.kind, i === line ? 'cur' : ''].filter(Boolean).join(' ')}
            style={l.ownerKey ? ({ '--c': people.color(l.ownerKey) } as React.CSSProperties) : undefined}
          >
            {l.ownerKey && <span className="dot" aria-hidden="true" />}
            {l.text}
          </li>
        ))}
      </ul>
    </WallSpotlight>
  );
};

export default WallBriefCard;
