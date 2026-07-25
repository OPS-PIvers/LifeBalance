import { describe, it, expect } from 'vitest';
import { buildToDosFromTemplate } from '@/utils/taskTemplates';
import { TaskTemplate } from '@/types/schema';

describe('buildToDosFromTemplate', () => {
  const today = '2026-07-14';

  it('builds one to-do payload per item, falling back to the applying user', () => {
    const template: TaskTemplate = {
      id: 't1',
      name: 'Trash day',
      items: [
        { text: 'Take out trash' },
        { text: 'Bring in bins', assignedTo: 'uid-kid' },
      ],
    };

    const result = buildToDosFromTemplate(template, today, 'uid-parent');

    expect(result).toEqual([
      {
        text: 'Take out trash',
        completeByDate: today,
        assignedTo: 'uid-parent',
        isCompleted: false,
        source: 'manual',
      },
      {
        text: 'Bring in bins',
        completeByDate: today,
        assignedTo: 'uid-kid',
        isCompleted: false,
        source: 'manual',
      },
    ]);
  });

  it('trims item text', () => {
    const template: TaskTemplate = {
      id: 't2',
      name: 'Guest prep',
      items: [{ text: '  Clean bathroom  ' }],
    };

    const result = buildToDosFromTemplate(template, today, 'uid-parent');

    expect(result[0]?.text).toBe('Clean bathroom');
  });

  it('drops blank items', () => {
    const template: TaskTemplate = {
      id: 't3',
      name: 'Empty-ish',
      items: [{ text: '   ' }, { text: 'Real task' }],
    };

    const result = buildToDosFromTemplate(template, today, 'uid-parent');

    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('Real task');
  });

  it('never includes points on the created payload (todos rules whitelist gap)', () => {
    const template: TaskTemplate = {
      id: 't4',
      name: 'Chores',
      items: [{ text: 'Vacuum', points: 10 }],
    };

    const result = buildToDosFromTemplate(template, today, 'uid-parent');

    expect(result[0]).not.toHaveProperty('points');
  });

  it('carries a template item category onto the spawned to-do (F-TODO-16)', () => {
    const template: TaskTemplate = {
      id: 't6',
      name: 'Saturday reset',
      items: [{ text: 'Vacuum', category: 'Household' }],
    };

    expect(buildToDosFromTemplate(template, today, 'uid-parent')[0]?.category).toBe('Household');
  });

  it('omits category entirely when the template item has none or it is blank', () => {
    const template: TaskTemplate = {
      id: 't7',
      name: 'Mixed',
      items: [{ text: 'No category' }, { text: 'Blank category', category: '   ' }],
    };

    const result = buildToDosFromTemplate(template, today, 'uid-parent');

    // Absence is the canonical "Uncategorized" value — never an empty string.
    expect(result[0]).not.toHaveProperty('category');
    expect(result[1]).not.toHaveProperty('category');
  });

  it('trims a template item category', () => {
    const template: TaskTemplate = {
      id: 't8',
      name: 'Padded',
      items: [{ text: 'Sweep', category: '  Household  ' }],
    };

    expect(buildToDosFromTemplate(template, today, 'uid-parent')[0]?.category).toBe('Household');
  });

  it('returns an empty array for a template with no items', () => {
    const template: TaskTemplate = { id: 't5', name: 'Empty', items: [] };

    expect(buildToDosFromTemplate(template, today, 'uid-parent')).toEqual([]);
  });
});
