import React, { useMemo, useState } from 'react';
import { Habit, HabitLocationTrigger } from '@/types/schema';
import { useGamification, useHouseholdCore, useTodos } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import Input from '@/components/ui/Input';
import HabitAutomationsSection from '@/components/habits/HabitAutomationsSection';
import { getLocalDateString } from '@/utils/dateHelpers';

interface HabitFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingHabit?: Habit;
}

const CATEGORIES = ['Health', 'Finance', 'Personal', 'Home', 'Work'];

const HabitFormModal: React.FC<HabitFormModalProps> = ({ isOpen, onClose, editingHabit }) => {
  const { addHabit, updateHabit, setHabitPause, habitCategories, updateHabitCategories } = useGamification();
  const { members } = useHouseholdCore();
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

  // Form State — lazy initializers so the first render is already populated for
  // the edit case; the defaults match the reset branch below for the new case.
  const [title, setTitle] = useState(() => editingHabit?.title ?? '');
  const [category, setCategory] = useState<string>(() => editingHabit?.category ?? (CATEGORIES[0] ?? 'Health'));
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

  // Kid assignment selection. CREATE mode is a multi-select (one chore per kid);
  // EDIT mode is a single-select (0 or 1 kid). We keep both states and read only
  // the relevant one at save time, so neither leaks into the other mode.
  const [assignedKidUids, setAssignedKidUids] = useState<string[]>([]);
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
      setCategory(editingHabit.category);
      setType(editingHabit.type);
      setScoringType(editingHabit.scoringType || 'threshold');
      setPeriod(editingHabit.period);
      setBasePoints(editingHabit.basePoints.toString());
      setTargetCount(editingHabit.targetCount.toString());
      setPausedUntil(editingHabit.pausedUntil ?? '');
      setKeywords(editingHabit.triggers?.keywords ?? []);
      setLocations(editingHabit.triggers?.locations ?? []);
      setEditAssignedUid(seedEditAssignedUid(editingHabit));
      setAssignedKidUids([]);
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
      setEditAssignedUid(undefined);
      setAssignedKidUids([]);
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
    if (isSaving) return;
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
    try {
      await updateHabitCategories([...habitCategories, trimmed]);
      setCategory(trimmed);
    } catch (error) {
      console.error('[HabitFormModal] Add category failed:', error);
      // Error toast is handled by updateHabitCategories.
    } finally {
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
      cleanedKeywords.length > 0 || locations.length > 0
        ? {
            ...(cleanedKeywords.length > 0 ? { keywords: cleanedKeywords } : {}),
            ...(locations.length > 0 ? { locations } : {}),
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
      basePoints: parseInt(basePoints),
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
      // Habit Automations (PRD #1065): when EDITING, always set `triggers` from
      // the live form state (overriding the spread-forward stored copy). The key
      // is present even when the value is `undefined` — a full clear must reach
      // updateHabit's presence check to deleteField(). When CREATING, omit the
      // key entirely (addHabit's addDoc rejects an explicit `undefined` value;
      // the automations UI isn't shown in create mode anyway).
      ...(editingHabit ? { triggers } : {}),
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
                  disabled={isSaving}
                  className="flex-1 min-w-0 p-2 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-lg text-sm disabled:opacity-50"
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => void confirmAddCategory()}
                  disabled={isSaving}
                  aria-label="Confirm new category"
                >
                  Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={cancelAddCategory}
                  disabled={isSaving}
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
            <Input
              label={showAssignControl ? 'Chore Points' : 'Points'}
              type="number"
              inputMode="numeric"
              value={basePoints}
              onChange={e => setBasePoints(e.target.value)}
              className="text-center font-mono font-bold"
              disabled={isSaving}
            />
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
            linkedTodos={linkedTodos}
            collapsible
          />
        )}

      </div>
    </Drawer>
  );
};

export default HabitFormModal;
