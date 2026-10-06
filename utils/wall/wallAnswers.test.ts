import { describe, expect, it } from 'vitest';
import type { HouseholdMember, MealPlanItem, ShoppingItem, ToDo, WallEvent } from '@/types/schema';
import type { WallWeather } from './wallWeather';
import { composeAnswer, datesFor, parseQuestion, QUESTION_PHRASES, type AnswerContext, type WallQuestion } from './wallAnswers';
import { memberForName, normalizeSpeech, parseLocalCommand } from './wallVoice';

const ask = (text: string) => parseQuestion(normalizeSpeech(text));

describe('parseQuestion', () => {
  it.each<[string, WallQuestion]>([
    ['weather', { topic: 'weather', when: 'today' }],
    ['Show weather', { topic: 'weather', when: 'today' }],
    ['show me the weather', { topic: 'weather', when: 'today' }],
    ["What's the weather?", { topic: 'weather', when: 'today' }],
    ["what's the weather like today", { topic: 'weather', when: 'today' }],
    ["how's the weather outside", { topic: 'weather', when: 'today' }],
    ["what's it like outside", { topic: 'weather', when: 'today' }],
    ['is it cold outside', { topic: 'weather', when: 'today' }],
    ["what's the weather tomorrow", { topic: 'weather', when: 'tomorrow' }],
    ["tomorrow's weather", { topic: 'weather', when: 'tomorrow' }],
    ['what will the weather be like on Saturday', { topic: 'weather', when: 'saturday' }],
    ["what's the weather this weekend", { topic: 'weather', when: 'weekend' }],
    ['weather for the weekend', { topic: 'weather', when: 'weekend' }],
    ['the forecast', { topic: 'weather', when: 'week' }],
    ['show the forecast', { topic: 'weather', when: 'week' }],
    ["what's the forecast for tomorrow", { topic: 'weather', when: 'tomorrow' }],
    ['will it rain', { topic: 'rain', when: 'today' }],
    ['is it going to rain tomorrow', { topic: 'rain', when: 'tomorrow' }],
    ['will it snow this weekend', { topic: 'rain', when: 'weekend' }],
    ['do I need an umbrella', { topic: 'rain', when: 'today' }],
    ['do i need a jacket today', { topic: 'rain', when: 'today' }],
    ["what's the temperature", { topic: 'temperature' }],
    ['how cold is it', { topic: 'temperature' }],
    ['What time is it?', { topic: 'time' }],
    ["what's the date", { topic: 'date' }],
    ["what's today's date", { topic: 'date' }],
    ['what day is it', { topic: 'date' }],
    ["what's next", { topic: 'next' }],
    ["what's coming up", { topic: 'next' }],
    ["what's on this weekend", { topic: 'schedule', when: 'weekend' }],
    ["what's happening on Saturday", { topic: 'schedule', when: 'saturday' }],
    ['what do we have going on this week', { topic: 'schedule', when: 'week' }],
    ["What's for dinner?", { topic: 'meal', meal: 'dinner', when: 'today' }],
    ["what's for dinner tonight", { topic: 'meal', meal: 'dinner', when: 'today' }],
    ["what's for supper", { topic: 'meal', meal: 'dinner', when: 'today' }],
    ['what are we having for dinner tomorrow', { topic: 'meal', meal: 'dinner', when: 'tomorrow' }],
    ["what's for dinner on friday", { topic: 'meal', meal: 'dinner', when: 'friday' }],
    ["what's for lunch", { topic: 'meal', meal: 'lunch', when: 'today' }],
    ["what's for dinner this week", { topic: 'mealPlan' }],
    ["what's on the meal plan", { topic: 'mealPlan' }],
    ["what's on the shopping list", { topic: 'shopping' }],
    ['what do we need from the store', { topic: 'shopping' }],
    ['read me the grocery list', { topic: 'shopping' }],
    ["what's on my to do list", { topic: 'todos', who: null, when: 'today' }],
    ["what's on the to-do list this week", { topic: 'todos', who: null, when: 'week' }],
    ['what do I have to do today', { topic: 'todos', who: null, when: 'today' }],
    ["what's left to do", { topic: 'todos', who: null, when: 'today' }],
    ['what chores are left', { topic: 'todos', who: null, when: 'today' }],
    ["what's on Emma's list", { topic: 'todos', who: 'emmas', when: 'today' }],
    ['what does Sam have to do', { topic: 'todos', who: 'sam', when: 'today' }],
    ["what are Sam's chores", { topic: 'todos', who: 'sams', when: 'today' }],
  ])('%s', (text, expected) => {
    expect(ask(text)).toEqual(expected);
  });

  it.each(['add milk', 'we need milk', 'show the calendar', 'play some music', 'turn on the lights', ''])('reads nothing from %j', text => {
    expect(ask(text)).toBeNull();
  });

  it('leaves the existing commands alone', () => {
    expect(parseLocalCommand('dinner')).toEqual({ kind: 'show', target: 'meals' });
    expect(parseLocalCommand("what's my day")).toEqual({ kind: 'brief', day: 'auto' });
    expect(parseLocalCommand('what do we have going on tomorrow')).toEqual({ kind: 'brief', day: 'tomorrow' });
    expect(parseLocalCommand("what's for dinner")).toEqual({ kind: 'ask', question: { topic: 'meal', meal: 'dinner', when: 'today' } });
  });

  it('reads every phrase the command recognizer is given', () => {
    for (const phrase of QUESTION_PHRASES) expect(parseLocalCommand(phrase), phrase).not.toBeNull();
  });
});

describe('percent articles', () => {
  it.each<[number, string]>([[8, 'an'], [11, 'an'], [18, 'an'], [80, 'an'], [85, 'an'], [10, 'a'], [12, 'a'], [1, 'a'], [100, 'a'], [40, 'a']])('%i → %s', (pct, article) => {
    const w: WallWeather = { ...weather, days: [{ date: '2026-10-07', high: 1, low: 0, icon: 'sun', precipMax: pct }] };
    expect(spoken({ topic: 'rain', when: 'tomorrow' }, ctx({ weather: w }))[0]).toContain(`${article} ${pct} percent`);
  });
});

describe('datesFor', () => {
  // 2026-10-06 is a Tuesday.
  it.each<[Parameters<typeof datesFor>[0], string, string[]]>([
    ['today', '2026-10-06', ['2026-10-06']],
    ['tomorrow', '2026-10-06', ['2026-10-07']],
    ['saturday', '2026-10-06', ['2026-10-10']],
    ['tuesday', '2026-10-06', ['2026-10-06']],
    ['monday', '2026-10-06', ['2026-10-12']],
    ['weekend', '2026-10-06', ['2026-10-10', '2026-10-11']],
    ['weekend', '2026-10-10', ['2026-10-10', '2026-10-11']],
    ['weekend', '2026-10-11', ['2026-10-11']],
  ])('%s from %s', (when, today, expected) => {
    expect(datesFor(when, today)).toEqual(expected);
  });
});

const TODAY = '2026-10-06';
const TZ = 'America/Chicago';
const NOW = Date.parse('2026-10-06T12:00:00-05:00');

const members = [
  { uid: 'u1', displayName: 'Emma Ivers' },
  { uid: 'u2', displayName: 'Sam Ivers' },
] as HouseholdMember[];

const weather: WallWeather = {
  fetchedAt: 0,
  current: { temp: 54, icon: 'partly' },
  high: 61,
  low: 43,
  blocks: [{ label: 'Evening', temp: 50, icon: 'rain', rainy: true }],
  rainNote: 'Rain likely 6–8 pm',
  days: [
    { date: '2026-10-06', high: 61, low: 43, icon: 'rain', precipMax: 70 },
    { date: '2026-10-07', high: 58, low: 41, icon: 'sun', precipMax: 10 },
    { date: '2026-10-10', high: 66, low: 50, icon: 'cloud', precipMax: 30 },
    { date: '2026-10-11', high: 64, low: 48, icon: 'rain', precipMax: 85 },
  ],
};

const todo = (id: string, text: string, completeByDate: string, over: Partial<ToDo> = {}): ToDo => ({
  id,
  text,
  completeByDate,
  isCompleted: false,
  createdBy: 'u1',
  createdAt: '',
  ...over,
});

const ev = (id: string, title: string, start: string, over: Partial<WallEvent> = {}): WallEvent => ({
  id,
  source: 'feed',
  ownerKey: 'family',
  title,
  allDay: false,
  date: start.slice(0, 10),
  start,
  end: new Date(Date.parse(start) + 3600_000).toISOString(),
  ...over,
});

function ctx(over: Partial<AnswerContext> = {}): AnswerContext {
  return {
    today: TODAY,
    now: NOW,
    timeZone: TZ,
    weather,
    events: [],
    mealPlan: [],
    shoppingList: [],
    todos: [],
    members,
    person: key => (key === 'u2' ? 'Sam' : null),
    memberFor: name => memberForName(members, name),
    ...over,
  };
}

const spoken = (q: WallQuestion, c: AnswerContext) => composeAnswer(q, c).lines.map(l => l.speech).filter(Boolean);

describe('composeAnswer', () => {
  it('weather today, with the day parts on the card only', () => {
    const a = composeAnswer({ topic: 'weather', when: 'today' }, ctx());
    expect(a.title).toBe('54°');
    expect(spoken({ topic: 'weather', when: 'today' }, ctx())).toEqual([
      "It's 54 degrees and partly cloudy, with a high of 61 and a low of 43. Rain likely 6 to 8 pm.",
    ]);
    expect(a.lines.map(l => l.text)).toContain('Evening · 50° · rainy');
  });

  it('weather on a later day, the weekend, and past the forecast', () => {
    expect(spoken({ topic: 'weather', when: 'tomorrow' }, ctx())).toEqual(['Tomorrow looks sunny, with a high of 58 and a low of 41.']);
    expect(spoken({ topic: 'weather', when: 'weekend' }, ctx())).toEqual([
      'Saturday looks cloudy, with a high of 66 and a low of 50.',
      "Sunday looks rainy, with a high of 64 and a low of 48. There's an 85 percent chance of rain.",
    ]);
    expect(spoken({ topic: 'weather', when: 'monday' }, ctx())).toEqual(['I only have the forecast for the next 6 days.']);
  });

  it('no weather at all says so', () => {
    expect(spoken({ topic: 'weather', when: 'today' }, ctx({ weather: null }))[0]).toMatch(/I don't have the weather right now/);
  });

  it('rain chances', () => {
    expect(spoken({ topic: 'rain', when: 'today' }, ctx())).toEqual(['Yes, rain is likely today, a 70 percent chance. Rain likely 6 to 8 pm.']);
    expect(spoken({ topic: 'rain', when: 'tomorrow' }, ctx())).toEqual(["Probably not. There's only a 10 percent chance of rain tomorrow."]);
    expect(spoken({ topic: 'rain', when: 'saturday' }, ctx())).toEqual(["Maybe. There's a 30 percent chance of rain Saturday."]);
    expect(spoken({ topic: 'rain', when: 'weekend' }, ctx())).toEqual(['Yes, rain is likely on Sunday, an 85 percent chance.']);
  });

  it('time and date', () => {
    expect(spoken({ topic: 'time' }, ctx())).toEqual(["It's 12 PM."]);
    expect(spoken({ topic: 'date' }, ctx())).toEqual(['Today is Tuesday, October 6.']);
  });

  it("what's next, then tomorrow's first thing", () => {
    const events = [ev('a', 'Soccer', '2026-10-06T16:00:00-05:00', { ownerKey: 'u2' }), ev('b', 'Dentist', '2026-10-06T09:00:00-05:00'), ev('c', 'Piano', '2026-10-07T08:30:00-05:00')];
    expect(spoken({ topic: 'next' }, ctx({ events }))).toEqual(['Next, at 4 PM, Sam has soccer.']);
    expect(spoken({ topic: 'next' }, ctx({ events, now: Date.parse('2026-10-06T18:00:00-05:00') }))).toEqual([
      'Nothing else is on the calendar today. Tomorrow starts at 8:30 AM, piano.',
    ]);
  });

  it('schedule for the weekend, capped at five spoken', () => {
    const events = Array.from({ length: 7 }, (_, i) => ev(`e${i}`, `Thing ${i}`, `2026-10-10T${String(9 + i).padStart(2, '0')}:00:00-05:00`));
    const a = composeAnswer({ topic: 'schedule', when: 'weekend' }, ctx({ events }));
    const s = a.lines[0]?.speech ?? '';
    expect(s).toMatch(/^You have 7 things this weekend\. Saturday at 9 AM, thing 0\./);
    expect(s).toMatch(/And 2 more\.$/);
    expect(a.lines.filter(l => l.kind === 'item')).toHaveLength(7);
    expect(spoken({ topic: 'schedule', when: 'weekend' }, ctx())).toEqual(['Nothing is on the calendar this weekend.']);
  });

  it("what's for dinner, and an honest empty", () => {
    const mealPlan: MealPlanItem[] = [
      { id: 'm1', date: TODAY, mealName: 'Tacos', type: 'dinner', isCooked: false },
      { id: 'm2', date: '2026-10-09', mealName: 'Pizza', type: 'dinner', isCooked: false },
    ];
    expect(spoken({ topic: 'meal', meal: 'dinner', when: 'today' }, ctx({ mealPlan }))).toEqual(['Dinner tonight is Tacos.']);
    expect(spoken({ topic: 'meal', meal: 'dinner', when: 'friday' }, ctx({ mealPlan }))).toEqual(["Friday's dinner is Pizza."]);
    expect(spoken({ topic: 'meal', meal: 'dinner', when: 'tomorrow' }, ctx({ mealPlan }))).toEqual(["Nothing's planned for dinner tomorrow."]);
    expect(spoken({ topic: 'mealPlan' }, ctx({ mealPlan }))).toEqual(['Tonight, Tacos. Friday, Pizza.']);
    expect(spoken({ topic: 'mealPlan' }, ctx())).toEqual(["Nothing's on the meal plan this week."]);
  });

  it('the shopping list reads five, then the count', () => {
    const shoppingList = ['Milk', 'Eggs', 'Bread', 'Apples', 'Butter', 'Rice', 'Beans', 'Done'].map(
      (name, i): ShoppingItem => ({ id: `s${i}`, name, category: 'x', isPurchased: name === 'Done', order: i })
    );
    expect(spoken({ topic: 'shopping' }, ctx({ shoppingList }))).toEqual([
      'There are 7 things on the shopping list: milk, eggs, bread, apples, butter and 2 more.',
    ]);
    expect(spoken({ topic: 'shopping' }, ctx())).toEqual(['The shopping list is empty.']);
  });

  it("to-dos: the household's, a member's, and nobody's", () => {
    const todos = [
      todo('t1', 'Feed the cat', '2026-10-05', { assignedTo: 'u2' }),
      todo('t2', 'Take out trash', TODAY),
      todo('t3', 'Call grandma', '2026-10-09', { assignedTo: 'u1' }),
      todo('t4', 'Done thing', TODAY, { isCompleted: true }),
    ];
    expect(spoken({ topic: 'todos', who: null, when: 'today' }, ctx({ todos }))).toEqual([
      'There are 2 to-dos due today, including 1 overdue: feed the cat and take out trash.',
    ]);
    expect(spoken({ topic: 'todos', who: 'sams', when: 'today' }, ctx({ todos }))).toEqual(['Sam has 1 to-do due today, including 1 overdue: feed the cat.']);
    expect(spoken({ topic: 'todos', who: 'emma', when: 'today' }, ctx({ todos }))).toEqual(['Emma has nothing due today. There is 1 more this week.']);
    expect(spoken({ topic: 'todos', who: 'bob', when: 'today' }, ctx({ todos }))).toEqual(["I don't know anyone called bob."]);
  });
});
