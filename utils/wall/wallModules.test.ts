import { describe, expect, it } from 'vitest';
import { addModule, nextRotation, removeModule, suppressDuplicates, switchModule } from './wallModules';

describe('panel layout edits', () => {
  it('switches, adds and removes without ever showing a module twice', () => {
    const one = { modules: ['coming' as const] };
    expect(switchModule(one, 0, 'shopping')).toEqual({ modules: ['shopping'] });
    const two = addModule(one, 'todos');
    expect(two).toEqual({ modules: ['coming', 'todos'] });
    expect(addModule(two, 'meals')).toBe(two);
    expect(addModule(one, 'coming')).toBe(one);
    expect(switchModule(two, 1, 'coming')).toBe(two);
    expect(switchModule(two, 5, 'meals')).toBe(two);
    expect(removeModule(two, 0)).toEqual({ modules: ['todos'] });
    expect(removeModule(removeModule(two, 0), 0)).toEqual({ modules: [] });
  });

  it('drops Today’s own checklist or dinner when the panel already shows them', () => {
    expect(suppressDuplicates(['coming'])).toEqual({ showDueToday: true, showDinner: true });
    expect(suppressDuplicates(['todos', 'meals'])).toEqual({ showDueToday: false, showDinner: false });
  });
});

describe('nextRotation', () => {
  it('cycles the only module through the starting modules, then the rest', () => {
    const seq: string[] = [];
    let layout = { modules: ['coming' as const] } as { modules: ('coming' | 'shopping' | 'todos' | 'meals')[] };
    for (let i = 0; i < 5; i++) {
      layout = nextRotation(layout, ['coming', 'meals']);
      seq.push(layout.modules[0] ?? '');
    }
    expect(seq).toEqual(['meals', 'shopping', 'todos', 'coming', 'meals']);
  });

  it('keeps the top module and rotates only the bottom, never duplicating', () => {
    let layout = { modules: ['coming', 'shopping'] } as { modules: ('coming' | 'shopping' | 'todos' | 'meals')[] };
    const bottoms: string[] = [];
    for (let i = 0; i < 4; i++) {
      layout = nextRotation(layout, ['coming']);
      expect(layout.modules[0]).toBe('coming');
      bottoms.push(layout.modules[1] ?? '');
    }
    expect(bottoms).toEqual(['todos', 'meals', 'shopping', 'todos']);
  });

  it('leaves Today-only mode alone', () => {
    const empty = { modules: [] };
    expect(nextRotation(empty, ['coming'])).toBe(empty);
  });
});
