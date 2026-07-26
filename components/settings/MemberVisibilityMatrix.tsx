import React, { useMemo } from 'react';
import { Baby } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Switch } from '@/components/ui/Switch';
import Eyebrow from '@/components/ui/Eyebrow';
import {
  getVisibilityMatrixSections,
  isHouseholdModuleEnabled,
  isMatrixRowLocked,
  resolveHiddenKeySet,
  resolveLandingOptions,
  resolveLandingScreenKey,
  toggleHiddenKey,
  type ModuleSettings,
  type VisibilityMatrixRow,
  type VisibilityMatrixSection,
} from '@/utils/moduleVisibility';
import type { HouseholdMember, ModuleKey } from '@/types/schema';

/** Everything an admin write through this matrix can touch on a member doc. */
type MatrixMemberUpdate = Partial<Pick<HouseholdMember, 'hiddenKeys' | 'homeScreen'>>;

interface MemberVisibilityMatrixProps {
  /** Every household member (including managed kid profiles), any order. */
  members: readonly HouseholdMember[];
  settings: ModuleSettings;
  /** Same handler Settings' "App Modules" toggles already use. */
  onToggleModule: (key: ModuleKey, value: boolean) => void;
  /** Same fields an admin or the member themselves would write via `updateMember`. */
  onUpdateMember: (memberId: string, updates: MatrixMemberUpdate) => void;
}

/**
 * Admin per-member visibility matrix (2F.3, plus the Home row/landing-screen
 * fix that closed this file's original gap — see `getVisibilityMatrixSections`
 * in utils/moduleVisibility.ts for why Home needed a hand-authored section).
 *
 * ONE matrix, both layers: each section's header IS the household layer for
 * that group (`Household.moduleVisibility`, editable right here — the exact
 * same switch as Settings' "App Modules"); Lists' three sub-tabs additionally
 * carry their OWN household toggle inline (each is independently gated). Home
 * and Home widgets have no household layer at all, so their section headers
 * carry no switch. Below that, one member-editable switch per leaf — writing
 * the SAME `HouseholdMember.hiddenKeys` field a member edits for themselves in
 * "What I see" (`MyViewSettings`). There is no lock/override flag: last write
 * wins.
 *
 * A row whose household layer is off is LOCKED — every member's switch in it
 * renders visually off and non-interactive, because no member can re-enable
 * what the household has disabled; toggling only the household switch back on
 * reveals each member's actual stored preference again.
 *
 * The Home section additionally carries a per-member landing-screen picker
 * (`LandingScreenRow` below) writing `HouseholdMember.homeScreen` — this is
 * the ONLY place a managed kid's landing screen can ever be set, since kids
 * have no login to use `MyViewSettings` themselves.
 */
export const MemberVisibilityMatrix: React.FC<MemberVisibilityMatrixProps> = ({
  members,
  settings,
  onToggleModule,
  onUpdateMember,
}) => {
  const sections = useMemo(() => getVisibilityMatrixSections(), []);

  // One resolved hidden-key Set per member, computed once per render rather
  // than once per (member, row) pair — ~20 rows × N members would otherwise
  // rebuild the same Set repeatedly.
  const hiddenByMember = useMemo(() => {
    const map = new Map<string, ReadonlySet<string>>();
    for (const member of members) {
      map.set(
        member.uid,
        resolveHiddenKeySet({ hiddenKeys: member.hiddenKeys, dashboardHidden: member.dashboardHidden })
      );
    }
    return map;
  }, [members]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
        Edit anyone&apos;s nav and Home screen — including managed kid profiles, which have no login
        to set their own. Each row&apos;s household switch is the same &quot;App Modules&quot; toggle
        as above: turn it off and no member below can re-enable it.
      </p>

      {sections.map(section => (
        <MatrixSectionTable
          key={section.key}
          section={section}
          members={members}
          settings={settings}
          hiddenByMember={hiddenByMember}
          onToggleModule={onToggleModule}
          onUpdateMember={onUpdateMember}
        />
      ))}
    </div>
  );
};

interface MatrixSectionTableProps {
  section: VisibilityMatrixSection;
  members: readonly HouseholdMember[];
  settings: ModuleSettings;
  hiddenByMember: ReadonlyMap<string, ReadonlySet<string>>;
  onToggleModule: (key: ModuleKey, value: boolean) => void;
  onUpdateMember: (memberId: string, updates: MatrixMemberUpdate) => void;
}

const MatrixSectionTable: React.FC<MatrixSectionTableProps> = ({
  section,
  members,
  settings,
  hiddenByMember,
  onToggleModule,
  onUpdateMember,
}) => {
  const { moduleKey } = section;
  const sectionOn = moduleKey ? isHouseholdModuleEnabled(settings, moduleKey) : true;

  return (
    <div className="surface-section overflow-hidden">
      {/* The household layer's "top row" for this group — the same toggle as
          Settings' "App Modules" (Home widgets have no household concept, so
          this header carries no switch for that section). */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 hairline-divider bg-brand-50/60 dark:bg-brand-700/30">
        <Eyebrow>{section.label}</Eyebrow>
        {moduleKey && (
          <Switch
            aria-label={`Toggle ${section.label} for the household`}
            checked={sectionOn}
            onCheckedChange={(value) => onToggleModule(moduleKey, value)}
          />
        )}
      </div>

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-sticky bg-white dark:bg-brand-800 text-left py-2 pr-3 font-semibold text-brand-500 dark:text-brand-400 whitespace-nowrap">
                View
              </th>
              {members.map(member => (
                <th
                  key={member.uid}
                  className="py-2 px-2 font-semibold text-brand-500 dark:text-brand-400 text-center whitespace-nowrap"
                >
                  <span className="inline-flex items-center gap-1">
                    {member.displayName}
                    {member.isManaged && (
                      <Baby size={12} className="text-brand-400 dark:text-brand-450" aria-label="Managed kid profile" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map(row => (
              <MatrixRowCells
                key={row.key}
                section={section}
                row={row}
                members={members}
                settings={settings}
                hiddenByMember={hiddenByMember}
                onToggleModule={onToggleModule}
                onUpdateMember={onUpdateMember}
              />
            ))}
            {/* The Home section additionally carries the landing-screen picker
                (this fix's other half): where a member lands can only be
                decided once Home (and every other destination) has a row to
                read visibility from, so it lives right under Home's own
                toggle rather than as a separate section. */}
            {section.key === 'home' && (
              <LandingScreenRow
                members={members}
                settings={settings}
                hiddenByMember={hiddenByMember}
                onUpdateMember={onUpdateMember}
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface MatrixRowCellsProps {
  section: VisibilityMatrixSection;
  row: VisibilityMatrixRow;
  members: readonly HouseholdMember[];
  settings: ModuleSettings;
  hiddenByMember: ReadonlyMap<string, ReadonlySet<string>>;
  onToggleModule: (key: ModuleKey, value: boolean) => void;
  onUpdateMember: (memberId: string, updates: MatrixMemberUpdate) => void;
}

const MatrixRowCells: React.FC<MatrixRowCellsProps> = ({
  section,
  row,
  members,
  settings,
  hiddenByMember,
  onToggleModule,
  onUpdateMember,
}) => {
  const locked = isMatrixRowLocked(settings, section, row);
  const ownModule = row.ownModule;

  return (
    <tr className="border-t border-brand-100 dark:border-brand-700">
      <td className="sticky left-0 z-sticky bg-white dark:bg-brand-800 py-2 pr-3 whitespace-nowrap">
        <span className="inline-flex items-center gap-2">
          <span
            className={cn(
              'font-medium',
              locked ? 'text-brand-400 dark:text-brand-450' : 'text-brand-800 dark:text-brand-100'
            )}
          >
            {row.label}
          </span>
          {/* Lists' sub-tabs each carry an independent household field on top
              of the section's own master switch above. */}
          {ownModule && (
            <Switch
              aria-label={`Toggle ${row.label} for the household`}
              checked={isHouseholdModuleEnabled(settings, ownModule)}
              onCheckedChange={(value) => onToggleModule(ownModule, value)}
            />
          )}
        </span>
      </td>
      {members.map(member => {
        const hidden = hiddenByMember.get(member.uid);
        const memberWantsIt = !hidden?.has(row.key);
        return (
          <td key={member.uid} className="text-center py-1 px-2">
            <Switch
              aria-label={`Show ${row.label} for ${member.displayName}`}
              checked={!locked && memberWantsIt}
              disabled={locked}
              onCheckedChange={() => {
                // NOTE: this is the one place an admin can plant `hiddenKeys`
                // on a MANAGED KID's member doc (kids have no login to set
                // their own). firestore.rules' managed-kid branch (used by
                // non-admin parents, e.g. via actAs) allowlists an exhaustive
                // set of writable keys on that doc — every key an admin can
                // write here (hiddenKeys, homeScreen, ...) MUST stay on that
                // allowlist, or a non-admin parent's later write to the same
                // kid (e.g. toggleHabit's points write) gets denied outright.
                // See fix/rules-kid-profile-visibility-keys.
                const nextHidden = toggleHiddenKey(hidden ? [...hidden] : [], row.key);
                onUpdateMember(member.uid, { hiddenKeys: nextHidden });
              }}
            />
          </td>
        );
      })}
    </tr>
  );
};

const EMPTY_HIDDEN_SET: ReadonlySet<string> = new Set<string>();

interface LandingScreenRowProps {
  members: readonly HouseholdMember[];
  settings: ModuleSettings;
  hiddenByMember: ReadonlyMap<string, ReadonlySet<string>>;
  onUpdateMember: (memberId: string, updates: MatrixMemberUpdate) => void;
}

/**
 * The Home section's second row — the other half of this fix. A per-member
 * landing-screen picker, reusing the exact `resolveLandingOptions`/
 * `resolveLandingScreenKey` derivation `MyViewSettings` uses for a member's
 * own choice, so an option only appears here if it's genuinely reachable for
 * THAT member. This is the ONLY place a managed kid's `homeScreen` can ever
 * be set — kids have no login to use `MyViewSettings` themselves.
 *
 * Rendered as a row rather than a `MatrixRowCells` instance because it writes
 * a different field (`homeScreen`, single-valued) with a different control
 * (a select, not a boolean `Switch`) — folding it into the generic
 * toggle-row renderer would mean branching inside that renderer instead of
 * here, once, at the one section that needs it.
 */
const LandingScreenRow: React.FC<LandingScreenRowProps> = ({
  members,
  settings,
  hiddenByMember,
  onUpdateMember,
}) => (
  <tr className="border-t border-brand-100 dark:border-brand-700">
    <td className="sticky left-0 z-sticky bg-white dark:bg-brand-800 py-2 pr-3 whitespace-nowrap">
      <span className="font-medium text-brand-800 dark:text-brand-100">Landing screen</span>
    </td>
    {members.map(member => {
      const hidden = hiddenByMember.get(member.uid) ?? EMPTY_HIDDEN_SET;
      const options = resolveLandingOptions(settings, hidden);
      const firstOption = options[0];
      if (!firstOption) {
        // Nothing reachable at all — Settings is the structurally
        // un-hideable terminal fallback, not a real choice, so there's
        // nothing to offer a picker over.
        return (
          <td key={member.uid} className="text-center py-1 px-2 text-brand-400 dark:text-brand-450">
            Settings
          </td>
        );
      }
      const effective = resolveLandingScreenKey({ homeScreen: member.homeScreen }, settings, hidden);
      const value = effective === 'settings' ? firstOption.key : effective;
      return (
        <td key={member.uid} className="text-center py-1 px-2">
          <select
            aria-label={`Landing screen for ${member.displayName}`}
            value={value}
            onChange={(e) => onUpdateMember(member.uid, { homeScreen: e.target.value })}
            className="w-full max-w-28 rounded-sm border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 px-1.5 py-1 text-xxs font-medium text-brand-700 dark:text-brand-300 outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
          >
            {options.map(o => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </td>
      );
    })}
  </tr>
);

export default MemberVisibilityMatrix;
