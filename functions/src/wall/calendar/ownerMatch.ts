/**
 * Who a shared ("family") calendar event is for, read from its words.
 *
 * A household often keeps one shared calendar and writes the person into the
 * event: "Leo – soccer", "Mia's dentist", or a note in the description. When
 * a family feed's event names household members by first name, the wall files
 * it under those people instead of Everyone.
 *
 * Rules:
 * - A name matches as a whole word ("Leo" in "Leo's game", never in "Leon").
 * - The title wins: the description is read only when the title names no one,
 *   so a note like "Mia is driving" doesn't pull Leo's practice into her lane.
 * - In the title any case matches (titles get typed fast: "leo soccer"). In
 *   the description the name must be capitalised, because descriptions are
 *   prose and names like Will, May or Grace are ordinary words there.
 * - Two members who share a first name can't be told apart, so that name is
 *   ignored rather than guessed.
 * - Results come back in roster order, so a re-sync never reorders them.
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

function namedIn(text: string, names: readonly MemberName[], anyCase: boolean): string[] {
  if (!text) return [];
  return names
    .filter((n) => {
      const word = anyCase ? escape(n.first) : `${escape(n.first.charAt(0).toUpperCase())}${escape(n.first.slice(1))}`;
      return new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, anyCase ? "iu" : "u").test(text);
    })
    .map((n) => n.uid);
}

/** The members an event names, title first, then the description; [] for no one. */
export function eventOwners(title: string, description: string, names: readonly MemberName[]): string[] {
  const inTitle = namedIn(title, names, true);
  return inTitle.length > 0 ? inTitle : namedIn(description, names, false);
}
