import { describe, expect, it } from 'vitest';
import { parseLocalAdd, type LocalAddContext } from './wallVoiceGrammar';

// 2026-10-07 is a Wednesday.
const CTX: LocalAddContext = {
  memberNames: ['Sam Rivera', 'Alex Rivera', 'Jo'],
  catalogNames: ['Milk', 'Avocados', 'Eggs', 'Paper Towels', 'Peas', 'Bread'],
  today: '2026-10-07',
};

const shop = (text: string) => {
  const c = parseLocalAdd(text, CTX);
  expect(c?.intent).toBe('add_shopping');
  return c?.items;
};
const todo = (text: string) => {
  const c = parseLocalAdd(text, CTX);
  expect(c?.intent).toBe('add_todo');
  return c?.todo;
};

describe('parseLocalAdd: shopping', () => {
  it.each([
    ['Add milk, eggs and two avocados', [{ name: 'Milk' }, { name: 'Eggs' }, { name: 'Avocados', quantity: '2' }]],
    ['add milk eggs and bread to the shopping list', [{ name: 'Milk' }, { name: 'Eggs' }, { name: 'Bread' }]],
    ['add milk two avocados', [{ name: 'Milk' }, { name: 'Avocados', quantity: '2' }]],
    ['put paper towels on the list', [{ name: 'Paper Towels' }]],
    ['we need avocado', [{ name: 'Avocados' }]],
    ["we're out of eggs", [{ name: 'Eggs' }]],
    ['add a dozen eggs', [{ name: 'Eggs', quantity: '1 dozen' }]],
    ['add two dozen eggs', [{ name: 'Eggs', quantity: '2 dozen' }]],
    ['add 3 pounds of ground beef', [{ name: 'ground beef', quantity: '3 pounds' }]],
    ['add two bags of frozen peas', [{ name: 'frozen peas', quantity: '2 bags' }]],
    ['add a bag of chips', [{ name: 'chips', quantity: '1 bag' }]],
    ['add an onion', [{ name: 'onion' }]],
    ['add dish soap milk', [{ name: 'dish soap' }, { name: 'Milk' }]],
    ['Please add milk.', [{ name: 'Milk' }]],
    ['add milk to groceries', [{ name: 'Milk' }]],
  ])('%s', (text, items) => {
    expect(shop(text)).toEqual(items);
  });

  // Vosk writes the nearest common word it knows; a short unfamiliar word that
  // sounds like exactly one grocery becomes it (the wall heard "rice" as "rights").
  it.each([
    ['add rice', [{ name: 'rice' }]],
    ['add rights', [{ name: 'rice' }]],
    ['add race', [{ name: 'rice' }]],
    ['add rise to the shopping list', [{ name: 'rice' }]],
    ['we need rights', [{ name: 'rice' }]],
    ['add milk rights and eggs', [{ name: 'Milk' }, { name: 'rice' }, { name: 'Eggs' }]],
    ['add two bags of rights', [{ name: 'rice', quantity: '2 bags' }]],
    // Items that are already known, or longer than a syllable, are left alone.
    ['add soap', [{ name: 'soap' }]],
    ['add paper', [{ name: 'paper' }]],
    ['add sponges', [{ name: 'sponges' }]],
  ])('%s (sound-alike repair)', (text, items) => {
    expect(shop(text)).toEqual(items);
  });

  it('spells a repaired item the way the catalog does', () => {
    const ctx = { ...CTX, catalogNames: [...CTX.catalogNames, 'Rice'] };
    expect(parseLocalAdd('add rights', ctx)?.items).toEqual([{ name: 'Rice' }]);
  });

  it('never repairs a word that two items sound like', () => {
    // "hawk" could be ham or hock; with both in the catalog it stays as heard.
    const ctx = { ...CTX, catalogNames: [...CTX.catalogNames, 'Hock', 'Hake'] };
    expect(parseLocalAdd('add hawk', ctx)?.items).toEqual([{ name: 'hawk' }]);
  });

  it('keeps the transcript as spoken', () => {
    expect(parseLocalAdd('Add milk.', CTX)?.transcript).toBe('Add milk.');
  });
});

describe('parseLocalAdd: to-dos', () => {
  it.each([
    ['Remind Sam to feed the cat tomorrow', { text: 'feed the cat', assigneeName: 'Sam Rivera', due: 'tomorrow' }],
    ['remind me to call the dentist', { text: 'call the dentist' }],
    ['remind us to pay the water bill on friday', { text: 'pay the water bill', due: '2026-10-09' }],
    ['remind jo to practice piano today', { text: 'practice piano', assigneeName: 'Jo', due: 'today' }],
    ['remind grandma to call', { text: 'grandma to call' }],
    ['reminds him to feed the cat tomorrow', { text: 'feed the cat', due: 'tomorrow' }],
    ['add a to do to call the plumber', { text: 'call the plumber' }],
    ['add a reminder for alex to mow the lawn this weekend', { text: 'mow the lawn', assigneeName: 'Alex Rivera', due: '2026-10-10' }],
    ['add take out the trash to the to do list', { text: 'take out the trash' }],
    ['add take out the trash to sams to do list', { text: 'take out the trash', assigneeName: 'Sam Rivera' }],
    ['add vacuum the stairs to the chore list for jo', { text: 'vacuum the stairs', assigneeName: 'Jo' }],
    ['Sam needs to clean his room by tonight', { text: 'clean his room', assigneeName: 'Sam Rivera', due: 'today' }],
    ['add a task to renew the passports next wednesday', { text: 'renew the passports', due: '2026-10-14' }],
    ['add a task to renew the passports this wednesday', { text: 'renew the passports', due: '2026-10-07' }],
    ['add a task to water plants monday', { text: 'water plants', due: '2026-10-12' }],
  ])('%s', (text, expected) => {
    expect(todo(text)).toEqual(expected);
  });
});

describe('parseLocalAdd: not an add', () => {
  it.each(['show the calendar', 'what is the weather', 'the car needs to be washed', 'add soccer to the calendar', '', 'hello'])(
    '%s',
    text => {
      expect(parseLocalAdd(text, CTX)).toBeNull();
    }
  );
});
