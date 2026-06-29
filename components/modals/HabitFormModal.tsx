import React, { useMemo, useState } from 'react';
import { Habit } from '@/types/schema';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';

interface HabitFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingHabit?: Habit;
}

const CATEGORIES = ['Health', 'Finance', 'Personal', 'Home', 'Work'];

const HabitFormModal: React.FC<HabitFormModalProps> = ({ isOpen, onClose, editingHabit }) => {
  const { addHabit, updateHabit } = useGamification();
  const { members } = useHouseholdCore();
  const kidModeEnabled = useKidModeEnabled();

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

  // Re-populate (or reset to defaults) the form when the habit being edited or
  // the open state changes. Done during render on that change edge rather than
  // in an effect so it doesn't trigger a cascading render. Mirrors the previous
  // effect keyed on `[editingHabit, isOpen]`; the initial population is handled
  // by the initializers above.
  const [prevKey, setPrevKey] = useState({ editingHabit, isOpen });
  if (prevKey.editingHabit !== editingHabit || prevKey.isOpen !== isOpen) {
    setPrevKey({ editingHabit, isOpen });
    if (editingHabit) {
      setTitle(editingHabit.title);
      setCategory(editingHabit.category);
      setType(editingHabit.type);
      setScoringType(editingHabit.scoringType || 'threshold');
      setPeriod(editingHabit.period);
      setBasePoints(editingHabit.basePoints.toString());
      setTargetCount(editingHabit.targetCount.toString());
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
      setEditAssignedUid(undefined);
      setAssignedKidUids([]);
    }
  }

  const [isSaving, setIsSaving] = useState(false);

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

    const baseHabitData: Habit = {
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
      weatherSensitive: editingHabit ? editingHabit.weatherSensitive : false,
      // Preserve ownership fields when editing
      isShared: editingHabit?.isShared,
      ownerId: editingHabit?.ownerId,
      telegramAlias: editingHabit?.telegramAlias,
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
            <Input
              label="Category"
              type="text"
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder="Select or type..."
              disabled={isSaving}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {CATEGORIES.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  disabled={isSaving}
                  className={`text-xxs px-2 py-1 rounded-lg border transition-all ${
                    category === c
                      ? 'bg-brand-200 dark:bg-brand-700 border-brand-300 dark:border-brand-600 text-brand-800 dark:text-brand-100 font-bold'
                      : 'bg-white dark:bg-brand-800 border-brand-200 dark:border-brand-700 text-brand-400 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-700/50'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div role="group" aria-label="Habit type">
            <span className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">Type</span>
            <div className="flex bg-brand-50 dark:bg-brand-700/50 p-1 rounded-xl mt-1">
               <button
                 onClick={() => setType('positive')}
                 disabled={isSaving}
                 type="button"
                 aria-pressed={type === 'positive'}
                 className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ${type === 'positive' ? 'bg-white dark:bg-brand-800 shadow-xs text-money-pos' : 'text-brand-400 dark:text-brand-400'}`}
               >Good</button>
               <button
                 onClick={() => setType('negative')}
                 disabled={isSaving}
                 type="button"
                 aria-pressed={type === 'negative'}
                 className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ${type === 'negative' ? 'bg-white dark:bg-brand-800 shadow-xs text-money-neg' : 'text-brand-400 dark:text-brand-400'}`}
               >Bad</button>
             </div>
          </div>
        </div>

        {/* Assign to kid (Plan 080c-3) — dormant unless Kid Mode is on AND there is
            at least one managed kid. CREATE = multi-select; EDIT = single-select. */}
        {showAssignControl && (
          <div className="bg-warm-50 dark:bg-warm-900/20 p-4 rounded-xl border border-warm-200 dark:border-warm-800/60">
            <span className="text-xs font-bold text-warm-700 dark:text-warm-300 uppercase" id="assign-kid-label">
              {editingHabit ? 'Assign to kid' : 'Assign to kid(s)'}
            </span>
            <p className="text-xxs text-warm-600/80 dark:text-warm-300/70 mt-0.5 mb-2">
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
        <div className="bg-brand-50 dark:bg-brand-700/50 p-4 rounded-xl border border-brand-200 dark:border-brand-700">
          <h3 className="text-sm font-bold text-brand-700 dark:text-brand-200 mb-3">Scoring Strategy</h3>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              onClick={() => setScoringType('incremental')}
              disabled={isSaving}
              type="button"
              aria-pressed={scoringType === 'incremental'}
              className={`p-3 rounded-xl border text-left text-xs transition-all disabled:opacity-50 ${scoringType === 'incremental' ? 'bg-white dark:bg-brand-800 border-brand-300 dark:border-brand-600 shadow-xs ring-1 ring-brand-200' : 'border-transparent hover:bg-brand-50 dark:hover:bg-brand-700/50'}`}
            >
              <span className="block font-bold mb-1">Incremental</span>
              <span className="text-brand-400 dark:text-brand-400">Points for every tap.</span>
            </button>
            <button
              onClick={() => setScoringType('threshold')}
              disabled={isSaving}
              type="button"
              aria-pressed={scoringType === 'threshold'}
              className={`p-3 rounded-xl border text-left text-xs transition-all disabled:opacity-50 ${scoringType === 'threshold' ? 'bg-white dark:bg-brand-800 border-brand-300 dark:border-brand-600 shadow-xs ring-1 ring-brand-200' : 'border-transparent hover:bg-brand-50 dark:hover:bg-brand-700/50'}`}
            >
              <span className="block font-bold mb-1">Threshold</span>
              <span className="text-brand-400 dark:text-brand-400">Points only when target met.</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={showAssignControl ? 'Chore Points' : 'Points'}
              type="number"
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
                  value={targetCount}
                  onChange={e => setTargetCount(e.target.value)}
                  className="w-20 p-2 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-lg text-center font-mono font-bold"
                  disabled={isSaving}
                />
                <button
                  onClick={() => setPeriod(period === 'daily' ? 'weekly' : 'daily')}
                  disabled={isSaving}
                  type="button"
                  aria-pressed={period === 'weekly'}
                  className="text-xxs font-bold uppercase bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 px-2 py-2.5 rounded-lg min-w-[60px] disabled:opacity-50"
                >
                  {period}
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>

      <div className="sticky bottom-0 bg-white dark:bg-brand-800 border-t border-brand-200 dark:border-brand-700 p-4">
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
    </Drawer>
  );
};

export default HabitFormModal;
