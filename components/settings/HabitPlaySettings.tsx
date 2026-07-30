import React from 'react';
import { Check } from 'lucide-react';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import SectionHeading from '@/components/ui/SectionHeading';
import { cn } from '@/utils/cn';
import type { CeremonyTone, FreezeMode, Household } from '@/types/schema';
import {
  CEREMONY_TONE_CHOICES,
  FREEZE_MODE_CHOICES,
  resolveCeremonyTone,
  resolveFreezeMode,
  type SettingChoice,
} from '@/utils/freezeSettings';

/**
 * Per-member habit points (stage 6) — Settings → Household → "Habits".
 *
 * Two household-wide, admin-owned choices that the rest of the feature reads:
 *
 *  - **Streak freezes** (`Household.freezeMode`) — live now: it dispatches
 *    `autoApplyFreezes` (see contexts/household/mutations/gamificationMutations).
 *  - **Weekly wrap-up** (`Household.ceremonyTone`) — stored now, consumed by
 *    stage 5's ceremony. Shipping the control first means the household can pin
 *    a tone before the surface that honours it exists, rather than getting a
 *    week of the wrong one.
 *
 * Both fields are ABSENT until an admin picks something, and both resolvers map
 * absent onto today's behaviour, so this whole surface is inert on every
 * existing household until it is touched.
 *
 * Why radio ROWS rather than a `Select` (DESIGN.md §6's pick-one rule): each
 * option needs a one-line explanation to be choosable at all — "A bank each"
 * versus "Shared bank, freeze us both" is meaningless without it, and an
 * `<option>` cannot carry a second line. The checked-row pattern here is the
 * one already used by `TabSubViewMenu` (role=radio + aria-checked + a trailing
 * check), kept quiet: no tint, no chrome, the check is the only state marker.
 */

interface ChoiceGroupProps<T extends string> {
  /** Accessible name for the radiogroup (the visible heading's text). */
  label: string;
  choices: readonly SettingChoice<T>[];
  value: T;
  canEdit: boolean;
  onChange: (value: T) => void;
}

const ChoiceGroup = <T extends string>({
  label,
  choices,
  value,
  canEdit,
  onChange,
}: ChoiceGroupProps<T>) => {
  // Read-only view for a non-admin: the household's answer, stated once. A
  // disabled radio list would be three rows of controls nobody can use — this
  // mirrors how the admin-only ActivityLogCard simply isn't offered, while
  // still telling everyone else what the household settled on.
  if (!canEdit) {
    const current = choices.find(c => c.value === value);
    return (
      <SurfaceList>
        <Row className="flex-col items-stretch gap-0.5">
          <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">
            {current?.label ?? value}
          </p>
          <p className="text-xs text-brand-500 dark:text-brand-400">
            {current?.description}
          </p>
        </Row>
      </SurfaceList>
    );
  }

  return (
    <SurfaceList role="radiogroup" aria-label={label}>
      {choices.map(choice => {
        const selected = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => { if (!selected) onChange(choice.value); }}
            className={cn(
              'flex w-full items-start gap-3 px-4 py-3.5 text-left hairline-divider',
              'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
              'hover:bg-brand-50 dark:hover:bg-brand-700/40',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset',
            )}
          >
            <span className="flex-1 min-w-0">
              <span
                className={cn(
                  'block font-semibold text-sm tracking-tight',
                  selected
                    ? 'text-accent-700 dark:text-accent-300'
                    : 'text-brand-900 dark:text-brand-100',
                )}
              >
                {choice.label}
              </span>
              <span className="block text-xs text-brand-500 dark:text-brand-400">
                {choice.description}
              </span>
            </span>
            {selected && (
              <Check
                size={18}
                className="shrink-0 mt-0.5 text-accent-600 dark:text-accent-300"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </SurfaceList>
  );
};

export interface HabitPlaySettingsProps {
  settings: Pick<Household, 'freezeMode' | 'ceremonyTone'> | null;
  /** Only an admin may change these — they are household-wide. */
  isAdmin: boolean;
  onChangeFreezeMode: (mode: FreezeMode) => void;
  onChangeCeremonyTone: (tone: CeremonyTone) => void;
}

const HabitPlaySettings: React.FC<HabitPlaySettingsProps> = ({
  settings,
  isAdmin,
  onChangeFreezeMode,
  onChangeCeremonyTone,
}) => (
  <Section title="Habits">
    <div className="space-y-6">
      <div className="space-y-2">
        <SectionHeading
          as="h3"
          className="px-1"
          description={
            isAdmin
              ? 'A freeze absorbs one missed day so a streak survives it — without earning any points.'
              : 'How this household spends its streak freezes. Only an admin can change it.'
          }
        >
          Streak freezes
        </SectionHeading>
        <ChoiceGroup
          label="Streak freezes"
          choices={FREEZE_MODE_CHOICES}
          value={resolveFreezeMode(settings)}
          canEdit={isAdmin}
          onChange={onChangeFreezeMode}
        />
      </div>

      <div className="space-y-2">
        <SectionHeading
          as="h3"
          className="px-1"
          description={
            isAdmin
              ? 'How the weekly wrap-up opens once the week is closed.'
              : 'How the weekly wrap-up opens. Only an admin can change it.'
          }
        >
          Weekly wrap-up
        </SectionHeading>
        <ChoiceGroup
          label="Weekly wrap-up"
          choices={CEREMONY_TONE_CHOICES}
          value={resolveCeremonyTone(settings)}
          canEdit={isAdmin}
          onChange={onChangeCeremonyTone}
        />
      </div>
    </div>
  </Section>
);

export default HabitPlaySettings;
