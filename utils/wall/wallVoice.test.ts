import { describe, expect, it } from 'vitest';
import type { GroceryCatalogItem, HouseholdMember } from '@/types/schema';
import { memberForName, normalizeSpeech, parseLocalCommand, pickVoiceEngine, resolveVoiceCommand, voiceContextFrom } from './wallVoice';

const member = (uid: string, displayName: string) => ({ uid, displayName, role: 'member' }) as HouseholdMember;
const MEMBERS = [member('u1', 'Sam Rivera'), member('u2', 'Alex Rivera'), member('u3', 'Sam Lee')];
const CATALOG = [
  { id: 'c1', name: 'Milk', category: 'Dairy', defaultStore: 'Costco', defaultQuantity: '1 gal', purchaseCount: 9 },
  { id: 'c2', name: 'Avocados', category: 'Produce', purchaseCount: 20 },
] as GroceryCatalogItem[];
const TODAY = '2026-10-04';

describe('parseLocalCommand (the no-AI grammar)', () => {
  it.each([
    ['Show the calendar', { kind: 'show', target: 'week' }],
    ['open month', { kind: 'show', target: 'month' }],
    ['Show me today.', { kind: 'show', target: 'day' }],
    ['go to the shopping list', { kind: 'show', target: 'shopping' }],
    ['show lists', { kind: 'show', target: 'shopping' }],
    ['Groceries', { kind: 'show', target: 'shopping' }],
    ['show to-dos', { kind: 'show', target: 'todos' }],
    ['open the to do list please', { kind: 'show', target: 'todos' }],
    ['show chores', { kind: 'show', target: 'todos' }],
    ['Hey, show meals', { kind: 'show', target: 'meals' }],
    ['show the meal plan', { kind: 'show', target: 'meals' }],
    ['start rotating', { kind: 'rotate', on: true }],
    ['Stop rotating.', { kind: 'rotate', on: false }],
    ['pause the rotation', { kind: 'rotate', on: false }],
    ['undo', { kind: 'undo' }],
    ['Undo that', { kind: 'undo' }],
    ['never mind', { kind: 'cancel' }],
    ['cancel', { kind: 'cancel' }],
  ])('%s', (text, expected) => {
    expect(parseLocalCommand(text)).toEqual(expected);
  });

  it.each([
    ["What's my day?", 'auto'],
    ['Hey, brief me please', 'auto'],
    ['my day', 'auto'],
    ['Good morning!', 'today'],
    ["What's on today", 'today'],
    ["what's on my calendar", 'today'],
    ["What's tomorrow?", 'tomorrow'],
    ['How does tomorrow look', 'tomorrow'],
    ["what's on the calendar tomorrow", 'tomorrow'],
  ])('“%s” asks for the day brief (%s)', (text, day) => {
    expect(parseLocalCommand(text)).toEqual({ kind: 'brief', day });
  });

  it('"today" alone still opens the Day view', () => {
    expect(parseLocalCommand('show today')).toEqual({ kind: 'show', target: 'day' });
    expect(parseLocalCommand('today')).toEqual({ kind: 'show', target: 'day' });
  });

  it.each(['add milk to the shopping list', 'remind Sam to feed the cat', 'show me something nice', '', '   '])(
    'leaves %j for the model',
    text => {
      expect(parseLocalCommand(text)).toBeNull();
    }
  );

  it('normalizes punctuation, case and politeness', () => {
    expect(normalizeSpeech('  OK, could you Show the To-Dos?? ')).toBe('show the to dos');
  });
});

describe('pickVoiceEngine', () => {
  const both = { speech: true, audio: true };
  it('auto prefers on-device speech, then falls back to audio once refused', () => {
    expect(pickVoiceEngine('auto', both, false)).toBe('speech');
    expect(pickVoiceEngine('auto', both, true)).toBe('audio');
    expect(pickVoiceEngine('auto', { speech: false, audio: true }, false)).toBe('audio');
    expect(pickVoiceEngine('auto', { speech: false, audio: false }, false)).toBeNull();
  });
  it('a forced engine never falls back', () => {
    expect(pickVoiceEngine('speech', { speech: false, audio: true }, false)).toBeNull();
    expect(pickVoiceEngine('audio', { speech: true, audio: false }, false)).toBeNull();
    expect(pickVoiceEngine('audio', both, false)).toBe('audio');
  });
  it('auto uses the on-device engine once Picovoice is set up', () => {
    expect(pickVoiceEngine('auto', { ...both, device: true }, false)).toBe('device');
    expect(pickVoiceEngine('device', { ...both, device: true }, false)).toBe('device');
    expect(pickVoiceEngine('device', both, false)).toBeNull();
  });
  it('off hides voice', () => {
    expect(pickVoiceEngine('off', both, false)).toBeNull();
  });
});

describe('memberForName', () => {
  it('matches a full name, or a first name only when it is unique', () => {
    expect(memberForName(MEMBERS, 'alex')?.uid).toBe('u2');
    expect(memberForName(MEMBERS, 'Sam Lee')?.uid).toBe('u3');
    expect(memberForName(MEMBERS, 'Sam')).toBeUndefined();
    expect(memberForName(MEMBERS, 'Jordan')).toBeUndefined();
    expect(memberForName(MEMBERS, undefined)).toBeUndefined();
  });
});

describe('resolveVoiceCommand', () => {
  const ctx = { members: MEMBERS, catalog: CATALOG, today: TODAY };

  it('adds shopping items through the catalog, with the spoken quantity winning', () => {
    const action = resolveVoiceCommand(
      {
        transcript: 'add milk, eggs and two avocados',
        intent: 'add_shopping',
        items: [{ name: 'milk' }, { name: 'eggs' }, { name: 'avocados', quantity: '2' }, { name: 'Milk' }, { name: ' ' }],
      },
      ctx
    );
    expect(action).toMatchObject({
      kind: 'shopping',
      summary: 'Milk (1 gal), Eggs, Avocados (2)',
      spoken: 'Added milk, eggs and avocados to shopping.',
    });
    if (action.kind !== 'shopping') throw new Error('expected shopping');
    expect(action.items).toEqual([
      expect.objectContaining({ name: 'Milk', category: 'Dairy', store: 'Costco', quantity: '1 gal', source: 'voice' }),
      expect.objectContaining({ name: 'Eggs', source: 'voice' }),
      expect.objectContaining({ name: 'Avocados', category: 'Produce', quantity: '2' }),
    ]);
  });

  it('adds a to-do for a named member, due when spoken', () => {
    const action = resolveVoiceCommand(
      { transcript: 'remind Alex to feed the cat tomorrow', intent: 'add_todo', todo: { text: 'feed the cat', assigneeName: 'Alex', due: 'tomorrow' } },
      ctx
    );
    expect(action).toEqual({
      kind: 'todo',
      todo: { text: 'Feed the cat', completeByDate: '2026-10-05', isCompleted: false, source: 'voice', assignedTo: 'u2' },
      summary: 'Feed the cat · Alex Rivera · tomorrow',
      spoken: 'Added feed the cat for Alex, due tomorrow.',
    });
  });

  it('defaults to Family and today, and keeps an explicit date', () => {
    expect(resolveVoiceCommand({ transcript: '', intent: 'add_todo', todo: { text: 'call the dentist', assigneeName: 'Sam' } }, ctx)).toMatchObject({
      todo: { completeByDate: TODAY },
      summary: 'Call the dentist · Family · today',
      spoken: 'Added call the dentist, due today.',
    });
    expect(resolveVoiceCommand({ transcript: '', intent: 'add_todo', todo: { text: 'x', due: '2026-10-20' } }, ctx)).toMatchObject({
      todo: { completeByDate: '2026-10-20' },
    });
    expect(resolveVoiceCommand({ transcript: '', intent: 'add_todo', todo: { text: 'x', due: 'someday' } }, ctx)).toMatchObject({
      todo: { completeByDate: TODAY },
    });
  });

  it('anything without content is unknown', () => {
    expect(resolveVoiceCommand({ transcript: 'hmm', intent: 'unknown' }, ctx)).toEqual({ kind: 'unknown' });
    expect(resolveVoiceCommand({ transcript: 'add', intent: 'add_shopping', items: [] }, ctx)).toEqual({ kind: 'unknown' });
    expect(resolveVoiceCommand({ transcript: 'add', intent: 'add_todo', todo: { text: ' ' } }, ctx)).toEqual({ kind: 'unknown' });
  });
});

describe('voiceContextFrom', () => {
  it('lists member names and the catalog most-used first', () => {
    expect(voiceContextFrom(MEMBERS, CATALOG, TODAY, 'America/Chicago')).toEqual({
      memberNames: ['Sam Rivera', 'Alex Rivera', 'Sam Lee'],
      catalogNames: ['Avocados', 'Milk'],
      today: TODAY,
      timeZone: 'America/Chicago',
    });
  });
});
