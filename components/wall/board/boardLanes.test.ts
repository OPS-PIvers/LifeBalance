import { describe, expect, it } from 'vitest';
import type { ToDo, WallEvent } from '@/types/schema';
import type { TodayRow } from '@/utils/wall/wallCalendar';
import { BOARD_OTHERS, boardLanes } from './boardLanes';
import { boardLayout } from './boardPreview';

const row = (id: string, ownerKey?: string): TodayRow => ({ event: { id, title: id, ownerKey } as WallEvent, time: '9:00', past: false });
const todo = (id: string, assignedTo?: string): ToDo => ({ id, text: id, assignedTo, completeByDate: '2026-10-07', isCompleted: false }) as ToDo;
const keys = (lanes: ReturnType<typeof boardLanes>) => lanes.map(l => l.key);

describe('boardLanes', () => {
  it('puts events by owner and to-dos by assignee, unassigned to-dos under Everyone', () => {
    const lanes = boardLanes([row('market', 'family'), row('piano', 'leo'), row('call', undefined)], [todo('recycling'), todo('bed', 'leo'), todo('run', 'alex')], ['alex', 'jordan', 'leo']);
    expect(keys(lanes)).toEqual(['family', 'alex', 'jordan', 'leo']);
    const by = Object.fromEntries(lanes.map(l => [l.key, { rows: l.rows.map(r => r.event.id), todos: l.todos.map(t => t.id) }]));
    expect(by['family']).toEqual({ rows: ['market', 'call'], todos: ['recycling'] });
    expect(by['leo']).toEqual({ rows: ['piano'], todos: ['bed'] });
    expect(by['alex']).toEqual({ rows: [], todos: ['run'] });
    expect(by['jordan']).toEqual({ rows: [], todos: [] });
  });

  it('sends a former member\'s to-dos to Others rather than dropping them', () => {
    const lanes = boardLanes([], [todo('old', 'gone')], ['alex']);
    expect(keys(lanes)).toEqual(['family', 'alex', BOARD_OTHERS]);
    expect(lanes[2]?.todos.map(t => t.id)).toEqual(['old']);
  });

  it('keeps Everyone plus three people and an Others lane past four members', () => {
    const lanes = boardLanes([row('e', 'p5')], [todo('t', 'p4')], ['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(keys(lanes)).toEqual(['family', 'p1', 'p2', 'p3', BOARD_OTHERS]);
    expect(lanes[4]?.rows.map(r => r.event.id)).toEqual(['e']);
    expect(lanes[4]?.todos.map(t => t.id)).toEqual(['t']);
  });
});

describe('boardLayout', () => {
  it('fills the second slot from the day module, but not with Due today (the lanes show it)', () => {
    expect(boardLayout({ modules: ['coming'], day: 'meals' }).modules).toEqual(['coming', 'meals']);
    expect(boardLayout({ modules: ['coming'], day: 'due' }).modules).toEqual(['coming', 'shopping']);
    expect(boardLayout({ modules: ['shopping'], day: 'due' }).modules).toEqual(['shopping', 'meals']);
  });

  it('keeps a second module the family picked, Due today included', () => {
    expect(boardLayout({ modules: ['coming', 'due'], day: null }).modules).toEqual(['coming', 'due']);
  });
});
