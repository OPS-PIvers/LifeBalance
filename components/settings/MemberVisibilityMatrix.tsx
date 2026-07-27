import React, { useMemo } from 'react';
import { Baby } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Switch } from '@/components/ui/Switch';
import Select from '@/components/ui/Select';
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
  /**
   * The member columns to render. An admin passes every household member
   * (including managed kid profiles); a non-admin passes just themselves, so
   * they still have a per-member editor. Column filtering is purely which
   * columns render — it never touches hidden-key derivation.
   */
  members: readonly HouseholdMember[];
  settings: ModuleSettings;
  /** Settings' `handleModuleToggle` — the household layer, editable by any member. */
  onToggleModule: (key: ModuleKey, value: boolean) => void;
  /** Same fields an admin or the member themselves would write via `updateMember`. */
  onUpdateMember: (memberId: string, updates: MatrixMemberUpdate) => void;
}

/**
 * The per-member visibility matrix (2F.3, plus the Home row/landing-screen fix
 * that closed this file's original gap — see `getVisibilityMatrixSections` in
 * utils/moduleVisibility.ts for why Home needed a hand-authored section).
 *
 * Since Settings collapsed "App Modules" / "What I see" / "Member visibility"
 * onto this one table, it is the ONLY visibility editor in Settings — an admin
 * gets every member's column, a non-admin gets just their own (the caller
 * decides via `members`). Widget ORDER is the one thing it doesn't cover; that
 * lives in `HomeWidgetOrder`.
 *
 * ONE matrix, both layers: each section's header IS the household layer for
 * that group (`Household.moduleVisibility`, editable right here by any member
 * — it was never admin-only); Lists' three sub-tabs additionally carry their
 * OWN household toggle inline (each is independently gated). Home and Home
 * widgets have no household layer at all, so their section headers carry no
 * switch. Below that, one member-editable switch per leaf — writing the SAME
 * `HouseholdMember.hiddenKeys` field the onboarding wizard's "What I see" step
 * (`MyViewSettings`) writes. There is no lock/override flag: last write wins.
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

  const hasManagedMember = useMemo(() => members.some(m => m.isManaged), [members]);

  return (
    <div className="space-y-4">
      {/* The legend. Two layers meet in this one table, and without saying so
          the switches look duplicated — including the asymmetry the owner
          asked about: only Lists' tabs have a household field of their own,
          every other sub-view is a personal choice. */}
      <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
        Two layers: a switch turns a whole section off for everyone — To-Dos, Meals, and Shopping
        each get their own, since they&apos;re independently toggleable. Each column is that
        person&apos;s own choice within whatever the household allows.
        {hasManagedMember && ' Managed kid profiles get a column too — with no login of their own, this is the only place to set theirs.'}
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
      {/* The household layer's "top row" for this group — writing
          `Household.moduleVisibility`, which is what the deleted "App Modules"
          section used to own (Home and Home widgets have no household concept,
          so those headers carry no switch). */}
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

      {/* The scroller carries NO horizontal padding: a `sticky left-0` cell
          pins to the scrollport's PADDING edge, so a `-mx-4 px-4` juggle here
          left the row labels flush against the surface edge while the section
          header above kept its px-4. Padding inside the sticky cell travels
          with it instead, so the labels line up with the header's Eyebrow —
          and `[&_tr>*:last-child]:pr-4` gives the far member column the
          matching gutter on the right. */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse [&_tr>*:last-child]:pr-4">
          <thead>
            <tr>
              <th className="sticky left-0 z-sticky bg-white dark:bg-brand-800 text-left py-2 pl-4 pr-3 font-semibold text-brand-500 dark:text-brand-400 whitespace-nowrap">
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
      <td className="sticky left-0 z-sticky bg-white dark:bg-brand-800 py-2 pl-4 pr-3 whitespace-nowrap">
        {/* A flex row spanning the FULL cell width, label first and (when
            present) the switch pinned to the trailing edge via
            justify-between — same pattern as the section header row above.
            Because every row in this table shares one sticky column, the
            column's width is set by its widest row (in the Lists section,
            "Shopping" + its switch); a shorter label like "To-Dos" still
            stretches this wrapper to that same width, so its switch lands
            at the identical trailing x position instead of drifting with
            the label's own width. Rows with no `ownModule` just render the
            label with nothing to push right. */}
        <span className="flex w-full items-center justify-between gap-3">
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
    <td className="sticky left-0 z-sticky bg-white dark:bg-brand-800 py-2 pl-4 pr-3 whitespace-nowrap">
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
          {/* The Select primitive (DESIGN.md's picker rule, r6) rather than a
              hand-rolled <select> — a min-h-11 keeps the 44px touch target
              this dense matrix's Switch cells already carry, while the
              compact py/px/text-xxs override keeps it from blowing out the
              row height or the table's own overflow-x-auto scroller. */}
          <Select
            aria-label={`Landing screen for ${member.displayName}`}
            value={value}
            onChange={(e) => onUpdateMember(member.uid, { homeScreen: e.target.value })}
            className="min-h-11 w-full max-w-28 py-1.5 pl-2 pr-8 text-xxs font-medium"
          >
            {options.map(o => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        </td>
      );
    })}
  </tr>
);

export default MemberVisibilityMatrix;
