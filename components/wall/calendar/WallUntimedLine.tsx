import React from 'react';
import type { WallEvent } from '@/types/schema';
import type { WallPeople } from '@/utils/wall/wallPeople';

/**
 * A day's untimed items as one quiet line: an all-day event with its
 * owner's color pip, a bill marked $, a holiday as plain text. They never
 * get a row of their own, so nothing pretends to have a time.
 */
const WallUntimedLine: React.FC<{ events: readonly WallEvent[]; people: WallPeople }> = ({ events, people }) => (
  <div className="untimed">
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
  </div>
);

export default WallUntimedLine;
