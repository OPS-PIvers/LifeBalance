import type { HouseholdMember, MealPlanItem, ShoppingItem, ToDo, WallEvent } from '@/types/schema';
import type { BriefLine, WallBrief } from './wallBrief';
import { addDaysTo, longDateText, weekdayName, weekdayOf } from './wallCalendar';
import { sortShopping } from './wallLists';
import { dueTodayTodos, eventsOn } from './wallSelectors';
import { spokenList, spokenTime } from './wallSpeech';
import type { WallWeather, WeatherIcon } from './wallWeather';

/**
 * The wall's spoken answers (no AI): the questions the local grammar reads
 * ("weather", "what's for dinner", "what's on the shopping list") and the card
 * each one shows and reads aloud through the day brief's player. Read-only:
 * nothing here writes.
 */

export const WEEKDAY_WORDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type Weekday = (typeof WEEKDAY_WORDS)[number];

/** The day(s) a question asks about. */
export type AskWhen = 'today' | 'tomorrow' | 'weekend' | 'week' | Weekday;

export type MealType = 'breakfast' | 'lunch' | 'dinner';

export type WallQuestion =
  | { topic: 'weather'; when: AskWhen }
  | { topic: 'rain'; when: AskWhen }
  | { topic: 'temperature' }
  | { topic: 'time' }
  | { topic: 'date' }
  | { topic: 'next' }
  /** Events on a weekday, the weekend or the week (today/tomorrow are the day brief). */
  | { topic: 'schedule'; when: AskWhen }
  | { topic: 'meal'; meal: MealType; when: AskWhen }
  | { topic: 'mealPlan' }
  | { topic: 'shopping' }
  /** `who`: a spoken name as heard, or null for the household. */
  | { topic: 'todos'; who: string | null; when: 'today' | 'week' };

// ---------------------------------------------------------------------------
// Grammar (input is already normalizeSpeech'd: lower case, no apostrophes)
// ---------------------------------------------------------------------------

const DAY_WORD = `(?:today|tonight|tomorrow|(?:this |the )?weekend|this week|the week|${WEEKDAY_WORDS.join('|')})`;
/** A trailing "for tomorrow", "on saturday", "this weekend". */
const WHEN_TAIL = new RegExp(`^(.*?) (?:for |on |this |for this |next )?(${DAY_WORD})$`);
/** A leading "tomorrows weather", "saturdays dinner". */
const WHEN_HEAD = new RegExp(`^(todays|tonights|tomorrows|${WEEKDAY_WORDS.map(d => `${d}s`).join('|')}) (.+)$`);

function whenOf(word: string): AskWhen {
  const w = word.replace(/^(this|the) /, '');
  if (w === 'today' || w === 'tonight') return 'today';
  if (w === 'tomorrow' || w === 'weekend' || w === 'week') return w;
  return WEEKDAY_WORDS.find(d => d === w) ?? 'today';
}

/** Splits "whats the weather on saturday" into ("whats the weather", saturday). */
function splitWhen(t: string): { core: string; when: AskWhen | null } {
  const head = WHEN_HEAD.exec(t);
  if (head?.[1] && head[2]) return { core: head[2], when: whenOf(head[1].replace(/s$/, '')) };
  const tail = WHEN_TAIL.exec(t);
  if (tail?.[1] && tail[2]) return { core: tail[1], when: whenOf(tail[2]) };
  return { core: t, when: null };
}

const WEATHER = /^(?:(?:show|open|display|check|give|tell)(?: me)? )?(?:the |a )?(?:weather|forecast|weather forecast|weather report)(?: like)?(?: outside)?$|^(?:whats|what is|hows|how is|how does|what does|what will|whats going on with) (?:the )?(?:weather|forecast|weather forecast)(?: like| going to be| gonna be| going to be like| looking| look| look like| looking like| be| be like)?(?: outside)?$|^(?:whats it|what is it|how is it|hows it) (?:like |going to be like |gonna be like )?(?:outside|out there|out)$|^is it (?:going to be |gonna be )?(?:nice|cold|hot|warm|chilly|sunny|cloudy|windy)(?: out| outside| out there)?$|^(?:how|what) (?:about|is) the weather$/;
const RAIN = /^(?:(?:is|will) it|is it going to|is it gonna|are we going to|are we gonna|will we|should we expect|do we expect) (?:going to |gonna |be )?(?:rain|raining|snow|snowing|storm|storming|get rain|get snow|see rain)(?: out| outside)?$|^(?:do|will|should) (?:i|we) (?:need|want|bring|take) (?:an |a |my |our )?(?:umbrella|rain ?coat|rain jacket|jacket|coat|boots)$|^(?:any|is there (?:any )?|is there a|whats the|what is the|what are the) ?(?:chance (?:of|for) )?(?:rain|snow|storms?|precipitation)(?: chance| chances)?(?: in the forecast| expected)?$|^(?:whats|what is) the (?:chance|chances|odds) (?:of|for) (?:rain|snow)$/;
const TEMPERATURE = /^(?:(?:whats|what is) (?:the )?(?:temperature|temp)(?: outside| out| right now| now| outside right now)?|how (?:cold|hot|warm|chilly) is it(?: outside| out| out there)?(?: right now| now)?|(?:how many|what) degrees(?: is it)?(?: outside)?)$/;
const TIME = /^(?:(?:whats|what is) the time|what time is it|what time|time|the time|do you (?:have|know) the time|tell me the time|whats the time now)(?: now| right now| please)?$/;
const DATE = /^(?:(?:whats|what is) (?:the |todays )?date|what day is (?:it|today)|what day of the week is it|whats today s date|what is todays date|what date is it|whats the date today|what is the date today|which day is it)(?: today)?$/;
const NEXT = /^(?:(?:whats|what is) (?:next|up next|coming up|coming up next|the next (?:thing|event))(?: on the calendar| today)?|what do (?:i|we) have next|whats our next (?:thing|event)|when is the next (?:thing|event)|whats the next thing on the calendar|(?:what|whats) is next)$/;
const SCHEDULE = /^(?:(?:whats|what is) (?:on|happening|going on|planned|the plan|on the calendar|on our calendar|on my calendar|on the schedule)|(?:whats|what is) (?:the )?(?:plan|schedule|calendar)|what do (?:i|we) have(?: going on| planned| on)?|what are we doing|(?:is there )?anything (?:on|going on|happening|planned)|(?:are we|am i) (?:busy|doing anything)|whats going on|how does (?:it|the|my|our) (?:look|day look|week look|weekend look)|how busy are we|(?:give me|whats) the rundown|whats happening)$/;
const MEAL_WORD = '(dinner|supper|lunch|breakfast)';
const MEAL = new RegExp(`^(?:(?:whats|what is|whats cooking) for ${MEAL_WORD}|what (?:are|do) we (?:having|eating|have|eat|making|cooking) for ${MEAL_WORD}|what are we having|whats (?:the )?${MEAL_WORD}(?: plan| plans)?|(?:whats|what is) on the menu(?: for ${MEAL_WORD})?|${MEAL_WORD}(?: plans?)?|what should we (?:have|eat|make) for ${MEAL_WORD}|what is for ${MEAL_WORD}|whats planned for ${MEAL_WORD}|what did we plan for ${MEAL_WORD}|what are we having for ${MEAL_WORD})$`);
const MEAL_PLAN = /^(?:(?:whats|what is|read(?: me)?) (?:on )?(?:the |our )?(?:meal plan|menu)|what are we (?:eating|having)(?: for dinner)?|whats for dinner|what are the dinners|what meals are planned|whats planned for meals|(?:show me )?(?:the )?dinners)$/;
const SHOPPING = /^(?:(?:whats|what is|whats left|what is left|whats still) on (?:the |our |my )?(?:shopping|grocery|groceries) list|what(?:s| is) on the list|read(?: me)? (?:the |our )?(?:shopping |grocery )?list|what do (?:we|i) need(?: from the (?:store|grocery store|shop))?(?: to (?:buy|get|pick up))?|what (?:groceries|things) do (?:we|i) need|what do we have to (?:buy|get|pick up)|how many (?:things|items) are on the (?:shopping |grocery )?list|(?:whats|what is) (?:on )?the grocery list|(?:do we|do i) need anything(?: from the store)?|whats on the shopping list|(?:what|whats) is on the shopping list|what are we out of)$/;

const PERSON = '(i|we|me|us|my|our|the|[a-z]+)';
const TODO_NOUN = '(?:to ?do|todo|task|chore|job)s?(?: list)?';
const TODOS: RegExp[] = [
  new RegExp(`^(?:whats|what is|whats left|whats still|what is left) on ${PERSON} (?:${TODO_NOUN}|list)$`),
  new RegExp(`^what (?:do|does|did) ${PERSON} (?:still )?(?:have|need|got) to do$`),
  new RegExp(`^what (?:does|do) ${PERSON} (?:have|need) left(?: to do)?$`),
  new RegExp(`^what (?:are|is) ${PERSON} (?:${TODO_NOUN})$`),
  new RegExp(`^(?:read|tell)(?: me)? ${PERSON} ${TODO_NOUN}$`),
  new RegExp(`^(?:what|which) (?:${TODO_NOUN}) (?:are|is) (?:left|due|still left|still due|open)$`),
  new RegExp(`^(?:whats|what is) (?:left|still left|due) (?:to do|on the list)$`),
  new RegExp(`^(?:any|are there any|do we have any|do i have any) (?:${TODO_NOUN})(?: left| due)?$`),
  new RegExp(`^(?:what|whats|what is) left to do$`),
  new RegExp(`^(?:how many|whats the number of) (?:${TODO_NOUN}) (?:are|do we have|are there)(?: left| due)?$`),
];
const HOUSEHOLD_WORDS = new Set(['i', 'we', 'me', 'us', 'my', 'our', 'the']);

function todosOf(core: string, when: AskWhen | null): WallQuestion | null {
  for (const re of TODOS) {
    const m = re.exec(core);
    if (!m) continue;
    const word = m[1];
    const who = word && !HOUSEHOLD_WORDS.has(word) ? word : null;
    return { topic: 'todos', who, when: when === 'week' || when === 'weekend' ? 'week' : 'today' };
  }
  return null;
}

/**
 * The question grammar. Today/tomorrow schedule questions come back as the day
 * brief's own command (see parseLocalCommand), so this returns `schedule` only
 * for other days.
 */
export function parseQuestion(t: string): WallQuestion | null {
  if (!t) return null;
  if (TIME.test(t)) return { topic: 'time' };
  if (DATE.test(t)) return { topic: 'date' };
  if (NEXT.test(t)) return { topic: 'next' };
  if (TEMPERATURE.test(t)) return { topic: 'temperature' };
  if (SHOPPING.test(t)) return { topic: 'shopping' };

  const { core, when } = splitWhen(t);
  if (/^(?:forecast|the forecast|show(?: me)? the forecast|whats the forecast|weather forecast)$/.test(core) && !when) {
    return { topic: 'weather', when: 'week' };
  }
  if (WEATHER.test(core)) return { topic: 'weather', when: when ?? 'today' };
  if (RAIN.test(core)) return { topic: 'rain', when: when ?? 'today' };

  if (MEAL_PLAN.test(core) && (when === 'week' || when === 'weekend' || (when === null && !/dinner/.test(core)))) return { topic: 'mealPlan' };
  const meal = MEAL.exec(core);
  if (meal) {
    const word = meal.slice(1).find(Boolean) ?? 'dinner';
    const type: MealType = word === 'lunch' ? 'lunch' : word === 'breakfast' ? 'breakfast' : 'dinner';
    if (when === 'week' || when === 'weekend') return { topic: 'mealPlan' };
    return { topic: 'meal', meal: type, when: when ?? 'today' };
  }

  const todos = todosOf(core, when);
  if (todos) return todos;

  // The tail's "on" may have taken the question's own ("whats on | this weekend").
  if (when && (SCHEDULE.test(core) || SCHEDULE.test(`${core} on`))) return { topic: 'schedule', when };
  return null;
}

/**
 * Every question shape as plain phrases, for the on-device engine's
 * command-only recognizer. wallVoice.test.ts checks each one parses.
 */
export const QUESTION_PHRASES: readonly string[] = [
  'weather', 'the weather', 'show the weather', 'show weather', "what's the weather", "how's the weather", "what's the weather like",
  "what's the weather tomorrow", "what's the weather this weekend", 'the forecast', 'show the forecast', "what's the forecast",
  'will it rain', 'will it rain today', 'will it rain tomorrow', 'is it going to rain', 'do i need an umbrella', 'do i need a jacket',
  "what's the temperature", 'how cold is it', 'how hot is it', 'how warm is it outside',
  'what time is it', "what's the time", "what's the date", "what's today's date", 'what day is it',
  "what's next", "what's coming up", 'what do we have next',
  "what's on this weekend", "what's happening this weekend", "what's on saturday", "what's on sunday", "what's on this week",
  "what's for dinner", "what's for dinner tonight", "what's for dinner tomorrow", 'what are we having for dinner', "what's for supper",
  "what's for lunch", "what's for breakfast", "what's on the meal plan", "what's on the menu",
  "what's on the shopping list", "what's on the grocery list", 'what do we need', 'what do we need from the store', 'read the shopping list',
  "what's on my to do list", "what's on the to do list", 'what do i have to do', 'what do we have to do', "what's left to do",
  'what chores are left', 'what are my chores', 'any chores left',
];

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export interface AnswerContext {
  today: string;
  /** Wall clock (ms). */
  now: number;
  timeZone: string;
  weather: WallWeather | null;
  events: readonly WallEvent[];
  mealPlan: readonly MealPlanItem[];
  shoppingList: readonly ShoppingItem[];
  todos: readonly ToDo[];
  members: readonly HouseholdMember[];
  /** A first name for an event owner key, or null for Family / unknown. */
  person: (ownerKey: string) => string | null;
  /** A spoken name → member (memberForName). */
  memberFor: (name: string) => HouseholdMember | undefined;
}

/** Spoken list answers read this many items, then "and N more" (the card shows more). */
export const SPOKEN_ITEMS = 5;
const CARD_ITEMS = 10;

const SKY: Record<WeatherIcon, string> = {
  sun: 'sunny',
  partly: 'partly cloudy',
  cloud: 'cloudy',
  fog: 'foggy',
  rain: 'rainy',
  snow: 'snowy',
  storm: 'stormy',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDay = (date: string) => weekdayName(date).slice(0, 3);
/** "a 40", "an 80", "an 8", "an 11", "an 18". */
const aPct = (pct: number) => `${pct === 8 || pct === 11 || pct === 18 || (pct >= 80 && pct < 90) ? 'an' : 'a'} ${pct}`;

/** The dates a `when` covers, from `today`. */
export function datesFor(when: AskWhen, today: string): string[] {
  if (when === 'today') return [today];
  if (when === 'tomorrow') return [addDaysTo(today, 1)];
  if (when === 'week') return Array.from({ length: 7 }, (_, i) => addDaysTo(today, i));
  const wd = weekdayOf(today);
  if (when === 'weekend') {
    if (wd === 6) return [today, addDaysTo(today, 1)];
    if (wd === 0) return [today];
    return [addDaysTo(today, 6 - wd), addDaysTo(today, 7 - wd)];
  }
  const target = WEEKDAY_WORDS.indexOf(when);
  return [addDaysTo(today, (target - wd + 7) % 7)];
}

/** "today", "tomorrow", "Saturday". */
function dayWord(date: string, today: string): string {
  if (date === today) return 'today';
  if (date === addDaysTo(today, 1)) return 'tomorrow';
  return weekdayName(date);
}

function whenWord(when: AskWhen, today: string): string {
  if (when === 'weekend') return 'this weekend';
  if (when === 'week') return 'this week';
  return dayWord(datesFor(when, today)[0] ?? today, today);
}

function card(kicker: string, title: string, label: string, icon: WallBrief['icon'], date: string, lines: BriefLine[]): WallBrief {
  return { date, kicker, title, label, icon, lines };
}

const answer = (speech: string, text = speech): BriefLine => ({ kind: 'answer', text, speech });
const item = (text: string): BriefLine => ({ kind: 'item', text, speech: '' });

/** Card rows for a list: up to CARD_ITEMS, then "and N more". */
function rows(texts: readonly string[]): BriefLine[] {
  const shown = texts.slice(0, CARD_ITEMS).map(item);
  if (texts.length > CARD_ITEMS) shown.push({ kind: 'more', text: `and ${texts.length - CARD_ITEMS} more`, speech: '' });
  return shown;
}

function noWeather(ctx: AnswerContext): WallBrief {
  return card('Weather', 'No forecast', 'Weather', 'weather', ctx.today, [
    answer("I don't have the weather right now. Check the wall's location in Settings and its internet connection."),
  ]);
}

function weatherForDay(date: string, ctx: AnswerContext, weather: WallWeather): BriefLine | null {
  if (date === ctx.today) {
    const rain = weather.rainNote ? ` ${weather.rainNote.replace('–', ' to ')}.` : '';
    return answer(
      `It's ${weather.current.temp} degrees and ${SKY[weather.current.icon]}, with a high of ${weather.high} and a low of ${weather.low}.${rain}`,
      `${weather.current.temp}° now, ${SKY[weather.current.icon]} · high ${weather.high}°, low ${weather.low}°${weather.rainNote ? ` · ${weather.rainNote.toLowerCase()}` : ''}`
    );
  }
  const d = weather.days.find(x => x.date === date);
  if (!d) return null;
  const pct = Math.round(d.precipMax);
  const rain = pct >= 40 ? ` There's ${aPct(pct)} percent chance of rain.` : '';
  return answer(
    `${cap(dayWord(date, ctx.today))} looks ${SKY[d.icon]}, with a high of ${d.high} and a low of ${d.low}.${rain}`,
    `${weekdayName(date)} · ${SKY[d.icon]} · high ${d.high}°, low ${d.low}°${pct >= 40 ? ` · ${pct}% rain` : ''}`
  );
}

const OUT_OF_RANGE = "I only have the forecast for the next 6 days.";

function weatherAnswer(when: AskWhen, ctx: AnswerContext): WallBrief {
  const weather = ctx.weather;
  if (!weather) return noWeather(ctx);
  if (when === 'week') {
    const lines = weather.days.map(d => {
      const pct = Math.round(d.precipMax);
      return {
        kind: 'item' as const,
        text: `${shortDay(d.date)} · ${SKY[d.icon]} · ${d.high}° / ${d.low}°${pct >= 40 ? ` · ${pct}% rain` : ''}`,
        speech: `${cap(dayWord(d.date, ctx.today))}, ${SKY[d.icon]}, ${d.high}.`,
      };
    });
    return card('Weather', 'The week ahead', 'Forecast', 'weather', ctx.today, lines.length ? lines : [answer(OUT_OF_RANGE)]);
  }
  const dates = datesFor(when, ctx.today);
  const lines = dates.map(date => weatherForDay(date, ctx, weather)).filter((l): l is BriefLine => l !== null);
  if (when === 'today') {
    for (const b of weather.blocks) lines.push(item(`${b.label} · ${b.temp}° · ${SKY[b.icon]}`));
  }
  const title = when === 'today' ? `${weather.current.temp}°` : cap(whenWord(when, ctx.today));
  return card('Weather', title, 'Weather', 'weather', dates[0] ?? ctx.today, lines.length ? lines : [answer(OUT_OF_RANGE)]);
}

function rainAnswer(when: AskWhen, ctx: AnswerContext): WallBrief {
  const weather = ctx.weather;
  if (!weather) return noWeather(ctx);
  const dates = when === 'week' ? weather.days.map(d => d.date) : datesFor(when, ctx.today);
  const days = dates.map(date => weather.days.find(d => d.date === date)).filter((d): d is NonNullable<typeof d> => d !== undefined);
  if (days.length === 0) return card('Weather', 'Rain', 'Rain', 'weather', ctx.today, [answer(OUT_OF_RANGE)]);
  const worst = days.reduce((a, b) => (b.precipMax > a.precipMax ? b : a));
  const pct = Math.round(worst.precipMax);
  const what = worst.icon === 'snow' ? 'snow' : 'rain';
  const where = days.length === 1 ? dayWord(worst.date, ctx.today) : `on ${weekdayName(worst.date)}`;
  let speech: string;
  if (pct >= 50) speech = `Yes, ${what} is likely ${where}, ${aPct(pct)} percent chance.`;
  else if (pct >= 20) speech = `Maybe. There's ${aPct(pct)} percent chance of ${what} ${where}.`;
  else speech = `Probably not. There's only ${aPct(pct)} percent chance of ${what} ${days.length === 1 ? where : whenWord(when, ctx.today)}.`;
  if (worst.date === ctx.today && weather.rainNote) speech += ` ${weather.rainNote.replace('–', ' to ')}.`;
  const lines = [answer(speech)];
  if (days.length > 1) for (const d of days) lines.push(item(`${shortDay(d.date)} · ${Math.round(d.precipMax)}% chance`));
  return card('Weather', `${pct}% chance`, 'Rain', 'weather', worst.date, lines);
}

function temperatureAnswer(ctx: AnswerContext): WallBrief {
  const weather = ctx.weather;
  if (!weather) return noWeather(ctx);
  return card('Weather', `${weather.current.temp}°`, 'Temperature', 'weather', ctx.today, [
    answer(
      `It's ${weather.current.temp} degrees right now, with a high of ${weather.high} today.`,
      `${weather.current.temp}° now · high ${weather.high}°, low ${weather.low}°`
    ),
  ]);
}

function eventLine(e: WallEvent, ctx: AnswerContext, withDay: boolean): { text: string; speech: string } {
  const who = ctx.person(e.ownerKey);
  const day = withDay ? `${weekdayName(e.date)} ` : '';
  if (e.allDay || !e.start) {
    const label = e.source === 'bill' ? `${e.title} is due` : e.title;
    return {
      text: `${withDay ? `${shortDay(e.date)} · ` : ''}${label}${who ? ` · ${who}` : ''}`,
      speech: `${withDay ? `${weekdayName(e.date)}, ` : ''}${who ? `${who} has ` : ''}${lowerFirst(label)}`,
    };
  }
  const at = spokenTime(e.start, ctx.timeZone);
  return {
    text: `${withDay ? `${shortDay(e.date)} ` : ''}${at} · ${e.title}${who ? ` · ${who}` : ''}`,
    speech: `${day}at ${at}, ${who ? `${who} has ${lowerFirst(e.title)}` : lowerFirst(e.title)}`,
  };
}

function scheduleAnswer(when: AskWhen, ctx: AnswerContext): WallBrief {
  const dates = datesFor(when, ctx.today);
  const events = dates.flatMap(d => eventsOn(ctx.events, d)).filter(e => e.date !== ctx.today || e.allDay || !e.start || Date.parse(e.end ?? e.start) > ctx.now);
  const span = whenWord(when, ctx.today);
  const multi = dates.length > 1;
  const title = cap(span);
  if (events.length === 0) {
    return card(longDateText(dates[0] ?? ctx.today), title, title, 'calendar', dates[0] ?? ctx.today, [answer(`Nothing is on the calendar ${span}.`)]);
  }
  const lines = events.map(e => eventLine(e, ctx, multi));
  const spoken = lines.slice(0, SPOKEN_ITEMS).map(l => l.speech);
  const more = events.length > SPOKEN_ITEMS ? ` And ${events.length - SPOKEN_ITEMS} more.` : '';
  const head = `You have ${plural(events.length, 'thing')} ${span}.`;
  return card(
    multi ? 'Calendar' : longDateText(dates[0] ?? ctx.today),
    title,
    title,
    'calendar',
    dates[0] ?? ctx.today,
    [answer(`${head} ${spoken.map(s => `${cap(s)}.`).join(' ')}${more}`, plural(events.length, 'thing') + ` ${span}`), ...rows(lines.map(l => l.text))]
  );
}

function nextAnswer(ctx: AnswerContext): WallBrief {
  const tomorrow = addDaysTo(ctx.today, 1);
  const upcoming = eventsOn(ctx.events, ctx.today).filter(e => !e.allDay && e.start && Date.parse(e.start) > ctx.now);
  const next = upcoming[0];
  if (next) {
    const l = eventLine(next, ctx, false);
    const after = upcoming[1] ? ` After that, ${eventLine(upcoming[1], ctx, false).speech}.` : '';
    return card('Up next', next.title, 'Up next', 'calendar', ctx.today, [answer(`Next, ${l.speech}.${after}`, l.text), ...(upcoming[1] ? [item(eventLine(upcoming[1], ctx, false).text)] : [])]);
  }
  const first = eventsOn(ctx.events, tomorrow).find(e => !e.allDay && e.start);
  if (first) {
    const l = eventLine(first, ctx, false);
    return card('Up next', 'Nothing else today', 'Up next', 'calendar', ctx.today, [
      answer(`Nothing else is on the calendar today. Tomorrow starts ${l.speech}.`, `Tomorrow · ${l.text}`),
    ]);
  }
  return card('Up next', 'All clear', 'Up next', 'calendar', ctx.today, [answer('Nothing else is on the calendar today or tomorrow.')]);
}

function mealAnswer(meal: MealType, when: AskWhen, ctx: AnswerContext): WallBrief {
  const date = datesFor(when, ctx.today)[0] ?? ctx.today;
  const entry = ctx.mealPlan.find(m => m.date === date && m.type === meal);
  const day = dayWord(date, ctx.today);
  const spokenWhen = meal === 'dinner' && day === 'today' ? 'tonight' : day;
  const label = cap(meal);
  if (!entry) {
    return card(`${label} · ${cap(spokenWhen)}`, 'Nothing planned', label, 'meal', date, [answer(`Nothing's planned for ${meal} ${spokenWhen}.`)]);
  }
  const lead = day === 'today' || day === 'tomorrow' ? `${label} ${spokenWhen}` : `${weekdayName(date)}'s ${meal}`;
  return card(`${label} · ${cap(spokenWhen)}`, entry.mealName, label, 'meal', date, [answer(`${lead} is ${entry.mealName}.`, longDateText(date))]);
}

function mealPlanAnswer(ctx: AnswerContext): WallBrief {
  const dinners = datesFor('week', ctx.today)
    .map(date => ({ date, entry: ctx.mealPlan.find(m => m.date === date && m.type === 'dinner') }))
    .filter((d): d is { date: string; entry: MealPlanItem } => d.entry !== undefined);
  if (dinners.length === 0) return card('Meal plan', 'Nothing planned', 'Meal plan', 'meal', ctx.today, [answer("Nothing's on the meal plan this week.")]);
  const spoken = dinners.slice(0, SPOKEN_ITEMS).map(d => `${cap(d.date === ctx.today ? 'tonight' : dayWord(d.date, ctx.today))}, ${d.entry.mealName}.`);
  const more = dinners.length > SPOKEN_ITEMS ? ` And ${dinners.length - SPOKEN_ITEMS} more.` : '';
  return card('Meal plan', 'This week', 'Meal plan', 'meal', ctx.today, [
    answer(`${spoken.join(' ')}${more}`, `${plural(dinners.length, 'dinner')} planned`),
    ...rows(dinners.map(d => `${shortDay(d.date)} · ${d.entry.mealName}`)),
  ]);
}

function shoppingAnswer(ctx: AnswerContext): WallBrief {
  const open = sortShopping(ctx.shoppingList.filter(i => !i.isPurchased));
  if (open.length === 0) return card('Shopping', 'All done', 'Shopping list', 'list', ctx.today, [answer('The shopping list is empty.')]);
  const names = open.map(i => i.name);
  const n = open.length;
  return card('Shopping', plural(n, 'item'), 'Shopping list', 'list', ctx.today, [
    answer(`There ${n === 1 ? 'is 1 thing' : `are ${n} things`} on the shopping list: ${spokenList(names.map(s => s.toLowerCase()), SPOKEN_ITEMS)}.`, `${plural(n, 'item')} to buy`),
    ...rows(open.map(i => (i.quantity ? `${i.name} (${i.quantity})` : i.name))),
  ]);
}

function todosAnswer(who: string | null, when: 'today' | 'week', ctx: AnswerContext): WallBrief {
  let member: HouseholdMember | undefined;
  if (who) {
    member = ctx.memberFor(who) ?? (who.endsWith('s') ? ctx.memberFor(who.slice(0, -1)) : undefined);
    if (!member) {
      return card('To-dos', 'Who?', 'To-dos', 'list', ctx.today, [answer(`I don't know anyone called ${who}.`)]);
    }
  }
  const mine = (t: ToDo) => !member || t.assignedTo === member.uid;
  const weekEnd = addDaysTo(ctx.today, 6);
  const open = ctx.todos.filter(t => !t.isCompleted && mine(t));
  const due = when === 'today' ? dueTodayTodos(open, ctx.today) : open.filter(t => t.completeByDate <= weekEnd).sort((a, b) => a.completeByDate.localeCompare(b.completeByDate));
  const name = member?.displayName?.split(' ')[0];
  const subject = (n: number) => (name ? `${name} has ${plural(n, 'to-do')}` : `There ${n === 1 ? 'is 1 to-do' : `are ${n} to-dos`}`);
  const span = when === 'today' ? 'today' : 'this week';
  const kicker = name ? `${name}'s to-dos` : 'To-dos';
  if (due.length === 0) {
    const later = when === 'today' ? open.filter(t => t.completeByDate > ctx.today && t.completeByDate <= weekEnd).length : 0;
    const rest = later ? ` ${later === 1 ? 'There is 1 more' : `There are ${later} more`} this week.` : '';
    return card(kicker, 'All clear', 'To-dos', 'list', ctx.today, [answer(`${name ? `${name} has nothing` : 'Nothing is'} due ${span}.${rest}`)]);
  }
  const overdue = due.filter(t => t.completeByDate < ctx.today).length;
  const late = overdue ? `, including ${overdue} overdue` : '';
  const texts = due.map(t => t.text);
  return card(kicker, plural(due.length, 'to-do'), 'To-dos', 'list', ctx.today, [
    answer(`${subject(due.length)} due ${span}${late}: ${spokenList(texts.map(lowerFirst), SPOKEN_ITEMS)}.`, `${plural(due.length, 'to-do')} due ${span}`),
    ...rows(due.map(t => (t.completeByDate < ctx.today ? `${t.text} · overdue` : t.text))),
  ]);
}

/** The card (and its spoken lines) for a question. */
export function composeAnswer(q: WallQuestion, ctx: AnswerContext): WallBrief {
  switch (q.topic) {
    case 'weather':
      return weatherAnswer(q.when, ctx);
    case 'rain':
      return rainAnswer(q.when, ctx);
    case 'temperature':
      return temperatureAnswer(ctx);
    case 'time': {
      const at = spokenTime(new Date(ctx.now).toISOString(), ctx.timeZone);
      return card(longDateText(ctx.today), at, 'Time', 'clock', ctx.today, [answer(`It's ${at}.`, longDateText(ctx.today))]);
    }
    case 'date': {
      const [y] = ctx.today.split('-');
      return card('Today', longDateText(ctx.today), 'Date', 'clock', ctx.today, [answer(`Today is ${longDateText(ctx.today)}.`, `${longDateText(ctx.today)}, ${y ?? ''}`)]);
    }
    case 'next':
      return nextAnswer(ctx);
    case 'schedule':
      return scheduleAnswer(q.when, ctx);
    case 'meal':
      return mealAnswer(q.meal, q.when, ctx);
    case 'mealPlan':
      return mealPlanAnswer(ctx);
    case 'shopping':
      return shoppingAnswer(ctx);
    case 'todos':
      return todosAnswer(q.who, q.when, ctx);
  }
}
