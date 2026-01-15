import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, Edit2, Trash2, Calendar, TrendingUp, Award, Flame, BarChart3 } from 'lucide-react';
import { Habit, HabitSubmission } from '@/types/schema';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { format, parseISO, startOfWeek, endOfWeek, subWeeks } from 'date-fns';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';

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
  const { getHabitSubmissions, addHabitSubmission, updateHabitSubmission, deleteHabitSubmission } = useHousehold();

  const [submissions, setSubmissions] = useState<HabitSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editingSubmission, setEditingSubmission] = useState<HabitSubmission | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'log' | 'stats'>('log');

  // Form state
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('');
  const [formCount, setFormCount] = useState('1');

  // Load submissions when modal opens
  useEffect(() => {
    if (isOpen && habit.id) {
      loadSubmissions();
    }
  }, [isOpen, habit.id]);

  const loadSubmissions = async () => {
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
  };

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

  const handleDelete = async (submissionId: string) => {
    if (!confirm('Delete this submission? This will adjust your points.')) return;

    await deleteHabitSubmission(habit.id, submissionId);
    await loadSubmissions();
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
      acc[sub.date].push(sub);
      return acc;
    }, {} as Record<string, HabitSubmission[]>);
  }, [submissions]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-2xl"
      className="flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="p-4 border-b border-brand-100 flex justify-between items-start shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-brand-800 truncate">Habit Analytics</h2>
          <p className="text-sm text-brand-400 truncate">{habit.title}</p>
        </div>
        <button
          onClick={onClose}
          className="ml-3 text-brand-400 hover:text-brand-600 p-1 hover:bg-brand-50 rounded-lg transition-colors flex-shrink-0"
        >
          <X size={20} />
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="px-4 pt-3 pb-0 shrink-0 border-b border-brand-100">
        <div className="flex gap-1 bg-brand-50 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('log')}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'log'
                ? 'bg-white text-brand-800 shadow-sm'
                : 'text-brand-400 hover:text-brand-600'
            }`}
          >
            <Calendar className="inline-block w-4 h-4 mr-1.5" />
            Log
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'stats'
                ? 'bg-white text-brand-800 shadow-sm'
                : 'text-brand-400 hover:text-brand-600'
            }`}
          >
            <BarChart3 className="inline-block w-4 h-4 mr-1.5" />
            Stats
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="text-center py-12 text-brand-400">
            <div className="animate-spin w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full mx-auto mb-3"></div>
            Loading...
          </div>
        ) : activeTab === 'stats' ? (
          <div className="p-4 space-y-4">
            {/* Stats Overview */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 p-4 rounded-xl border border-emerald-200">
                <div className="flex items-center gap-2 mb-1">
                  <Award className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold text-emerald-600 uppercase tracking-wide">Total Points</span>
                </div>
                <p className="text-2xl font-bold text-emerald-800">{analytics.totalPoints.toLocaleString()}</p>
                <p className="text-xs text-emerald-600 mt-1">
                  {analytics.averagePointsPerSubmission.toFixed(1)} avg/submission
                </p>
              </div>

              <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-xl border border-purple-200">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-purple-600" />
                  <span className="text-xs font-bold text-purple-600 uppercase tracking-wide">Submissions</span>
                </div>
                <p className="text-2xl font-bold text-purple-800">{analytics.totalSubmissions}</p>
                <p className="text-xs text-purple-600 mt-1">
                  {analytics.totalCount} total actions
                </p>
              </div>

              <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-xl border border-orange-200">
                <div className="flex items-center gap-2 mb-1">
                  <Flame className="w-4 h-4 text-orange-600" />
                  <span className="text-xs font-bold text-orange-600 uppercase tracking-wide">Current Streak</span>
                </div>
                <p className="text-2xl font-bold text-orange-800">{analytics.currentStreak}</p>
                <p className="text-xs text-orange-600 mt-1">
                  {analytics.maxStreak} day max
                </p>
              </div>

              <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-xl border border-blue-200">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">Multiplier</span>
                </div>
                <p className="text-2xl font-bold text-blue-800">
                  {analytics.currentStreak >= 7 ? '2.0x' : analytics.currentStreak >= 3 ? '1.5x' : '1.0x'}
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Current bonus
                </p>
              </div>
            </div>

            {/* Weekly Breakdown */}
            {analytics.weeklyData.length > 0 && (
              <div className="bg-brand-50 rounded-xl border border-brand-100 overflow-hidden">
                <div className="p-3 border-b border-brand-200 bg-white">
                  <h3 className="text-sm font-bold text-brand-800">Weekly Breakdown</h3>
                  <p className="text-xs text-brand-400 mt-0.5">Points earned per week</p>
                </div>
                <div className="p-3 space-y-2">
                  {analytics.weeklyData.map((week, idx) => {
                    const maxPoints = Math.max(...analytics.weeklyData.map(w => w.points), 1);
                    const barWidth = (week.points / maxPoints) * 100;

                    return (
                      <div key={idx}>
                        <div className="flex justify-between items-baseline mb-1">
                          <span className="text-xs font-bold text-brand-600">{week.label}</span>
                          <span className="text-xs text-brand-400">
                            {week.points} pts • {week.count} actions
                          </span>
                        </div>
                        <div className="h-2 bg-brand-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-500"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Time of Day Distribution */}
            {Object.keys(analytics.dailyDistribution).length > 0 && (
              <div className="bg-brand-50 rounded-xl border border-brand-100 overflow-hidden">
                <div className="p-3 border-b border-brand-200 bg-white">
                  <h3 className="text-sm font-bold text-brand-800">Time Patterns</h3>
                  <p className="text-xs text-brand-400 mt-0.5">When you complete this habit</p>
                </div>
                <div className="p-3 space-y-2">
                  {Object.entries(analytics.dailyDistribution)
                    .sort((a, b) => b[1] - a[1])
                    .map(([period, count]) => {
                      const maxCount = Math.max(...Object.values(analytics.dailyDistribution), 1);
                      const barWidth = (count / maxCount) * 100;

                      return (
                        <div key={period}>
                          <div className="flex justify-between items-baseline mb-1">
                            <span className="text-xs font-bold text-brand-600">{period}</span>
                            <span className="text-xs text-brand-400">
                              {count} time{count !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="h-2 bg-brand-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-purple-400 to-purple-600 rounded-full transition-all duration-500"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Empty State */}
            {analytics.totalSubmissions === 0 && (
              <div className="text-center py-12 text-brand-400">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-bold">No data yet</p>
                <p className="text-xs mt-1">Start logging submissions to see analytics</p>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4">
            {/* Add New Submission Button */}
            {!isAddMode && (
              <button
                onClick={() => setIsAddMode(true)}
                className="w-full mb-4 py-3 bg-brand-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-brand-900 active:scale-98 transition-all shadow-sm"
              >
                <Plus size={16} /> Add Submission
              </button>
            )}

            {/* Add Form */}
            {isAddMode && (
              <div className="mb-4 p-4 bg-brand-50 rounded-xl border border-brand-200">
                <h3 className="font-bold text-sm text-brand-700 mb-3">New Submission</h3>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div>
                    <label className="text-xs text-brand-400 block mb-1 font-bold">Date</label>
                    <input
                      type="date"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      max={format(new Date(), 'yyyy-MM-dd')}
                      className="w-full p-2 bg-white border border-brand-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-brand-400 block mb-1 font-bold">Time</label>
                    <input
                      type="time"
                      value={formTime}
                      onChange={(e) => setFormTime(e.target.value)}
                      className="w-full p-2 bg-white border border-brand-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-brand-400 block mb-1 font-bold">Count</label>
                    <input
                      type="number"
                      value={formCount}
                      onChange={(e) => setFormCount(e.target.value)}
                      min="1"
                      className="w-full p-2 bg-white border border-brand-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsAddMode(false)}
                    className="flex-1 py-2 bg-white border border-brand-200 text-brand-600 font-bold rounded-lg hover:bg-brand-50 active:scale-98 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAdd}
                    className="flex-1 py-2 bg-brand-800 text-white font-bold rounded-lg hover:bg-brand-900 active:scale-98 transition-all shadow-sm"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {/* Submissions List */}
            <div className="space-y-3">
              {Object.keys(groupedSubmissions).length === 0 ? (
                <div className="text-center py-12 text-brand-400 border-2 border-dashed border-brand-200 rounded-xl">
                  <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-bold">No submissions yet</p>
                  <p className="text-xs mt-1">Click "Add Submission" to get started</p>
                </div>
              ) : (
                (Object.entries(groupedSubmissions) as [string, HabitSubmission[]][]).map(([date, subs]) => {
                  const dayTotal = subs.reduce((sum, s) => sum + s.pointsEarned, 0);
                  const dayCount = subs.reduce((sum, s) => sum + s.count, 0);

                  return (
                    <div key={date} className="border border-brand-100 rounded-xl overflow-hidden shadow-sm">
                      <div className="bg-gradient-to-r from-brand-50 to-brand-100 px-3 py-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Calendar size={14} className="text-brand-600 flex-shrink-0" />
                          <span className="text-xs font-bold text-brand-800 truncate">
                            {format(parseISO(date), 'MMMM d, yyyy')}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                            {dayTotal > 0 ? '+' : ''}{dayTotal} pts
                          </span>
                          <span className="text-[10px] text-brand-400 font-bold">
                            {subs.length} log{subs.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      <div className="divide-y divide-brand-100">
                        {subs.map((sub) => (
                          <div key={sub.id} className="p-3 flex items-center justify-between hover:bg-brand-50/50 transition-colors">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-mono font-bold text-brand-800">
                                  {format(parseISO(sub.timestamp), 'h:mm a')}
                                </span>
                                <span className="text-xs bg-brand-100 text-brand-600 px-2 py-0.5 rounded-full font-bold">
                                  ×{sub.count}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                                  sub.pointsEarned >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                                }`}>
                                  {sub.pointsEarned > 0 ? '+' : ''}{sub.pointsEarned} pts
                                </span>
                              </div>
                              <div className="text-[10px] text-brand-400 mt-1 flex items-center gap-2 flex-wrap">
                                <span>{sub.multiplierApplied}x multiplier</span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <Flame size={10} className={sub.streakDaysAtTime >= 3 ? 'text-orange-500' : 'text-brand-400'} />
                                  {sub.streakDaysAtTime} day{sub.streakDaysAtTime !== 1 ? 's' : ''}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                              <button
                                onClick={() => {
                                  setEditingSubmission(sub);
                                  setFormCount(sub.count.toString());
                                }}
                                className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-100 rounded-lg transition-colors"
                                aria-label="Edit submission"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => handleDelete(sub.id)}
                                className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                aria-label="Delete submission"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal (nested) */}
      {editingSubmission && (
        <div className="absolute inset-0 bg-white z-10 p-4 flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-brand-800">Edit Submission</h3>
            <button
              onClick={() => setEditingSubmission(null)}
              className="text-brand-400 hover:text-brand-600 p-1 hover:bg-brand-50 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="mb-4">
            <label className="text-xs text-brand-400 block mb-1 font-bold">Count</label>
            <input
              type="number"
              value={formCount}
              onChange={(e) => setFormCount(e.target.value)}
              min="1"
              className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
            <p className="text-xs text-amber-700">
              <strong>Note:</strong> Editing count will recalculate points for this submission.
              Date and time cannot be changed - delete and re-add instead.
            </p>
          </div>

          <div className="mt-auto flex gap-2">
            <button
              onClick={() => setEditingSubmission(null)}
              className="flex-1 py-3 bg-white border border-brand-200 text-brand-600 font-bold rounded-xl hover:bg-brand-50 active:scale-98 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleUpdate}
              className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl hover:bg-brand-900 active:scale-98 transition-all shadow-sm"
            >
              Save Changes
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default HabitSubmissionLogModal;
