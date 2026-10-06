import type { GroceryCatalogItem, HouseholdMember, ShoppingItem, ToDo, WallVoiceEngine } from '@/types/schema';
import type { WallVoiceCommand } from '@/services/geminiService.types';
import { dueDateFor, newShoppingItem } from './wallLists';
import { spokenDay, spokenList } from './wallSpeech';
import { QUESTION_PHRASES, parseQuestion, type WallQuestion } from './wallAnswers';

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
  | { kind: 'cancel' }
  /** The day brief; "auto" = today, or tomorrow in the evening. */
  | { kind: 'brief'; day: 'today' | 'tomorrow' | 'auto' }
  /** A question the wall answers out loud (utils/wall/wallAnswers.ts). */
  | { kind: 'ask'; question: WallQuestion };

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

const BRIEF_TODAY = /^(good morning|(whats|what is) (on |happening )?today|whats the plan( for)? today|(give me )?(my |the )?(morning |daily |day )?brief(ing)?( me)?|brief me|how does (my |the )?(day|today) look|(whats|what is|tell me about) (my|the|our) day( today)?|my day|day at a glance|(whats|what is) on (my|the|our) calendar( today)?)$/;
const BRIEF_TOMORROW = /^((whats|what is) (on |happening )?tomorrow|whats the plan( for)? tomorrow|how does tomorrow look|(whats|what is|tell me about) (my|the|our) day tomorrow|(whats|what is) on (my|the|our) calendar tomorrow|tomorrow)$/;

function briefOf(t: string): LocalCommand | null {
  if (BRIEF_TOMORROW.test(t)) return { kind: 'brief', day: 'tomorrow' };
  if (BRIEF_TODAY.test(t)) {
    // "What's today" / "good morning" mean today; "what's my day" follows the clock.
    return { kind: 'brief', day: /today|good morning|calendar/.test(t) ? 'today' : 'auto' };
  }
  return null;
}

/**
 * The no-AI grammar: navigation, rotation, undo, cancel, the day brief and
 * spoken questions.
 * Adds have their own no-AI grammar (`parseLocalAdd` in wallVoiceGrammar.ts);
 * what neither reads goes to Gemini, except on the on-device engine.
 */
export function parseLocalCommand(text: string): LocalCommand | null {
  const t = normalizeSpeech(text);
  if (!t) return null;
  if (/^(undo|undo that|take that back|remove that)$/.test(t)) return { kind: 'undo' };
  if (/^(cancel|never ?mind|stop|nothing|forget it)$/.test(t)) return { kind: 'cancel' };
  const brief = briefOf(t);
  if (brief) return brief;
  if (/^(start|resume|turn on) (the )?rotat(e|ing|ion)( the panel| modules?)?$/.test(t)) return { kind: 'rotate', on: true };
  if (/^(stop|pause|turn off) (the )?rotat(e|ing|ion)( the panel| modules?)?$/.test(t)) return { kind: 'rotate', on: false };
  const show = /^(show|open|go to|switch to|display)( me)? (.+)$/.exec(t);
  const target = targetOf(show?.[3] ?? t);
  if (target) return { kind: 'show', target };
  const question = parseQuestion(t);
  if (!question) return null;
  // "What do we have going on today" is the day brief.
  if (question.topic === 'schedule' && (question.when === 'today' || question.when === 'tomorrow')) return { kind: 'brief', day: question.when };
  return { kind: 'ask', question };
}

/**
 * Everything the no-AI command grammar reads, as plain phrases, for the
 * on-device engine's command-only recognizer (Vosk hears these far more
 * reliably than free speech: "show the calendar", not "though the calendar").
 * wallVoice.test.ts checks each one parses.
 */
export const COMMAND_PHRASES: readonly string[] = [
  ...['the calendar', 'the week', 'this week', 'the day', 'today', 'the month', 'this month', 'the shopping list', 'the grocery list',
    'shopping', 'groceries', 'the list', 'to dos', 'the to do list', 'tasks', 'chores', 'meals', 'the meal plan', 'dinner', 'the menu',
  ].flatMap(target => [`show ${target}`, `open ${target}`, `go to ${target}`]),
  'calendar', 'month', 'today', 'shopping list', 'to dos', 'meals',
  'start rotating', 'stop rotating',
  'undo', 'undo that', 'take that back',
  'cancel', 'never mind', 'forget it',
  'good morning', "what's my day", "what's on today", "what's on my calendar", "what's tomorrow", "what's on tomorrow",
  'brief me', 'how does my day look', 'how does tomorrow look',
  ...QUESTION_PHRASES,
];

/**
 * The on-device engine hears each command twice: freely, and through the
 * command-only recognizer. The free transcript wins unless it reads as
 * nothing at all while the command one reads cleanly ("[unk]" means it heard
 * something outside its phrases) — so a misheard "show the calendar" is
 * rescued, and an add can never turn into a command.
 */
export function pickTranscript(transcript: string, alternative: string | undefined, readsAsAdd: (text: string) => boolean): string {
  if (!alternative || alternative.includes('[unk]')) return transcript;
  if (parseLocalCommand(transcript) || readsAsAdd(transcript)) return transcript;
  return parseLocalCommand(alternative) ? alternative : transcript;
}

/**
 * What the tail of a wake word tends to come out as when the recognizer hears
 * its last syllable ("Jarvis" → "this", "the"), plus fillers.
 */
const LEAD_IN = new Set(['this', 'the', 'these', 'his', 'is', 'its', 'it', 'us', 'a', 'of', 'so', 'and', 'uh', 'um', 'er']);

/**
 * Drops one or two such words from the start, but only when that turns an
 * unreadable command into a readable one ("this show the calendar" → "show
 * the calendar"); a command that already reads is never touched.
 */
export function trimLeadIn(text: string, readable: (text: string) => boolean): string {
  if (readable(text)) return text;
  const words = text.trim().split(/\s+/);
  for (let drop = 1; drop <= 2 && drop < words.length; drop++) {
    if (!LEAD_IN.has(normalizeSpeech(words[drop - 1] ?? ''))) break;
    const rest = words.slice(drop).join(' ');
    if (readable(rest)) return rest;
  }
  return text;
}

/** Drops the wake word from the start of a command ("hey jarvis add milk" → "add milk"). */
export function stripWakeWord(text: string, label: string): string {
  const wake = new Set(normalizeSpeech(label).split(' ').filter(Boolean));
  wake.add('hey');
  const words = text.trim().split(/\s+/);
  let i = 0;
  while (i < words.length && wake.has(normalizeSpeech(words[i] ?? ''))) i++;
  return words.slice(i).join(' ');
}

export interface VoiceSupport {
  speech: boolean;
  audio: boolean;
  /** This browser can run the on-device engine (WebAssembly workers and a mic). */
  device?: boolean;
}

/**
 * Which engine a tap uses. `auto` uses the on-device engine wherever it
 * runs; otherwise Safari's speech recognition, falling back to
 * recorded audio once speech has been refused on this launch (plan §6
 * decision rule). Null = voice is unavailable here.
 */
export function pickVoiceEngine(
  setting: WallVoiceEngine,
  support: VoiceSupport,
  speechRefused: boolean
): 'device' | 'speech' | 'audio' | null {
  if (setting === 'off') return null;
  if (setting === 'device') return support.device ? 'device' : null;
  if (setting === 'speech') return support.speech ? 'speech' : null;
  if (setting === 'audio') return support.audio ? 'audio' : null;
  if (support.device) return 'device';
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
