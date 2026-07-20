import { addDays, format, getDay, parseISO } from "date-fns";

// F-TODO-15 — deterministic natural-language parsing for the `quickAddTodo`
// endpoint ("Hey Siri, add a task…"). Pure and unit-tested, mirroring the
// emailParser.ts approach for expenses: no AI round-trip, no ambiguity — a
// phrase either matches a documented pattern or is left in the task text.
//
// Extracted (all optional, first match wins, matched phrase is removed):
//   - due date:  today / tonight / tomorrow / weekday names ("friday",
//                "on friday", "next friday") / "next week" / "in N days" /
//                "M/D" or "M/D/YYYY" / "july 25" / "25 july"
//   - due time:  "at 3pm", "at 3:30 pm", "at 15:00", "at 09:30", "at noon",
//                "at midnight" — bare hours 1–12 without am/pm are ambiguous
//                and deliberately NOT parsed
//   - reminder:  "remind me N minutes/hours before", "remind me an hour
//                before", "remind me the day before", bare "remind me" /
//                "with (a) reminder" = at the due time (0)
//   - importance: the word "important" or a trailing "!"
//
// The caller decides precedence — explicit structured body fields always win
// over parsed values (see quickAddTodo).

export interface ParsedTodoPhrase {
  /** The phrase with all recognized fragments removed and whitespace tidied. */
  text: string;
  dueDate?: string; // yyyy-MM-dd
  dueTime?: string; // HH:mm 24-hour
  reminderMinutesBefore?: number;
  isImportant?: boolean;
}

const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

const MONTHS = [
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
] as const;

/** Next calendar occurrence of `weekday` strictly AFTER interpretation rules:
 *  bare/"on" weekday = the next occurrence (today counts as 7 days out only
 *  when prefixed "next"); "next <weekday>" = the occurrence in 1–7 days, then
 *  +7 more when the bare occurrence would be within this week's remainder. */
function nextWeekday(today: Date, weekday: number, isNext: boolean): Date {
  const delta = (weekday - getDay(today) + 7) % 7;
  const days = delta === 0 ? 7 : delta;
  return addDays(today, isNext && delta !== 0 ? days + 7 : days);
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** Resolve a month/day to the next occurrence on/after today (year rollover). */
function resolveMonthDay(today: Date, month: number, day: number, year?: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year !== undefined) return `${year}-${two(month)}-${two(day)}`;
  const thisYear = today.getFullYear();
  const candidate = `${thisYear}-${two(month)}-${two(day)}`;
  return candidate >= format(today, "yyyy-MM-dd")
    ? candidate
    : `${thisYear + 1}-${two(month)}-${two(day)}`;
}

interface Extraction<T> {
  value: T;
  cleaned: string;
}

function extractReminder(input: string): Extraction<number> | null {
  // "remind me 30 minutes before" / "remind me 2 hours before"
  let m = input.match(/\bremind me (\d{1,4})\s*(minutes?|mins?|hours?|hrs?)\s*(?:before|early|ahead)?\b/i);
  if (m && m[1] && m[2]) {
    const n = parseInt(m[1], 10);
    const minutes = /^h/i.test(m[2]) ? n * 60 : n;
    if (minutes >= 0 && minutes <= 10080) {
      return { value: minutes, cleaned: input.replace(m[0], " ") };
    }
  }
  // "remind me an hour before" / "remind me a minute before" / "remind me the day before"
  m = input.match(/\bremind me (?:a|an|one|the) (minute|hour|day|morning)\s*before\b/i);
  if (m && m[1]) {
    const unit = m[1].toLowerCase();
    const minutes = unit === "minute" ? 1 : unit === "hour" ? 60 : 1440;
    return { value: minutes, cleaned: input.replace(m[0], " ") };
  }
  // bare "remind me" / "with a reminder" — at the due time
  m = input.match(/\b(?:remind me|with (?:a )?reminder)\b/i);
  if (m) {
    return { value: 0, cleaned: input.replace(m[0], " ") };
  }
  return null;
}

function extractTime(input: string): Extraction<string> | null {
  // "at noon" / "at midnight" — "at" is REQUIRED so nouns like "noon
  // appointment" or "midnight showing" are never misread as times.
  let m = input.match(/\bat (noon|midnight)\b/i);
  if (m && m[1]) {
    const value = m[1].toLowerCase() === "noon" ? "12:00" : "00:00";
    return { value, cleaned: input.replace(m[0], " ") };
  }
  // "at 3pm" / "at 3:30 pm" / "3pm" / "at 15:00" / "at 09:30"
  // am/pm forms may omit "at"; 24-hour forms require "at" so ordinary numbers
  // in the task text ("buy 3 lemons") are never misread as times. Without
  // am/pm, only UNAMBIGUOUS 24-hour values parse: hours 13–23, or a
  // zero-padded HH:mm ("09:30"). A bare "at 3" is ambiguous in dictation
  // (usually means 3 PM) — guessing either way risks a wrong-time alarm, so
  // it is deliberately left in the task text instead.
  m = input.match(/\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i)
    ?? input.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i);
  if (m && m[1]) {
    let hour = parseInt(m[1], 10);
    const minute = m[2] !== undefined ? parseInt(m[2], 10) : 0;
    const meridiem = m[3]?.toLowerCase().replace(/\./g, "");
    if (minute > 59) return null;
    if (meridiem === "pm" && hour >= 1 && hour <= 12) hour = (hour % 12) + 12;
    else if (meridiem === "am" && hour >= 1 && hour <= 12) hour = hour % 12;
    else if (meridiem === undefined) {
      const explicit24h = m[2] !== undefined && m[1].length === 2; // "09:30", "15:00"
      if (hour > 23) return null;
      if (hour < 13 && !explicit24h) return null;
      if (m[2] === undefined && m[1].length > 2) return null;
    }
    if (hour > 23) return null;
    return { value: `${two(hour)}:${two(minute)}`, cleaned: input.replace(m[0], " ") };
  }
  return null;
}

function extractDate(input: string, today: Date): Extraction<string> | null {
  const todayStr = format(today, "yyyy-MM-dd");

  // today / tonight / tomorrow
  let m = input.match(/\b(today|tonight)\b/i);
  if (m) return { value: todayStr, cleaned: input.replace(m[0], " ") };
  m = input.match(/\btomorrow\b/i);
  if (m) return { value: format(addDays(today, 1), "yyyy-MM-dd"), cleaned: input.replace(m[0], " ") };

  // "in N days" / "in a week"
  m = input.match(/\bin (\d{1,3}) days?\b/i);
  if (m && m[1]) {
    return { value: format(addDays(today, parseInt(m[1], 10)), "yyyy-MM-dd"), cleaned: input.replace(m[0], " ") };
  }
  m = input.match(/\bin a week\b/i);
  if (m) return { value: format(addDays(today, 7), "yyyy-MM-dd"), cleaned: input.replace(m[0], " ") };

  // "next week"
  m = input.match(/\bnext week\b/i);
  if (m) return { value: format(addDays(today, 7), "yyyy-MM-dd"), cleaned: input.replace(m[0], " ") };

  // weekday names, optionally "on"/"next"/"this"
  m = input.match(/\b(?:(next|this|on)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (m && m[2]) {
    const weekday = WEEKDAYS.indexOf(m[2].toLowerCase() as typeof WEEKDAYS[number]);
    const isNext = m[1]?.toLowerCase() === "next";
    return {
      value: format(nextWeekday(today, weekday, isNext), "yyyy-MM-dd"),
      cleaned: input.replace(m[0], " "),
    };
  }

  // "july 25" / "july 25th" / "25 july" / "25th of july"
  const monthAlt = MONTHS.join("|");
  m = input.match(new RegExp(`\\b(?:on )?(${monthAlt})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"))
    ?? input.match(new RegExp(`\\b(?:on )?(?:the )?(\\d{1,2})(?:st|nd|rd|th)?(?: of)?\\s+(${monthAlt})\\b`, "i"));
  if (m && m[1] && m[2]) {
    const first = m[1].toLowerCase();
    const monthName = MONTHS.includes(first as typeof MONTHS[number]) ? first : m[2].toLowerCase();
    const dayStr = MONTHS.includes(first as typeof MONTHS[number]) ? m[2] : m[1];
    const value = resolveMonthDay(today, MONTHS.indexOf(monthName as typeof MONTHS[number]) + 1, parseInt(dayStr, 10));
    if (value) return { value, cleaned: input.replace(m[0], " ") };
  }

  // "7/25" / "7/25/2026" — requires "on"/"by"/"due" so fractions in task
  // text ("mix 1/2 cup") are never misread as dates.
  m = input.match(/\b(?:on|by|due)\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/i);
  if (m && m[1] && m[2]) {
    const value = resolveMonthDay(
      today,
      parseInt(m[1], 10),
      parseInt(m[2], 10),
      m[3] !== undefined ? parseInt(m[3], 10) : undefined
    );
    if (value) return { value, cleaned: input.replace(m[0], " ") };
  }

  return null;
}

function extractImportance(input: string): Extraction<true> | null {
  let m = input.match(/\b(?:this is |it'?s )?(?:really |very )?important\b:?/i);
  if (m) return { value: true, cleaned: input.replace(m[0], " ") };
  m = input.match(/!+\s*$/);
  if (m) return { value: true, cleaned: input.replace(m[0], " ") };
  return null;
}

/** Strip dangling connectives left behind by fragment removal. */
function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/(?:^|\s)(?:on|at|by|and|,)+\s*$/i, "")
    .replace(/^[,.;\s]+|[,.;\s]+$/g, "")
    .trim();
}

/**
 * Parses a free-text task phrase. `todayStr` is the caller-local date
 * (yyyy-MM-dd) — Cloud Functions run in UTC, so the endpoint forwards the
 * Shortcut's `today` just like the other quickAdd endpoints.
 *
 * A reminder without a parsed/explicit time anchors to nothing, so it is
 * DROPPED unless a due time was also found — same invariant as the app form
 * and the structured endpoint fields.
 */
export function parseTodoPhrase(input: string, todayStr: string): ParsedTodoPhrase {
  const today = parseISO(todayStr);
  let text = input;
  const result: ParsedTodoPhrase = { text: input };

  const reminder = extractReminder(text);
  if (reminder) {
    result.reminderMinutesBefore = reminder.value;
    text = reminder.cleaned;
  }

  const time = extractTime(text);
  if (time) {
    result.dueTime = time.value;
    text = time.cleaned;
  }

  const date = extractDate(text, today);
  if (date) {
    result.dueDate = date.value;
    text = date.cleaned;
  }

  const importance = extractImportance(text);
  if (importance) {
    result.isImportant = true;
    text = importance.cleaned;
  }

  // A time was parsed but no date: the natural reading of "at 5pm" is the
  // next upcoming 5pm — today. (The endpoint defaults the date to today
  // anyway; making it explicit here keeps the parser self-contained.)
  if (result.dueTime !== undefined && result.dueDate === undefined) {
    result.dueDate = todayStr;
  }

  // Reminder requires a time anchor (matches the app form's rule).
  if (result.reminderMinutesBefore !== undefined && result.dueTime === undefined) {
    delete result.reminderMinutesBefore;
  }

  const cleaned = tidy(text);
  // Never return an empty task — if parsing consumed everything, keep the
  // original input as the text.
  result.text = cleaned.length > 0 ? cleaned : input.trim();
  return result;
}
