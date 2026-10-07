import { describe, expect, it } from 'vitest';
import type { WallLayout } from '@/types/schema';
import { addModule, dayModule, nextRotation, removeModule, setDayModule, shownModules, switchModule, withTopModule } from './wallModules';

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

  it('keeps an empty panel off whatever the day column shows', () => {
    expect(withTopModule({ modules: [], day: 'coming' })).toEqual({ modules: ['shopping'], day: 'coming' });
  });
});

describe('the module under today', () => {
  it('defaults to Due today, unless the panel already shows it or To-dos', () => {
    expect(dayModule({ modules: ['coming'] })).toBe('due');
    expect(dayModule({ modules: ['todos', 'meals'] })).toBeNull();
    expect(dayModule({ modules: ['coming', 'due'] })).toBeNull();
    expect(shownModules({ modules: ['coming', 'meals'] })).toEqual(['coming', 'meals', 'due']);
  });

  it('shows an explicit pick, or nothing when removed', () => {
    expect(dayModule({ modules: ['coming'], day: 'shopping' })).toBe('shopping');
    expect(dayModule({ modules: ['coming'], day: null })).toBeNull();
    expect(dayModule({ modules: ['todos'], day: 'due' })).toBe('due');
  });

  it('switches the slot without ever showing a module twice', () => {
    const base: WallLayout = { modules: ['coming', 'meals'] };
    expect(setDayModule(base, 'shopping')).toEqual({ modules: ['coming', 'meals'], day: 'shopping' });
    expect(setDayModule(base, 'meals')).toBe(base);
    expect(setDayModule(base, null)).toEqual({ modules: ['coming', 'meals'], day: null });
    // The panel can't take what the day column shows.
    const withShopping: WallLayout = { modules: ['coming'], day: 'shopping' };
    expect(addModule(withShopping, 'shopping')).toBe(withShopping);
    expect(switchModule(withShopping, 0, 'shopping')).toBe(withShopping);
    expect(addModule({ modules: ['coming'] }, 'due')).toEqual({ modules: ['coming'] });
  });

  it('keeps the day slot through panel edits, and never writes an undefined day', () => {
    const picked: WallLayout = { modules: ['coming', 'meals'], day: 'shopping' };
    expect(removeModule(picked, 1)).toEqual({ modules: ['coming'], day: 'shopping' });
    expect(switchModule(picked, 0, 'todos')).toEqual({ modules: ['todos', 'meals'], day: 'shopping' });
    expect('day' in removeModule({ modules: ['coming', 'meals'] }, 1)).toBe(false);
  });
});

describe('nextRotation', () => {
  it('cycles the only module through the starting modules, then the rest', () => {
    const seq: string[] = [];
    let layout: WallLayout = { modules: ['coming'] };
    for (let i = 0; i < 6; i++) {
      layout = nextRotation(layout, ['coming', 'meals']);
      seq.push(layout.modules[0] ?? '');
    }
    // Due today joins once To-dos has taken it out of the day column.
    expect(seq).toEqual(['meals', 'shopping', 'todos', 'due', 'coming', 'meals']);
  });

  it('keeps the top module and rotates only the bottom, never duplicating', () => {
    let layout: WallLayout = { modules: ['coming', 'shopping'] };
    const bottoms: string[] = [];
    for (let i = 0; i < 4; i++) {
      layout = nextRotation(layout, ['coming']);
      expect(layout.modules[0]).toBe('coming');
      bottoms.push(layout.modules[1] ?? '');
    }
    expect(bottoms).toEqual(['todos', 'meals', 'shopping', 'todos']);
  });

  it('skips what the day column shows and keeps its pick', () => {
    const next = nextRotation({ modules: ['coming', 'meals'], day: 'shopping' }, ['coming']);
    expect(next).toEqual({ modules: ['coming', 'due'], day: 'shopping' });
  });

  it('leaves an empty layout alone (the panel fills it with Coming up)', () => {
    const empty = { modules: [] };
    expect(nextRotation(empty, ['coming'])).toBe(empty);
  });
});
