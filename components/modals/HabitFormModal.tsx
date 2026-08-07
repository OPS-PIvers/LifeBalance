import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { doc, deleteField, updateDoc } from 'firebase/firestore';
import { db } from '@/firebase.config';
import { Habit, HabitLocationTrigger, HabitReminderConfig, NoSpendScope } from '@/types/schema';
import { useGamification, useHouseholdCore, useTodos } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import Input from '@/components/ui/Input';
import HabitAutomationsSection from '@/components/habits/HabitAutomationsSection';
import HabitReminderEditor from '@/components/habits/HabitReminderEditor';
import { getLocalDateString } from '@/utils/dateHelpers';
import { getHabitReminder } from '@/utils/habitReminders';
import { computeAnyNotificationsEnabled } from '@/utils/notificationFlags';

interface HabitFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingHabit?: Habit;
}

const CATEGORIES = ['Health', 'Finance', 'Personal', 'Home', 'Work'];

const HabitFormModal: React.FC<HabitFormModalProps> = ({ isOpen, onClose, editingHabit }) => {
  const { addHabit, updateHabit, setHabitPause, habitCategories, updateHabitCategories } = useGamification();
  // F-HABITS-03: reminders are per-MEMBER, so they live on the current member's
  // doc rather than on the (shared) habit — see NotificationPreferences.
  const { members, householdId, currentUser } = useHouseholdCore();
  const { todos } = useTodos();
  const kidModeEnabled = useKidModeEnabled();

  // Habit Automations (PRD #1065): the to-dos linked to the habit being edited,
  // listed read-only inside the shared Automations section.
  const linkedTodos = useMemo(
    () => (editingHabit ? todos.filter(t => t.linkedHabitId === editingHabit.id) : []),
    [todos, editingHabit],
  );

  // Plan 080c-3: chore assignment targets MANAGED KIDS only (isManaged === true).
  // Parents are never in this list, so a habit with assignedTo set is, by
  // construction, a kid chore. The assign control renders ONLY when Kid Mode is on
  // AND at least one managed kid exists — otherwise it's absent and the save path
  // below is byte-for-byte the pre-080c behavior (dormant).
  const managedKids = useMemo(
    () => members.filter(m => m.isManaged === true),
    [members],
  );
  const showAssignControl = kidModeEnabled && managedKids.length > 0;

  // Seed the category to the canonical chip form when it matches an existing
  // chip case-insensitively, so an existing habit whose stored category differs
  // only in case from a chip (e.g. legacy "health" vs "Health") still lights up
  // the matching chip — the chip-only UI has no text field to reveal the raw
  // value otherwise. Falls back to the raw value (rendered as its own chip via
  // `mergedCategories`) when there's no match.
  const canonicalCategory = (raw: string): string => {
    const key = raw.trim().toLowerCase();
    return [...CATEGORIES, ...habitCategories].find(c => c.trim().toLowerCase() === key) ?? raw;
  };

  // Form State — lazy initializers so the first render is already populated for
  // the edit case; the defaults match the reset branch below for the new case.
  const [title, setTitle] = useState(() => editingHabit?.title ?? '');
  const [category, setCategory] = useState<string>(() => editingHabit ? canonicalCategory(editingHabit.category) : (CATEGORIES[0] ?? 'Health'));
  const [type, setType] = useState<'positive' | 'negative'>(() => editingHabit?.type ?? 'positive');
  const [scoringType, setScoringType] = useState<'incremental' | 'threshold'>(() => editingHabit?.scoringType || 'threshold');
  const [period, setPeriod] = useState<'daily' | 'weekly'>(() => editingHabit?.period ?? 'daily');
  const [basePoints, setBasePoints] = useState(() => editingHabit ? editingHabit.basePoints.toString() : '10');
  const [targetCount, setTargetCount] = useState(() => editingHabit ? editingHabit.targetCount.toString() : '1');
  // F-HABITS-01: planned-break end date (yyyy-MM-dd) — editable only when editing
  // an existing habit. Empty string means "not paused".
  const [pausedUntil, setPausedUntil] = useState(() => editingHabit?.pausedUntil ?? '');
  // Habit Automations (PRD #1065): live-edited trigger state. Seeded from the
  // habit's stored triggers so an edit round-trips them, and rebuilt into
  // `triggers` at save time (see handleSave) so the live values override the
  // spread-forward stored copy.
  const [keywords, setKeywords] = useState<string[]>(() => editingHabit?.triggers?.keywords ?? []);
  const [locations, setLocations] = useState<HabitLocationTrigger[]>(() => editingHabit?.triggers?.locations ?? []);
  const [noSpend, setNoSpend] = useState<NoSpendScope | undefined>(() => editingHabit?.triggers?.noSpend);
  // F-HABITS-03: this member's reminder for the habit being edited. Persisted on
  // save (below) via a field-path write to the member doc, NOT through
  // updateHabit — the two documents are unrelated.
  const [reminder, setReminder] = useState<HabitReminderConfig | null>(() =>
    editingHabit ? getHabitReminder(currentUser?.notificationPreferences, editingHabit.id) : null,
  );

  // Kid assignment selection. CREATE mode is a multi-select (one chore per kid);
  // EDIT mode is a single-select (0 or 1 kid). We keep both states and read only
  // the relevant one at save time, so neither leaks into the other mode.
  const [assignedKidUids, setAssignedKidUids] = useState<string[]>([]);
  // Household credit mode. Absent on every existing habit ⇒ 'members' ⇒ today's
  // behavior, so the control seeds to 'members' and only writes something new
  // once someone picks 'household'.
  //
  // 🛡️ A CHORE'S STORED `creditMode` IS NEVER SEEDED. An assigned chore's points
  // route to the assignee's own member doc and bypass the pool entirely
  // (`isHouseholdCreditHabit` requires `!assignedTo`), so the field is inert
  // there and the control is hidden. Seeding from it would mean un-assigning the
  // kid re-opened the control ALREADY set to "Household" — handing the user a
  // habit that credits nobody, from a setting they were never shown. Habits
  // saved before `handleSave` stopped carrying the stale value can still hold
  // one, and there is no migration, so this guard is what covers them.
  const seedCreditMode = (habit: Habit | undefined): 'members' | 'household' =>
    habit && !habit.assignedTo ? (habit.creditMode ?? 'members') : 'members';
  const [creditMode, setCreditMode] = useState<'members' | 'household'>(
    () => seedCreditMode(editingHabit),
  );
  // Pre-seed the EDIT single-select ONLY when the habit's existing assignee is
  // STILL a managed kid. A stale uid (the kid was removed, or the field points at
  // a non-kid) must not pre-select a now-absent chip — it would let the save path
  // silently re-write a dangling assignedTo. Reused at the render-edge re-seed below.
  const seedEditAssignedUid = (habit: Habit | undefined): string | undefined =>
    habit && managedKids.some(k => k.uid === habit.assignedTo) ? habit.assignedTo : undefined;
  const [editAssignedUid, setEditAssignedUid] = useState<string | undefined>(
    () => seedEditAssignedUid(editingHabit),
  );

  // Re-populate (or reset to defaults) the form when the habit being edited
  // (by id — NOT object reference) or the open state changes. Done during
  // render on that change edge rather than in an effect so it doesn't trigger
  // a cascading render. Mirrors the previous effect keyed on
  // `[editingHabit, isOpen]`; the initial population is handled by the
  // initializers above.
  //
  // Keying on `editingHabit` by reference (rather than `editingHabit?.id`)
  // would clobber unsaved form state: the habits Firestore listener rebuilds
  // every habit object on each snapshot, so any concurrent household activity
  // while the modal is open for the SAME habit would produce a new object
  // reference for that habit and wipe in-progress edits (title, keyword
  // draft, etc.) out from under the user. Comparing by id (plus the
  // closed->open transition, so reopening for the same habit still
  // re-seeds) only resets on a genuine new edit session: a different habit,
  // or switching create<->edit.
  const [prevEditingHabitId, setPrevEditingHabitId] = useState(editingHabit?.id);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const idChanged = prevEditingHabitId !== editingHabit?.id;
  const reopened = isOpen && !prevIsOpen;
  const shouldReset = idChanged || reopened;
  // Track the latest id/open state on every render — independently of
  // whether a reset fires below — so a later closed->open transition for the
  // SAME id is still detected even though closing itself doesn't reset the
  // form. (Each write is guarded by an inequality check, the same
  // "adjust state during render" pattern the previous single-state version
  // used, just split so tracking isn't tied to whether a reset happened.)
  if (idChanged) setPrevEditingHabitId(editingHabit?.id);
  if (prevIsOpen !== isOpen) setPrevIsOpen(isOpen);
  if (shouldReset) {
    if (editingHabit) {
      setTitle(editingHabit.title);
      setCategory(canonicalCategory(editingHabit.category));
      setType(editingHabit.type);
      setScoringType(editingHabit.scoringType || 'threshold');
      setPeriod(editingHabit.period);
      setBasePoints(editingHabit.basePoints.toString());
      setTargetCount(editingHabit.targetCount.toString());
      setPausedUntil(editingHabit.pausedUntil ?? '');
      setKeywords(editingHabit.triggers?.keywords ?? []);
      setLocations(editingHabit.triggers?.locations ?? []);
      setNoSpend(editingHabit.triggers?.noSpend);
      setReminder(getHabitReminder(currentUser?.notificationPreferences, editingHabit.id));
      setEditAssignedUid(seedEditAssignedUid(editingHabit));
      setAssignedKidUids([]);
      setCreditMode(seedCreditMode(editingHabit));
    } else {
      // Reset defaults
      setTitle('');
      setCategory(CATEGORIES[0] ?? 'Health');
      setType('positive');
      setScoringType('threshold');
      setPeriod('daily');
      setBasePoints('10');
      setTargetCount('1');
      setPausedUntil('');
      setKeywords([]);
      setLocations([]);
      // Every other trigger is cleared here, so this one must be too. It was
      // previously the only omission, and harmless while this modal was
      // mounted once per habit by HabitCard and never entered create mode.
      // Now that pages/Habits keeps ONE long-lived instance whose
      // `editingHabit` flips between habits and null, an un-reset value would
      // survive from the last habit edited into the next create session.
      setNoSpend(undefined);
      setReminder(null);
      setEditAssignedUid(undefined);
      setAssignedKidUids([]);
      setCreditMode('members');
    }
  }

  const [isSaving, setIsSaving] = useState(false);

  // Category chips: the UI-only defaults first, then the household's custom
  // categories (case-insensitive de-dupe), then the habit's own category if it
  // is a legacy/custom value not otherwise represented — so an existing habit's
  // category always renders as a selectable chip.
  const mergedCategories = useMemo(() => {
    const result = [...CATEGORIES];
    const seen = new Set(CATEGORIES.map(c => c.toLowerCase()));
    for (const c of habitCategories) {
      const key = c.trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        result.push(c);
      }
    }
    const editingCat = editingHabit?.category?.trim();
    if (editingCat && !seen.has(editingCat.toLowerCase())) {
      result.push(editingCat);
    }
    return result;
  }, [habitCategories, editingHabit?.category]);

  // Inline "+ Add" category editor.
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryDraft, setNewCategoryDraft] = useState('');
  // In-flight guard for the category write: `isSaving` covers the habit-form
  // save, not this. Without it a double-tap on Add (before the editor closes in
  // `finally`) fires a redundant second write; blocking it also disables the
  // controls for feedback during the round-trip.
  const [isAddingCategoryBusy, setIsAddingCategoryBusy] = useState(false);
  // Reset the inline editor whenever the form re-seeds (new/switched habit or
  // reopen), mirroring the field resets in the shouldReset block above.
  if (shouldReset && (isAddingCategory || newCategoryDraft)) {
    setIsAddingCategory(false);
    setNewCategoryDraft('');
  }

  const cancelAddCategory = () => {
    setIsAddingCategory(false);
    setNewCategoryDraft('');
  };

  const confirmAddCategory = async () => {
    if (isSaving || isAddingCategoryBusy) return;
    const trimmed = newCategoryDraft.trim();
    // Empty → just close the editor (no write).
    if (!trimmed) {
      cancelAddCategory();
      return;
    }
    // Case-insensitive dupe of an existing chip → select the existing one, no write.
    const existing = mergedCategories.find(c => c.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      setCategory(existing);
      cancelAddCategory();
      return;
    }
    // New value → persist alongside the current customs, select it, close.
    setIsAddingCategoryBusy(true);
    try {
      await updateHabitCategories([...habitCategories, trimmed]);
      setCategory(trimmed);
    } catch (error) {
      console.error('[HabitFormModal] Add category failed:', error);
      // Error toast is handled by updateHabitCategories.
    } finally {
      setIsAddingCategoryBusy(false);
      cancelAddCategory();
    }
  };

  const toggleKidSelection = (uid: string) => {
    setAssignedKidUids(prev =>
      prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid],
    );
  };

  // EDIT single-select: clicking the already-selected kid unassigns (toggles off).
  const selectEditKid = (uid: string) => {
    setEditAssignedUid(prev => (prev === uid ? undefined : uid));
  };

  /**
   * F-HABITS-03: persist this member's reminder for `habitId`.
   *
   * A field-path write (not a whole-`notificationPreferences` set) so a
   * concurrent Settings save can't be clobbered by this one — only the single
   * habit's key is touched. `anyNotificationsEnabled` rides along in the SAME
   * write so the denormalized fan-out flag can't drift, mirroring
   * `handleSaveNotificationPreferences` in pages/Settings.
   */
  const persistReminder = async (habitId: string) => {
    if (!householdId || !currentUser) return;
    const prefs = currentUser.notificationPreferences;
    const nextByHabitId = { ...(prefs?.perHabitReminders ?? {}) };
    if (reminder) {
      nextByHabitId[habitId] = reminder;
    } else {
      delete nextByHabitId[habitId];
    }

    try {
      await updateDoc(doc(db, 'households', householdId, 'members', currentUser.uid), {
        [`notificationPreferences.perHabitReminders.${habitId}`]: reminder ?? deleteField(),
        anyNotificationsEnabled: computeAnyNotificationsEnabled(
          prefs ? { ...prefs, perHabitReminders: nextByHabitId } : undefined,
          currentUser.fcmTokens,
        ),
      });
    } catch (error) {
      // The habit itself already saved, so don't rethrow and strand the modal —
      // report the partial outcome instead of implying the whole save failed.
      console.error('[HabitFormModal] Reminder save failed:', error);
      toast.error('Habit saved, but the reminder didn’t save');
    }
  };

  // Household credit is meaningless on an ASSIGNED chore: its points already
  // route to the assignee's own member doc and bypass the household pool
  // entirely (see `isHouseholdCreditHabit`). Hide the control — and never write
  // the field — whenever this save will produce a chore.
  const willBeAssignedChore = editingHabit
    ? !!(showAssignControl ? editAssignedUid : editingHabit.assignedTo)
    : showAssignControl && assignedKidUids.length >= 1;
  const showCreditControl = !willBeAssignedChore;

  const handleSave = async () => {
    if (!title || !basePoints || !targetCount || isSaving) return;

    // Enforce non-empty category
    const finalCategory = category.trim() || CATEGORIES[0] || 'Health';

    // Habit Automations (PRD #1065): rebuild `triggers` from the live-edited
    // keyword/location state (mirrors HabitCreatorWizard.handleSaveCustom).
    // `undefined` when nothing is configured — and when EDITING the key is
    // ALWAYS set on the payload below (even when undefined) so a full clear
    // routes through updateHabit's hasOwnProperty presence check → deleteField.
    const cleanedKeywords = keywords.map(k => k.trim()).filter(Boolean);
    const triggers: Habit['triggers'] =
      cleanedKeywords.length > 0 || locations.length > 0 || noSpend !== undefined
        ? {
            ...(cleanedKeywords.length > 0 ? { keywords: cleanedKeywords } : {}),
            ...(locations.length > 0 ? { locations } : {}),
            ...(noSpend !== undefined ? { noSpend } : {}),
          }
        : undefined;

    const baseHabitData: Habit = {
      // Spread the existing habit FIRST when editing so every field this form
      // doesn't surface (triggers automations, presetId, isCustom,
      // effortLevel, frozenDates, assignedTo when the control is hidden,
      // createdBy, etc.) carries forward untouched instead of silently
      // reverting/dropping on an ordinary edit — updateHabit only writes its
      // own whitelist plus an explicit `triggers`, so re-supplying the
      // existing value leaves automations untouched. The explicit fields
      // below override only what this form actually edits. In CREATE mode
      // editingHabit is undefined, so this spread is a no-op.
      ...(editingHabit ?? {}),
      id: editingHabit ? editingHabit.id : crypto.randomUUID(),
      title,
      category: finalCategory,
      type,
      scoringType,
      period,
      // Sign is conveyed entirely by `type` (see habitSign/signedHabitPoints in
      // utils/habitLogic.ts) — basePoints is always stored as a positive
      // magnitude so this form never re-introduces the "opposite convention"
      // that HabitCreatorWizard historically used (negative basePoints on a
      // negative-type habit). Math.abs guards a user typing a negative number
      // even though the input also carries `min="0"`.
      basePoints: Math.abs(parseInt(basePoints)),
      targetCount: parseInt(targetCount),
      // Preserve or Init State
      count: editingHabit ? editingHabit.count : 0,
      totalCount: editingHabit ? editingHabit.totalCount : 0,
      completedDates: editingHabit ? editingHabit.completedDates : [],
      streakDays: editingHabit ? editingHabit.streakDays : 0,
      lastUpdated: new Date().toISOString(),
      // Preserve ownership fields when editing
      isShared: editingHabit?.isShared,
      ownerId: editingHabit?.ownerId,
      // A hand-authored habit is by definition custom — it carries no
      // `presetId` — and the habit manager's "Your Custom Habits" list is
      // `habits.filter(h => h.isCustom)`, so a habit created here would
      // otherwise vanish from the very list it was created from. EDIT never
      // touches the flag: the `...editingHabit` spread above carries the
      // stored value forward (a preset-derived habit stays `isCustom: false`).
      ...(editingHabit ? {} : { isCustom: true }),
      // Habit Automations (PRD #1065): when EDITING, always set `triggers` from
      // the live form state (overriding the spread-forward stored copy). The key
      // is present even when the value is `undefined` — a full clear must reach
      // updateHabit's presence check to deleteField(). When CREATING, omit the
      // key entirely (addHabit's addDoc rejects an explicit `undefined` value;
      // the automations UI isn't shown in create mode anyway).
      ...(editingHabit ? { triggers } : {}),
      // Household credit mode. EDIT always writes an EXPLICIT value so the
      // stored field can never disagree with what this form showed — flipping
      // back to 'members' sticks (updateHabit's whitelist drops `undefined`, not
      // an explicit value).
      //
      // 🛡️ WHEN THE SAVE PRODUCES A CHORE, THE WRITTEN VALUE IS 'members' — not
      // the stored one the `...editingHabit` spread carried in. The control is
      // hidden for a chore because `creditMode` is inert there (its points
      // bypass the pool), so letting a stale 'household' ride along persisted a
      // setting the user could neither see nor have chosen. Un-assigning the kid
      // later then re-opened the control pre-set to "Household" and saved it
      // again, turning a plain un-assign into a habit that credits nobody.
      //
      // CREATE omits the key unless it is actually 'household': addDoc rejects
      // an explicit `undefined`, and a brand-new habit has no stale value to
      // correct.
      ...(editingHabit
        ? { creditMode: showCreditControl ? creditMode : ('members' as const) }
        : showCreditControl && creditMode === 'household'
          ? { creditMode }
          : {}),
    };

    setIsSaving(true);
    try {
      if (editingHabit) {
        // EDIT: only let the assign control influence assignedTo when it's shown.
        // When hidden, omit assignedTo entirely so an existing chore keeps its
        // current assignment untouched (dormant — matches pre-080c behavior).
        const updatePayload: Habit = showAssignControl
          ? { ...baseHabitData, assignedTo: editAssignedUid }
          : baseHabitData;
        await updateHabit(updatePayload);
        // F-HABITS-01: persist pause changes via the dedicated mutation (a clear
        // needs deleteField, which updateHabit's whitelist can't express). Only
        // write when it actually changed so an unrelated edit doesn't touch it.
        const originalPause = editingHabit.pausedUntil ?? '';
        if (pausedUntil !== originalPause) {
          await setHabitPause(editingHabit.id, pausedUntil || null);
        }
        // F-HABITS-03: same "only write when it actually changed" rule. Days are
        // kept sorted by the editor, so a structural compare is stable here.
        const originalReminder = getHabitReminder(
          currentUser?.notificationPreferences,
          editingHabit.id,
        );
        if (JSON.stringify(originalReminder) !== JSON.stringify(reminder)) {
          await persistReminder(editingHabit.id);
        }
      } else if (showAssignControl && assignedKidUids.length >= 1) {
        // CREATE + at least one kid selected: spawn one chore per kid. Each is a
        // per-kid chore (assignedTo set, isShared:false), not a shared household
        // habit. basePoints is the chore's point value. Distinct ids per chore.
        await Promise.all(
          assignedKidUids.map(uid =>
            addHabit({
              ...baseHabitData,
              id: crypto.randomUUID(),
              assignedTo: uid,
              isShared: false,
            }),
          ),
        );
      } else {
        // CREATE, no kid selected (or control hidden): exactly today's behavior.
        await addHabit(baseHabitData);
      }
      onClose();
    } catch (error) {
      console.error('[HabitFormModal] Save failed:', error);
      // Error toast is handled by updateHabit/addHabit
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={isSaving ? () => {} : onClose}
      title={editingHabit ? 'Edit Habit' : 'New Habit'}
      noPadding={true}
      footer={
        <div className="bg-white dark:bg-brand-800 border-t border-brand-200 dark:border-brand-700 p-4">
          <Button
            type="button"
            variant="warning"
            size="lg"
            onClick={handleSave}
            isLoading={isSaving}
            className="w-full"
          >
            {editingHabit ? 'Save Changes' : 'Create Habit'}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">

        {/* Title */}
        <Input
          label="Title"
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Drink Water"
          disabled={isSaving}
        />

        {/* Type & Category */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <span className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase" id="habit-category-label">Category</span>
            <div className="flex flex-wrap gap-1.5 mt-2" role="group" aria-labelledby="habit-category-label">
              {mergedCategories.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  disabled={isSaving}
                  aria-pressed={category === c}
                  className={`text-xxs px-2 py-1 rounded-lg border transition-all ${
                    category === c
                      ? 'bg-brand-200 dark:bg-brand-700 border-brand-300 dark:border-brand-600 text-brand-800 dark:text-brand-100 font-bold'
                      : 'bg-white dark:bg-brand-800 border-brand-200 dark:border-brand-700 text-brand-400 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-700/50'
                  }`}
                >
                  {c}
                </button>
              ))}
              {!isAddingCategory && (
                <button
                  type="button"
                  onClick={() => setIsAddingCategory(true)}
                  disabled={isSaving}
                  aria-label="Add a category"
                  className="text-xxs px-2 py-1 rounded-lg border border-dashed border-brand-300 dark:border-brand-600 text-brand-500 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700/50 transition-all disabled:opacity-50"
                >
                  + Add
                </button>
              )}
            </div>
            {isAddingCategory && (
              <div className="flex items-center gap-1.5 mt-2">
                <input
                  type="text"
                  value={newCategoryDraft}
                  onChange={e => setNewCategoryDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void confirmAddCategory();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelAddCategory();
                    }
                  }}
                  placeholder="New category"
                  aria-label="New category name"
                  autoFocus
                  disabled={isSaving || isAddingCategoryBusy}
                  className="flex-1 min-w-0 p-2 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-lg text-sm disabled:opacity-50"
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => void confirmAddCategory()}
                  disabled={isSaving || isAddingCategoryBusy}
                  aria-label="Confirm new category"
                >
                  Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={cancelAddCategory}
                  disabled={isSaving || isAddingCategoryBusy}
                  aria-label="Cancel adding category"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
          <div>
            <span className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">Type</span>
            <SegmentedControl
              tone="warm"
              name="Habit type"
              disabled={isSaving}
              value={type}
              onChange={setType}
              options={[
                { value: 'positive', label: 'Good', activeClassName: 'text-money-pos dark:text-money-posDark' },
                { value: 'negative', label: 'Bad', activeClassName: 'text-money-neg dark:text-money-negDark' },
              ]}
              className="mt-1"
            />
          </div>
        </div>

        {/* Assign to kid (Plan 080c-3) — dormant unless Kid Mode is on AND there is
            at least one managed kid. CREATE = multi-select; EDIT = single-select. */}
        {showAssignControl && (
          <div>
            <span className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase" id="assign-kid-label">
              {editingHabit ? 'Assign to kid' : 'Assign to kid(s)'}
            </span>
            <p className="text-xxs text-brand-400 dark:text-brand-400 mt-0.5 mb-2">
              {editingHabit
                ? 'A chore shows on that kid’s dashboard and credits their points.'
                : 'Creates one chore per selected kid, each crediting that kid’s points.'}
            </p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="assign-kid-label">
              {managedKids.map(kid => {
                const selected = editingHabit
                  ? editAssignedUid === kid.uid
                  : assignedKidUids.includes(kid.uid);
                return (
                  <button
                    key={kid.uid}
                    type="button"
                    onClick={() => (editingHabit ? selectEditKid(kid.uid) : toggleKidSelection(kid.uid))}
                    disabled={isSaving}
                    aria-pressed={selected}
                    className={`text-xs px-3 py-1.5 rounded-btn border font-bold transition-colors duration-(--duration-fast) ease-(--ease-standard) disabled:opacity-50 ${
                      selected
                        ? 'bg-warm-500 border-warm-500 text-white'
                        : 'bg-white dark:bg-brand-800 border-warm-200 dark:border-warm-800/60 text-warm-700 dark:text-warm-300 hover:bg-warm-100 dark:hover:bg-warm-900/30'
                    }`}
                  >
                    {kid.displayName}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Household credit mode — who a completion credits. Hidden entirely for
            an assigned chore, whose points already route to the assignee. */}
        {showCreditControl && (
          <div>
            <span className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">
              Credit
            </span>
            <p className="text-xxs text-brand-400 dark:text-brand-400 mt-0.5 mb-2">
              Household habits award the household total. Nobody earns individual points.
            </p>
            <SegmentedControl
              tone="warm"
              name="Credit"
              disabled={isSaving}
              value={creditMode}
              onChange={setCreditMode}
              options={[
                { value: 'members', label: 'Individuals' },
                { value: 'household', label: 'Household' },
              ]}
            />
          </div>
        )}

        {/* Scoring Logic */}
        <div>
          <h3 className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase mb-3">Scoring Strategy</h3>

          <SegmentedControl
            tone="warm"
            name="Scoring strategy"
            disabled={isSaving}
            value={scoringType}
            onChange={setScoringType}
            className="mb-4"
            options={[
              {
                value: 'incremental',
                label: (
                  <span className="block text-left text-xs">
                    <span className="block font-bold mb-1">Incremental</span>
                    <span className="text-brand-400 dark:text-brand-400">Points for every tap.</span>
                  </span>
                ),
              },
              {
                value: 'threshold',
                label: (
                  <span className="block text-left text-xs">
                    <span className="block font-bold mb-1">Threshold</span>
                    <span className="text-brand-400 dark:text-brand-400">Points only when target met.</span>
                  </span>
                ),
              },
            ]}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Input
                label={showAssignControl ? 'Chore Points (magnitude)' : 'Points (magnitude)'}
                type="number"
                inputMode="numeric"
                min="0"
                value={basePoints}
                onChange={e => setBasePoints(e.target.value)}
                className="text-center font-mono font-bold"
                disabled={isSaving}
              />
              <p className="text-xxs text-brand-400 dark:text-brand-400 mt-1">
                Always a positive number — the Good/Bad type above sets the direction.
              </p>
            </div>
            <div>
              <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase" htmlFor="habit-target">Target ({period})</label>
              <div className="flex items-center gap-2 mt-1">
                 <input
                  id="habit-target"
                  type="number"
                  inputMode="numeric"
                  value={targetCount}
                  onChange={e => setTargetCount(e.target.value)}
                  className="w-20 p-2 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-lg text-center font-mono font-bold"
                  disabled={isSaving}
                />
                <SegmentedControl
                  tone="warm"
                  name="Target period"
                  disabled={isSaving}
                  value={period}
                  onChange={setPeriod}
                  className="flex-1"
                  options={[
                    { value: 'daily', label: 'Daily' },
                    { value: 'weekly', label: 'Weekly' },
                  ]}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Pause / vacation mode (F-HABITS-01) — edit mode only. A planned break
            skips the auto-reset penalty and freeze-token use; the streak bridges
            the gap and resumes when the break ends. */}
        {editingHabit && (
          <div>
            <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase" htmlFor="habit-pause-until">
              Pause until
            </label>
            <p className="text-xxs text-brand-400 dark:text-brand-400 mt-0.5 mb-2">
              Planned break (vacation, injury). The streak is protected and resumes cleanly — no freeze tokens used.
            </p>
            <div className="flex items-center gap-2">
              <input
                id="habit-pause-until"
                type="date"
                value={pausedUntil}
                min={getLocalDateString()}
                onChange={e => setPausedUntil(e.target.value)}
                disabled={isSaving}
                className="flex-1 p-2 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-lg font-mono text-sm disabled:opacity-50"
              />
              {pausedUntil && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPausedUntil('')}
                  disabled={isSaving}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Per-habit reminder (F-HABITS-03) — edit mode only, since the config is
            keyed by habit id and a habit being created doesn't have one yet.
            Stored on the member doc, so it saves separately from the habit. */}
        {editingHabit && (
          <HabitReminderEditor
            value={reminder}
            onChange={setReminder}
            period={period}
            disabled={isSaving}
          />
        )}

        {/* Habit Automations (PRD #1065) — edit mode only. Collapsed by default
            to keep the modal uncluttered; expands to the same keyword/location/
            linked-to-do controls the wizard's custom-habit editor shows, now
            reachable for EVERY habit (preset or custom) via the habit card. */}
        {editingHabit && (
          <HabitAutomationsSection
            keywords={keywords}
            onKeywordsChange={setKeywords}
            locations={locations}
            onLocationsChange={setLocations}
            noSpend={noSpend}
            onNoSpendChange={setNoSpend}
            linkedTodos={linkedTodos}
            collapsible
          />
        )}

      </div>
    </Drawer>
  );
};

export default HabitFormModal;
