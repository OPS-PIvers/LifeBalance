import { describe, it, expect } from 'vitest';
import { AVATAR_COLORS } from '@/utils/avatarColor';
import { AA_NORMAL_TEXT_CONTRAST, avatarTextColor, contrastRatio } from '@/utils/contrastColor';
import {
  MEMBER_COLOR_SEQUENCE,
  buildMemberColorMap,
  isAdultMember,
  memberColorFor,
} from '@/utils/memberColors';

const PAUL = { uid: 'paul-uid' };
const JEN = { uid: 'jen-uid' };
const SAM = { uid: 'sam-uid' };
const LEO = { uid: 'kid_leo', isManaged: true };

describe('memberColors — adult sequence', () => {
  it('gives the first adult evergreen (accent-600) and the second amber (warm-500)', () => {
    const colors = buildMemberColorMap([PAUL, JEN]);
    expect(colors[PAUL.uid]).toBe('#285742');
    expect(colors[JEN.uid]).toBe('#b87a29');
  });

  it('keeps every adult visually distinct', () => {
    const colors = buildMemberColorMap([PAUL, JEN, SAM, { uid: 'a' }, { uid: 'b' }, { uid: 'c' }]);
    const used = Object.values(colors);
    expect(new Set(used).size).toBe(used.length);
  });

  it('is stable for the same roster (no hashing of adult positions)', () => {
    expect(buildMemberColorMap([PAUL, JEN])).toEqual(buildMemberColorMap([PAUL, JEN]));
  });

  it('falls back past the end of the sequence without crashing or blanking', () => {
    const many = Array.from({ length: MEMBER_COLOR_SEQUENCE.length + 3 }, (_, i) => ({
      uid: `member-${i}`,
    }));
    const colors = buildMemberColorMap(many);
    for (const member of many) {
      expect(colors[member.uid]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('memberColors — stored avatarColor wins', () => {
  it('honors a stored palette color and does not hand it to anyone else', () => {
    // Jen has explicitly claimed evergreen, so Paul must NOT also take it.
    const colors = buildMemberColorMap([PAUL, { ...JEN, avatarColor: '#285742' }]);
    expect(colors[JEN.uid]).toBe('#285742');
    expect(colors[PAUL.uid]).not.toBe('#285742');
    expect(colors[PAUL.uid]).toBe('#b87a29');
  });

  it('maps a legacy arbitrary hex onto the palette rather than using it raw', () => {
    const colors = buildMemberColorMap([{ ...PAUL, avatarColor: '#7c3aed' }]);
    expect(AVATAR_COLORS).toContain(colors[PAUL.uid]);
    expect(colors[PAUL.uid]).not.toBe('#7c3aed');
  });
});

describe('memberColors — managed profiles', () => {
  it('excludes managed profiles from the adult sequence but still colors them', () => {
    const colors = buildMemberColorMap([PAUL, LEO, JEN]);
    // Leo sits between the adults in roster order and must not consume amber.
    expect(colors[PAUL.uid]).toBe('#285742');
    expect(colors[JEN.uid]).toBe('#b87a29');
    expect(colors[LEO.uid]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('uses a stored kid avatarColor as-is', () => {
    const colors = buildMemberColorMap([{ ...LEO, avatarColor: '#9f5618' }]);
    expect(colors[LEO.uid]).toBe('#9f5618');
  });

  it('identifies adults by the absence of isManaged', () => {
    expect(isAdultMember(PAUL)).toBe(true);
    expect(isAdultMember({ uid: 'sam', isManaged: false })).toBe(true);
    expect(isAdultMember(LEO)).toBe(false);
  });
});

describe('memberColors — unknown uids', () => {
  it('still returns a stable color for a uid the roster no longer has', () => {
    const colors = buildMemberColorMap([PAUL]);
    // Attribution outlives membership: a departed member's slice must not vanish.
    const gone = memberColorFor(colors, 'departed-uid');
    expect(gone).toMatch(/^#[0-9a-f]{6}$/);
    expect(memberColorFor(colors, 'departed-uid')).toBe(gone);
  });
});

describe('memberColors — avatar-initial contrast (WCAG AA, both themes)', () => {
  // Every color either palette can ever hand to `MemberAvatar` — the adult
  // sequence (buildMemberColorMap step 2) and the hashed/legacy-mapped
  // palette (buildMemberColorMap steps 1 and 3, via resolveAvatarColor/
  // pickAvatarColor in utils/avatarColor.ts). None of these tokens are
  // theme-split in index.css (no `.dark` override for warm-*/the palette
  // hexes), so one computed ratio covers light AND dark.
  const ALL_MEMBER_FILL_COLORS = [...new Set([...MEMBER_COLOR_SEQUENCE, ...AVATAR_COLORS])];

  it.each(ALL_MEMBER_FILL_COLORS)(
    'the initial rendered on %s clears WCAG AA (4.5:1) against its own fill',
    (fill) => {
      const foreground = avatarTextColor(fill);
      const ratio = contrastRatio(foreground, fill);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_CONTRAST);
    }
  );

  it('the amber pole specifically fails against white — proving the picker actually does something', () => {
    // A regression guard for the picker itself: if this ever starts passing,
    // the "every fill clears AA" test above would pass even with a
    // do-nothing `avatarTextColor` that always returned white, silently
    // losing the darker-foreground behavior it exists to provide.
    const amber = MEMBER_COLOR_SEQUENCE[1];
    expect(contrastRatio(amber, '#ffffff')).toBeLessThan(AA_NORMAL_TEXT_CONTRAST);
    expect(avatarTextColor(amber)).not.toBe('#ffffff');
  });
});
