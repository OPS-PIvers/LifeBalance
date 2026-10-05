import type { GroceryCatalogItem, HouseholdMember, ShoppingItem, ToDo, WallVoiceEngine } from '@/types/schema';
import type { WallVoiceCommand } from '@/services/geminiService.types';
import { dueDateFor, newShoppingItem } from './wallLists';
import { spokenDay, spokenList } from './wallSpeech';

/**
 * Pure logic for the wall's tap-to-talk commands
 * (docs/plans/wall-display-kiosk.md §3 "Voice", §4.10): the local keyword
 * grammar that runs before any AI call, the engine choice, and turning a
 * parsed command into the writes the wall makes.
 */

export type VoiceTarget = 'week' | 'day' | 'month' | 'shopping' | 'todos' | 'meals';

export type LocalCommand =
  | { kind: 'show'; target: VoiceTarget }
  | { kind: 'rotate'; on: boolean }
  | { kind: 'undo' }
  | { kind: 'cancel' };

const TARGETS: [RegExp, VoiceTarget][] = [
  [/^(the )?(calendar|week|this week|week view)$/, 'week'],
  [/^(the )?(day|today|day view)$/, 'day'],
  [/^(the )?(month|this month|month view)$/, 'month'],
  [/^(the )?(shopping|grocery|groceries)( list)?$/, 'shopping'],
  [/^(the )?lists?$/, 'shopping'],
  [/^(the )?(to ?dos?|to do list|todo list|tasks|chores)$/, 'todos'],
  [/^(the )?(meals?|meal plan|dinners?|menu|recipes?)$/, 'meals'],
];

function targetOf(phrase: string): VoiceTarget | null {
  for (const [re, target] of TARGETS) if (re.test(phrase)) return target;
  return null;
}

/** Lower-case, drop punctuation and politeness so "Show me the meals, please." matches. */
export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(hey |ok |okay |um |uh )+/, '')
    .replace(/^(please |can you |could you )+/, '')
    .replace(/ please$/, '')
    .trim();
}

/**
 * The no-AI grammar: navigation, rotation, undo and cancel. Anything else
 * (adds above all) returns null and goes to Gemini.
 */
export function parseLocalCommand(text: string): LocalCommand | null {
  const t = normalizeSpeech(text);
  if (!t) return null;
  if (/^(undo|undo that|take that back|remove that)$/.test(t)) return { kind: 'undo' };
  if (/^(cancel|never ?mind|stop|nothing|forget it)$/.test(t)) return { kind: 'cancel' };
  if (/^(start|resume|turn on) (the )?rotat(e|ing|ion)( the panel| modules?)?$/.test(t)) return { kind: 'rotate', on: true };
  if (/^(stop|pause|turn off) (the )?rotat(e|ing|ion)( the panel| modules?)?$/.test(t)) return { kind: 'rotate', on: false };
  const show = /^(show|open|go to|switch to|display)( me)? (.+)$/.exec(t);
  const target = targetOf(show?.[3] ?? t);
  return target ? { kind: 'show', target } : null;
}

export interface VoiceSupport {
  speech: boolean;
  audio: boolean;
}

/**
 * Which engine a tap uses. `auto` prefers on-device speech recognition and
 * falls back to recorded audio once speech has been refused on this launch
 * (plan §6 decision rule). Null = voice is unavailable here.
 */
export function pickVoiceEngine(setting: WallVoiceEngine, support: VoiceSupport, speechRefused: boolean): 'speech' | 'audio' | null {
  if (setting === 'off') return null;
  if (setting === 'speech') return support.speech ? 'speech' : null;
  if (setting === 'audio') return support.audio ? 'audio' : null;
  if (support.speech && !speechRefused) return 'speech';
  return support.audio ? 'audio' : null;
}

type NewTodo = Omit<ToDo, 'id' | 'createdAt' | 'createdBy'>;

export type VoiceAction =
  | { kind: 'shopping'; items: Omit<ShoppingItem, 'id'>[]; summary: string; spoken: string }
  | { kind: 'todo'; todo: NewTodo; summary: string; spoken: string }
  | { kind: 'unknown' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A spoken name → member uid: the full display name, else a unique first name. */
export function memberForName(members: readonly HouseholdMember[], name: string | undefined): HouseholdMember | undefined {
  const n = normalizeSpeech(name ?? '');
  if (!n) return undefined;
  const full = members.find(m => normalizeSpeech(m.displayName ?? '') === n);
  if (full) return full;
  const byFirst = members.filter(m => normalizeSpeech(m.displayName ?? '').split(' ')[0] === n.split(' ')[0]);
  return byFirst.length === 1 ? byFirst[0] : undefined;
}

function dueFrom(due: string | undefined, today: string): string {
  const d = (due ?? '').trim().toLowerCase();
  if (d === 'tomorrow') return dueDateFor('tomorrow', today);
  if (DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return d;
  return today;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Turns the model's command into the wall's writes. Item names go through the
 * grocery catalog for category and store, the spoken quantity wins over the
 * catalog's usual one, and an assignee nobody in the household matches falls
 * back to Family (never a guess).
 */
export function resolveVoiceCommand(
  command: WallVoiceCommand,
  ctx: { members: readonly HouseholdMember[]; catalog: readonly GroceryCatalogItem[]; today: string }
): VoiceAction {
  if (command.intent === 'add_shopping') {
    const seen = new Set<string>();
    const items: Omit<ShoppingItem, 'id'>[] = [];
    for (const raw of command.items ?? []) {
      const name = capitalize(raw.name.trim());
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const quantity = raw.quantity?.trim();
      items.push(newShoppingItem(name, ctx.catalog, null, { source: 'voice', ...(quantity ? { quantity } : {}) }));
    }
    if (items.length === 0) return { kind: 'unknown' };
    const summary = items.map(i => (i.quantity ? `${i.name} (${i.quantity})` : i.name)).join(', ');
    const spoken = `Added ${spokenList(items.map(i => i.name.toLowerCase()))} to shopping.`;
    return { kind: 'shopping', items, summary, spoken };
  }
  if (command.intent === 'add_todo' && command.todo?.text.trim()) {
    const text = capitalize(command.todo.text.trim());
    const member = memberForName(ctx.members, command.todo.assigneeName);
    const completeByDate = dueFrom(command.todo.due, ctx.today);
    const todo: NewTodo = {
      text,
      completeByDate,
      isCompleted: false,
      source: 'voice',
      ...(member ? { assignedTo: member.uid } : {}),
    };
    const tomorrow = dueDateFor('tomorrow', ctx.today);
    const when = completeByDate === ctx.today ? 'today' : completeByDate === tomorrow ? 'tomorrow' : completeByDate;
    const summary = `${text} · ${member?.displayName ?? 'Family'} · ${when}`;
    const firstName = member?.displayName?.split(' ')[0];
    const spoken = `Added ${text.charAt(0).toLowerCase()}${text.slice(1)}${firstName ? ` for ${firstName}` : ''}, due ${spokenDay(completeByDate, ctx.today, tomorrow)}.`;
    return { kind: 'todo', todo, summary, spoken };
  }
  return { kind: 'unknown' };
}

/** The household facts a Gemini voice prompt is grounded in (catalog most-used first). */
export function voiceContextFrom(
  members: readonly HouseholdMember[],
  catalog: readonly GroceryCatalogItem[],
  today: string,
  timeZone: string
): { memberNames: string[]; catalogNames: string[]; today: string; timeZone: string } {
  return {
    memberNames: members.map(m => m.displayName).filter((n): n is string => Boolean(n)),
    catalogNames: [...catalog].sort((a, b) => (b.purchaseCount ?? 0) - (a.purchaseCount ?? 0)).map(i => i.name),
    today,
    timeZone,
  };
}
