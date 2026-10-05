import React from 'react';
import { CalendarDays } from 'lucide-react';
import { longDateText } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import WallSpotlight from '@/components/wall/WallSpotlight';
import type { BriefState } from './useWallBrief';

interface WallBriefCardProps {
  state: BriefState;
  people: WallPeople;
  onClose: () => void;
}

/** The day brief on screen (plan §12): each line lights up as it's read. */
const WallBriefCard: React.FC<WallBriefCardProps> = ({ state, people, onClose }) => {
  const { brief, line, speaking } = state;
  return (
    <WallSpotlight
      tone="brief"
      icon={<CalendarDays className="wi" size="1em" />}
      kicker={longDateText(brief.date)}
      title={brief.day === 'today' ? 'Today' : 'Tomorrow'}
      label={brief.day === 'today' ? 'Your day' : 'Tomorrow'}
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
