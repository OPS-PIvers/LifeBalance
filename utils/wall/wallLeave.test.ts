import { describe, expect, it } from 'vitest';
import type { WallEvent } from '@/types/schema';
import { leavePlan } from './wallLeave';

const MIN = 60_000;
const START = '2026-11-10T17:00:00-06:00';
const startMs = Date.parse(START);
const ev = (over: Partial<WallEvent> = {}): WallEvent => ({ id: 'e', source: 'feed', ownerKey: 'family', title: 'Soccer', allDay: false, date: '2026-11-10', start: START, ...over });
const before = (p: ReturnType<typeof leavePlan>) => (p ? [p.kind, (startMs - p.at) / MIN] : null);

describe('leavePlan', () => {
  it('leaves at start − trip − arrive-early when there is a trip', () => {
    expect(before(leavePlan(ev(), 20, 5))).toEqual(['leave', 25]);
    expect(before(leavePlan(ev({ earlyMin: 15 }), 20, 5))).toEqual(['leave', 35]);
  });

  it('counts to the stated arrival when no trip is known (no address, alerts off)', () => {
    expect(before(leavePlan(ev({ earlyMin: 15 }), null, 5))).toEqual(['arrive', 15]);
  });

  it("has no plan without a trip or the event's own word", () => {
    // The wall's own arrive-early setting is a margin on a trip, not an arrival time.
    expect(leavePlan(ev(), null, 10)).toBeNull();
    expect(leavePlan(ev({ earlyMin: 0 }), null, 10)).toBeNull();
  });

  it('keeps a stated leave time ahead of everything', () => {
    expect(before(leavePlan(ev({ leaveAt: '2026-11-10T16:20:00-06:00', earlyMin: 15 }), null, 5))).toEqual(['leave', 40]);
  });
});
