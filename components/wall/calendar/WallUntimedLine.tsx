import React, { useRef } from 'react';
import type { WallEvent } from '@/types/schema';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useLineClamp } from '@/components/wall/useWallFit';

interface WallUntimedLineProps {
  events: readonly WallEvent[];
  people: WallPeople;
  /** At most this many rows; the rest fold into "+N more". Unset → every item. */
  lines?: number;
  /** Tapping "+N more" (where the whole list is). */
  onMore?: () => void;
}

/**
 * A day's untimed items as one quiet line: an all-day event with its
 * owner's color pip, a bill marked $, a holiday as plain text. They never
 * get a row of their own, so nothing pretends to have a time.
 */
const WallUntimedLine: React.FC<WallUntimedLineProps> = ({ events, people, lines, onMore }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLineClamp(ref, lines ?? Infinity);
  return (
    <div className="untimed" ref={ref}>
      {events.map(e =>
        e.source === 'bill' ? (
          <span key={e.id} className="bill">
            {e.title}
          </span>
        ) : e.source === 'holiday' ? (
          <span key={e.id}>{e.title}</span>
        ) : (
          <span key={e.id}>
            <i className="pip" style={{ background: people.color(e.ownerKey) }} aria-hidden="true" />
            {e.title}
          </span>
        )
      )}
      {/* "+N more": its text is written by useLineClamp. */}
      {onMore ? <button type="button" className="more" hidden onClick={onMore} /> : <span className="more" hidden />}
    </div>
  );
};

export default WallUntimedLine;
