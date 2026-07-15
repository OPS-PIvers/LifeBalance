import { describe, it, expect } from 'vitest';
import {
  TRASH_RETENTION_DAYS,
  TRASH_DOMAIN_META,
  trashDocId,
  isTrashDomain,
  isTrashExpired,
  daysUntilPurge,
  trashItemTitle,
  type TrashedItem,
} from '@/utils/trash';

const DAY = 24 * 60 * 60 * 1000;

function makeItem(overrides: Partial<TrashedItem> = {}): TrashedItem {
  return {
    id: 'todo_abc',
    domain: 'todo',
    originalId: 'abc',
    data: {},
    deletedAt: '2026-07-01T12:00:00.000Z',
    deletedBy: 'user-1',
    ...overrides,
  };
}

describe('trashDocId', () => {
  it('is deterministic per domain + original id', () => {
    expect(trashDocId('meal', 'm1')).toBe('meal_m1');
    expect(trashDocId('todo', 'm1')).not.toBe(trashDocId('meal', 'm1'));
  });
});

describe('isTrashDomain', () => {
  it('accepts known domains and rejects everything else', () => {
    for (const key of Object.keys(TRASH_DOMAIN_META)) {
      expect(isTrashDomain(key)).toBe(true);
    }
    expect(isTrashDomain('transaction')).toBe(false);
    expect(isTrashDomain(42)).toBe(false);
    expect(isTrashDomain(null)).toBe(false);
  });
});

describe('isTrashExpired', () => {
  const deletedAt = '2026-07-01T00:00:00.000Z';
  it('is false before the retention window closes', () => {
    const now = new Date(new Date(deletedAt).getTime() + (TRASH_RETENTION_DAYS - 1) * DAY);
    expect(isTrashExpired(deletedAt, now)).toBe(false);
  });
  it('is true once the retention window has fully elapsed', () => {
    const now = new Date(new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * DAY);
    expect(isTrashExpired(deletedAt, now)).toBe(true);
  });
  it('fails safe (not expired) for a malformed timestamp', () => {
    expect(isTrashExpired('not-a-date', new Date())).toBe(false);
  });
});

describe('daysUntilPurge', () => {
  const deletedAt = '2026-07-01T00:00:00.000Z';
  it('reports the full window right after deletion', () => {
    const now = new Date(deletedAt);
    expect(daysUntilPurge(deletedAt, now)).toBe(TRASH_RETENTION_DAYS);
  });
  it('counts down and clamps to 0 past expiry', () => {
    const midway = new Date(new Date(deletedAt).getTime() + 10 * DAY);
    expect(daysUntilPurge(deletedAt, midway)).toBe(TRASH_RETENTION_DAYS - 10);
    const past = new Date(new Date(deletedAt).getTime() + 40 * DAY);
    expect(daysUntilPurge(deletedAt, past)).toBe(0);
  });
  it('returns 0 for a malformed timestamp', () => {
    expect(daysUntilPurge('nonsense', new Date())).toBe(0);
  });
});

describe('trashItemTitle', () => {
  it('probes name-like fields across domains', () => {
    expect(trashItemTitle(makeItem({ data: { name: 'Milk' } }))).toBe('Milk');
    expect(trashItemTitle(makeItem({ data: { title: 'Pay rent' } }))).toBe('Pay rent');
    expect(trashItemTitle(makeItem({ data: { text: 'Take out trash' } }))).toBe('Take out trash');
    expect(trashItemTitle(makeItem({ data: { merchant: 'Target' } }))).toBe('Target');
  });
  it('prefers name over other fields', () => {
    expect(trashItemTitle(makeItem({ data: { name: 'A', title: 'B' } }))).toBe('A');
  });
  it('falls back to the domain label when nothing usable is present', () => {
    expect(trashItemTitle(makeItem({ domain: 'habit', data: {} }))).toBe('Habit');
    expect(trashItemTitle(makeItem({ domain: 'meal', data: { name: '   ' } }))).toBe('Meal');
  });
});
