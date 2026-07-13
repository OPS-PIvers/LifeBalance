import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Plus, Edit2, Trash2, Calendar, TrendingUp, Award, Flame, BarChart3, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Habit, HabitSubmission } from '@/types/schema';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { format, parseISO, startOfWeek, endOfWeek, subWeeks, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';
import toast from 'react-hot-toast';
import { Drawer } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Section, StatGroup, Stat } from '@/components/ui/Section';

interface HabitSubmissionLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  habit: Habit;
}

const HabitSubmissionLogModal: React.FC<HabitSubmissionLogModalProps> = ({
  isOpen,
  onClose,
  habit,
}) => {
  const { getHabitSubmissions, addHabitSubmission, updateHabitSubmission, deleteHabitSubmission } = useGamification();

  const [submissions, setSubmissions] = useState<HabitSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editingSubmission, setEditingSubmission] = useState<HabitSubmission | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'log' | 'stats' | 'calendar'>('log');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [deleteSubmissionId, setDeleteSubmissionId] = useState<string | null>(null);

  // Form state
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('');
  const [formCount, setFormCount] = useState('1');

  const loadSubmissions = useCallback(async () => {
    setIsLoading(true);
    try {
      const subs = await getHabitSubmissions(habit.id);
      setSubmissions(subs);
    } catch (error) {
      console.error('Failed to load submissions:', error);
      toast.error('Failed to load submission history');
    } finally {
      setIsLoading(false);
    }
  }, [getHabitSubmissions, habit.id]);

  // Load submissions when modal opens
  useEffect(() => {
    if (isOpen && habit.id) {
      // loadSubmissions() is an async Firestore fetch that synchronously flips
      // the loading flag before awaiting. This is legitimate external-system
      // synchronization (re-fetched whenever the modal opens for a habit), not
      // derivable state — deferring the loading flag would cause a content flash
      // before the spinner. loadSubmissions is also invoked from the add/edit/
      // delete handlers, so it must remain a callable that owns its loading.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional load-on-open; see comment above
      loadSubmissions();
    }
  }, [isOpen, habit.id, loadSubmissions]);

  const handleAdd = async () => {
    if (!formDate || !formTime) {
      toast.error('Please select date and time');
      return;
    }

    const count = parseInt(formCount, 10);
    if (isNaN(count) || count <= 0) {
      toast.error('Count must be a positive number');
      return;
    }

    const timestamp = `${formDate}T${formTime}:00`;
    await addHabitSubmission(habit.id, count, timestamp);
    await loadSubmissions();

    // Reset form
    setIsAddMode(false);
    setFormDate('');
    setFormTime('');
    setFormCount('1');
  };

  const handleUpdate = async () => {
    if (!editingSubmission) return;

    const count = parseInt(formCount, 10);
    if (isNaN(count) || count <= 0) {
      toast.error('Count must be a positive number');
      return;
    }

    await updateHabitSubmission(habit.id, editingSubmission.id, {
      count,
    });
    await loadSubmissions();
    setEditingSubmission(null);
  };

  const handleDelete = (submissionId: string) => {
    setDeleteSubmissionId(submissionId);
  };

  const confirmDeleteSubmission = async () => {
    if (!deleteSubmissionId) return;
    try {
      await deleteHabitSubmission(habit.id, deleteSubmissionId);
    } catch (error) {
      console.error('Failed to delete submission:', error);
    } finally {
      // Always reset state so the confirmation dialog can't get stuck open.
      setDeleteSubmissionId(null);
      await loadSubmissions();
    }
  };

  // Analytics calculations
  const analytics = useMemo(() => {
    if (submissions.length === 0) {
      return {
        totalSubmissions: 0,
        totalPoints: 0,
        averagePointsPerSubmission: 0,
        totalCount: 0,
        maxStreak: 0,
        currentStreak: habit.streakDays,
        weeklyData: [],
        dailyDistribution: {},
      };
    }

    const totalSubmissions = submissions.length;
    const totalPoints = submissions.reduce((sum, sub) => sum + sub.pointsEarned, 0);
    const totalCount = submissions.reduce((sum, sub) => sum + sub.count, 0);
    const maxStreak = Math.max(...submissions.map(s => s.streakDaysAtTime));
    const averagePointsPerSubmission = totalPoints / totalSubmissions;

    // Weekly breakdown (last 4 weeks)
    const now = new Date();
    const weeklyData = [];
    for (let i = 0; i < 4; i++) {
      const weekStart = format(startOfWeek(subWeeks(now, i), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const weekEnd = format(endOfWeek(subWeeks(now, i), { weekStartsOn: 1 }), 'yyyy-MM-dd');

      const weekSubmissions = submissions.filter(s => s.date >= weekStart && s.date <= weekEnd);
      const weekPoints = weekSubmissions.reduce((sum, s) => sum + s.pointsEarned, 0);
      const weekCount = weekSubmissions.reduce((sum, s) => sum + s.count, 0);

      weeklyData.unshift({
        label: i === 0 ? 'This Week' : i === 1 ? 'Last Week' : `${i} Weeks Ago`,
        points: weekPoints,
        count: weekCount,
        submissions: weekSubmissions.length,
      });
    }

    // Daily distribution (hour of day)
    const dailyDistribution: Record<string, number> = {};
    submissions.forEach(sub => {
      const hour = parseISO(sub.timestamp).getHours();
      const period = hour < 6 ? 'Night (12AM-6AM)' :
                     hour < 12 ? 'Morning (6AM-12PM)' :
                     hour < 18 ? 'Afternoon (12PM-6PM)' : 'Evening (6PM-12AM)';
      dailyDistribution[period] = (dailyDistribution[period] || 0) + 1;
    });

    return {
      totalSubmissions,
      totalPoints,
      averagePointsPerSubmission,
      totalCount,
      maxStreak,
      currentStreak: habit.streakDays,
      weeklyData,
      dailyDistribution,
    };
  }, [submissions, habit.streakDays]);

  // Group submissions by date
  const groupedSubmissions = useMemo(() => {
    return submissions.reduce((acc, sub) => {
      if (!acc[sub.date]) acc[sub.date] = [];
      const bucket = acc[sub.date];
      if (bucket) bucket.push(sub);
      return acc;
    }, {} as Record<string, HabitSubmission[]>);
  }, [submissions]);

  // Calendar Logic
  const calendarData = useMemo(() => {
    const monthStart = startOfMonth(calendarDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const completionsInMonth = habit.completedDates.filter(d =>
      d.startsWith(format(calendarDate, 'yyyy-MM'))
    ).length;

    // Convert to Set for O(1) lookup in render loop
    const completedDatesSet = new Set(habit.completedDates);

    return { days, completionsInMonth, completedDatesSet };
  }, [calendarDate, habit.completedDates]);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Habit Analytics - ${habit.title}`}
      noPadding={true}
    >
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'log' | 'stats' | 'calendar')}>
        {/* Tab Navigation */}
        <div className="px-4 pt-3 pb-0 border-b border-brand-200 dark:border-brand-700">
          <TabsList>
            <TabsTrigger value="log" className="flex-1">
              <Calendar className="w-4 h-4" aria-hidden="true" />
              Log
            </TabsTrigger>
            <TabsTrigger value="stats" className="flex-1">
              <BarChart3 className="w-4 h-4" aria-hidden="true" />
              Stats
            </TabsTrigger>
            <TabsTrigger value="calendar" className="flex-1">
              <Calendar className="w-4 h-4" aria-hidden="true" />
              Calendar
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Content */}
        <div className="scroll-contain-y">
          {isLoading ? (
            <div className="text-center py-12 text-brand-400 dark:text-brand-400">
              <div className="animate-spin w-8 h-8 border-4 border-brand-200 dark:border-brand-700 border-t-brand-600 rounded-full mx-auto mb-3"></div>
              Loading...
            </div>
          ) : (
          <>
          <TabsContent value="calendar" className="p-4 space-y-4">
            {/* Calendar — nav row + grid share a single surface */}
            <div className="bg-white dark:bg-brand-800 rounded-xl border border-brand-200 dark:border-brand-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCalendarDate(subMonths(calendarDate, 1))}
                  aria-label="Previous month"
                >
                  <ChevronLeft size={20} />
                </Button>
                <h3 className="text-lg font-bold text-brand-800 dark:text-brand-100">
                  {format(calendarDate, 'MMMM yyyy')}
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCalendarDate(addMonths(calendarDate, 1))}
                  aria-label="Next month"
                >
                  <ChevronRight size={20} />
                </Button>
              </div>

              <div
                role="grid"
                aria-label={`Habit calendar for ${format(calendarDate, 'MMMM yyyy')}`}
              >
                <div className="grid grid-cols-7 mb-2" role="row">
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                    <div key={i} className="text-center text-xs font-bold text-brand-300 dark:text-brand-450 py-2" role="columnheader">
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1" role="presentation">
                  {calendarData.days.map((day) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    // Use O(1) Set lookup
                    const isCompleted = calendarData.completedDatesSet.has(dateStr);
                    const isCurrentMonth = isSameMonth(day, calendarDate);
                    const isTodayDate = isSameDay(day, new Date());

                    // Accessibility label
                    const label = `${format(day, 'MMMM do')}, ${isCompleted ? 'completed' : 'not completed'}`;

                    return (
                      <div
                        key={dateStr}
                        role="gridcell"
                        aria-label={label}
                        className={`
                          aspect-square rounded-lg flex items-center justify-center text-sm font-medium relative
                          ${!isCurrentMonth ? 'opacity-30' : ''}
                          ${isCompleted
                            ? (habit.type === 'positive' ? 'bg-money-bgPos dark:bg-money-pos/15 text-money-pos dark:text-money-posDark font-bold' : 'bg-money-bgNeg dark:bg-money-neg/15 text-money-neg dark:text-money-negDark font-bold')
                            : 'bg-brand-50 dark:bg-brand-700/50 text-brand-400 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-700/50'
                          }
                          ${isTodayDate && !isCompleted ? 'ring-2 ring-brand-400' : ''}
                        `}
                        title={dateStr}
                      >
                        {format(day, 'd')}
                        {isCompleted && (
                          <div className={`absolute bottom-1 w-1 h-1 rounded-full ${habit.type === 'positive' ? 'bg-money-pos' : 'bg-money-neg'}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Summary — typography line, no boxed card */}
            <div className="flex items-center gap-3 px-1">
              <div className={`shrink-0 p-2 rounded-full ${habit.type === 'positive' ? 'bg-money-bgPos dark:bg-money-pos/15 text-money-pos dark:text-money-posDark' : 'bg-money-bgNeg dark:bg-money-neg/15 text-money-neg dark:text-money-negDark'}`}>
                <CheckCircle2 size={20} />
              </div>
              <div>
                <p className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase tracking-wide">
                  {format(calendarDate, 'MMMM')} Performance
                </p>
                <p className="text-lg font-bold text-brand-800 dark:text-brand-100">
                  {calendarData.completionsInMonth} day{calendarData.completionsInMonth !== 1 ? 's' : ''} completed
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="stats" className="p-4 space-y-6">
            {/* Stats Overview — typography-only, no boxed tiles */}
            <StatGroup>
              <Stat
                label={
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5"><Award size={12} /> Total Points</span>
                    <span className="text-brand-400 dark:text-brand-450">{analytics.averagePointsPerSubmission.toFixed(1)} avg/submission</span>
                  </span>
                }
                value={analytics.totalPoints.toLocaleString()}
                valueClassName="text-2xl text-money-pos dark:text-money-posDark"
              />
              <Stat
                label={
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5"><TrendingUp size={12} /> Submissions</span>
                    <span className="text-brand-400 dark:text-brand-450">{analytics.totalCount} total actions</span>
                  </span>
                }
                value={analytics.totalSubmissions}
                valueClassName="text-2xl text-warm-700 dark:text-warm-200"
              />
              <Stat
                label={
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5"><Flame size={12} /> Current Streak</span>
                    <span className="text-brand-400 dark:text-brand-450">{analytics.maxStreak} day max</span>
                  </span>
                }
                value={analytics.currentStreak}
                valueClassName="text-2xl text-habit-streak"
              />
              <Stat
                label={
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5"><BarChart3 size={12} /> Multiplier</span>
                    <span className="text-brand-400 dark:text-brand-450">Current bonus</span>
                  </span>
                }
                value={analytics.currentStreak >= 7 ? '2.0x' : analytics.currentStreak >= 3 ? '1.5x' : '1.0x'}
                valueClassName="text-2xl text-habit-blue"
              />
            </StatGroup>

            {/* Weekly Breakdown */}
            {analytics.weeklyData.length > 0 && (
              <Section title="Weekly Breakdown">
                <p className="text-xs text-brand-400 dark:text-brand-400 mb-3">Points earned per week</p>
                <div className="space-y-3">
                  {analytics.weeklyData.map((week, idx) => {
                    const maxPoints = Math.max(...analytics.weeklyData.map(w => w.points), 1);
                    const barWidth = (week.points / maxPoints) * 100;

                    return (
                      <div key={idx}>
                        <div className="flex justify-between items-baseline mb-1">
                          <span className="text-xs font-bold text-brand-600 dark:text-brand-300">{week.label}</span>
                          <span className="text-xs text-brand-400 dark:text-brand-400">
                            {week.points} pts • {week.count} actions
                          </span>
                        </div>
                        <div className="h-2 bg-brand-100 dark:bg-brand-700/50 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-linear-to-r from-money-pos to-accent-600 rounded-full transition-all duration-(--duration-slow)"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Time of Day Distribution */}
            {Object.keys(analytics.dailyDistribution).length > 0 && (
              <Section title="Time Patterns">
                <p className="text-xs text-brand-400 dark:text-brand-400 mb-3">When you complete this habit</p>
                <div className="space-y-3">
                  {Object.entries(analytics.dailyDistribution)
                    .sort((a, b) => b[1] - a[1])
                    .map(([period, count]) => {
                      const maxCount = Math.max(...Object.values(analytics.dailyDistribution), 1);
                      const barWidth = (count / maxCount) * 100;

                      return (
                        <div key={period}>
                          <div className="flex justify-between items-baseline mb-1">
                            <span className="text-xs font-bold text-brand-600 dark:text-brand-300">{period}</span>
                            <span className="text-xs text-brand-400 dark:text-brand-400">
                              {count} time{count !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="h-2 bg-brand-100 dark:bg-brand-700/50 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-linear-to-r from-habit-blue to-accent-500 rounded-full transition-all duration-(--duration-slow)"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </Section>
            )}

            {/* Empty State */}
            {analytics.totalSubmissions === 0 && (
              <EmptyState
                icon={<BarChart3 size={28} />}
                title="No data yet"
                description="Start logging submissions to see analytics"
              />
            )}
          </TabsContent>

          <TabsContent value="log" className="p-4">
            {/* Add New Submission Button */}
            {!isAddMode && (
              <Button
                variant="warning"
                size="lg"
                onClick={() => setIsAddMode(true)}
                leftIcon={<Plus size={16} />}
                className="w-full mb-4"
              >
                Add Submission
              </Button>
            )}

            {/* Add Form */}
            {isAddMode && (
              <div className="mb-4 p-4 bg-brand-50 dark:bg-brand-700/50 rounded-xl border border-brand-200 dark:border-brand-700">
                <h3 className="font-bold text-sm text-brand-700 dark:text-brand-200 mb-3">New Submission</h3>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <Input
                    label="Date"
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    max={getLocalDateString()}
                  />
                  <Input
                    label="Time"
                    type="time"
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                  />
                  <Input
                    label="Count"
                    type="number"
                    value={formCount}
                    onChange={(e) => setFormCount(e.target.value)}
                    min="1"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setIsAddMode(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="warning"
                    onClick={handleAdd}
                    className="flex-1"
                  >
                    Add
                  </Button>
                </div>
              </div>
            )}

            {/* Submissions List */}
            <div className="space-y-3">
              {Object.keys(groupedSubmissions).length === 0 ? (
                <EmptyState
                  variant="dashed"
                  icon={<Calendar size={28} />}
                  title="No submissions yet"
                  description={<>Click &quot;Add Submission&quot; to get started</>}
                />
              ) : (
                (Object.entries(groupedSubmissions) as [string, HabitSubmission[]][]).map(([date, subs]) => {
                  const dayTotal = subs.reduce((sum, s) => sum + s.pointsEarned, 0);
                  const dayCount = subs.reduce((sum, s) => sum + s.count, 0);

                  return (
                    <div key={date} className="border border-brand-200 dark:border-brand-700 rounded-xl overflow-hidden">
                      <div className="bg-brand-50 dark:bg-brand-700/50 px-3 py-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Calendar size={14} className="text-brand-600 dark:text-brand-300 shrink-0" />
                          <span className="text-xs font-bold text-brand-800 dark:text-brand-100 truncate">
                            {format(parseISO(date), 'MMMM d, yyyy')}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-2">
                          <Badge variant={dayTotal > 0 ? 'success' : dayTotal < 0 ? 'danger' : 'neutral'} size="md">
                            {dayTotal > 0 ? '+' : ''}{dayTotal} pts
                          </Badge>
                          <span className="text-xxs text-brand-400 dark:text-brand-400 font-bold">
                            {dayCount} log{dayCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      <div className="divide-y divide-brand-200">
                        {subs.map((sub) => (
                          <div key={sub.id} className="p-3 flex items-center justify-between hover:bg-brand-50 dark:hover:bg-brand-700/50 transition-colors">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-mono font-bold text-brand-800 dark:text-brand-100">
                                  {format(parseISO(sub.timestamp), 'h:mm a')}
                                </span>
                                <Badge variant="neutral" size="md">
                                  ×{sub.count}
                                </Badge>
                                <Badge variant={sub.pointsEarned > 0 ? 'success' : sub.pointsEarned < 0 ? 'danger' : 'neutral'} size="md">
                                  {sub.pointsEarned > 0 ? '+' : ''}{sub.pointsEarned} pts
                                </Badge>
                              </div>
                              <div className="text-xxs text-brand-400 dark:text-brand-400 mt-1 flex items-center gap-2 flex-wrap">
                                <span>{sub.multiplierApplied}x multiplier</span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <Flame size={10} className={sub.streakDaysAtTime >= 3 ? 'text-habit-streak' : 'text-brand-400 dark:text-brand-400'} />
                                  {sub.streakDaysAtTime} day{sub.streakDaysAtTime !== 1 ? 's' : ''}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 ml-3 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setEditingSubmission(sub);
                                  setFormCount(sub.count.toString());
                                }}
                                aria-label="Edit submission"
                              >
                                <Edit2 size={14} />
                              </Button>
                              <Button
                                variant="ghost-destructive"
                                size="icon"
                                onClick={() => handleDelete(sub.id)}
                                aria-label="Delete submission"
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </TabsContent>
          </>
          )}
        </div>
      </Tabs>

      {/* Edit Modal (nested) */}
      {editingSubmission && (
        <div className="absolute inset-0 bg-white dark:bg-brand-800 z-10 p-4 flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-brand-800 dark:text-brand-100">Edit Submission</h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEditingSubmission(null)}
              aria-label="Close edit"
            >
              <X size={20} />
            </Button>
          </div>

          <div className="mb-4">
            <Input
              label="Count"
              type="number"
              value={formCount}
              onChange={(e) => setFormCount(e.target.value)}
              min="1"
            />
          </div>

          <div className="bg-warm-50 dark:bg-warm-900/20 border border-warm-200 dark:border-warm-800/60 rounded-xl p-3 mb-4">
            <p className="text-xs text-warm-700 dark:text-warm-300">
              <strong>Note:</strong> Editing count will recalculate points for this submission.
              Date and time cannot be changed - delete and re-add instead.
            </p>
          </div>

          <div className="mt-auto flex gap-2">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setEditingSubmission(null)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="warning"
              size="lg"
              onClick={handleUpdate}
              className="flex-1"
            >
              Save Changes
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteSubmissionId}
        onClose={() => setDeleteSubmissionId(null)}
        onConfirm={confirmDeleteSubmission}
        title="Delete Submission"
        message="Delete this submission? This will adjust your points."
        confirmLabel="Delete"
      />
    </Drawer>
  );
};

export default HabitSubmissionLogModal;
