import React from 'react';
import { Popover } from '@/components/ui/Popover';
import MemberAvatar from '@/components/ui/MemberAvatar';
import HouseholdAvatar from '@/components/ui/HouseholdAvatar';
import type { AttributionPickerMember, RowMember } from '@/utils/habitRowAttribution';

/**
 * The stateful "who did this?" picker, anchored on a habit row's toggle.
 *
 * Opened by a LONG-PRESS on the toggle, and — because a long-press can never be
 * the only path to an action — by the row's "Who did this?" kebab item. The
 * picker is built on {@link Popover}, so it inherits focus trapping, Escape,
 * click-away and roving arrow keys from the same primitive every other anchored
 * menu in the app uses.
 *
 * It is STATEFUL, not a fire-and-forget action list: a member already credited
 * on the date being edited renders checked with a "tap to undo" hint, and
 * tapping them un-credits
 * (reversing exactly the points that completion earned). That is why the rows
 * are `menuitemcheckbox` — their checked state is the day's attribution.
 *
 * Adults only. Managed kid profiles are excluded until Kid Mode activates; the
 * underlying mutations are member-set based, so widening this later is a data
 * question, not a rewrite.
 *
 * 🏁 THE HOUSEHOLD ROW is a THIRD meaning, not a rename of the compound one:
 *
 *   - `Both of us` / `Everyone` — N separate completions. Each member earns a
 *     full award at their own streak, and the pool is paid the SUM. "We each
 *     went for a run."
 *   - `Household` — ONE completion, at the habit's own flame, paid to the pool
 *     and credited to NOBODY. No `completedBy` entry is written at all. "We
 *     cooked dinner together."
 *
 * It renders on EVERY habit (any habit can be a one-off team effort) and sorts
 * FIRST on a `creditMode: 'household'` habit, LAST on a members one — so the
 * habit's own default is the row your thumb lands on.
 *
 * 🛡️ THE TWO COMPOUND ROWS MUST BE TELLABLE APART BEFORE THE TAP. In a
 * two-adult household — this app's home case — `Both of us` and `Household` sit
 * adjacent with the most OPPOSITE outcomes on the sheet, and a 1px hairline was
 * the only thing between them. A mis-tap swaps a double member award for a
 * zero-personal one, and undoing a mistaken `Both of us` costs TWO taps before
 * `Household` can even be picked. So each compound row carries a one-line
 * descriptor of what it actually does, and a thick group break separates
 * `Household` from the member-ish rows. Both are legibility only: the rows'
 * semantics, roles, ordering and 44px hit targets are unchanged.
 */

// The row view model lives with the other row derivations in
// `utils/habitRowAttribution.ts` (this file is presentational). Re-exported so
// existing importers keep reaching it here.
export type { AttributionPickerMember };

interface HabitAttributionPickerProps {
  isOpen: boolean;
  onClose: () => void;
  habitTitle: string;
  members: readonly AttributionPickerMember[];
  /** Which side of the toggle the sheet opens on (measured by the caller). */
  placement: 'above' | 'below';
  /** Credit one completion to each uid. */
  onCredit: (memberIds: string[]) => void;
  /** Take back one of this member's completions. */
  onUncredit: (memberId: string) => void;
  /**
   * Is the period/day's completion credited to the HOUSEHOLD — i.e. does it
   * carry no member attribution at all? Drives the Household row's checkmark.
   */
  householdCredited: boolean;
  /**
   * Does this habit default to household credit (`creditMode: 'household'`)?
   * Only the row ORDER depends on it — the row itself is always offered.
   */
  householdFirst: boolean;
  /** Credit ONE completion to the household, crediting nobody individually. */
  onCreditHousehold: () => void;
  /** Take that household completion back. */
  onUncreditHousehold: () => void;
}

const CheckGlyph: React.FC = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={3.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const PickerAvatar: React.FC<{ member: RowMember; size?: number }> = ({ member, size = 22 }) => (
  <MemberAvatar name={member.displayName} photoURL={member.photoURL} color={member.color} size={size} />
);

/** The "already credited — tap to undo" affordance shared by every checkbox row. */
const CreditedMark: React.FC = () => (
  <>
    <span className="text-xxs font-semibold uppercase tracking-wider text-accent-500 dark:text-accent-300">
      Tap to undo
    </span>
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-600 text-white">
      <CheckGlyph />
    </span>
  </>
);

/** Shared row anatomy. `active` = this row's credit is currently in force. */
const rowClass = (active: boolean): string =>
  [
    'flex w-full min-h-11 items-center gap-3 border-t border-brand-200 px-3.5 py-2 text-left text-sm font-semibold first:border-t-0 dark:border-brand-600',
    'focus:outline-hidden focus-visible:bg-warm-50 dark:focus-visible:bg-warm-900/20',
    active
      ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-200'
      : 'text-brand-700 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-600/40',
  ].join(' ');

/**
 * A row's label plus, on the two COMPOUND rows, the one-line descriptor that
 * says what picking it actually does. The descriptor is REAL row content, not
 * `aria-hidden` decoration — a screen-reader user faces exactly the same
 * ambiguity a sighted one does, so it belongs in the accessible name.
 */
const RowLabel: React.FC<{ label: string; detail?: string }> = ({ label, detail }) => (
  <span className="flex min-w-0 flex-1 flex-col">
    <span className="truncate">{label}</span>
    {detail && (
      <span className="truncate text-xxs font-medium text-brand-450 dark:text-brand-400">
        {detail}
      </span>
    )}
  </span>
);

/**
 * The break that stops `Household` reading as one more member-ish row.
 *
 * A thick TINT band in the same colour as the row dividers (so it merges with
 * the adjacent row's own `border-t` into one heavier rule) rather than a border
 * — the panel is `overflow-hidden` + rounded, and a full-bleed child's border
 * corners get sliced by that clip.
 */
const GroupBreak: React.FC = () => (
  <div
    role="separator"
    aria-orientation="horizontal"
    className="h-1 bg-brand-200 dark:bg-brand-600"
  />
);

const HabitAttributionPicker: React.FC<HabitAttributionPickerProps> = ({
  isOpen,
  onClose,
  habitTitle,
  members,
  placement,
  onCredit,
  onUncredit,
  householdCredited,
  householdFirst,
  onCreditHousehold,
  onUncreditHousehold,
}) => {
  const uncredited = members.filter(m => !m.credited);
  // "Both of us" completes the state rather than adding a unit to everyone: the
  // checkmarks say who is already credited, so the compound row means "make it
  // so all of us are". With everyone already credited there is nothing left for
  // it to do, and it disables rather than silently double-crediting.
  const everyoneLabel = members.length === 2 ? 'Both of us' : 'Everyone';
  const showEveryone = members.length > 1;

  const handleRow = (member: AttributionPickerMember) => {
    onClose();
    if (member.credited) onUncredit(member.uid);
    else onCredit([member.uid]);
  };

  const handleHouseholdRow = () => {
    onClose();
    if (householdCredited) onUncreditHousehold();
    else onCreditHousehold();
  };

  // The Household row is a `menuitemcheckbox` for the same reason the member
  // rows are: its checked state IS the day's attribution (specifically, the
  // ABSENCE of any), and tapping it checked undoes that completion.
  const householdRow = (
    <button
      key="household"
      type="button"
      role="menuitemcheckbox"
      aria-checked={householdCredited}
      // useFocusTrap prefers [data-autofocus] over the first focusable — the
      // picker opens on whichever row this habit's own credit mode leads with.
      {...(householdFirst ? { 'data-autofocus': true } : {})}
      onClick={(e) => {
        e.stopPropagation();
        handleHouseholdRow();
      }}
      className={rowClass(householdCredited)}
    >
      <HouseholdAvatar size={22} />
      <RowLabel label="Household" detail="One award — nobody credited" />
      {householdCredited && <CreditedMark />}
    </button>
  );

  const memberRows = members.map((member, index) => (
    <button
      key={member.uid}
      type="button"
      role="menuitemcheckbox"
      aria-checked={member.credited}
      // See the Household row: exactly one row carries [data-autofocus], and
      // which one depends on the habit's own credit mode.
      {...(!householdFirst && index === 0 ? { 'data-autofocus': true } : {})}
      onClick={(e) => {
        // The row underneath is one big tap target; a pick must never also
        // increment the habit.
        e.stopPropagation();
        handleRow(member);
      }}
      className={rowClass(member.credited)}
    >
      <PickerAvatar member={member} />
      <RowLabel label={member.isSelf ? 'Me' : member.displayName} />
      {member.credited && <CreditedMark />}
    </button>
  ));

  const everyoneRow = showEveryone ? (
    <button
      key="everyone"
      type="button"
      role="menuitem"
      disabled={uncredited.length === 0}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
        onCredit(uncredited.map(m => m.uid));
      }}
      className="flex w-full min-h-11 items-center gap-3 border-t border-brand-200 px-3.5 py-2 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50 focus:outline-hidden focus-visible:bg-warm-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-600 dark:text-brand-200 dark:hover:bg-brand-600/40 dark:focus-visible:bg-warm-900/20"
    >
      {/* Stacked member avatars — deliberately NOT the household badge. This
          row means N completions and N member awards; the household one means
          a single award credited to nobody. */}
      <span className="flex shrink-0 items-center">
        {members.map((member, index) => (
          <span key={member.uid} className={index > 0 ? '-ml-1.5' : undefined}>
            <PickerAvatar member={member} />
          </span>
        ))}
      </span>
      <RowLabel
        label={everyoneLabel}
        detail={`${members.length} awards — one each`}
      />
    </button>
  ) : null;

  // 🛡️ The break always sits BETWEEN the household row and the member-ish
  // rows, whichever end `householdFirst` puts it at.
  const groupBreak = <GroupBreak key="group-break" />;

  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      role="menu"
      ariaLabel={`Who completed ${habitTitle}?`}
      ariaOrientation="vertical"
      position={placement === 'above' ? 'bottom-full left-2.5 mb-2' : 'top-full left-2.5 mt-2'}
      className="w-56 overflow-hidden"
    >
      {householdFirst
        ? [householdRow, groupBreak, ...memberRows, everyoneRow]
        : [...memberRows, everyoneRow, groupBreak, householdRow]}
    </Popover>
  );
};

export default HabitAttributionPicker;
