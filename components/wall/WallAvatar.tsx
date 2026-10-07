import React from 'react';
import type { WallPeople } from '@/utils/wall/wallPeople';

/** A member's filled initial in their color (the day column and Day view). */
export const WallAvatar: React.FC<{ people: WallPeople; who: string | undefined; small?: boolean }> = ({ people, who, small = false }) => (
  <span className={small ? 'av sm' : 'av'} style={{ '--c': people.color(who) } as React.CSSProperties} aria-hidden="true">
    {people.initial(who)}
  </span>
);

/** A member's color dot (the panel and Month, where an initial costs too much room). */
export const WallDot: React.FC<{ people: WallPeople; who: string | undefined }> = ({ people, who }) => (
  <span className="dot" style={{ background: people.color(who) }} aria-hidden="true" />
);
