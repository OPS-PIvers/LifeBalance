import { describe, it, expect } from 'vitest';
import {
  buildActivityLogEntry,
  composeSummary,
  resolveActorName,
  type ActivityActor,
} from '@/utils/activityLog';

const actor: ActivityActor = { uid: 'u1', name: 'Paul' };

describe('resolveActorName', () => {
  it('trims and passes through a real name', () => {
    expect(resolveActorName('  Mia  ')).toBe('Mia');
  });

  it('falls back for empty / whitespace / nullish names', () => {
    expect(resolveActorName('')).toBe('Someone');
    expect(resolveActorName('   ')).toBe('Someone');
    expect(resolveActorName(null)).toBe('Someone');
    expect(resolveActorName(undefined)).toBe('Someone');
  });
});

describe('composeSummary', () => {
  it('renders an amount as whole dollars', () => {
    expect(composeSummary('Paul', 'paid', 'Electric Bill', 142)).toBe(
      'Paul paid Electric Bill ($142)'
    );
  });

  it('omits the amount when not provided', () => {
    expect(composeSummary('Kid', 'completed', 'Reading habit')).toBe(
      'Kid completed Reading habit'
    );
  });

  it('rounds/formats amounts and uses the actor fallback', () => {
    expect(composeSummary('', 'deleted', '3 shopping items')).toBe(
      'Someone deleted 3 shopping items'
    );
  });
});

describe('buildActivityLogEntry', () => {
  it('produces a persisted shape without an id, preserving the timestamp sentinel', () => {
    const ts = '2026-07-14T12:00:00.000Z';
    const entry = buildActivityLogEntry(
      actor,
      { domain: 'money', action: 'bill_paid', summary: 'Paul paid Electric Bill ($142)' },
      ts
    );
    expect(entry).toEqual({
      actorUid: 'u1',
      actorName: 'Paul',
      domain: 'money',
      action: 'bill_paid',
      summary: 'Paul paid Electric Bill ($142)',
      timestamp: ts,
    });
    expect('id' in entry).toBe(false);
  });

  it('normalises a blank actor name', () => {
    const entry = buildActivityLogEntry(
      { uid: 'u2', name: '   ' },
      { domain: 'habit', action: 'habit_completed', summary: 'x' },
      'ts'
    );
    expect(entry.actorName).toBe('Someone');
  });
});
