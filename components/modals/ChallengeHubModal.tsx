
import React, { useState } from 'react';
import { Check, Plus, Users } from 'lucide-react';
import { Challenge, CreateChallengePayload } from '@/types/schema';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { format, parseISO, subDays } from 'date-fns';
import YearlyGoalFormModal from './YearlyGoalFormModal';
import { Drawer } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Section, SurfaceList, Row } from '@/components/ui/Section';

interface ChallengeHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: CreateChallengePayload | null;
}

type TabType = 'challenge' | 'yearly' | 'freeze';

// TODO(redesign-IA): this modal is kept (not dissolved into Habits → Challenges)
// because it owns the heavier MUTATION flows — create/edit a challenge, the
// freeze-token spend flow, family-challenge creation, yearly-goal forms — plus
// the cross-screen "create challenge from an insight" entry point on the
// Dashboard (`initialData`). The Challenges tab reproduces the read surfaces and
// opens this for those flows. It has been restyled to the editorial-finance
// language; fully dissolving the mutation wiring is a later pass.
const ChallengeHubModal: React.FC<ChallengeHubModalProps> = ({ isOpen, onClose, initialData }) => {
  const {
    activeChallenge,
    habits,
    addHabit,
    addChallenge,
    updateChallenge,
    yearlyGoals,
    activeYearlyGoals,
    freezeBank,
    useFreezeBankToken: consumeFreezeBankToken,
  } = useGamification();

  // Plan 080e — the "New family challenge" creation affordance below is DORMANT:
  // it only renders while Kid Mode is on. With it off, this modal behaves exactly
  // as before (display/edit of the active challenge only).
  const kidModeEnabled = useKidModeEnabled();

  const [activeTab, setActiveTab] = useState<TabType>('challenge');
  const [isYearlyGoalFormOpen, setIsYearlyGoalFormOpen] = useState(false);

  // Family-challenge creation form state (separate from the edit form below so
  // the existing challenge display/edit path is untouched).
  const [showFamilyForm, setShowFamilyForm] = useState(false);
  const [familyTitle, setFamilyTitle] = useState('');
  const [familyDescription, setFamilyDescription] = useState('');
  const [familyTarget, setFamilyTarget] = useState('');
  const [familyHabitIds, setFamilyHabitIds] = useState<string[]>([]);
  const [savingFamily, setSavingFamily] = useState(false);

  // Challenge Tab State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetType, setTargetType] = useState<'count' | 'percentage'>('count');
  const [targetValue, setTargetValue] = useState(100);
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>([]);
  const [selectedYearlyGoalId, setSelectedYearlyGoalId] = useState<string>('');

  // New state for implicit habit creation
  const [suggestedHabit, setSuggestedHabit] = useState<CreateChallengePayload['suggestedHabit'] | null>(null);

  // Freeze Bank Tab State
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedHabitForFreeze, setSelectedHabitForFreeze] = useState<string | null>(null);

  // Populate the challenge form from initial data, the active challenge, or
  // reset to blanks. Done during render on the change edge of those inputs
  // rather than in an effect so it doesn't trigger a cascading render. The
  // tracker starts null so this also runs on the first render, mirroring the
  // previous effect (keyed on `[activeChallenge, isOpen, initialData]`) which
  // ran on mount and on every change.
  const [prevKey, setPrevKey] = useState<{
    activeChallenge: typeof activeChallenge;
    isOpen: boolean;
    initialData: typeof initialData;
  } | null>(null);
  if (
    prevKey === null ||
    prevKey.activeChallenge !== activeChallenge ||
    prevKey.isOpen !== isOpen ||
    prevKey.initialData !== initialData
  ) {
    setPrevKey({ activeChallenge, isOpen, initialData });
    if (initialData) {
      setTitle(initialData.title);
      setDescription(initialData.description || '');
      setTargetType(initialData.targetType);
      setTargetValue(initialData.targetValue);

      if (initialData.relatedHabitId) {
           setSelectedHabitIds([initialData.relatedHabitId]);
           setSuggestedHabit(null);
      } else if (initialData.suggestedHabit) {
           setSuggestedHabit(initialData.suggestedHabit);
           setSelectedHabitIds(['suggested-habit']); // Use placeholder ID
      } else {
           setSelectedHabitIds([]);
           setSuggestedHabit(null);
      }
      // Reset yearly goal for new challenge suggestions
      setSelectedYearlyGoalId('');
    } else if (activeChallenge) {
      setTitle(activeChallenge.title);
      setDescription(activeChallenge.description || '');
      setTargetType(activeChallenge.targetType || 'count');
      setTargetValue(activeChallenge.targetValue || activeChallenge.targetTotalCount || 100);
      setSelectedHabitIds(activeChallenge.relatedHabitIds || []);
      setSelectedYearlyGoalId(activeChallenge.yearlyGoalId || '');
      setSuggestedHabit(null);
    } else {
      // Reset if no active challenge and no initial data
      setTitle('');
      setDescription('');
      setTargetType('count');
      setTargetValue(100);
      setSelectedHabitIds([]);
      setSuggestedHabit(null);
      setSelectedYearlyGoalId('');
    }
  }

  const toggleHabitSelection = (habitId: string) => {
    setSelectedHabitIds((prev) =>
      prev.includes(habitId) ? prev.filter((id) => id !== habitId) : [...prev, habitId]
    );
  };

  const handleSaveChallenge = async () => {
    if (!title) return;

    let finalRelatedHabitIds = [...selectedHabitIds];

    // Handle suggested habit creation
    if (suggestedHabit && finalRelatedHabitIds.includes('suggested-habit')) {
        try {
            // Remove placeholder
            finalRelatedHabitIds = finalRelatedHabitIds.filter(id => id !== 'suggested-habit');

            const newHabitId = await addHabit({
                id: '', // Generated
                title: suggestedHabit.title,
                category: suggestedHabit.category,
                type: suggestedHabit.type || 'positive',
                period: suggestedHabit.period || 'daily',
                basePoints: 10,
                scoringType: 'threshold',
                targetCount: 1,
                count: 0,
                totalCount: 0,
                completedDates: [],
                streakDays: 0,
                lastUpdated: new Date().toISOString()
            });

            if (newHabitId && typeof newHabitId === 'string') {
                finalRelatedHabitIds.push(newHabitId);
            }
        } catch (e) {
            console.error("Failed to create suggested habit", e);
            return; // Stop if habit creation failed
        }
    }

    const updatedChallenge: Challenge = activeChallenge && !initialData
      ? {
          ...activeChallenge,
          title,
          description,
          targetType,
          targetValue,
          relatedHabitIds: finalRelatedHabitIds,
          yearlyGoalId: selectedYearlyGoalId || undefined,
        }
      : {
          id: 'new', // Placeholder ID, ignored by addDoc
          month: format(new Date(), 'yyyy-MM'),
          status: 'active',
          title,
          description,
          targetType,
          targetValue,
          relatedHabitIds: finalRelatedHabitIds,
          yearlyGoalId: selectedYearlyGoalId || undefined,
          yearlyRewardLabel: 'Badge', // Default reward
        };

    await updateChallenge(updatedChallenge);
    onClose();
  };

  const toggleFamilyHabit = (habitId: string) => {
    setFamilyHabitIds((prev) =>
      prev.includes(habitId) ? prev.filter((id) => id !== habitId) : [...prev, habitId]
    );
  };

  const resetFamilyForm = () => {
    setFamilyTitle('');
    setFamilyDescription('');
    setFamilyTarget('');
    setFamilyHabitIds([]);
    setShowFamilyForm(false);
  };

  const handleCreateFamilyChallenge = async () => {
    const title = familyTitle.trim();
    if (!title || savingFamily) return;

    const parsedTarget = parseInt(familyTarget, 10);
    setSavingFamily(true);
    try {
      await addChallenge({
        title,
        description: familyDescription.trim() || undefined,
        relatedHabitIds: familyHabitIds,
        targetValue: Number.isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : undefined,
      });
      resetFamilyForm();
    } catch {
      // addChallenge surfaces its own error toast.
    } finally {
      setSavingFamily(false);
    }
  };

  const handleUseFreeze = async () => {
    if (!selectedDate || !selectedHabitForFreeze) return;

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    await consumeFreezeBankToken(selectedHabitForFreeze, dateStr);

    // Reset selections
    setSelectedDate(null);
    setSelectedHabitForFreeze(null);
  };

  if (!isOpen) return null;

  const selectedYearlyGoal = yearlyGoals.find((g) => g.id === selectedYearlyGoalId);
  const displayYearlyGoal = selectedYearlyGoal || activeYearlyGoals[0] || null;

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="Challenge Hub"
        noPadding={true}
      >
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="flex flex-col h-full overflow-hidden">
          {/* Tab Navigation */}
          <div className="px-4 pt-4 shrink-0">
            <TabsList>
              <TabsTrigger value="challenge">Challenge</TabsTrigger>
              <TabsTrigger value="yearly">Yearly Goal</TabsTrigger>
              <TabsTrigger value="freeze">Freeze Bank</TabsTrigger>
            </TabsList>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 scroll-contain-y p-6">
              {/* Challenge Tab */}
              <TabsContent value="challenge" className="space-y-4">
                {/* Plan 080e — DORMANT "New family challenge" creation affordance.
                    Only rendered when Kid Mode is on; warm-amber kid-surface accents.
                    Leaves the existing edit form (below) untouched when off. */}
                {kidModeEnabled && (
                  <div>
                    {!showFamilyForm ? (
                      <Button
                        type="button"
                        variant="warning"
                        size="lg"
                        onClick={() => setShowFamilyForm(true)}
                        leftIcon={<Users size={18} />}
                        className="w-full"
                      >
                        New family challenge
                      </Button>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Users size={18} className="text-warm-500" />
                          <h3 className="text-sm font-bold text-warm-700 dark:text-warm-200">
                            New family challenge
                          </h3>
                        </div>

                        {/* Title */}
                        <Input
                          label="Title"
                          type="text"
                          value={familyTitle}
                          onChange={(e) => setFamilyTitle(e.target.value)}
                          placeholder="e.g., Family Fitness Month"
                        />

                        {/* Description */}
                        <div>
                          <label className="text-xxs font-bold text-warm-500 dark:text-warm-300 uppercase">
                            Description (Optional)
                          </label>
                          <textarea
                            value={familyDescription}
                            onChange={(e) => setFamilyDescription(e.target.value)}
                            placeholder="What is the whole family working toward?"
                            className="w-full mt-1 p-3 bg-white dark:bg-brand-800 border border-warm-200 dark:border-warm-500/40 rounded-xl resize-none h-16 focus:border-warm-400 outline-hidden text-brand-900 dark:text-white"
                          />
                        </div>

                        {/* Optional Target */}
                        <Input
                          label="Target completions (Optional)"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={familyTarget}
                          onChange={(e) => setFamilyTarget(e.target.value)}
                          placeholder="e.g., 60"
                        />

                        {/* Habit multi-select */}
                        <div>
                          <label className="text-xxs font-bold text-warm-500 dark:text-warm-300 uppercase mb-2 block">
                            Linked habits
                          </label>
                          {habits.length === 0 ? (
                            <p className="text-xs text-warm-500 dark:text-warm-300">
                              Add a habit first to link it to a challenge.
                            </p>
                          ) : (
                            <div className="max-h-44 overflow-y-auto scroll-contain-y">
                              <SurfaceList>
                                {habits.map((habit) => {
                                  const isSelected = familyHabitIds.includes(habit.id);
                                  return (
                                    <button
                                      key={habit.id}
                                      type="button"
                                      onClick={() => toggleFamilyHabit(habit.id)}
                                      aria-pressed={isSelected}
                                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left hairline-divider transition-colors duration-(--duration-fast) ease-(--ease-standard) ${
                                        isSelected
                                          ? 'bg-warm-50 dark:bg-warm-900/20'
                                          : 'hover:bg-warm-50/60 dark:hover:bg-warm-900/10'
                                      }`}
                                    >
                                      <span
                                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                                          isSelected
                                            ? 'bg-warm-500 text-white'
                                            : 'border border-warm-300 dark:border-warm-500/50 bg-white dark:bg-brand-800'
                                        }`}
                                      >
                                        {isSelected && <Check size={14} strokeWidth={3} />}
                                      </span>
                                      <span className="text-sm font-medium text-brand-700 dark:text-brand-200">
                                        {habit.title}
                                      </span>
                                    </button>
                                  );
                                })}
                              </SurfaceList>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 pt-1">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={resetFamilyForm}
                            className="flex-1"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant="warning"
                            onClick={handleCreateFamilyChallenge}
                            disabled={!familyTitle.trim()}
                            isLoading={savingFamily}
                            className="flex-1"
                          >
                            Create
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Title */}
                <Input
                  label="Challenge Title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., No Spend November"
                />

                {/* Description */}
                <div>
                  <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">
                    Description (Optional)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Add details about this challenge..."
                    className="w-full mt-1 p-3 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-xl resize-none h-20 focus:border-brand-400 outline-hidden"
                  />
                </div>

                {/* Target Type */}
                <div>
                  <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase mb-2 block">
                    Target Type
                  </label>
                  <SegmentedControl
                    tone="warm"
                    name="Target type"
                    value={targetType}
                    onChange={setTargetType}
                    options={[
                      {
                        value: 'count',
                        label: (
                          <span className="block">
                            <span className="block font-bold text-brand-800 dark:text-brand-100">Count</span>
                            <span className="text-xs text-brand-400 dark:text-brand-400">Total completions</span>
                          </span>
                        ),
                      },
                      {
                        value: 'percentage',
                        label: (
                          <span className="block">
                            <span className="block font-bold text-brand-800 dark:text-brand-100">Percentage</span>
                            <span className="text-xs text-brand-400 dark:text-brand-400">% of days completed</span>
                          </span>
                        ),
                      },
                    ]}
                  />
                </div>

                {/* Target Slider */}
                <div>
                  <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase mb-2 block">
                    Target: {targetValue}
                    {targetType === 'percentage' ? '%' : ''}
                  </label>
                  <input
                    type="range"
                    min={targetType === 'percentage' ? 0 : 1}
                    max={targetType === 'percentage' ? 100 : 500}
                    value={targetValue}
                    onChange={(e) => setTargetValue(parseInt(e.target.value))}
                    className="w-full h-2 bg-brand-200 dark:bg-brand-700 rounded-lg appearance-none cursor-pointer accent-brand-600"
                  />
                  <div className="flex justify-between text-xs text-brand-400 dark:text-brand-400 mt-1">
                    <span>{targetType === 'percentage' ? '0%' : '1'}</span>
                    <span>{targetType === 'percentage' ? '100%' : '500'}</span>
                  </div>
                </div>

                {/* Yearly Goal Selector */}
                {yearlyGoals.length > 0 && (
                  <Select
                    label="Link to Yearly Goal (Optional)"
                    value={selectedYearlyGoalId}
                    onChange={(e) => setSelectedYearlyGoalId(e.target.value)}
                  >
                    <option value="">No yearly goal</option>
                    {yearlyGoals.map((goal) => (
                      <option key={goal.id} value={goal.id}>
                        {goal.title} ({goal.year})
                      </option>
                    ))}
                  </Select>
                )}

                {/* Habit Selector */}
                <Section title="Linked Habits">
                  <div className="max-h-60 overflow-y-auto scroll-contain-y">
                    <SurfaceList>
                      {/* Suggested New Habit */}
                      {suggestedHabit && (
                          <button
                            key="suggested-habit"
                            type="button"
                            onClick={() => toggleHabitSelection('suggested-habit')}
                            aria-pressed={selectedHabitIds.includes('suggested-habit')}
                            className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hairline-divider transition-colors duration-(--duration-fast) ease-(--ease-standard) ${
                              selectedHabitIds.includes('suggested-habit')
                                ? 'bg-brand-50 dark:bg-brand-700/40'
                                : 'hover:bg-brand-50 dark:hover:bg-brand-700/40'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`w-5 h-5 shrink-0 rounded flex items-center justify-center ${
                                  selectedHabitIds.includes('suggested-habit')
                                    ? 'bg-brand-800 text-white'
                                    : 'border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800'
                                }`}
                              >
                                {selectedHabitIds.includes('suggested-habit') && <Check size={14} strokeWidth={3} />}
                              </div>
                              <span className="text-sm font-medium text-brand-700 dark:text-brand-200 truncate">
                                {suggestedHabit.title} <Badge variant="neutral" size="sm" className="ml-2">NEW</Badge>
                              </span>
                            </div>
                            <Badge
                              variant={(suggestedHabit.type || 'positive') === 'positive' ? 'success' : 'danger'}
                              size="sm"
                              className="uppercase shrink-0"
                            >
                              {(suggestedHabit.type || 'positive') === 'positive' ? 'Good' : 'Bad'}
                            </Badge>
                          </button>
                      )}

                      {habits.map((habit) => {
                        const isSelected = selectedHabitIds.includes(habit.id);
                        return (
                          <button
                            key={habit.id}
                            type="button"
                            onClick={() => toggleHabitSelection(habit.id)}
                            aria-pressed={isSelected}
                            className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hairline-divider transition-colors duration-(--duration-fast) ease-(--ease-standard) ${
                              isSelected
                                ? 'bg-brand-50 dark:bg-brand-700/40'
                                : 'hover:bg-brand-50 dark:hover:bg-brand-700/40'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`w-5 h-5 shrink-0 rounded flex items-center justify-center ${
                                  isSelected
                                    ? 'bg-brand-800 text-white'
                                    : 'border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800'
                                }`}
                              >
                                {isSelected && <Check size={14} strokeWidth={3} />}
                              </div>
                              <span className="text-sm font-medium text-brand-700 dark:text-brand-200 truncate">
                                {habit.title}
                              </span>
                            </div>
                            <Badge
                              variant={habit.type === 'positive' ? 'success' : 'danger'}
                              size="sm"
                              className="uppercase shrink-0"
                            >
                              {habit.type === 'positive' ? 'Good' : 'Bad'}
                            </Badge>
                          </button>
                        );
                      })}
                    </SurfaceList>
                  </div>
                </Section>
              </TabsContent>

              {/* Yearly Goal Tab */}
              <TabsContent value="yearly" className="space-y-6">
                {displayYearlyGoal ? (
                  <>
                    {/* Goal Info */}
                    <div className="bg-warm-50 dark:bg-warm-900/15 p-5 rounded-2xl border border-warm-200 dark:border-warm-800">
                      <h3 className="text-lg font-bold text-brand-800 dark:text-brand-100 mb-1">
                        {displayYearlyGoal.title}
                      </h3>
                      {displayYearlyGoal.description && (
                        <p className="text-sm text-brand-600 dark:text-brand-300 mb-2">
                          {displayYearlyGoal.description}
                        </p>
                      )}
                      <p className="text-sm text-brand-500 dark:text-brand-400">
                        Complete {displayYearlyGoal.requiredMonths} out of 12 months
                      </p>
                    </div>

                    {/* 12-Circle Chain Progress */}
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">
                          Monthly Progress
                        </h4>
                        <span className="text-sm font-bold text-brand-800 dark:text-brand-100">
                          {displayYearlyGoal.successfulMonths.length} /{' '}
                          {displayYearlyGoal.requiredMonths}
                        </span>
                      </div>

                      {/* Circle Chain (2 rows of 6) */}
                      <div className="grid grid-cols-6 gap-3">
                        {Array.from({ length: 12 }, (_, i) => {
                          const monthIndex = i + 1;
                          const monthKey = `${displayYearlyGoal.year}-${String(
                            monthIndex
                          ).padStart(2, '0')}`;
                          const isCompleted =
                            displayYearlyGoal.successfulMonths.includes(monthKey);
                          const isCurrentMonth =
                            monthKey === format(new Date(), 'yyyy-MM');

                          return (
                            <div key={monthKey} className="flex flex-col items-center">
                              <div
                                className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                                  isCompleted
                                    ? 'bg-accent-600 text-white dark:bg-accent-500 scale-105'
                                    : isCurrentMonth
                                    ? 'bg-brand-100 dark:bg-brand-700 text-brand-600 dark:text-brand-300 ring-2 ring-warm-400'
                                    : 'bg-brand-100 dark:bg-brand-700/50 text-brand-400 dark:text-brand-450'
                                }`}
                              >
                                {isCompleted ? (
                                  <Check size={18} strokeWidth={3} />
                                ) : (
                                  monthIndex
                                )}
                              </div>
                              <span className="text-xxs text-brand-400 dark:text-brand-400 mt-1 font-medium">
                                {format(parseISO(`${monthKey}-01`), 'MMM')}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Status Message */}
                    <div
                      className={`p-4 rounded-xl border ${
                        displayYearlyGoal.successfulMonths.length >=
                        displayYearlyGoal.requiredMonths
                          ? 'bg-money-bgPos dark:bg-money-pos/15 border-money-pos/30'
                          : displayYearlyGoal.successfulMonths.length >=
                            displayYearlyGoal.requiredMonths - 2
                          ? 'bg-warm-50 dark:bg-warm-900/20 border-warm-200 dark:border-warm-800'
                          : 'bg-brand-50 dark:bg-brand-700/50 border-brand-200 dark:border-brand-700'
                      }`}
                    >
                      <p className="text-sm font-medium text-brand-700 dark:text-brand-200 text-center">
                        {displayYearlyGoal.successfulMonths.length >=
                        displayYearlyGoal.requiredMonths
                          ? '🎉 Yearly goal achieved!'
                          : `${
                              displayYearlyGoal.requiredMonths -
                              displayYearlyGoal.successfulMonths.length
                            } months remaining`}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-brand-400 dark:text-brand-400 mb-4">No yearly goal set</p>
                    <Button
                      size="lg"
                      onClick={() => setIsYearlyGoalFormOpen(true)}
                      leftIcon={<Plus size={18} />}
                      className="mx-auto"
                    >
                      Create Yearly Goal
                    </Button>
                  </div>
                )}
              </TabsContent>

              {/* Freeze Bank Tab */}
              <TabsContent value="freeze" className="space-y-6">
                {/* Token Display */}
                <div className="bg-habit-blue/10 dark:bg-habit-blue/15 p-6 rounded-2xl border border-habit-blue/30">
                  <h3 className="text-sm font-bold text-brand-400 dark:text-brand-400 uppercase mb-3">
                    Available Tokens
                  </h3>
                  <div className="flex items-center justify-center gap-3 mb-4">
                    {Array.from({ length: 3 }, (_, i) => (
                      <div
                        key={i}
                        className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
                          i < (freezeBank?.tokens || 0)
                            ? 'bg-habit-blue text-white shadow-raised scale-110'
                            : 'bg-brand-100 dark:bg-brand-700/50 text-brand-300 dark:text-brand-450'
                        }`}
                      >
                        <span className="text-2xl">❄️</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-center text-sm text-brand-600 dark:text-brand-300">
                    {freezeBank?.tokens || 0} / 3 tokens available
                  </p>
                </div>

                {/* Use Token Flow */}
                {(freezeBank?.tokens || 0) > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-brand-700 dark:text-brand-200">Use a Freeze Token</h3>

                    {/* Date Picker */}
                    <div>
                      <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase mb-2 block">
                        Select Missed Date
                      </label>
                      <div className="grid grid-cols-7 gap-2">
                        {Array.from({ length: 7 }, (_, i) => {
                          const date = subDays(new Date(), 6 - i);
                          const dateStr = format(date, 'yyyy-MM-dd');
                          const isSelected =
                            selectedDate && format(selectedDate, 'yyyy-MM-dd') === dateStr;

                          return (
                            <button
                              key={dateStr}
                              onClick={() => setSelectedDate(date)}
                              aria-pressed={!!isSelected}
                              className={`flex flex-col items-center gap-0.5 py-2.5 rounded-full transition-colors duration-(--duration-fast) ease-(--ease-standard) ${
                                isSelected
                                  ? 'bg-habit-blue text-white'
                                  : 'bg-brand-100 dark:bg-brand-700/50 text-brand-500 dark:text-brand-400 hover:bg-brand-200 dark:hover:bg-brand-700'
                              }`}
                            >
                              <span className="text-xxs font-medium opacity-80">
                                {format(date, 'EEE')}
                              </span>
                              <span className="text-sm font-bold">
                                {format(date, 'd')}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Habit Picker */}
                    {selectedDate && (
                      <div>
                        <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase mb-2 block">
                          Select Habit to Patch
                        </label>
                        <div className="max-h-48 overflow-y-auto scroll-contain-y">
                          <SurfaceList>
                            {habits
                              .filter((h) => h.type === 'positive')
                              .map((habit) => {
                                const dateStr = format(selectedDate, 'yyyy-MM-dd');
                                const alreadyCompleted = habit.completedDates.includes(dateStr);
                                const isSelected = selectedHabitForFreeze === habit.id;

                                return (
                                  <button
                                    key={habit.id}
                                    type="button"
                                    onClick={() => setSelectedHabitForFreeze(habit.id)}
                                    disabled={alreadyCompleted}
                                    aria-pressed={isSelected}
                                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hairline-divider transition-colors duration-(--duration-fast) ease-(--ease-standard) ${
                                      isSelected
                                        ? 'bg-habit-blue/10 dark:bg-habit-blue/15'
                                        : alreadyCompleted
                                        ? 'opacity-50 cursor-not-allowed'
                                        : 'hover:bg-brand-50 dark:hover:bg-brand-700/40'
                                    }`}
                                  >
                                    <span className="font-bold text-brand-700 dark:text-brand-200 text-sm">
                                      {habit.title}
                                    </span>
                                    {alreadyCompleted && (
                                      <span className="text-xs text-money-pos dark:text-money-posDark font-medium">
                                        Already completed
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                          </SurfaceList>
                        </div>
                      </div>
                    )}

                    {/* Use Token Button */}
                    {selectedDate && selectedHabitForFreeze && (
                      <button
                        onClick={handleUseFreeze}
                        className="w-full py-3 bg-habit-blue hover:brightness-95 text-white font-bold rounded-btn shadow-raised active:scale-95 transition-[transform,filter] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-habit-blue/40"
                      >
                        Use Freeze Token ❄️
                      </button>
                    )}
                  </div>
                )}

                {/* History Log */}
                <Section title="Recent History">
                  {(!freezeBank?.history || freezeBank.history.length === 0) ? (
                    <p className="text-sm text-brand-400 dark:text-brand-400 text-center py-4">No history yet</p>
                  ) : (
                    <SurfaceList>
                      {(freezeBank?.history || [])
                        .slice(-5)
                        .reverse()
                        .map((entry) => (
                          <Row key={entry.id} className="justify-between">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-brand-700 dark:text-brand-200">
                                {entry.type === 'used' ? '❄️ Token Used' : '📥 Rollover'}
                              </p>
                              <p className="text-xs text-brand-400 dark:text-brand-400 truncate">{entry.notes}</p>
                            </div>
                            <span
                              className={`shrink-0 text-sm font-bold ${
                                entry.amount > 0 ? 'text-money-pos dark:text-money-posDark' : 'text-brand-600 dark:text-brand-300'
                              }`}
                            >
                              {entry.amount > 0 ? '+' : ''}
                              {entry.amount}
                            </span>
                          </Row>
                        ))}
                    </SurfaceList>
                  )}
                </Section>
              </TabsContent>
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-brand-100 dark:border-brand-700 bg-brand-50 dark:bg-brand-700/50 shrink-0">
            {activeTab === 'challenge' && (
              <Button
                size="lg"
                onClick={handleSaveChallenge}
                disabled={!title}
                className="w-full"
              >
                Save Challenge
              </Button>
            )}
            {activeTab === 'yearly' && displayYearlyGoal && (
              <div className="text-center">
                <p className="text-xs text-brand-400 dark:text-brand-400">
                  Monthly challenges automatically update yearly progress
                </p>
              </div>
            )}
            {activeTab === 'freeze' && (
              <Button
                variant="secondary"
                size="lg"
                onClick={onClose}
                className="w-full"
              >
                Close
              </Button>
            )}
          </div>
        </Tabs>
      </Drawer>

      <YearlyGoalFormModal
        isOpen={isYearlyGoalFormOpen}
        onClose={() => setIsYearlyGoalFormOpen(false)}
      />
    </>
  );
};

export default ChallengeHubModal;
