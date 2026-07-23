import { describe, it, expect } from 'vitest';
import { Subtask } from '@/types/schema';
import {
  newSubtaskId,
  makeSubtask,
  subtaskProgress,
  toggleSubtask,
  removeSubtask,
  updateSubtaskText,
  appendSubtask,
  subtasksFromTexts,
  subtaskLinesFromPaste,
  isPermissionDeniedError,
  subtaskWriteErrorMessage,
  setSubtaskAssignee,
} from '@/utils/subtasks';

const st = (id: string, text: string, isDone = false): Subtask => ({ id, text, isDone });

describe('newSubtaskId', () => {
  it('returns unique non-empty strings', () => {
    const a = newSubtaskId();
    const b = newSubtaskId();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('makeSubtask', () => {
  it('creates an incomplete subtask with trimmed text', () => {
    const s = makeSubtask('  Book venue  ');
    expect(s).not.toBeNull();
    expect(s?.text).toBe('Book venue');
    expect(s?.isDone).toBe(false);
    expect(s?.id).toBeTruthy();
  });

  it('returns null for blank text', () => {
    expect(makeSubtask('   ')).toBeNull();
    expect(makeSubtask('')).toBeNull();
  });
});

describe('subtaskProgress', () => {
  it('handles undefined and empty as zero', () => {
    expect(subtaskProgress(undefined)).toEqual({ done: 0, total: 0, fraction: 0, allDone: false });
    expect(subtaskProgress([])).toEqual({ done: 0, total: 0, fraction: 0, allDone: false });
  });

  it('counts done vs total and computes fraction', () => {
    const list = [st('1', 'a', true), st('2', 'b', false), st('3', 'c', false), st('4', 'd', false)];
    const p = subtaskProgress(list);
    expect(p.done).toBe(1);
    expect(p.total).toBe(4);
    expect(p.fraction).toBeCloseTo(0.25);
    expect(p.allDone).toBe(false);
  });

  it('flags allDone only when every subtask is done', () => {
    expect(subtaskProgress([st('1', 'a', true), st('2', 'b', true)]).allDone).toBe(true);
    expect(subtaskProgress([st('1', 'a', true), st('2', 'b', false)]).allDone).toBe(false);
  });
});

describe('toggleSubtask', () => {
  it('flips only the target and returns a new array', () => {
    const list = [st('1', 'a', false), st('2', 'b', false)];
    const next = toggleSubtask(list, '1');
    expect(next).not.toBe(list);
    const first = next[0];
    const second = next[1];
    expect(first?.isDone).toBe(true);
    expect(second?.isDone).toBe(false);
    // original untouched
    expect(list[0]?.isDone).toBe(false);
  });

  it('is a no-op for unknown id / undefined', () => {
    expect(toggleSubtask([st('1', 'a')], 'x')).toEqual([st('1', 'a')]);
    expect(toggleSubtask(undefined, 'x')).toEqual([]);
  });
});

describe('removeSubtask', () => {
  it('removes the matching subtask', () => {
    expect(removeSubtask([st('1', 'a'), st('2', 'b')], '1')).toEqual([st('2', 'b')]);
  });

  it('handles undefined', () => {
    expect(removeSubtask(undefined, '1')).toEqual([]);
  });
});

describe('updateSubtaskText', () => {
  it('updates and trims the matching subtask text', () => {
    const next = updateSubtaskText([st('1', 'a'), st('2', 'b')], '2', '  new  ');
    expect(next[1]?.text).toBe('new');
  });

  it('ignores blank text (keeps original)', () => {
    const list = [st('1', 'a')];
    expect(updateSubtaskText(list, '1', '   ')).toEqual(list);
  });
});

describe('appendSubtask', () => {
  it('appends a built subtask', () => {
    const next = appendSubtask([st('1', 'a')], 'Order cake');
    expect(next).toHaveLength(2);
    expect(next[1]?.text).toBe('Order cake');
    expect(next[1]?.isDone).toBe(false);
  });

  it('ignores blank input', () => {
    const list = [st('1', 'a')];
    expect(appendSubtask(list, '  ')).toEqual(list);
    expect(appendSubtask(undefined, '  ')).toEqual([]);
  });
});

describe('subtasksFromTexts', () => {
  it('builds incomplete subtasks and drops blanks', () => {
    const list = subtasksFromTexts(['Book venue', '  ', 'Order cake', '']);
    expect(list).toHaveLength(2);
    expect(list.map(s => s.text)).toEqual(['Book venue', 'Order cake']);
    expect(list.every(s => s.isDone === false)).toBe(true);
    expect(new Set(list.map(s => s.id)).size).toBe(2);
  });
});

describe('isPermissionDeniedError', () => {
  it('detects Firestore permission-denied code', () => {
    expect(isPermissionDeniedError({ code: 'permission-denied' })).toBe(true);
    expect(isPermissionDeniedError({ code: 'firestore/permission-denied' })).toBe(true);
  });

  it('detects permission in the message', () => {
    expect(isPermissionDeniedError(new Error('Missing or insufficient permissions.'))).toBe(true);
  });

  it('returns false for unrelated / non-object errors', () => {
    expect(isPermissionDeniedError({ code: 'unavailable' })).toBe(false);
    expect(isPermissionDeniedError(new Error('network'))).toBe(false);
    expect(isPermissionDeniedError(null)).toBe(false);
    expect(isPermissionDeniedError('nope')).toBe(false);
  });
});

describe('setSubtaskAssignee', () => {
  it('sets the assignee on the matching subtask', () => {
    const next = setSubtaskAssignee([st('1', 'a'), st('2', 'b')], '2', 'uid-1');
    expect(next[1]).toEqual({ id: '2', text: 'b', isDone: false, assigneeId: 'uid-1' });
    expect(next[0]).toEqual(st('1', 'a'));
  });

  it('clears the assignee (drops the key, never writes undefined)', () => {
    const withAssignee = [{ id: '1', text: 'a', isDone: false, assigneeId: 'uid-1' }];
    const next = setSubtaskAssignee(withAssignee, '1', undefined);
    expect(next[0]).toEqual({ id: '1', text: 'a', isDone: false });
    expect(next[0] && 'assigneeId' in next[0]).toBe(false);
  });

  it('handles undefined and unknown id', () => {
    expect(setSubtaskAssignee(undefined, 'x', 'uid-1')).toEqual([]);
    const list = [st('1', 'a')];
    expect(setSubtaskAssignee(list, 'x', 'uid-1')).toEqual(list);
  });
});

describe('subtaskWriteErrorMessage', () => {
  it('gives a specific message for permission errors', () => {
    expect(subtaskWriteErrorMessage({ code: 'permission-denied' })).toMatch(/couldn't be saved/i);
  });

  it('gives a generic message otherwise', () => {
    expect(subtaskWriteErrorMessage(new Error('boom'))).toBe('Failed to update subtask');
  });
});

describe('subtaskLinesFromPaste', () => {
  it('splits lines, strips bullets/numbering, drops blanks', () => {
    expect(subtaskLinesFromPaste('- Milk\n2) Eggs\n\n• Bread\r\n  * Butter  ')).toEqual([
      'Milk', 'Eggs', 'Bread', 'Butter',
    ]);
  });

  it('keeps a plain single line as one label', () => {
    expect(subtaskLinesFromPaste('Just one step')).toEqual(['Just one step']);
  });

  it('clamps each line to 200 chars', () => {
    const long = 'x'.repeat(250);
    expect(subtaskLinesFromPaste(long)[0]).toHaveLength(200);
  });

  it('returns [] for whitespace-only input', () => {
    expect(subtaskLinesFromPaste('  \n \r\n')).toEqual([]);
  });
});
