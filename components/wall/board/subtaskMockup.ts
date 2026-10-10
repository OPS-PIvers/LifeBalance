import type { Subtask, ToDo } from '@/types/schema';

/**
 * MOCKUP ONLY (lane steps). `#/wall?board=1&subs=short|long&steps=shown|tap`
 * seeds Test Mode with to-dos that have short or long step lists, and picks
 * how a lane shows them: always shown, or behind a tap.
 */
function hashParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

export type LaneStepsMode = 'shown' | 'tap';

export function laneStepsMode(): LaneStepsMode {
  return hashParams().get('steps') === 'tap' ? 'tap' : 'shown';
}

const steps = (prefix: string, list: readonly (string | [string, true])[]): Subtask[] =>
  list.map((s, i) => (typeof s === 'string' ? { id: `${prefix}${i}`, text: s, isDone: false } : { id: `${prefix}${i}`, text: s[0], isDone: true }));

export function subtaskMockTodos(today: string): ToDo[] | null {
  const size = hashParams().get('subs');
  if (size !== 'short' && size !== 'long') return null;
  const long = size === 'long';
  const base = { completeByDate: today, isCompleted: false, createdBy: 'test-user-id', createdAt: new Date().toISOString() };
  return [
    { ...base, id: 'mk_play', text: 'Clean up the playroom', subtasks: steps('mk_play_', [['Pick up the toys', true], 'Vacuum the rug', 'Put the books away']) },
    { ...base, id: 'mk_plants', text: 'Water the plants' },
    long
      ? {
          ...base,
          id: 'mk_party',
          assignedTo: 'test-user-id',
          text: 'Plan Leo’s birthday party',
          subtasks: steps('mk_party_', [
            ['Pick a date', true],
            ['Book the bounce house', true],
            'Send the invitations',
            'Order the cake',
            'Buy party favors',
            'Plan two games',
            'Pick up balloons',
            'Clean up the backyard',
          ]),
        }
      : {
          ...base,
          id: 'mk_ins',
          assignedTo: 'test-user-id',
          text: 'Renew car insurance',
          subtasks: steps('mk_ins_', [['Get two quotes', true], 'Compare coverage', 'Sign the new policy']),
        },
    { ...base, id: 'mk_run', assignedTo: 'test-user-id', text: 'Go for a 30 minute run' },
    {
      ...base,
      id: 'mk_lake',
      assignedTo: 'test-partner-id',
      text: 'Pack for the lake weekend',
      subtasks: long
        ? steps('mk_lake_', [['Swimsuits', true], 'Beach towels', 'Sunscreen', 'Life jackets', 'Fishing gear', 'Snacks for the car', 'Phone chargers', 'Bug spray', 'Lock the back door'])
        : steps('mk_lake_', ['Swimsuits', 'Sunscreen']),
    },
    { ...base, id: 'mk_vet', assignedTo: 'test-partner-id', text: 'Call the vet' },
    long
      ? {
          ...base,
          id: 'mk_school',
          assignedTo: 'kid_leo',
          text: 'Get ready for school',
          subtasks: steps('mk_school_', [['Brush teeth', true], ['Get dressed', true], 'Eat breakfast', 'Pack your backpack', 'Shoes and jacket', 'Feed the cat']),
        }
      : { ...base, id: 'mk_hw', assignedTo: 'kid_leo', text: 'Homework', subtasks: steps('mk_hw_', [['Math worksheet', true], 'Reading log']) },
    { ...base, id: 'mk_bed', assignedTo: 'kid_leo', text: 'Make your bed', points: 5 },
  ];
}
