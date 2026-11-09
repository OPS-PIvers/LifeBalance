/**
 * Who a calendar event is for, read from its words.
 *
 * A household writes the person into the event: "Leo – soccer", "Mia's
 * dentist", or a note in the description. When an event names household
 * members by first name, the wall files it under those people:
 *
 * - On any calendar but the holidays. A parent's calendar is where most
 *   kids' events actually live ("Leo dentist" on Mom's calendar); reading
 *   only Family calendars is why a name almost never moved anything.
 * - Into ONE lane: the first person named. "Jen lunch with Gail" is Jen's,
 *   "Pick up Leo and Mia" is Leo's. Copies across lanes read as
 *   several events, so a person's event is never also shown as its owner's.
 *
 * Rules:
 * - A name matches as a whole word ("Leo" in "Leo's game", never in "Leon"),
 *   or by a short form that starts it ("Jen" for Jennifer, 3+ letters) when
 *   no other member's name starts the same way. App names are full names
 *   from Google sign-in; calendars use what the family actually says.
 * - The title wins: the description is read only when the title names no one,
 *   so a note like "Mia is driving" doesn't pull Leo's practice into her lane.
 * - In the title any case matches (titles get typed fast: "leo soccer"). In
 *   the description the name must be capitalised, because descriptions are
 *   prose and names like Will, May or Grace are ordinary words there.
 * - Two members who share a first name can't be told apart, so that name is
 *   ignored rather than guessed.
 * - Results come back in the order the text names them.
 */

export interface MemberName {
  uid: string;
  /** The first word of the member's display name. */
  first: string;
}

/** First names usable for matching, in roster order, ambiguous ones dropped. */
export function memberNames(members: readonly { uid: string; displayName?: unknown }[]): MemberName[] {
  const named = members.flatMap((m) => {
    const first = typeof m.displayName === "string" ? m.displayName.trim().split(/\s+/)[0] ?? "" : "";
    return first.length >= 2 ? [{ uid: m.uid, first }] : [];
  });
  const count = new Map<string, number>();
  for (const n of named) count.set(n.first.toLowerCase(), (count.get(n.first.toLowerCase()) ?? 0) + 1);
  return named.filter((n) => count.get(n.first.toLowerCase()) === 1);
}

/** A stable fingerprint of the names, so a rename or a new member re-reads the feed. */
export function namesKey(names: readonly MemberName[]): string {
  return names.map((n) => `${n.uid}=${n.first.toLowerCase()}`).join(",");
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Words that start a first name but are ordinary words first ("The" is not
 * Theodore, "Will" in "Will pick up" is not William). Only the short-form
 * match consults this; a member literally named Will still matches "Will".
 */
const NOT_SHORT_FORMS = new Set(["the", "and", "all", "are", "art", "can", "will", "bill", "pat", "rob", "sue", "don", "mar", "max", "kit"]);
const MIN_SHORT_FORM = 3;

/** Earliest index in `text` where `n` is named, in full or by a short form only `n` has; -1 if not named. */
function namedAt(text: string, n: MemberName, names: readonly MemberName[], anyCase: boolean): number {
  const word = anyCase ? escape(n.first) : `${escape(n.first.charAt(0).toUpperCase())}${escape(n.first.slice(1))}`;
  const full = new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, anyCase ? "iu" : "u").exec(text);
  let at = full ? full.index : -1;
  // "Jen" for Jennifer, "Theo" for Theodore: a word that starts this name and no other member's.
  const first = n.first.toLowerCase();
  for (const m of text.matchAll(/\p{L}+/gu)) {
    if (at !== -1 && m.index >= at) break;
    const w = m[0];
    const lower = w.toLowerCase();
    if (lower.length < MIN_SHORT_FORM || lower === first || NOT_SHORT_FORMS.has(lower) || !first.startsWith(lower)) continue;
    if (!anyCase && w.charAt(0) !== w.charAt(0).toUpperCase()) continue;
    // A member called exactly this word, or another name it starts too, makes it someone else's or ambiguous.
    if (names.some((o) => o.uid !== n.uid && o.first.toLowerCase().startsWith(lower))) continue;
    at = m.index;
    break;
  }
  return at;
}

function namedIn(text: string, names: readonly MemberName[], anyCase: boolean): string[] {
  if (!text) return [];
  return names
    .map((n) => ({ uid: n.uid, at: namedAt(text, n, names, anyCase) }))
    .filter((x) => x.at !== -1)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.uid);
}

/** The members an event names, in the order it names them, title first, then the description; [] for no one. */
export function eventOwners(title: string, description: string, names: readonly MemberName[]): string[] {
  const inTitle = namedIn(title, names, true);
  return inTitle.length > 0 ? inTitle : namedIn(description, names, false);
}

/**
 * The row's owner for a feed owned by `feedOwner` ("family" or a uid) when
 * the event names `named`: the first person it names, on any calendar, or the
 * calendar's owner when it names no one. One lane per event, never copies:
 * "Jen lunch with Gail" is Jen's, "Paul drive Leo to soccer" is Paul's.
 */
export function ownerFields(feedOwner: string, named: readonly string[]): { ownerKey: string } {
  return { ownerKey: named[0] ?? feedOwner };
}
