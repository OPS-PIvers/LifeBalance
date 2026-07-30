/**
 * Per-member habit points — the ONE place a member's identity color is decided.
 *
 * Every surface that shows "who did this" (stage 2's pie counter + badge-row
 * avatars, and the drawer / scoreboard / ceremony that follow) reads its colors
 * from here, so a member is the same color everywhere. The map is built once per
 * roster change and passed down — never recomputed per row.
 *
 * Resolution order, per member:
 *   1. a stored `avatarColor` (kid profiles set one; adults may later) — run
 *      through `resolveAvatarColor` so a legacy/arbitrary hex is still mapped
 *      onto the token-derived palette,
 *   2. otherwise, for an ADULT: the next unclaimed slot of
 *      `MEMBER_COLOR_SEQUENCE` — first adult evergreen (`accent-600`), second
 *      amber (`warm-500`), then visually distinct fallbacks,
 *   3. otherwise (a managed profile with no stored color): a hash of their uid,
 *      the same rule `resolveAvatarColor` already applies elsewhere.
 *
 * Colors are POSITIONAL over the roster you pass in. The household roster comes
 * from a plain Firestore collection listener, i.e. document-id order, so it is
 * stable across devices and sessions; adding a member can shift a later
 * member's default color, which is why an explicit `avatarColor` always wins.
 *
 * Hex (not a Tailwind class) because these values are consumed as SVG `fill`s
 * and inline `backgroundColor` — the same precedent `utils/avatarColor.ts`
 * already sets for avatar backgrounds.
 */
import { pickAvatarColor, resolveAvatarColor } from '@/utils/avatarColor';

/** The minimum a member must carry to be colored. */
export interface ColorableMember {
  uid: string;
  avatarColor?: string;
  /** A login-less managed (kid) profile — excluded from the adult sequence. */
  isManaged?: boolean;
}

/** uid → hex color, for every member of the household. */
export type MemberColorMap = Readonly<Record<string, string>>;

/**
 * Default colors for adults with no stored `avatarColor`, in assignment order.
 * The first two are the app's two accent poles (`accent-600` evergreen and
 * `warm-500` amber — the locked mock pairing); the rest are palette entries
 * from `AVATAR_COLORS`, ordered for maximum hue separation.
 */
export const MEMBER_COLOR_SEQUENCE = [
  '#285742', // accent-600 — evergreen
  '#b87a29', // warm-500 — amber
  '#386695', // slate blue
  '#95525d', // dusty rose
  '#197478', // teal
  '#535695', // indigo
] as const;

/** Is this a full member (not a login-less managed kid profile)? */
export const isAdultMember = (member: ColorableMember): boolean => member.isManaged !== true;

/** Build the household's uid → color map (see the module comment for the rules). */
export const buildMemberColorMap = (members: readonly ColorableMember[]): MemberColorMap => {
  const out: Record<string, string> = {};
  const claimed = new Set<string>();

  // 1 — explicit stored colors win, for adults and managed profiles alike.
  for (const member of members) {
    if (!member.avatarColor) continue;
    const color = resolveAvatarColor(member.avatarColor, member.uid);
    out[member.uid] = color;
    claimed.add(color);
  }

  // 2 — adults take the next sequence slot nobody has claimed.
  let next = 0;
  for (const member of members) {
    if (out[member.uid] || !isAdultMember(member)) continue;
    while (next < MEMBER_COLOR_SEQUENCE.length && claimed.has(MEMBER_COLOR_SEQUENCE[next]!)) {
      next += 1;
    }
    // Past the end of the sequence (a very large household) fall back to the
    // hashed palette pick rather than repeating the last color deterministically.
    const color = MEMBER_COLOR_SEQUENCE[next] ?? pickAvatarColor(member.uid);
    out[member.uid] = color;
    claimed.add(color);
    next += 1;
  }

  // 3 — managed profiles with no stored color: hashed, like everywhere else.
  for (const member of members) {
    if (out[member.uid]) continue;
    out[member.uid] = resolveAvatarColor(undefined, member.uid);
  }

  return out;
};

/**
 * Color for one uid. A uid the roster doesn't know (a member removed while
 * their attribution lives on) still gets a stable hashed color rather than a
 * blank, so a historical slice never disappears.
 */
export const memberColorFor = (colors: MemberColorMap, uid: string): string =>
  colors[uid] ?? pickAvatarColor(uid);
