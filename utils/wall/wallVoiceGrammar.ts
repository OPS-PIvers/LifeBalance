import type { WallVoiceCommand } from '@/services/geminiService.types';
import { addDaysTo, weekdayOf } from './wallCalendar';

/**
 * The no-AI grammar for ADDS (docs/plans/wall-display-kiosk.md §12 "Wake
 * word"): the common ways a family asks the wall to add groceries or a
 * to-do, turned into the same `WallVoiceCommand` the Gemini path returns, so
 * `resolveVoiceCommand` makes the writes either way. On the on-device engine
 * (openWakeWord + Vosk) this is the only parser: anything it can't read is "Didn't
 * catch that", never a Gemini call.
 */

export interface LocalAddContext {
  /** Household members' display names. */
  memberNames: readonly string[];
  /** Grocery catalog names; used to split "milk eggs bread" and to spell items. */
  catalogNames: readonly string[];
  /** yyyy-MM-dd, the household's today. */
  today: string;
}

/** Lower-case, keep commas (item separators), drop other punctuation. */
function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9, ]+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(hey |ok |okay |um |uh |so )+/, '')
    .replace(/^(please |can you |could you |would you )+/, '')
    .replace(/,? please$/, '')
    .replace(/[, ]+$/, '')
    .trim();
}

const NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  a: 1, an: 1, another: 1, couple: 2,
};
const UNITS = new Set([
  'dozen', 'gallon', 'gallons', 'half gallon', 'pound', 'pounds', 'lb', 'lbs', 'bag', 'bags', 'box', 'boxes', 'bottle', 'bottles',
  'can', 'cans', 'pack', 'packs', 'package', 'packages', 'loaf', 'loaves', 'carton', 'cartons', 'jar', 'jars', 'bunch', 'bunches',
  'case', 'cases', 'container', 'containers', 'roll', 'rolls', 'quart', 'quarts', 'pint', 'pints',
]);

const isNumber = (w: string | undefined): boolean => w !== undefined && (/^\d+$/.test(w) || w in NUMBERS);
const numberValue = (w: string): number => (/^\d+$/.test(w) ? Number(w) : (NUMBERS[w] ?? 1));

/** "milk" ↔ "Milk", "avocado" ↔ "Avocados", "tomatoes" ↔ "Tomato". */
function singular(w: string): string {
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('oes') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}
const key = (words: readonly string[]) => words.map(singular).join(' ');

interface Catalog {
  /** Singularized, cleaned name → the catalog's own spelling. */
  byKey: Map<string, string>;
  /** Longest name, in words. */
  longest: number;
}

function catalogIndex(names: readonly string[]): Catalog {
  const byKey = new Map<string, string>();
  let longest = 1;
  for (const name of names) {
    const words = clean(name).replace(/,/g, '').split(' ').filter(Boolean);
    if (words.length === 0) continue;
    const k = key(words);
    if (!byKey.has(k)) byKey.set(k, name);
    longest = Math.max(longest, words.length);
  }
  return { byKey, longest };
}

/** Leading "two", "a dozen", "3 pounds of", "a bag of": the spoken quantity and where the name starts. */
function quantityAt(words: readonly string[], i: number): { quantity?: string; next: number } {
  let j = i;
  let count: number | null = null;
  const w = words[j];
  if (w === 'a' && words[j + 1] === 'couple' && words[j + 2] === 'of') {
    count = 2;
    j += 3;
  } else if (w === 'some') {
    j += 1;
  } else if (w !== undefined && isNumber(w)) {
    count = numberValue(w);
    j += 1;
  }
  let unit: string | null = null;
  const two = `${words[j] ?? ''} ${words[j + 1] ?? ''}`;
  if (UNITS.has(two)) {
    unit = two;
    j += 2;
  } else if (words[j] !== undefined && UNITS.has(words[j] ?? '')) {
    unit = words[j] ?? null;
    j += 1;
  }
  if (unit && words[j] === 'of') j += 1;
  // "a" alone is an article, not a quantity; "a dozen" is one.
  const article = w === 'a' || w === 'an' || w === 'another';
  if (unit) return { quantity: count === null ? unit : `${count} ${unit}`, next: j };
  if (count === null || article) return { next: j };
  return { quantity: String(count), next: j };
}

/**
 * One spoken chunk → items. Without commas ("milk eggs and bread" comes out
 * of a recognizer with none), catalog names and number words mark where one
 * item ends and the next begins; unknown words between them stay together
 * as one item ("paper towels").
 */
function itemsOf(chunk: string, catalog: Catalog): { name: string; quantity?: string }[] {
  const words = chunk.split(' ').filter(Boolean);
  const items: { name: string; quantity?: string }[] = [];
  let run: string[] = [];
  let runQty: string | undefined;
  const flushRun = () => {
    if (run.length > 0) {
      const name = catalog.byKey.get(key(run)) ?? run.join(' ');
      items.push({ name, ...(runQty ? { quantity: runQty } : {}) });
    }
    run = [];
    runQty = undefined;
  };
  let i = 0;
  while (i < words.length) {
    // A number word starts a new item ("milk two avocados").
    const q = quantityAt(words, i);
    if (q.next > i) {
      flushRun();
      runQty = q.quantity;
      i = q.next;
      continue;
    }
    let matched = 0;
    for (let len = Math.min(catalog.longest, words.length - i); len > 0; len--) {
      if (catalog.byKey.has(key(words.slice(i, i + len)))) {
        matched = len;
        break;
      }
    }
    if (matched > 0) {
      const spoken = words.slice(i, i + matched);
      const catalogName = catalog.byKey.get(key(spoken)) ?? spoken.join(' ');
      if (run.length > 0 && runQty) {
        // "two bags of frozen peas": the words after a quantity describe this item.
        items.push({ name: [...run, ...spoken].join(' '), quantity: runQty });
        run = [];
      } else {
        // "bread milk": an unknown run before a catalog name is its own item.
        const qty = runQty;
        flushRun();
        items.push({ name: catalogName, ...(qty ? { quantity: qty } : {}) });
      }
      runQty = undefined;
      i += matched;
      continue;
    }
    run.push(words[i] ?? '');
    i += 1;
  }
  flushRun();
  return items.filter(it => it.name && !/^(and|or|some|the|of)$/.test(it.name));
}

function shoppingItems(list: string, catalog: Catalog): { name: string; quantity?: string }[] {
  const chunks = list
    .split(/,| and | plus | also | & /)
    .map(c => c.replace(/^(and|also|plus) /, '').trim())
    .filter(Boolean);
  return chunks.flatMap(c => itemsOf(c, catalog));
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** A trailing "today", "tomorrow", "on friday", "by next monday", "this weekend" → the date, and the text without it. */
function splitDue(text: string, today: string): { text: string; due?: string } {
  const m = /^(.*?)(?:,? (?:by|on|for|due|before))? (today|tonight|this (?:morning|afternoon|evening)|tomorrow(?: morning| afternoon| night)?|this weekend|(this |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday))$/.exec(text);
  if (!m) return { text };
  const rest = (m[1] ?? '').trim();
  const when = m[2] ?? '';
  if (/^(today|tonight|this (morning|afternoon|evening))$/.test(when)) return { text: rest, due: 'today' };
  if (when.startsWith('tomorrow')) return { text: rest, due: 'tomorrow' };
  if (when === 'this weekend') {
    const ahead = (6 - weekdayOf(today) + 7) % 7;
    return { text: rest, due: addDaysTo(today, ahead) };
  }
  const day = WEEKDAYS.indexOf(m[4] ?? '');
  let ahead = (day - weekdayOf(today) + 7) % 7;
  // "Friday" said on a Friday means next week's; "this Friday" means today.
  if (ahead === 0 && m[3] !== 'this ') ahead = 7;
  return { text: rest, due: addDaysTo(today, ahead) };
}

/** Nobody in particular: the to-do goes to Family. Pronouns too, since a recognizer often hears "him" for a short name. */
const SELF = /^(me|us|we|everyone|everybody|the family|family|the kids|all of us|him|her|them)$/;

function memberNamed(name: string, members: readonly string[]): string | undefined {
  const n = name.trim();
  if (!n || SELF.test(n)) return undefined;
  const cleaned = members.map(m => ({ m, c: clean(m).replace(/,/g, '') }));
  const full = cleaned.find(x => x.c === n);
  if (full) return full.m;
  const first = cleaned.filter(x => x.c.split(' ')[0] === n);
  return first.length === 1 ? first[0]?.m : undefined;
}

function todo(text: string, ctx: LocalAddContext, assignee?: string): WallVoiceCommand | null {
  const { text: task, due } = splitDue(text, ctx.today);
  const t = task.replace(/^(to |that |about )/, '').replace(/^(i |we )need to /, '').trim();
  if (!t) return null;
  return {
    transcript: '',
    intent: 'add_todo',
    todo: { text: t, ...(assignee ? { assigneeName: assignee } : {}), ...(due ? { due } : {}) },
  };
}

const TODO_LIST = '(?:the |my |our )?(?:to ?dos?|to do list|todo list|tasks?|task list|chores?|chore list|reminders?)';
const SHOP_LIST = '(?:the |my |our )?(?:shopping|grocery|groceries)(?: list)?|(?:the |my |our )?list';

/**
 * An add, read without AI. Returns null when the words aren't one of the
 * shapes below, so the caller can say "Didn't catch that" (or, on the
 * Gemini-backed engines, ask the model).
 */
export function parseLocalAdd(transcript: string, ctx: LocalAddContext): WallVoiceCommand | null {
  const t = clean(transcript);
  if (!t) return null;
  const catalog = catalogIndex(ctx.catalogNames);
  const stamp = (c: WallVoiceCommand | null): WallVoiceCommand | null => (c ? { ...c, transcript } : null);
  const shopping = (list: string): WallVoiceCommand | null => {
    const items = shoppingItems(list, catalog);
    return items.length > 0 ? { transcript, intent: 'add_shopping', items } : null;
  };

  // To-dos first: "add call the dentist to the to-do list" names its list.
  let m = new RegExp(`^(?:add|put|create|make) (?:a |an )?(?:new )?(?:to ?do|task|reminder|chore)(?: for (.+?))?(?: to| that|:)? (.+)$`).exec(t);
  if (m) return stamp(todo(m[2] ?? '', ctx, memberNamed(m[1] ?? '', ctx.memberNames)));
  m = new RegExp(`^(?:add|put) (.+?) (?:to|on|in) (?:(.+?)s )?${TODO_LIST}$`).exec(t);
  if (m) {
    const owner = m[2] ? memberNamed(m[2], ctx.memberNames) : undefined;
    return stamp(todo(m[1] ?? '', ctx, owner));
  }
  m = new RegExp(`^(?:add|put) (.+?) (?:to|on|in) ${TODO_LIST} for (.+)$`).exec(t);
  if (m) return stamp(todo(m[1] ?? '', ctx, memberNamed(m[2] ?? '', ctx.memberNames)));
  // "reminds": recognizers often add the s.
  m = /^reminds? (.+?) (?:to|that|about) (.+)$/.exec(t);
  if (m) {
    const who = m[1] ?? '';
    const assignee = memberNamed(who, ctx.memberNames);
    // "Remind grandma to call": not a member, so it stays in the words.
    const text = assignee || SELF.test(who) ? (m[2] ?? '') : `${who} to ${m[2] ?? ''}`;
    return stamp(todo(text, ctx, assignee));
  }
  m = /^(.+?) (?:needs|has) to (.+)$/.exec(t);
  if (m) {
    const assignee = memberNamed(m[1] ?? '', ctx.memberNames);
    if (assignee) return stamp(todo(m[2] ?? '', ctx, assignee));
  }

  // Shopping.
  m = new RegExp(`^(?:add|put) (.+?) (?:to|on|onto) (?:${SHOP_LIST})$`).exec(t);
  if (m) return shopping(m[1] ?? '');
  m = /^(?:we need|we need some|we need more|we(?:re| are) (?:out of|low on|almost out of)|i need|buy|pick up|get some) (.+)$/.exec(t);
  if (m) return shopping(m[1] ?? '');
  m = /^(?:add|put) (.+)$/.exec(t);
  // "Add soccer to the calendar" isn't a grocery.
  if (m && !/ (to|on|onto|in|into) (the |my |our )?(calendar|schedule|meal plan|menu|meals)$/.test(t)) return shopping(m[1] ?? '');
  return null;
}
