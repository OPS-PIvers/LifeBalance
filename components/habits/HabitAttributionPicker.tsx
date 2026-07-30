import React from 'react';
import { Popover } from '@/components/ui/Popover';
import MemberAvatar from '@/components/ui/MemberAvatar';
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

const HabitAttributionPicker: React.FC<HabitAttributionPickerProps> = ({
  isOpen,
  onClose,
  habitTitle,
  members,
  placement,
  onCredit,
  onUncredit,
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
      {members.map((member, index) => (
        <button
          key={member.uid}
          type="button"
          role="menuitemcheckbox"
          aria-checked={member.credited}
          // useFocusTrap prefers [data-autofocus] over the first focusable, so
          // the picker opens with the first person selected either way — this
          // just states it.
          {...(index === 0 ? { 'data-autofocus': true } : {})}
          onClick={(e) => {
            // The row underneath is one big tap target; a pick must never also
            // increment the habit.
            e.stopPropagation();
            handleRow(member);
          }}
          className={[
            'flex w-full min-h-11 items-center gap-3 border-t border-brand-200 px-3.5 text-left text-sm font-semibold first:border-t-0 dark:border-brand-600',
            'focus:outline-hidden focus-visible:bg-warm-50 dark:focus-visible:bg-warm-900/20',
            member.credited
              ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-200'
              : 'text-brand-700 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-brand-600/40',
          ].join(' ')}
        >
          <PickerAvatar member={member} />
          <span className="flex-1 truncate">{member.isSelf ? 'Me' : member.displayName}</span>
          {member.credited && (
            <>
              <span className="text-xxs font-semibold uppercase tracking-wider text-accent-500 dark:text-accent-300">
                Tap to undo
              </span>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-600 text-white">
                <CheckGlyph />
              </span>
            </>
          )}
        </button>
      ))}

      {showEveryone && (
        <button
          type="button"
          role="menuitem"
          disabled={uncredited.length === 0}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onCredit(uncredited.map(m => m.uid));
          }}
          className="flex w-full min-h-11 items-center gap-3 border-t border-brand-200 px-3.5 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50 focus:outline-hidden focus-visible:bg-warm-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-600 dark:text-brand-200 dark:hover:bg-brand-600/40 dark:focus-visible:bg-warm-900/20"
        >
          <span className="flex shrink-0 items-center">
            {members.map((member, index) => (
              <span key={member.uid} className={index > 0 ? '-ml-1.5' : undefined}>
                <PickerAvatar member={member} />
              </span>
            ))}
          </span>
          <span className="flex-1 truncate">{everyoneLabel}</span>
        </button>
      )}
    </Popover>
  );
};

export default HabitAttributionPicker;
