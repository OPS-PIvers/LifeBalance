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

  it('returns an empty array for a template with no items', () => {
    const template: TaskTemplate = { id: 't5', name: 'Empty', items: [] };

    expect(buildToDosFromTemplate(template, today, 'uid-parent')).toEqual([]);
  });
});
