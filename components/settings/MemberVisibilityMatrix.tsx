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
  toggleHiddenKey,
  type ModuleSettings,
  type VisibilityMatrixRow,
  type VisibilityMatrixSection,
} from '@/utils/moduleVisibility';
import type { HouseholdMember, ModuleKey } from '@/types/schema';

interface MemberVisibilityMatrixProps {
  /** Every household member (including managed kid profiles), any order. */
  members: readonly HouseholdMember[];
  settings: ModuleSettings;
  /** Same handler Settings' "App Modules" toggles already use. */
  onToggleModule: (key: ModuleKey, value: boolean) => void;
  /** Same field an admin or the member themselves would write via `updateMember`. */
  onUpdateMember: (memberId: string, updates: Pick<HouseholdMember, 'hiddenKeys'>) => void;
}

/**
 * Admin per-member visibility matrix (2F.3).
 *
 * ONE matrix, both layers: each section's header IS the household layer for
 * that group (`Household.moduleVisibility`, editable right here — the exact
 * same switch as Settings' "App Modules"); Lists' three sub-tabs additionally
 * carry their OWN household toggle inline (each is independently gated).
 * Below that, one member-editable switch per leaf — writing the SAME
 * `HouseholdMember.hiddenKeys` field a member edits for themselves in "What I
 * see" (`MyViewSettings`). There is no lock/override flag: last write wins.
 *
 * A row whose household layer is off is LOCKED — every member's switch in it
 * renders visually off and non-interactive, because no member can re-enable
 * what the household has disabled; toggling only the household switch back on
 * reveals each member's actual stored preference again.
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
  onUpdateMember: (memberId: string, updates: Pick<HouseholdMember, 'hiddenKeys'>) => void;
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
  onUpdateMember: (memberId: string, updates: Pick<HouseholdMember, 'hiddenKeys'>) => void;
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

export default MemberVisibilityMatrix;
