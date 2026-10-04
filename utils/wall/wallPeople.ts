import type { HouseholdMember } from '@/types/schema';
import { FAMILY_COLOR, buildMemberColorMap, memberColorFor } from '@/utils/memberColors';

/**
 * Who an event or to-do belongs to, as the wall shows it (plan §3 "Person
 * identity"): a colored dot plus a name, or a filled initial on Day blocks.
 * `key` is a member uid or 'family' (calendar owners); an absent assignee is
 * the family too.
 */
export interface WallPeople {
  color: (key: string | undefined) => string;
  name: (key: string | undefined) => string;
  initial: (key: string | undefined) => string;
  /** Members in roster order, for filter chips and pickers. */
  members: { uid: string; name: string }[];
}

export function makeWallPeople(members: readonly HouseholdMember[], dark: boolean): WallPeople {
  const colors = buildMemberColorMap(members);
  const names = new Map(members.map(m => [m.uid, m.displayName || 'Someone']));
  const isFamily = (key: string | undefined) => !key || key === 'family';
  const name = (key: string | undefined) => (isFamily(key) ? 'Family' : (names.get(key ?? '') ?? 'Someone'));
  return {
    color: key =>
      isFamily(key) ? FAMILY_COLOR[dark ? 'dark' : 'light'] : memberColorFor(colors, key ?? '', { scheme: dark ? 'dark' : 'light' }),
    name,
    initial: key => name(key).trim().charAt(0).toUpperCase() || '?',
    members: members.map(m => ({ uid: m.uid, name: names.get(m.uid) ?? 'Someone' })),
  };
}
