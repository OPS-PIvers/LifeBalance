import { describe, it, expect } from 'vitest';
import {
  evaluateTodoSubtaskGate,
  TodoSubtasksIncompleteError,
  isTodoSubtasksIncompleteError,
} from '@/utils/todoSubtaskGate';
import { ToDo, Subtask } from '@/types/schema';

const st = (isDone: boolean, id: string): Subtask => ({ id, text: id, isDone });

function makeTodo(overrides: Partial<ToDo> = {}): ToDo {
  return {
    id: 't1',
    text: 'Task',
    completeByDate: '2026-07-22',
    assignedTo: 'u1',
    isCompleted: false,
    createdBy: 'u1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('evaluateTodoSubtaskGate', () => {
  it('does not block an unlinked to-do even with unfinished subtasks', () => {
    const gate = evaluateTodoSubtaskGate(makeTodo({ subtasks: [st(false, 'a')] }));
    expect(gate.blocked).toBe(false);
    expect(gate.stepsLeft).toBe(0);
  });

  it('does not block a linked to-do with no subtasks', () => {
    const gate = evaluateTodoSubtaskGate(makeTodo({ linkedHabitId: 'h1' }));
    expect(gate.blocked).toBe(false);
  });

  it('does not block a linked to-do whose subtasks are all done', () => {
    const gate = evaluateTodoSubtaskGate(
      makeTodo({ linkedHabitId: 'h1', subtasks: [st(true, 'a'), st(true, 'b')] }),
    );
    expect(gate.blocked).toBe(false);
    expect(gate.stepsLeft).toBe(0);
  });

  it('blocks a linked to-do with unfinished subtasks and counts steps left', () => {
    const gate = evaluateTodoSubtaskGate(
      makeTodo({ linkedHabitId: 'h1', subtasks: [st(true, 'a'), st(false, 'b'), st(false, 'c')] }),
    );
    expect(gate.blocked).toBe(true);
    expect(gate.stepsLeft).toBe(2);
  });
});

describe('TodoSubtasksIncompleteError', () => {
  it('is recognized structurally even after losing its prototype', () => {
    const err = new TodoSubtasksIncompleteError('t1', 'Task', 2);
    expect(isTodoSubtasksIncompleteError(err)).toBe(true);
    // A structural clone (e.g. crossing an async boundary) still matches on code.
    const clone = { code: 'todo-subtasks-incomplete', stepsLeft: 2, title: 'Task' };
    expect(isTodoSubtasksIncompleteError(clone)).toBe(true);
    expect(isTodoSubtasksIncompleteError(new Error('nope'))).toBe(false);
    expect(isTodoSubtasksIncompleteError(null)).toBe(false);
  });
});
