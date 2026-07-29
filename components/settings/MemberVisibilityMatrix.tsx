import React, { useMemo } from 'react';
import { Baby } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Switch } from '@/components/ui/Switch';
import Select from '@/components/ui/Select';
import Eyebrow from '@/components/ui/Eyebrow';
import SectionHeading from '@/components/ui/SectionHeading';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
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
   * The members to render an editor for. An admin passes every household
   * member (including managed kid profiles); a non-admin passes just
   * themselves, so they still have a per-member editor. This filters WHICH
   * members get a section — it never touches hidden-key derivation, and it
   * never gates the household switches (those are any-member-editable).
   */
  members: readonly HouseholdMember[];
  settings: ModuleSettings;
  /** Settings' `handleModuleToggle` — the household layer, editable by any member. */
  onToggleModule: (key: ModuleKey, value: boolean) => void;
  /** Same fields an admin or the member themselves would write via `updateMember`. */
  onUpdateMember: (memberId: string, updates: MatrixMemberUpdate) => void;
}

/**
 * The per-member visibility editor (2F.3, plus the Home row/landing-screen fix
 * — see `getVisibilityMatrixSections` in utils/moduleVisibility.ts for why Home
 * needed a hand-authored section).
 *
 * Since Settings collapsed "App Modules" / "What I see" / "Member visibility"
 * onto this one surface, it is the ONLY visibility editor in Settings — an
 * admin gets a section per member, a non-admin gets just their own (the caller
 * decides via `members`). Widget ORDER is the one thing it doesn't cover; that
 * lives in `HomeWidgetOrder`.
 *
 * ── Layout (CRIT-03) ──────────────────────────────────────────────────────
 * This used to be a literal matrix: rows = views, one COLUMN per member. At
 * 375px — the only width this app supports — four columns squeezed the
 * landing-screen `<select>`s to 55-61px, so "Home" rendered as "Ho…" and a
 * fourth member broke the layout outright. Since this is also the ONLY way to
 * configure a login-less managed kid, the single control for setting up a
 * child's app had an unreadable current value.
 *
 * So it is now stacked, not tabulated: the household layer is one leading
 * section of full-width switch rows, then ONE `Section` per member whose rows
 * are also full-width. Every control gets the full content width, and adding a
 * fifth member costs vertical space instead of breaking anything.
 *
 * ── Both layers survive the reflow ────────────────────────────────────────
 * "What the household uses" (`Household.moduleVisibility`) is what the deleted
 * "App Modules" section used to own, and it stays editable by ANY member — it
 * was never admin-only. Lists' three sub-tabs each carry their OWN household
 * toggle there, nested under Lists, because each is independently gated;
 * Habits'/Money's leaves all share their page's single module, and Home and
 * Home widgets have no household concept at all.
 *
 * Below it, one member-editable switch per leaf — writing the SAME
 * `HouseholdMember.hiddenKeys` field the onboarding wizard's "What I see" step
 * (`MyViewSettings`) writes. There is no lock/override flag: last write wins.
 *
 * A row whose household layer is off is LOCKED — the member's switch renders
 * visually off, non-interactive and captioned "Off for the household", because
 * no member can re-enable what the household has disabled; turning the
 * household switch back on reveals their actual stored preference again.
 * (The table conveyed that with a greyed row under a section header carrying
 * the household switch; with the two layers now separated vertically, the
 * caption is what carries the explanation to where the switch is.)
 *
 * Each member's Home section additionally carries a landing-screen picker
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
  const householdSwitches = useMemo(() => deriveHouseholdSwitches(sections), [sections]);

  return (
    <div className="space-y-8">
      <HouseholdModulesSection
        switches={householdSwitches}
        settings={settings}
        onToggleModule={onToggleModule}
      />

      {members.map(member => (
        <MemberVisibilitySection
          key={member.uid}
          member={member}
          sections={sections}
          settings={settings}
          onUpdateMember={onUpdateMember}
        />
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Household layer
// ---------------------------------------------------------------------------

/** One household-level module switch, flattened out of the matrix sections. */
interface HouseholdSwitchDef {
  module: ModuleKey;
  label: string;
  /** True for Lists' sub-tabs, which hang off their page's own switch. */
  nested: boolean;
}

/**
 * Flatten `getVisibilityMatrixSections()` into the household switches it
 * implies — a section's own `moduleKey` (Habits/Money/Lists), plus any row
 * carrying its OWN module (Lists' todos/meals/shopping). Derived rather than
 * hand-listed so this can't drift from `NAV_PAGES`; sections with no household
 * concept (Home, Home widgets) contribute nothing, which is why neither
 * appears here.
 */
function deriveHouseholdSwitches(
  sections: readonly VisibilityMatrixSection[]
): HouseholdSwitchDef[] {
  const out: HouseholdSwitchDef[] = [];
  for (const section of sections) {
    if (section.moduleKey) {
      out.push({ module: section.moduleKey, label: section.label, nested: false });
    }
    for (const row of section.rows) {
      if (row.ownModule) {
        out.push({ module: row.ownModule, label: row.label, nested: true });
      }
    }
  }
  return out;
}

interface HouseholdModulesSectionProps {
  switches: readonly HouseholdSwitchDef[];
  settings: ModuleSettings;
  onToggleModule: (key: ModuleKey, value: boolean) => void;
}

const HouseholdModulesSection: React.FC<HouseholdModulesSectionProps> = ({
  switches,
  settings,
  onToggleModule,
}) => (
  <Section>
    <SectionHeading
      as="h3"
      className="px-1 mb-1.5"
      description="Shared by everyone in the household."
    >
      What the household uses
    </SectionHeading>
    <SurfaceList>
      {switches.map(item => (
        <Row key={item.module} className="py-1">
          <span
            className={cn(
              'min-w-0 flex-1 text-sm',
              item.nested
                ? 'pl-4 text-brand-600 dark:text-brand-300'
                : 'font-medium text-brand-800 dark:text-brand-100'
            )}
          >
            {item.label}
          </span>
          <Switch
            aria-label={`Toggle ${item.label} for the household`}
            checked={isHouseholdModuleEnabled(settings, item.module)}
            onCheckedChange={(value) => onToggleModule(item.module, value)}
          />
        </Row>
      ))}
    </SurfaceList>
  </Section>
);

// ---------------------------------------------------------------------------
// Member layer
// ---------------------------------------------------------------------------

interface MemberVisibilitySectionProps {
  member: HouseholdMember;
  sections: readonly VisibilityMatrixSection[];
  settings: ModuleSettings;
  onUpdateMember: (memberId: string, updates: MatrixMemberUpdate) => void;
}

const MemberVisibilitySection: React.FC<MemberVisibilitySectionProps> = ({
  member,
  sections,
  settings,
  onUpdateMember,
}) => {
  // Resolved once per member per render, rather than once per (member, row)
  // pair — ~28 rows would otherwise rebuild the same Set repeatedly.
  const hidden = useMemo(
    () => resolveHiddenKeySet({ hiddenKeys: member.hiddenKeys, dashboardHidden: member.dashboardHidden }),
    [member.hiddenKeys, member.dashboardHidden]
  );

  return (
    <Section>
      <SectionHeading
        as="h3"
        className="px-1 mb-1.5"
        description={
          member.isManaged
            ? `No login of their own — set up ${member.displayName}'s app here.`
            : `What ${member.displayName} sees, within whatever the household allows.`
        }
      >
        <span className="inline-flex items-center gap-1.5">
          {member.displayName}
          {member.isManaged && (
            <Baby size={14} className="text-brand-400 dark:text-brand-450" aria-label="Managed kid profile" />
          )}
        </span>
      </SectionHeading>

      <div className="space-y-3">
        {sections.map(section => (
          <div key={section.key}>
            {/* A CONTENT GROUPING, not a control label — so the editorial serif
                `SectionHeading` in sentence case, per DESIGN.md §3's decision
                test (this was an uppercase `Eyebrow` while these labels doubled
                as the household switches' own row). */}
            <SectionHeading as="h4" className="px-1 mb-1.5">
              {section.label}
            </SectionHeading>
            <SurfaceList>
              {section.rows.map(row => (
                <MemberLeafRow
                  key={row.key}
                  section={section}
                  row={row}
                  member={member}
                  hidden={hidden}
                  settings={settings}
                  onUpdateMember={onUpdateMember}
                />
              ))}
              {/* The Home section additionally carries the landing-screen
                  picker: where a member lands can only be decided once Home
                  (and every other destination) has a row to read visibility
                  from, so it sits right under Home's own switch. */}
              {section.key === 'home' && (
                <LandingScreenRow
                  member={member}
                  settings={settings}
                  hidden={hidden}
                  onUpdateMember={onUpdateMember}
                />
              )}
            </SurfaceList>
          </div>
        ))}
      </div>
    </Section>
  );
};

interface MemberLeafRowProps {
  section: VisibilityMatrixSection;
  row: VisibilityMatrixRow;
  member: HouseholdMember;
  hidden: ReadonlySet<string>;
  settings: ModuleSettings;
  onUpdateMember: (memberId: string, updates: MatrixMemberUpdate) => void;
}

const MemberLeafRow: React.FC<MemberLeafRowProps> = ({
  section,
  row,
  member,
  hidden,
  settings,
  onUpdateMember,
}) => {
  const locked = isMatrixRowLocked(settings, section, row);
  const memberWantsIt = !hidden.has(row.key);

  return (
    <Row className="py-1">
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-sm font-medium',
            locked ? 'text-brand-400 dark:text-brand-450' : 'text-brand-800 dark:text-brand-100'
          )}
        >
          {row.label}
        </span>
        {locked && (
          <span className="block text-xs text-brand-400 dark:text-brand-450">
            Off for the household
          </span>
        )}
      </span>
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
          const nextHidden = toggleHiddenKey([...hidden], row.key);
          onUpdateMember(member.uid, { hiddenKeys: nextHidden });
        }}
      />
    </Row>
  );
};

interface LandingScreenRowProps {
  member: HouseholdMember;
  settings: ModuleSettings;
  hidden: ReadonlySet<string>;
  onUpdateMember: (memberId: string, updates: MatrixMemberUpdate) => void;
}

/**
 * The Home section's second row: a per-member landing-screen picker, reusing
 * the exact `resolveLandingOptions`/`resolveLandingScreenKey` derivation
 * `MyViewSettings` uses for a member's own choice, so an option only appears
 * here if it's genuinely reachable for THAT member. This is the ONLY place a
 * managed kid's `homeScreen` can ever be set — kids have no login to use
 * `MyViewSettings` themselves.
 *
 * Rendered separately from `MemberLeafRow` because it writes a different field
 * (`homeScreen`, single-valued) with a different control (a select, not a
 * boolean `Switch`) — folding it into the generic toggle-row renderer would
 * mean branching inside that renderer instead of here, once, at the one
 * section that needs it.
 */
const LandingScreenRow: React.FC<LandingScreenRowProps> = ({
  member,
  settings,
  hidden,
  onUpdateMember,
}) => {
  const options = resolveLandingOptions(settings, hidden);
  const firstOption = options[0];

  if (!firstOption) {
    // Nothing reachable at all — Settings is the structurally un-hideable
    // terminal fallback, not a real choice, so there's nothing to offer a
    // picker over.
    return (
      <Row className="flex-col items-stretch gap-1 py-2">
        <Eyebrow as="p">Landing screen</Eyebrow>
        <span className="text-sm text-brand-500 dark:text-brand-400">Settings</span>
      </Row>
    );
  }

  const effective = resolveLandingScreenKey({ homeScreen: member.homeScreen }, settings, hidden);
  const value = effective === 'settings' ? firstOption.key : effective;

  return (
    <Row className="py-2">
      {/* The `Select` primitive (DESIGN.md's picker rule, r6) rather than a
          hand-rolled <select>, now at the FULL content width — the old
          matrix cell clamped it to `max-w-28`, which at 375px with three
          members rendered a 55px control showing "Ho…" instead of "Home".
          `min-h-11` keeps the >=44px touch target the Switch rows carry, and
          the brand-50 fill is DESIGN.md §6's input recipe (FIELD_BASE's
          `bg-white` would otherwise vanish into the white surface row). */}
      <Select
        id={`landing-screen-${member.uid}`}
        label="Landing screen"
        aria-label={`Landing screen for ${member.displayName}`}
        value={value}
        onChange={(e) => onUpdateMember(member.uid, { homeScreen: e.target.value })}
        className="min-h-11 bg-brand-50 dark:bg-brand-700/50"
      >
        {options.map(o => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </Select>
    </Row>
  );
};

export default MemberVisibilityMatrix;
