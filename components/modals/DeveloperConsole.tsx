import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Switch } from '@/components/ui/Switch';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { db } from '@/firebase.config';
import { collection, query, getDocs, getDoc, addDoc, updateDoc, doc, deleteDoc, orderBy, limit, arrayUnion, serverTimestamp, runTransaction } from 'firebase/firestore';
import { computeHabitHistoryRepair } from '@/utils/migrations/habitHistoryRepair';
import {
  computePointsDriftReport,
  planPointsDriftApply,
  type DriftRow,
  type PointsDriftReport,
  type PointsDriftWrite,
} from '@/utils/pointsDriftRepair';
import { buildActivityLogEntry } from '@/utils/activityLog';
import { habitConverter, householdMemberConverter, activityLogConverter } from '@/utils/firestoreConverters';
import { useAuth } from '@/contexts/AuthContext';
import {
  readAppConfigFlags,
  setAppFlag,
  getBillingEnabled,
  AI_ENABLED_FLAG_KEY,
  POWER_TOOLS_FLAG_KEY,
  ALLOWLIST_TARGETABLE_FLAGS,
  getFlagTargetHouseholds,
  addFlagTargetHousehold,
  removeFlagTargetHousehold,
} from '@/services/appConfig';
import { getLimits, LEGACY_AI_DAILY_QUOTA } from '@/utils/entitlements';
import { BetaTester, FeedbackReport, Household, Habit, HabitSubmission } from '@/types/schema';
import { Loader2, Plus, Trash2, Copy, X, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

interface DeveloperConsoleProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'testers' | 'ai_meter' | 'reports' | 'flags';

/**
 * The six operator flags on `app_config/global`. `danger` flags an action with a
 * broad blast radius (opening signup / launching paid tiers) so the UI can warn harder.
 * Descriptions state what each gates AND the fail-safe direction.
 */
interface FeatureFlagDef {
  key: string;
  label: string;
  description: string;
  danger: boolean;
}

const FEATURE_FLAGS: readonly FeatureFlagDef[] = [
  {
    key: 'kidModeEnabled',
    label: 'Kid Mode',
    description:
      'Gates the kid profile switcher and all kid views (Plan 080). Fails CLOSED: off unless explicitly enabled, so households behave normally while dormant.',
    danger: false,
  },
  {
    key: 'billingEnabled',
    label: 'Billing / Freemium',
    description:
      'Launches the paid tiers: upgrade UI plus plan-aware AI caps (Plan 050). Fails CLOSED: off keeps the legacy flat AI cap for everyone and shows no upgrade UI. Turning this ON goes live for ALL users.',
    danger: true,
  },
  {
    key: 'openSignup',
    label: 'Open Signup',
    description:
      'Opens signup to ANY Google user, bypassing the beta_testers allowlist. Fails CLOSED: off keeps Private Alpha. Turning this ON lets anyone create an account — also add the origin to Firebase Auth authorized domains.',
    danger: true,
  },
  {
    key: AI_ENABLED_FLAG_KEY,
    label: 'AI Enabled',
    description:
      'Master AI kill-switch for all Gemini features. Fails OPEN: AI stays ON unless this is explicitly turned off. Turn OFF to halt all AI usage instantly across every household.',
    danger: false,
  },
  {
    key: 'plaidEnabled',
    label: 'Plaid Bank Link',
    description:
      "Gates the \"Connect a bank (Plaid)\" entry and all Plaid linking UI. Fails CLOSED: off unless explicitly enabled, so no bank-link UI shows while dormant. Requires the PLAID_* secrets in Secret Manager and the deployed plaidcreatelinktoken / plaidexchangepublictoken functions (see docs/PLAID_SETUP_RUNBOOK.md) BEFORE turning ON.",
    danger: false,
  },
  {
    key: POWER_TOOLS_FLAG_KEY,
    label: 'Power Tools',
    description:
      'Gates power-user/AI-heavy surfaces: HabitCoach, Smart Adjust/Reorder, grocery "Optimize with AI", Budget History, Saved View chips, and Yearly Goal UI (Plan 17). Fails OPEN: these stay ON unless this is explicitly turned off. Turn OFF to simplify the app / reduce AI cost surface for all households.',
    danger: false,
  },
];

/** Tab strip, rendered from data so the nav stays a single horizontally-scrollable row. */
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'testers', label: 'Beta Testers' },
  { id: 'ai_meter', label: 'AI Usage Meter' },
  { id: 'reports', label: 'Feedback Reports' },
  { id: 'flags', label: 'Feature Flags' },
];

const DeveloperConsole: React.FC<DeveloperConsoleProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('testers');
  const [testers, setTesters] = useState<(BetaTester & { id: string })[]>([]);
  const [reports, setReports] = useState<(FeedbackReport & { id: string })[]>([]);
  const [households, setHouseholds] = useState<(Household & { id: string })[]>([]);
  // Whether billing is live — decides if the AI meter's per-household cap is
  // plan-aware (billing on) or the flat legacy cap for everyone (billing off,
  // the current state). Mirrors geminiService.checkAndIncrementAiUsage exactly.
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  // Tester Form
  const [newTesterEmail, setNewTesterEmail] = useState('');

  // Confirm delete tester dialog
  const [deleteTesterConfirmId, setDeleteTesterConfirmId] = useState<string | null>(null);

  // Feature flags: current effective values + the flip awaiting confirmation.
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [pendingFlag, setPendingFlag] = useState<FeatureFlagDef | null>(null);
  const [flagSaving, setFlagSaving] = useState(false);
  // Ops-only Plaid status (count of connected bank items; never reads a token).
  const [plaidItemCount, setPlaidItemCount] = useState<number | null>(null);
  // Per-household allowlist targeting (Plan F-PLAT-09): current household ids per
  // targetable flag, the add-input draft per flag, and which flag's expander is open.
  const [targetHouseholds, setTargetHouseholds] = useState<Record<string, string[]>>({});
  const [targetInputs, setTargetInputs] = useState<Record<string, string>>({});
  const [expandedTargetFlag, setExpandedTargetFlag] = useState<string | null>(null);
  const [targetSaving, setTargetSaving] = useState(false);
  // Habit-history repair (2026-07-15 incident): additive rebuild of
  // completedDates from surviving submission docs. Confirm-gated; idempotent.
  const [repairConfirmOpen, setRepairConfirmOpen] = useState(false);
  const [repairRunning, setRepairRunning] = useState(false);
  const [repairLog, setRepairLog] = useState<string[]>([]);

  // Points-drift repair (this file's Phase 1/Phase 2 tool — see
  // utils/pointsDriftRepair.ts). Phase 1 ("Scan") is READ-ONLY and always
  // safe to run; Phase 2 ("Apply") is gated behind a literal type-to-confirm
  // phrase, never a single click adjacent to the report.
  const { user } = useAuth();
  const [driftReports, setDriftReports] = useState<PointsDriftReport[]>([]);
  const [driftScanned, setDriftScanned] = useState(false);
  const [driftScanning, setDriftScanning] = useState(false);
  const [driftConfirmText, setDriftConfirmText] = useState('');
  const [driftApplying, setDriftApplying] = useState(false);
  const [driftApplyLog, setDriftApplyLog] = useState<string[]>([]);
  // Household ids that threw during Scan (dropped from the report, not just
  // silently absent) and how many household docs the scan actually fetched —
  // both surfaced so an operator can't mistake "clean-looking report" for
  // "every household was actually analyzed". See DRIFT_SCAN_HOUSEHOLD_CAP.
  const [driftFailedHouseholdIds, setDriftFailedHouseholdIds] = useState<string[]>([]);
  const [driftHouseholdsScanned, setDriftHouseholdsScanned] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'testers') {
        const q = query(collection(db, 'beta_testers'), orderBy('addedAt', 'desc'));
        const snap = await getDocs(q);
        setTesters(snap.docs.map(d => ({ ...d.data(), id: d.id } as BetaTester & { id: string })));
      } else if (activeTab === 'reports') {
        const q = query(collection(db, 'feedback'), orderBy('timestamp', 'desc'), limit(50));
        const snap = await getDocs(q);
        setReports(snap.docs.map(d => ({ ...d.data(), id: d.id } as FeedbackReport & { id: string })));
      } else if (activeTab === 'ai_meter') {
        const q = query(collection(db, 'households'), limit(50)); // Limit to 50 for safety
        // Independent reads — run in parallel so the meter tab loads faster.
        const [snap, billingEnabledVal] = await Promise.all([getDocs(q), getBillingEnabled()]);
        setHouseholds(snap.docs.map(d => ({ ...d.data(), id: d.id } as Household & { id: string })));
        // So the meter denominator matches the actually-enforced cap (see below).
        setBillingEnabled(billingEnabledVal);
      } else if (activeTab === 'flags') {
        setFlags(await readAppConfigFlags());
        // Server-maintained count (incremented by plaidexchangepublictoken); a
        // plain number, never a token. Best-effort — a read error just hides it.
        try {
          const cfgSnap = await getDoc(doc(db, 'app_config', 'global'));
          const count = cfgSnap.exists() ? cfgSnap.data().plaidItemCount : 0;
          setPlaidItemCount(typeof count === 'number' ? count : 0);
        } catch {
          setPlaidItemCount(null);
        }
        // Per-household allowlists for targetable flags (Plan F-PLAT-09).
        const targetableKeys = Object.keys(ALLOWLIST_TARGETABLE_FLAGS);
        const lists = await Promise.all(targetableKeys.map(key => getFlagTargetHouseholds(key)));
        setTargetHouseholds(
          targetableKeys.reduce<Record<string, string[]>>((acc, key, i) => {
            acc[key] = lists[i] ?? [];
            return acc;
          }, {})
        );
      }
    } catch (error) {
      console.error("Failed to load data", error);
      toast.error("Failed to load data (Check console)");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (isOpen) {
      // loadData() is an async Firestore fetch that synchronously flips the
      // loading flag before awaiting. This is legitimate external-system
      // synchronization (re-fetched on open and on tab change), not derivable
      // state — deferring the loading flag would cause a content flash before
      // the spinner. loadData is also invoked from event handlers, so it must
      // remain a callable that owns its loading transitions.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional load-on-open; see comment above
      loadData();
    }
  }, [isOpen, activeTab, loadData]);

  const handleAddTester = async () => {
    const email = newTesterEmail.trim();
    if (!email) return;
    try {
      const newTester: Omit<BetaTester, 'id'> = {
        email,
        addedAt: new Date().toISOString(),
        status: 'active',
        usageLimit: 20
      };
      await addDoc(collection(db, 'beta_testers'), newTester);
      toast.success("Tester added");
      setNewTesterEmail('');
      loadData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to add tester");
    }
  };

  const toggleTesterStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'revoked' : 'active';
    await updateDoc(doc(db, 'beta_testers', id), { status: newStatus });
    loadData();
  };

  const deleteTester = (id: string) => {
    setDeleteTesterConfirmId(id);
  };

  const confirmDeleteTester = async () => {
    if (!deleteTesterConfirmId) return;
    try {
      await deleteDoc(doc(db, 'beta_testers', deleteTesterConfirmId));
    } catch (error) {
      console.error('Failed to delete tester:', error);
    } finally {
      // Always reset state so the confirmation dialog can't get stuck open.
      setDeleteTesterConfirmId(null);
      loadData();
    }
  };

  // Open the confirm dialog for a flag flip — never write directly; these are
  // global switches affecting ALL users.
  const requestFlagFlip = (flag: FeatureFlagDef) => {
    setPendingFlag(flag);
  };

  const confirmFlagFlip = async () => {
    if (!pendingFlag) return;
    const { key, label } = pendingFlag;
    const nextValue = !flags[key];
    setFlagSaving(true);
    try {
      await setAppFlag(key, nextValue);
      // The AI kill-switch has its own cache inside geminiService; reset it lazily so
      // we don't pull the Gemini SDK into this statically-imported modal's chunk.
      if (key === AI_ENABLED_FLAG_KEY) {
        const { resetAiEnabledCache } = await import('@/services/geminiService');
        resetAiEnabledCache();
      }
      toast.success(`${label} turned ${nextValue ? 'ON' : 'OFF'}`);
      setPendingFlag(null);
      await loadData(); // Re-read so the row reflects the new effective state.
    } catch (error) {
      console.error('Failed to update feature flag:', error);
      toast.error(`Failed to update ${label}`);
    } finally {
      setFlagSaving(false);
    }
  };

  // Household allowlist targeting (Plan F-PLAT-09) — soft-launch a targetable flag
  // to specific households before flipping the global boolean. No confirm dialog
  // (unlike the global flip): scoped to one household, low blast radius.
  const handleAddTargetHousehold = async (flagKey: string) => {
    const id = (targetInputs[flagKey] ?? '').trim();
    if (!id) return;
    setTargetSaving(true);
    try {
      await addFlagTargetHousehold(flagKey, id);
      setTargetHouseholds(prev => ({
        ...prev,
        [flagKey]: prev[flagKey]?.includes(id) ? prev[flagKey] : [...(prev[flagKey] ?? []), id],
      }));
      setTargetInputs(prev => ({ ...prev, [flagKey]: '' }));
      toast.success(`Household added to ${flagKey} allowlist`);
    } catch (error) {
      console.error('Failed to add target household:', error);
      toast.error('Failed to add household to allowlist');
    } finally {
      setTargetSaving(false);
    }
  };

  const handleRemoveTargetHousehold = async (flagKey: string, id: string) => {
    setTargetSaving(true);
    try {
      await removeFlagTargetHousehold(flagKey, id);
      setTargetHouseholds(prev => ({
        ...prev,
        [flagKey]: (prev[flagKey] ?? []).filter(h => h !== id),
      }));
      toast.success(`Household removed from ${flagKey} allowlist`);
    } catch (error) {
      console.error('Failed to remove target household:', error);
      toast.error('Failed to remove household from allowlist');
    } finally {
      setTargetSaving(false);
    }
  };

  /**
   * Habit-history repair (2026-07-15 incident): for every household (up to the
   * same 50-household ops cap as the AI meter), rebuild each habit's
   * completedDates from its surviving submission docs. Writes are strictly
   * additive (`arrayUnion` of only the missing dates), so re-running is
   * idempotent and toggle-path days are never removed. streakDays is
   * recomputed over the merged history. See utils/migrations/habitHistoryRepair.
   */
  const runHabitHistoryRepair = async () => {
    setRepairConfirmOpen(false);
    setRepairRunning(true);
    setRepairLog([]);
    const log: string[] = [];
    try {
      const householdsSnap = await getDocs(query(collection(db, 'households'), limit(50)));
      let repairedHabits = 0;
      let restoredDates = 0;
      let failures = 0;
      for (const hh of householdsSnap.docs) {
        // Per-household + per-habit error isolation: one bad document or a
        // transient permission/network error must not abort the whole sweep
        // (the run is additive/idempotent, so partial progress is safe).
        try {
          const habitsSnap = await getDocs(collection(db, `households/${hh.id}/habits`));
          for (const habitDoc of habitsSnap.docs) {
            try {
              const habit = habitDoc.data() as Habit;
              // Only habits flagged for submission tracking can have submission docs.
              if (!habit.hasSubmissionTracking) continue;
              const subsSnap = await getDocs(
                collection(db, `households/${hh.id}/habits/${habitDoc.id}/submissions`)
              );
              const submissions = subsSnap.docs.map(d => d.data() as HabitSubmission);
              const plan = computeHabitHistoryRepair(habit, submissions);
              if (!plan) continue;
              await updateDoc(doc(db, `households/${hh.id}/habits`, habitDoc.id), {
                completedDates: arrayUnion(...plan.missingDates),
                streakDays: plan.streakDays,
                lastUpdated: serverTimestamp(),
              });
              repairedHabits++;
              restoredDates += plan.missingDates.length;
              log.push(`${habit.title ?? habitDoc.id}: restored ${plan.missingDates.length} day(s), streak → ${plan.streakDays}`);
            } catch (error) {
              failures++;
              console.error(`[runHabitHistoryRepair] Habit ${hh.id}/${habitDoc.id} failed:`, error);
              log.push(`SKIPPED habit ${habitDoc.id} (${hh.id}) — see console; re-run to retry.`);
            }
          }
        } catch (error) {
          failures++;
          console.error(`[runHabitHistoryRepair] Household ${hh.id} failed:`, error);
          log.push(`SKIPPED household ${hh.id} — see console; re-run to retry.`);
        }
      }
      log.push(
        repairedHabits === 0
          ? 'Nothing to repair — every submission-backed day is already present.'
          : `Done: ${restoredDates} day(s) restored across ${repairedHabits} habit(s). Points totals self-correct on next login/midnight recompute.`
      );
      if (failures > 0) {
        log.push(`${failures} item(s) skipped on errors — safe to re-run (additive/idempotent).`);
        toast.error(`Repair finished with ${failures} skipped item(s) — re-run to retry`);
      } else {
        toast.success('Habit history repair complete');
      }
    } catch (error) {
      console.error('[runHabitHistoryRepair] Failed:', error);
      log.push('FAILED — see console. Partial progress is safe to re-run (additive/idempotent).');
      toast.error('Repair failed — safe to re-run');
    } finally {
      setRepairLog(log);
      setRepairRunning(false);
    }
  };

  /** The literal phrase an operator must type before Phase 2 can commit anything. */
  const DRIFT_CONFIRM_PHRASE = 'REPAIR POINTS';
  /** Ops cap on Scan — same 50-household ceiling the AI meter tab uses. A
   *  household beyond this is never read, let alone reported on; the UI
   *  states this explicitly so a clean report can't be read as "every
   *  household is fine" when it may just mean "every household we looked
   *  at is fine". */
  const DRIFT_SCAN_HOUSEHOLD_CAP = 50;

  /** Human-readable verdict line for one report row. */
  const describeDriftVerdict = (row: DriftRow): string => {
    const { verdict } = row;
    switch (verdict.kind) {
      case 'looks_correct':
        return 'looks correct';
      case 'under_credited':
        return `under-credited by ${verdict.amount}`;
      case 'over_debited':
        return `over-debited by ${verdict.amount}`;
      case 'cannot_determine':
        return `cannot determine — ${verdict.reason}`;
    }
  };

  /**
   * Points-drift Phase 1 — REPORT ONLY. Never writes anything. Recomputes
   * what each member's and the household's `points.total` SHOULD be from
   * habit data (see utils/pointsDriftRepair.ts for the full design and the
   * hard constraint around pre-attribution history), across the same
   * DRIFT_SCAN_HOUSEHOLD_CAP ops cap the other sweeps here use.
   *
   * Members/habits are read through the app's real `FirestoreDataConverter`s
   * (`householdMemberConverter`/`habitConverter`) — NOT a raw `as Habit`
   * cast — so this scan sees the same normalized shape every other read path
   * in the app does (e.g. `Habit.scoringType` defaulting to `'threshold'`
   * when absent, `completedBy` normalization). A raw cast on unvalidated
   * legacy docs is exactly how a malformed doc (e.g. a missing `basePoints`)
   * reaches the scorer in the first place. The household doc itself has no
   * converter (none exists in the codebase — see firestoreConverters.ts's
   * own doc comment on why Household reads are left raw elsewhere too).
   *
   * A household that throws while being scanned is DROPPED from the report,
   * not silently treated as clean — `driftFailedHouseholdIds` records which,
   * so the operator sees "N failed to scan" rather than reading their
   * absence as "nothing wrong there".
   */
  const runPointsDriftScan = async () => {
    setDriftScanning(true);
    setDriftApplyLog([]);
    setDriftConfirmText('');
    setDriftFailedHouseholdIds([]);
    try {
      const householdsSnap = await getDocs(
        query(collection(db, 'households'), limit(DRIFT_SCAN_HOUSEHOLD_CAP))
      );
      const reports: PointsDriftReport[] = [];
      const failedHouseholdIds: string[] = [];
      for (const hh of householdsSnap.docs) {
        try {
          const household = { ...(hh.data() as Household), id: hh.id };
          const [membersSnap, habitsSnap] = await Promise.all([
            getDocs(
              collection(db, `households/${hh.id}/members`).withConverter(householdMemberConverter)
            ),
            getDocs(collection(db, `households/${hh.id}/habits`).withConverter(habitConverter)),
          ]);
          const members = membersSnap.docs.map(d => d.data());
          const habits = habitsSnap.docs.map(d => d.data());
          reports.push(computePointsDriftReport(household, members, habits));
        } catch (error) {
          console.error(`[runPointsDriftScan] Household ${hh.id} failed:`, error);
          failedHouseholdIds.push(hh.id);
        }
      }
      setDriftReports(reports);
      setDriftScanned(true);
      setDriftFailedHouseholdIds(failedHouseholdIds);
      setDriftHouseholdsScanned(householdsSnap.docs.length);
      const proposed = planPointsDriftApply(reports).length;
      const failedNote = failedHouseholdIds.length > 0 ? ` — ${failedHouseholdIds.length} household(s) FAILED to scan` : '';
      if (failedHouseholdIds.length > 0) {
        toast.error(`Scan finished with ${failedHouseholdIds.length} household(s) failed — see report`);
      } else {
        toast.success(
          proposed > 0
            ? `Scan complete — ${proposed} determinable fix(es) found${failedNote}`
            : `Scan complete — no determinable drift found${failedNote}`
        );
      }
    } catch (error) {
      console.error('[runPointsDriftScan] Failed:', error);
      toast.error('Scan failed — see console');
    } finally {
      setDriftScanning(false);
    }
  };

  /**
   * Points-drift Phase 2 — APPLY. Only reachable once the operator has typed
   * `DRIFT_CONFIRM_PHRASE` verbatim (checked again here, not just via the
   * disabled-button affordance). Writes ONLY the deltas Phase 1 classified as
   * determinable (`planPointsDriftApply` — never a `cannot_determine` row).
   *
   * 🛡️ TOCTOU GUARD (one `runTransaction` per household, not a plain
   * `writeBatch`): Scan and Apply are separated by real time — the operator
   * has to read the report, type the confirm phrase, and (per this panel's
   * own instructions) manually think about it. `write.newTotal` was computed
   * entirely from the SCAN-time snapshot; a plain absolute `batch.update`
   * would silently clobber whatever the household has legitimately done
   * since (a member finishing more habits, another admin editing points).
   * Each household's transaction re-reads every target doc's LIVE
   * `points.total` and only writes a row if it still equals exactly what
   * Scan captured (`write.previousTotal`); anything that moved is skipped
   * and surfaced as "changed since scan — re-scan required", never silently
   * reconciled or silently applied over the new value. All reads happen
   * before any write, per Firestore's transaction rule, and the whole
   * household's writes + its audit-log entry commit as ONE transaction, so
   * per-household atomicity is unchanged from the batch this replaced — a
   * transaction per WRITE (rather than per household) would NOT preserve
   * that atomicity, which is why every household's several rows share one
   * `runTransaction` call, not one each.
   *
   * Every write is also re-asserted `Number.isFinite` immediately before the
   * transaction write, even though `planPointsDriftApply` already guarantees
   * it — the last line before a real Firestore write is not the place to
   * trust an upstream invariant alone (see that function's own doc comment).
   *
   * The durable record: the activity-log entry written in the SAME
   * transaction states each write's full `previousTotal → newTotal` (and its
   * target id), not just the delta — a delta alone cannot reconstruct what
   * was overwritten once any further points activity has happened, and this
   * is a ONE-WAY DOWNWARD write against a lifetime counter nothing else ever
   * lowers.
   */
  const applyPointsDriftFixes = async () => {
    if (driftConfirmText.trim() !== DRIFT_CONFIRM_PHRASE) return;
    setDriftApplying(true);
    const log: string[] = [];
    const staleLog: string[] = [];
    try {
      const writes = planPointsDriftApply(driftReports);
      if (writes.length === 0) {
        log.push('Nothing to apply — the last scan found no determinable drift.');
      } else {
        const byHousehold = new Map<string, PointsDriftWrite[]>();
        for (const w of writes) {
          const list = byHousehold.get(w.householdId) ?? [];
          list.push(w);
          byHousehold.set(w.householdId, list);
        }
        for (const [householdId, householdWrites] of byHousehold) {
          await runTransaction(db, async transaction => {
            // ALL reads before any write — Firestore requires this ordering
            // within one transaction.
            const targets = householdWrites.map(w => ({
              write: w,
              ref:
                w.scope === 'household'
                  ? doc(db, 'households', householdId)
                  : doc(db, `households/${householdId}/members`, w.memberUid as string),
            }));
            const snaps = await Promise.all(targets.map(t => transaction.get(t.ref)));

            const applied: PointsDriftWrite[] = [];
            for (let i = 0; i < targets.length; i++) {
              const target = targets[i];
              const snap = snaps[i];
              if (!target || !snap) continue;
              const { write, ref } = target;
              const liveData = snap.data() as { points?: { total?: number } } | undefined;
              const liveTotal = liveData?.points?.total ?? 0;
              if (liveTotal !== write.previousTotal) {
                staleLog.push(
                  `${householdId} · ${write.label}: changed since scan (was ${write.previousTotal}, now ${liveTotal}) — skipped, re-scan required`
                );
                continue;
              }
              if (!Number.isFinite(write.newTotal)) {
                staleLog.push(`${householdId} · ${write.label}: computed total was not finite — skipped`);
                continue;
              }
              transaction.update(ref, { 'points.total': write.newTotal });
              applied.push(write);
              log.push(`${householdId} · ${write.label}: ${write.previousTotal} → ${write.newTotal} (+${write.delta})`);
            }

            if (applied.length > 0) {
              const activityRef = doc(collection(db, `households/${householdId}/activityLog`)).withConverter(
                activityLogConverter
              );
              transaction.set(activityRef, {
                id: activityRef.id,
                ...buildActivityLogEntry(
                  { uid: user?.uid ?? 'admin', name: user?.displayName ?? 'Admin' },
                  {
                    domain: 'member',
                    action: 'points_drift_repaired',
                    summary: `Points drift repair — ${applied
                      .map(
                        w =>
                          `${w.label} (${w.scope === 'member' ? w.memberUid : householdId}): ${w.previousTotal} → ${w.newTotal}`
                      )
                      .join('; ')}`,
                  },
                  serverTimestamp()
                ),
              });
            }
          });
        }
      }
      if (staleLog.length > 0) {
        log.push(...staleLog);
        toast.error(`${staleLog.length} row(s) changed since scan — skipped, see log`);
      } else {
        toast.success(writes.length === 0 ? 'Nothing to apply' : 'Points drift repair applied');
      }
      setDriftApplyLog(log);
      // Force a fresh scan before another apply — the stored totals just
      // changed (or a row was skipped as stale), so the previous report is
      // no longer trustworthy either way.
      setDriftReports([]);
      setDriftScanned(false);
      setDriftConfirmText('');
    } catch (error) {
      console.error('[applyPointsDriftFixes] Failed:', error);
      toast.error('Apply failed — see console');
    } finally {
      setDriftApplying(false);
    }
  };

  const copyReport = (report: FeedbackReport) => {
    if (!navigator.clipboard) {
      toast.error('Clipboard not available in this browser');
      return;
    }
    navigator.clipboard.writeText(JSON.stringify(report, null, 2))
      .then(() => toast.success('Report JSON copied'))
      .catch(err => {
        console.error('Failed to copy report:', err);
        toast.error('Failed to copy to clipboard');
      });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="dev-console-title"
      maxWidth="max-w-none sm:max-w-4xl"
      fullScreenOnMobile
    >
      {/* Fill the sheet on mobile; keep a comfortable fixed height on desktop. */}
      <div className="flex flex-col h-full sm:h-[70vh]">
        {/* Sticky header so the title + close stay reachable while the body scrolls. */}
        <div className="sticky top-0 z-10 shrink-0 px-4 py-3 sm:p-4 border-b border-brand-200 dark:border-brand-700/60 bg-white dark:bg-brand-800 flex justify-between items-center">
            <h2 id="dev-console-title" className="font-display text-lg sm:text-xl font-semibold">Developer Console</h2>
            <button
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center -mr-2 hover:bg-brand-100/50 dark:hover:bg-brand-700/50 rounded-full text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 transition-colors"
              aria-label="Close"
            >
              <X size={22} />
            </button>
        </div>

        {/* Tabs — shared Tabs primitive (pill-in-trough), matching the horizontal
            page selectors on the core app pages. Scrolls horizontally on a phone
            so all four fit without wrapping. */}
        <div className="shrink-0 px-3 py-2 sm:px-4 border-b border-brand-200 dark:border-brand-700/60 bg-brand-50/50 dark:bg-brand-700/30">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as Tab)}>
            <TabsList size="sm" aria-label="Developer Console sections">
              {TABS.map(tab => (
                <TabsTrigger key={tab.id} value={tab.id} className="whitespace-nowrap">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Content */}
        <div className="flex-1 scroll-contain-y p-4 sm:p-6 bg-white dark:bg-brand-800">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 text-brand-600 dark:text-brand-300 animate-spin" />
            </div>
          ) : (
            <>
              {activeTab === 'testers' && (
                <div className="space-y-6">
                  {/* Add form stacks on mobile so neither the input nor the button overflows. */}
                  <form
                    onSubmit={e => { e.preventDefault(); handleAddTester(); }}
                    className="flex flex-col sm:flex-row gap-2 p-4 bg-brand-50/50 dark:bg-brand-700/30 rounded-xl border border-brand-200 dark:border-brand-700/60"
                  >
                    <input
                      type="email"
                      required
                      placeholder="new@tester.com"
                      className="flex-1 min-w-0 h-11 px-3 border border-brand-200 dark:border-brand-600 rounded-lg bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-100 placeholder:text-brand-400 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
                      value={newTesterEmail}
                      onChange={e => setNewTesterEmail(e.target.value)}
                    />
                    <button type="submit" className="h-11 bg-accent-600 dark:bg-accent-500 text-white px-4 rounded-btn flex items-center justify-center gap-2 font-semibold hover:bg-accent-700 dark:hover:bg-accent-400 active:scale-[0.98] transition-colors duration-(--duration-fast) ease-(--ease-standard) shrink-0 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40">
                      <Plus size={16} /> Add Tester
                    </button>
                  </form>

                  {testers.length === 0 && (
                    <div className="text-center py-12 text-brand-400 dark:text-brand-450">No beta testers yet.</div>
                  )}

                  {/* Mobile: stacked cards (no cramped horizontal table). */}
                  <div className="space-y-3 md:hidden">
                    {testers.map(t => (
                      <div key={t.id} className="p-4 rounded-xl border border-brand-200 dark:border-brand-700/60 bg-white dark:bg-brand-800">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-semibold text-brand-800 dark:text-brand-100 break-all min-w-0">{t.email}</p>
                          <Badge variant={t.status === 'active' ? 'success' : 'danger'} size="sm">
                            {t.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-brand-500 dark:text-brand-400">Added {new Date(t.addedAt).toLocaleDateString()}</p>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => toggleTesterStatus(t.id, t.status)}
                            className="flex-1 min-h-[44px] rounded-lg text-sm font-bold border border-brand-200 dark:border-brand-600 text-habit-blue hover:bg-habit-blue/10 active:scale-[0.98] transition"
                          >
                            {t.status === 'active' ? 'REVOKE' : 'ACTIVATE'}
                          </button>
                          <button
                            onClick={() => deleteTester(t.id)}
                            className="flex h-11 w-11 items-center justify-center shrink-0 rounded-lg text-money-neg dark:text-money-negDark hover:bg-money-neg/10 active:scale-[0.98] transition"
                            aria-label={`Delete tester ${t.email}`}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop (md+): the compact table. */}
                  <div className="hidden md:block border rounded-xl overflow-hidden">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-brand-100/50 dark:bg-brand-700/30 text-brand-600 dark:text-brand-300 font-medium">
                        <tr>
                          <th className="p-3">Email</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Added</th>
                          <th className="p-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-200">
                        {testers.map(t => (
                          <tr key={t.id} className="hover:bg-brand-50/50 dark:hover:bg-brand-700/30">
                            <td className="p-3 font-medium">{t.email}</td>
                            <td className="p-3">
                              <Badge variant={t.status === 'active' ? 'success' : 'danger'} size="md">
                                {t.status}
                              </Badge>
                            </td>
                            <td className="p-3 text-brand-500 dark:text-brand-400">{new Date(t.addedAt).toLocaleDateString()}</td>
                            <td className="p-3 flex gap-2">
                              <button onClick={() => toggleTesterStatus(t.id, t.status)} className="text-habit-blue hover:underline text-xs font-bold">
                                {t.status === 'active' ? 'REVOKE' : 'ACTIVATE'}
                              </button>
                              <button onClick={() => deleteTester(t.id)} className="text-money-neg dark:text-money-negDark hover:bg-money-neg/10 p-1 rounded-sm ml-2" aria-label={`Delete tester ${t.email}`}>
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'ai_meter' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-habit-blue/10 dark:bg-habit-blue/15 p-4 rounded-xl border border-habit-blue/30">
                      <h3 className="text-sm font-medium text-habit-blue">Total Active Households</h3>
                      <p className="text-3xl font-bold text-habit-blue">{households.length}</p>
                    </div>
                  </div>

                  <div className="border rounded-xl overflow-hidden">
                    <div className="bg-brand-50/50 dark:bg-brand-700/30 px-4 py-3 border-b font-medium text-brand-700 dark:text-brand-200">Household Usage (Daily)</div>
                    <div className="divide-y">
                        {households.map(h => {
                            const usage = h.aiUsage?.dailyCount || 0;
                            // The actually-enforced cap: plan-aware once billing is live,
                            // else the flat legacy cap for everyone (matches
                            // geminiService.checkAndIncrementAiUsage).
                            const cap = billingEnabled ? getLimits(h).aiDailyCap : LEGACY_AI_DAILY_QUOTA;
                            const percentage = Math.min((usage / cap) * 100, 100);
                            return (
                                <div key={h.id} className="p-4 hover:bg-brand-50/50 dark:hover:bg-brand-700/30">
                                    {/* Stack name + a full-width bar on mobile; side-by-side at sm+. */}
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                        <div className="min-w-0 sm:flex-1">
                                            <p className="font-bold text-brand-800 dark:text-brand-100 truncate">{h.name}</p>
                                            <p className="text-xs text-brand-400 dark:text-brand-450 font-mono truncate">{h.id}</p>
                                            <p className="text-xs text-brand-500 dark:text-brand-400">Last Reset: {h.aiUsage?.lastResetDate || 'Never'}</p>
                                        </div>
                                        <div className="flex items-center gap-3 w-full sm:w-1/2 shrink-0">
                                            <div className="flex-1 h-3 bg-brand-200/50 dark:bg-brand-700 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full transition-all ${percentage > 90 ? 'bg-money-neg' : 'bg-brand-500'}`}
                                                    style={{ width: `${percentage}%` }}
                                                />
                                            </div>
                                            <span className={`text-sm font-mono font-bold w-12 text-right shrink-0 ${percentage > 90 ? 'text-money-neg dark:text-money-negDark' : 'text-brand-600 dark:text-brand-300'}`}>
                                                {usage}/{cap}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {households.length === 0 && (
                            <div className="text-center py-12 text-brand-400 dark:text-brand-450">No households found.</div>
                        )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'reports' && (
                <div className="space-y-4">
                    {reports.map(report => (
                        <div key={report.id} className="p-4 rounded-xl border border-brand-200 dark:border-brand-700/60 hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard)">
                            <div className="flex justify-between items-start gap-2 mb-2">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                                    <span className="text-xs font-mono bg-brand-100/50 dark:bg-brand-700/30 px-2 py-1 rounded-sm text-brand-600 dark:text-brand-300 font-bold">{report.version}</span>
                                    <span className="text-xs text-brand-400 dark:text-brand-450">{new Date(report.timestamp).toLocaleString()}</span>
                                </div>
                                <button onClick={() => copyReport(report)} className="flex h-11 w-11 items-center justify-center shrink-0 -mr-1 -mt-1 text-brand-600 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700/50 rounded-lg active:scale-[0.98] transition" title="Copy JSON" aria-label="Copy report as JSON">
                                    <Copy size={18} />
                                </button>
                            </div>
                            <p className="text-brand-800 dark:text-brand-100 whitespace-pre-wrap break-words mb-3">{report.message}</p>
                            <div className="pt-3 border-t border-brand-200 dark:border-brand-700/60 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-brand-500 dark:text-brand-400 font-mono">
                                <span className="break-all">Route: {report.route}</span>
                                <span className="break-all">UID: {report.userId}</span>
                                <span className="break-all">HID: {report.householdId}</span>
                            </div>
                            {report.errorContext && (
                                <div className="mt-2 bg-money-bgNeg dark:bg-money-neg/15 p-2 rounded-sm text-xs text-money-neg dark:text-money-negDark font-mono overflow-x-auto border border-money-neg/30">
                                    <strong>Error Context:</strong><br/>
                                    {report.errorContext}
                                </div>
                            )}
                        </div>
                    ))}
                    {reports.length === 0 && <div className="text-center py-12 text-brand-400 dark:text-brand-450">No feedback reports found.</div>}
                </div>
              )}

              {activeTab === 'flags' && (
                <div className="space-y-3 sm:space-y-4">
                  <p className="text-sm text-brand-500 dark:text-brand-400">
                    Global switches on <span className="font-mono">app_config/global</span>, effective for ALL users within ~60 s. Changes are confirmed before they apply.
                  </p>
                  {FEATURE_FLAGS.map(flag => {
                    const isOn = flags[flag.key] === true;
                    const isTargetable = flag.key in ALLOWLIST_TARGETABLE_FLAGS;
                    const targets = targetHouseholds[flag.key] ?? [];
                    const isExpanded = expandedTargetFlag === flag.key;
                    return (
                      <div
                        key={flag.key}
                        className={`p-4 rounded-xl border ${
                          flag.danger
                            ? 'border-warm-300/70 bg-warm-50/60 dark:border-warm-800/60 dark:bg-warm-900/20'
                            : 'border-brand-200 bg-brand-50/50 dark:border-brand-700/60 dark:bg-brand-700/30'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 sm:gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                              <h3 className="font-bold text-brand-800 dark:text-brand-100">{flag.label}</h3>
                              <Badge variant={isOn ? 'success' : 'neutral'} size="sm">
                                {isOn ? 'ON' : 'OFF'}
                              </Badge>
                              {flag.danger && (
                                <Badge variant="warning" size="sm" className="inline-flex items-center gap-1">
                                  <AlertTriangle size={11} aria-hidden="true" /> High impact
                                </Badge>
                              )}
                              {isTargetable && targets.length > 0 && (
                                <Badge variant="neutral" size="sm">
                                  {targets.length} targeted household{targets.length === 1 ? '' : 's'}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1.5 text-xs leading-relaxed text-brand-500 dark:text-brand-400">{flag.description}</p>
                            {isTargetable && (
                              <button
                                type="button"
                                onClick={() => setExpandedTargetFlag(isExpanded ? null : flag.key)}
                                className="mt-2 text-xs font-semibold text-accent-600 hover:text-accent-700 dark:text-accent-400"
                              >
                                {isExpanded ? 'Hide' : 'Target specific household'}
                              </button>
                            )}
                          </div>
                          {/* Confirm-gated: onCheckedChange opens the dialog. */}
                          <Switch
                            checked={isOn}
                            onCheckedChange={() => requestFlagFlip(flag)}
                            aria-label={`Turn ${flag.label} ${isOn ? 'OFF' : 'ON'}`}
                          />
                        </div>

                        {isTargetable && isExpanded && (
                          <div className="mt-3 pt-3 border-t border-brand-200/70 dark:border-brand-700/50 space-y-2">
                            <p className="text-xs text-brand-500 dark:text-brand-400">
                              Households listed here get this flag ON regardless of the global switch above — soft-launch before flipping it for everyone.
                            </p>
                            {targets.length > 0 && (
                              <ul className="space-y-1">
                                {targets.map(id => (
                                  <li
                                    key={id}
                                    className="flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-brand-800 px-2.5 py-1.5 text-xs font-mono text-brand-700 dark:text-brand-200"
                                  >
                                    <span className="truncate">{id}</span>
                                    <button
                                      type="button"
                                      disabled={targetSaving}
                                      onClick={() => handleRemoveTargetHousehold(flag.key, id)}
                                      aria-label={`Remove household ${id} from ${flag.label} allowlist`}
                                      className="shrink-0 text-brand-400 hover:text-red-600 disabled:opacity-50"
                                    >
                                      <X size={14} aria-hidden="true" />
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={targetInputs[flag.key] ?? ''}
                                onChange={(e) => setTargetInputs(prev => ({ ...prev, [flag.key]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void handleAddTargetHousehold(flag.key);
                                  }
                                }}
                                placeholder="Household ID"
                                aria-label={`Household ID to target for ${flag.label}`}
                                className="flex-1 min-w-0 rounded-lg border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 px-2.5 py-1.5 text-xs font-mono text-brand-800 dark:text-brand-100 outline-hidden focus:ring-2 focus:ring-accent-500"
                              />
                              <button
                                type="button"
                                disabled={targetSaving || !(targetInputs[flag.key] ?? '').trim()}
                                onClick={() => void handleAddTargetHousehold(flag.key)}
                                className="shrink-0 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                              >
                                Add
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Read-only Plaid status. The secret lives in Secret Manager
                      (set via CLI) — never surfaced here. This only shows the
                      flag state + a connected-account COUNT (no tokens). */}
                  <div className="mt-1 rounded-xl border border-brand-200 bg-brand-50/50 p-4 text-xs text-brand-500 dark:border-brand-700/60 dark:bg-brand-700/30 dark:text-brand-400">
                    Plaid: {flags['plaidEnabled'] ? 'enabled ✓' : 'disabled ✗'} · connected accounts: {plaidItemCount ?? '—'}
                    <span className="mt-1 block opacity-80">
                      Secret is set via <span className="font-mono">firebase functions:secrets:set</span> (see docs/PLAID_SETUP_RUNBOOK.md), not here.
                    </span>
                  </div>

                  {/* Maintenance: additive habit-history repair (2026-07-15 incident). */}
                  <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-700/60 dark:bg-brand-700/30">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-bold text-brand-800 dark:text-brand-100">Repair habit history</h3>
                        <p className="mt-1.5 text-xs leading-relaxed text-brand-500 dark:text-brand-400">
                          Rebuilds each habit&apos;s <span className="font-mono">completedDates</span> from its stored submission
                          docs (all households). Strictly additive and idempotent — only missing days are restored, nothing
                          is ever removed. Toggle-path days without submissions can&apos;t be recovered automatically; re-enter
                          those via the History tab&apos;s day editor.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={repairRunning}
                        onClick={() => setRepairConfirmOpen(true)}
                        className="shrink-0 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {repairRunning ? (
                          <span className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Repairing…</span>
                        ) : (
                          'Run repair'
                        )}
                      </button>
                    </div>
                    {repairLog.length > 0 && (
                      <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-white p-2.5 text-xs font-mono text-brand-700 dark:bg-brand-800 dark:text-brand-200">
                        {repairLog.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Points-drift repair: Phase 1 (Scan) is a read-only dry
                      run; Phase 2 (Apply) is gated behind a literal
                      type-to-confirm phrase — never a single click. See
                      utils/pointsDriftRepair.ts for the full design. */}
                  <div className="rounded-xl border border-warm-300/70 bg-warm-50/60 p-4 dark:border-warm-800/60 dark:bg-warm-900/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-bold text-brand-800 dark:text-brand-100">Points drift repair</h3>
                        <p className="mt-1.5 text-xs leading-relaxed text-brand-500 dark:text-brand-400">
                          Recomputes each member&apos;s and household&apos;s <span className="font-mono">points.total</span> from
                          habit data and reports where it disagrees with what&apos;s stored (all households). Read-only — this
                          never writes anything by itself. Pre-attribution history and any other unmodeled point source
                          (redemptions, chores, to-do credits, submission-tracked habits) is reported as &ldquo;cannot
                          determine&rdquo; rather than guessed at.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={driftScanning}
                        onClick={() => void runPointsDriftScan()}
                        className="shrink-0 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {driftScanning ? (
                          <span className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Scanning…</span>
                        ) : (
                          'Scan for drift'
                        )}
                      </button>
                    </div>

                    {driftScanned && (
                      <div className="mt-3 space-y-3">
                        {driftReports.length === 0 ? (
                          <p className="text-xs text-brand-500 dark:text-brand-400">No households found.</p>
                        ) : (
                          <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg bg-white p-2.5 text-xs font-mono text-brand-700 dark:bg-brand-800 dark:text-brand-200">
                            {driftReports.flatMap(report =>
                              report.rows.map(row => (
                                <li key={`${report.householdId}-${row.scope}-${row.id}`}>
                                  <span className="text-brand-400 dark:text-brand-450">{report.householdName}</span>
                                  {' · '}
                                  <span className="font-semibold">{row.label}</span>
                                  {`: ${describeDriftVerdict(row)} (stored ${row.storedTotal}${row.recomputedTotal !== null ? `, recomputed ${row.recomputedTotal}` : ''})`}
                                </li>
                              ))
                            )}
                          </ul>
                        )}

                        {(() => {
                          const proposedWrites = planPointsDriftApply(driftReports);
                          if (proposedWrites.length === 0) return null;
                          return (
                            <div className="rounded-lg border border-warm-300/70 bg-white p-3 dark:border-warm-800/60 dark:bg-brand-800">
                              <p className="text-xs font-semibold text-brand-800 dark:text-brand-100">
                                {proposedWrites.length} determinable fix(es) ready to apply:
                              </p>
                              <ul className="mt-1.5 space-y-0.5 text-xs font-mono text-brand-600 dark:text-brand-300">
                                {proposedWrites.map((w, i) => (
                                  <li key={i}>{`${w.householdId} · ${w.label}: ${w.previousTotal} → ${w.newTotal} (+${w.delta})`}</li>
                                ))}
                              </ul>
                              <p className="mt-3 text-xs font-semibold text-red-600 dark:text-red-400">
                                Before applying: manually cross-check any threshold-habit fix above against known
                                PointsBreakdownModal past-date edits. That editor can restore a past date on a threshold habit
                                without adjusting points (by design), which this scan cannot distinguish from real drift — see
                                the &ldquo;KNOWN GAP&rdquo; note in utils/pointsDriftRepair.ts.
                              </p>
                              <p className="mt-2 text-xs text-brand-500 dark:text-brand-400">
                                Type <span className="font-mono font-bold">{DRIFT_CONFIRM_PHRASE}</span> to enable Apply. This
                                writes in a batch per household and is NOT reversible from this console.
                              </p>
                              <div className="mt-2 flex gap-2">
                                <input
                                  type="text"
                                  value={driftConfirmText}
                                  onChange={(e) => setDriftConfirmText(e.target.value)}
                                  placeholder={DRIFT_CONFIRM_PHRASE}
                                  aria-label={`Type ${DRIFT_CONFIRM_PHRASE} to confirm applying points drift fixes`}
                                  className="flex-1 min-w-0 rounded-lg border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 px-2.5 py-1.5 text-xs font-mono text-brand-800 dark:text-brand-100 outline-hidden focus:ring-2 focus:ring-accent-500"
                                />
                                <button
                                  type="button"
                                  disabled={driftApplying || driftConfirmText.trim() !== DRIFT_CONFIRM_PHRASE}
                                  onClick={() => void applyPointsDriftFixes()}
                                  className="shrink-0 rounded-lg bg-money-neg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                                >
                                  {driftApplying ? (
                                    <span className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Applying…</span>
                                  ) : (
                                    'Apply fixes'
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {driftApplyLog.length > 0 && (
                      <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-white p-2.5 text-xs font-mono text-brand-700 dark:bg-brand-800 dark:text-brand-200">
                        {driftApplyLog.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!deleteTesterConfirmId}
        onClose={() => setDeleteTesterConfirmId(null)}
        onConfirm={confirmDeleteTester}
        title="Remove Tester"
        message="Are you sure you want to remove this tester?"
        confirmLabel="Remove"
      />

      <ConfirmDialog
        isOpen={repairConfirmOpen}
        onClose={() => setRepairConfirmOpen(false)}
        onConfirm={() => void runHabitHistoryRepair()}
        title="Repair habit history?"
        message="Restores completion days proven by stored submissions across ALL households (max 50). Additive only — no existing data is changed or removed, and re-running is safe."
        confirmLabel="Run repair"
      />

      <ConfirmDialog
        isOpen={!!pendingFlag}
        onClose={() => setPendingFlag(null)}
        onConfirm={confirmFlagFlip}
        title={pendingFlag ? `Turn ${pendingFlag.label} ${flags[pendingFlag.key] ? 'OFF' : 'ON'}?` : ''}
        message={
          pendingFlag
            ? `This ${flags[pendingFlag.key] ? 'turns OFF' : 'turns ON'} "${pendingFlag.label}" for ALL users (effective within ~60 s). ${pendingFlag.description}`
            : ''
        }
        confirmLabel={pendingFlag && flags[pendingFlag.key] ? 'Turn OFF' : 'Turn ON'}
        confirmVariant={pendingFlag?.danger ? 'destructive' : 'primary'}
        isConfirming={flagSaving}
      />
    </Modal>
  );
};

export default DeveloperConsole;
