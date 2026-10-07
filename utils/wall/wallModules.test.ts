import { describe, expect, it } from 'vitest';
import { addModule, nextRotation, removeModule, suppressDuplicates, switchModule, withTopModule } from './wallModules';

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
    expect(removeModule(two, 1)).toEqual({ modules: ['coming'] });
  });

  it('never removes the top module, and fills an empty panel with Coming up', () => {
    const two = { modules: ['coming' as const, 'todos' as const] };
    expect(removeModule(two, 0)).toBe(two);
    const one = { modules: ['shopping' as const] };
    expect(removeModule(one, 0)).toBe(one);
    expect(withTopModule({ modules: [] })).toEqual({ modules: ['coming'] });
    expect(withTopModule(one)).toBe(one);
  });

  it('drops Today’s own checklist when the panel already shows To-dos', () => {
    expect(suppressDuplicates(['coming'])).toEqual({ showDueToday: true });
    expect(suppressDuplicates(['todos', 'meals'])).toEqual({ showDueToday: false });
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

  it('leaves an empty layout alone (the panel fills it with Coming up)', () => {
    const empty = { modules: [] };
    expect(nextRotation(empty, ['coming'])).toBe(empty);
  });
});
