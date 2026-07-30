import { describe, it, expect } from 'vitest';
import { findLeaderId, isLeader, type LeaderCandidate } from '@/utils/pointsLeader';

describe('findLeaderId', () => {
  it('crowns the strict leader among two candidates', () => {
    const candidates: LeaderCandidate[] = [
      { memberId: 'jen', points: 325 },
      { memberId: 'paul', points: 285 },
    ];
    expect(findLeaderId(candidates)).toBe('jen');
  });

  it('crowns the strict leader in a net-negative week — lost the least still wins', () => {
    // Paul -5, Jen -20 — nonzero and Paul's is strictly the higher (less negative).
    const candidates: LeaderCandidate[] = [
      { memberId: 'paul', points: -5 },
      { memberId: 'jen', points: -20 },
    ];
    expect(findLeaderId(candidates)).toBe('paul');
  });

  it('never crowns a tie', () => {
    const candidates: LeaderCandidate[] = [
      { memberId: 'jen', points: 50 },
      { memberId: 'paul', points: 50 },
    ];
    expect(findLeaderId(candidates)).toBeNull();
  });

  it('never crowns an all-zero field', () => {
    const candidates: LeaderCandidate[] = [
      { memberId: 'jen', points: 0 },
      { memberId: 'paul', points: 0 },
    ];
    expect(findLeaderId(candidates)).toBeNull();
  });

  it('never crowns a solo candidate — nothing to lead over', () => {
    expect(findLeaderId([{ memberId: 'jen', points: 40 }])).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(findLeaderId([])).toBeNull();
  });

  it('crowns the leader even when every candidate is negative and tied for last', () => {
    const candidates: LeaderCandidate[] = [
      { memberId: 'jen', points: -5 },
      { memberId: 'paul', points: -20 },
      { memberId: 'sam', points: -20 },
    ];
    expect(findLeaderId(candidates)).toBe('jen');
  });

  it('does not re-sort — an unsorted list is judged only on its first two entries', () => {
    // Candidates must be pre-sorted by the caller; this only asks whether
    // index 0 beats index 1. Handed an unsorted list where a LATER entry
    // actually has the higher score, index 0 (10) reads as behind index 1
    // (500) and nobody is crowned — the function trusts the caller's order.
    const candidates: LeaderCandidate[] = [
      { memberId: 'paul', points: 10 },
      { memberId: 'jen', points: 500 },
    ];
    expect(findLeaderId(candidates)).toBeNull();
  });
});

describe('isLeader', () => {
  const candidates: LeaderCandidate[] = [
    { memberId: 'jen', points: 325 },
    { memberId: 'paul', points: 285 },
  ];

  it('is true only for the sole leader', () => {
    expect(isLeader(candidates, 'jen')).toBe(true);
    expect(isLeader(candidates, 'paul')).toBe(false);
  });

  it('is false for every candidate on a tie', () => {
    const tied: LeaderCandidate[] = [
      { memberId: 'jen', points: 50 },
      { memberId: 'paul', points: 50 },
    ];
    expect(isLeader(tied, 'jen')).toBe(false);
    expect(isLeader(tied, 'paul')).toBe(false);
  });
});
