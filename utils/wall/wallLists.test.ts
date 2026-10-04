import { describe, expect, it } from 'vitest';
import type { ShoppingItem, ToDo } from '@/types/schema';
import { groupTodos, sortShopping } from './wallLists';

const T = '2026-10-03';
const todo = (id: string, date: string, extra: Partial<ToDo> = {}): ToDo =>
  ({ id, text: id, completeByDate: date, isCompleted: false, ...extra }) as ToDo;

describe('groupTodos', () => {
  const list = [
    todo('late', '2026-10-01'),
    todo('today', T, { assignedTo: 'p' }),
    todo('done today', T, { isCompleted: true, completedAt: '2026-10-03T18:00:00Z' }),
    todo('done before', T, { isCompleted: true, completedAt: '2026-10-02T18:00:00Z' }),
    todo('fri', '2026-10-09', { assignedTo: 'l' }),
    todo('too far', '2026-10-10'),
  ];

  it('groups Overdue / Today / This week and counts open items', () => {
    const groups = groupTodos(list, T, 'America/Chicago');
    expect(groups.map(g => [g.title, g.items.map(t => t.id), g.open])).toEqual([
      ['Overdue', ['late'], 1],
      ['Today', ['done today', 'today'], 1],
      ['This week', ['fri'], 1],
    ]);
  });

  it('filters by person, with family meaning unassigned', () => {
    expect(groupTodos(list, T, 'America/Chicago', 'l').flatMap(g => g.items.map(t => t.id))).toEqual(['fri']);
    expect(groupTodos(list, T, 'America/Chicago', 'family').flatMap(g => g.items.map(t => t.id))).toEqual(['late', 'done today']);
  });
});

describe('sortShopping', () => {
  it('uses the manual order, then the name', () => {
    const items = [
      { id: 'b', name: 'Bread', order: 2 },
      { id: 'a', name: 'Apples' },
      { id: 'm', name: 'Milk', order: 1 },
    ] as ShoppingItem[];
    expect(sortShopping(items).map(i => i.id)).toEqual(['m', 'b', 'a']);
  });
});
