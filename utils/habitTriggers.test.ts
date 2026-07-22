import { describe, it, expect } from 'vitest';
import {
  TRIGGER_DEFINITIONS,
  AUTOMATED_TRIGGER_TYPES,
  attributionString,
  triggerDedupKey,
  shouldFireTrigger,
  TriggerSource,
} from '@/utils/habitTriggers';

describe('trigger definitions', () => {
  it('lists the three automated types, excluding manual', () => {
    expect(AUTOMATED_TRIGGER_TYPES).toEqual(['todo', 'geo', 'transaction']);
    expect(AUTOMATED_TRIGGER_TYPES).not.toContain('manual');
  });

  it('has no attribution prefix for manual', () => {
    expect(TRIGGER_DEFINITIONS.manual.attributionPrefix).toBeNull();
  });
});

describe('attributionString', () => {
  it('formats each automated source', () => {
    expect(attributionString({ type: 'todo', todoId: 't1', label: 'Mow the lawn' })).toBe(
      'via to-do: Mow the lawn',
    );
    expect(attributionString({ type: 'geo', locationId: 'l1', label: 'Target' })).toBe(
      'via location: Target',
    );
    expect(
      attributionString({
        type: 'transaction',
        transactionId: 'x1',
        habitId: 'h1',
        label: 'TARGET T-1234',
      }),
    ).toBe('via transaction: TARGET T-1234');
  });

  it('returns null for a manual fire', () => {
    expect(attributionString({ type: 'manual' })).toBeNull();
  });
});

describe('triggerDedupKey', () => {
  it('keys a to-do per to-do (date-independent)', () => {
    const source: TriggerSource = { type: 'todo', todoId: 't1', label: 'x' };
    expect(triggerDedupKey(source, '2026-07-22')).toBe('todo:t1');
    expect(triggerDedupKey(source, '2026-07-23')).toBe('todo:t1');
  });

  it('keys a transaction per (transaction, habit) pair (date-independent)', () => {
    const source: TriggerSource = {
      type: 'transaction',
      transactionId: 'x1',
      habitId: 'hA',
      label: 'x',
    };
    expect(triggerDedupKey(source, '2026-07-22')).toBe('txn:x1:hA');
  });

  it('keys the same transaction differently per habit', () => {
    const habitA: TriggerSource = {
      type: 'transaction',
      transactionId: 'x1',
      habitId: 'hA',
      label: 'x',
    };
    const habitB: TriggerSource = {
      type: 'transaction',
      transactionId: 'x1',
      habitId: 'hB',
      label: 'x',
    };
    expect(triggerDedupKey(habitA, '2026-07-22')).not.toBe(triggerDedupKey(habitB, '2026-07-22'));
  });

  it('keys geo per day per location', () => {
    const source: TriggerSource = { type: 'geo', locationId: 'l1', label: 'x' };
    expect(triggerDedupKey(source, '2026-07-22')).toBe('geo:l1:2026-07-22');
  });

  it('returns null for manual (never deduped)', () => {
    expect(triggerDedupKey({ type: 'manual' }, '2026-07-22')).toBeNull();
  });
});

describe('shouldFireTrigger', () => {
  const today = '2026-07-22';

  it('always fires a manual tap even when keys exist', () => {
    expect(shouldFireTrigger({ type: 'manual' }, today, ['todo:t1', 'txn:x1'])).toBe(true);
  });

  it('fires a to-do once, then suppresses the same to-do', () => {
    const source: TriggerSource = { type: 'todo', todoId: 't1', label: 'x' };
    expect(shouldFireTrigger(source, today, [])).toBe(true);
    expect(shouldFireTrigger(source, today, ['todo:t1'])).toBe(false);
  });

  it('fires a transaction once, then suppresses re-edits (same habit)', () => {
    const source: TriggerSource = {
      type: 'transaction',
      transactionId: 'x1',
      habitId: 'hA',
      label: 'x',
    };
    expect(shouldFireTrigger(source, today, [])).toBe(true);
    expect(shouldFireTrigger(source, today, ['txn:x1:hA'])).toBe(false);
  });

  it('firing habit A on a transaction does not block habit B on the same transaction', () => {
    const habitA: TriggerSource = {
      type: 'transaction',
      transactionId: 'x1',
      habitId: 'hA',
      label: 'x',
    };
    const habitB: TriggerSource = {
      type: 'transaction',
      transactionId: 'x1',
      habitId: 'hB',
      label: 'x',
    };
    const fired = ['txn:x1:hA'];
    expect(shouldFireTrigger(habitA, today, fired)).toBe(false);
    expect(shouldFireTrigger(habitB, today, fired)).toBe(true);
  });

  it('firing habit A twice on the same transaction is deduped', () => {
    const habitA: TriggerSource = {
      type: 'transaction',
      transactionId: 'x1',
      habitId: 'hA',
      label: 'x',
    };
    expect(shouldFireTrigger(habitA, today, [])).toBe(true);
    expect(shouldFireTrigger(habitA, today, ['txn:x1:hA'])).toBe(false);
  });

  it('suppresses geo the same day but allows it the next day', () => {
    const source: TriggerSource = { type: 'geo', locationId: 'l1', label: 'x' };
    expect(shouldFireTrigger(source, today, ['geo:l1:2026-07-22'])).toBe(false);
    expect(shouldFireTrigger(source, '2026-07-23', ['geo:l1:2026-07-22'])).toBe(true);
  });

  it('allows cross-trigger double-fires (different types, different keys)', () => {
    const todo: TriggerSource = { type: 'todo', todoId: 't1', label: 'x' };
    const geo: TriggerSource = { type: 'geo', locationId: 'l1', label: 'x' };
    const fired = ['todo:t1'];
    expect(shouldFireTrigger(todo, today, fired)).toBe(false);
    expect(shouldFireTrigger(geo, today, fired)).toBe(true);
  });
});
