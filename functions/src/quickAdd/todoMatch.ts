/**
 * Pure helper for the `quickAddTodo` endpoint: resolves a caller-supplied
 * assignee name ("assign it to Sam") to a household member's uid. Mirrors the
 * dependency-light decision-layer style of accountMatch.ts / billMatch.ts —
 * no Firestore, trivially unit-testable.
 */

/** The minimal member shape the matcher needs (uid + display name). */
export interface MemberLike {
  uid: string;
  displayName: string;
}

/**
 * Fuzzy-match a caller-supplied name against household members' display
 * names: exact match (case/whitespace-insensitive) first, then a contains
 * match, then a starts-with match — same tiering as the habit-name matcher
 * (functions/src/quickAdd/habitProcessor.ts's fuzzyMatchHabit). Returns null
 * when nothing matches, or when a tier has more than one equally-good
 * candidate (never guess between two similarly-named members).
 */
export function fuzzyMatchMember(
  members: readonly MemberLike[],
  searchTerm: string
): MemberLike | null {
  const normalizedSearch = searchTerm.toLowerCase().trim();
  if (!normalizedSearch) return null;

  const exactMatches = members.filter(
    (m) => m.displayName.toLowerCase().trim() === normalizedSearch
  );
  if (exactMatches.length === 1) return exactMatches[0] ?? null;
  if (exactMatches.length > 1) return null;

  const containsMatches = members.filter((m) =>
    m.displayName.toLowerCase().includes(normalizedSearch)
  );
  if (containsMatches.length === 1) return containsMatches[0] ?? null;
  if (containsMatches.length > 1) return null;

  const startsWithMatches = members.filter((m) =>
    m.displayName.toLowerCase().startsWith(normalizedSearch)
  );
  if (startsWithMatches.length === 1) return startsWithMatches[0] ?? null;

  return null;
}
