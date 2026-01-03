import React, { useState, useEffect } from 'react';
import { X, Plus, Edit2, Trash2, Calendar } from 'lucide-react';
import { Habit, HabitSubmission } from '@/types/schema';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';

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

  // Group submissions by date
  const groupedSubmissions = submissions.reduce((acc, sub) => {
    if (!acc[sub.date]) acc[sub.date] = [];
    acc[sub.date].push(sub);
    return acc;
  }, {} as Record<string, HabitSubmission[]>);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="p-4 border-b border-brand-100 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-brand-800">Submission Log</h2>
            <p className="text-sm text-brand-400">{habit.title}</p>
          </div>
          <button onClick={onClose} className="text-brand-400 hover:text-brand-600">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="text-center py-12 text-brand-400">Loading...</div>
          ) : (
            <>
              {/* Add New Submission Button */}
              {!isAddMode && (
                <button
                  onClick={() => setIsAddMode(true)}
                  className="w-full mb-4 py-3 bg-brand-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-brand-900"
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
                      <label className="text-xs text-brand-400 block mb-1">Date</label>
                      <input
                        type="date"
                        value={formDate}
                        onChange={(e) => setFormDate(e.target.value)}
                        max={format(new Date(), 'yyyy-MM-dd')}
                        className="w-full p-2 bg-white border border-brand-200 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-brand-400 block mb-1">Time</label>
                      <input
                        type="time"
                        value={formTime}
                        onChange={(e) => setFormTime(e.target.value)}
                        className="w-full p-2 bg-white border border-brand-200 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-brand-400 block mb-1">Count</label>
                      <input
                        type="number"
                        value={formCount}
                        onChange={(e) => setFormCount(e.target.value)}
                        min="1"
                        className="w-full p-2 bg-white border border-brand-200 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsAddMode(false)}
                      className="flex-1 py-2 bg-brand-100 text-brand-600 font-bold rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAdd}
                      className="flex-1 py-2 bg-brand-800 text-white font-bold rounded-lg"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {/* Submissions List */}
              <div className="space-y-4">
                {Object.keys(groupedSubmissions).length === 0 ? (
                  <div className="text-center py-12 text-brand-400">
                    No submissions yet. Click "Add Submission" to get started.
                  </div>
                ) : (
                  (Object.entries(groupedSubmissions) as [string, HabitSubmission[]][]).map(([date, subs]) => (
                    <div key={date} className="border border-brand-100 rounded-xl overflow-hidden">
                      <div className="bg-brand-50 px-3 py-2 flex items-center gap-2">
                        <Calendar size={14} className="text-brand-400" />
                        <span className="text-xs font-bold text-brand-600">
                          {format(parseISO(date), 'MMMM d, yyyy')}
                        </span>
                        <span className="ml-auto text-xs text-brand-400">
                          {subs.length} submission{subs.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="divide-y divide-brand-100">
                        {subs.map((sub) => (
                          <div key={sub.id} className="p-3 flex items-center justify-between hover:bg-brand-50">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono text-brand-600">
                                  {format(parseISO(sub.timestamp), 'h:mm a')}
                                </span>
                                <span className="text-xs bg-brand-100 text-brand-600 px-2 py-0.5 rounded-full font-bold">
                                  ×{sub.count}
                                </span>
                              </div>
                              <div className="text-xs text-brand-400 mt-1">
                                {sub.pointsEarned > 0 ? '+' : ''}{sub.pointsEarned} pts
                                {' • '}
                                {sub.multiplierApplied}x multiplier
                                {' • '}
                                {sub.streakDaysAtTime} day streak
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  setEditingSubmission(sub);
                                  setFormCount(sub.count.toString());
                                }}
                                className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-100 rounded-lg"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => handleDelete(sub.id)}
                                className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Edit Modal (nested) */}
        {editingSubmission && (
          <div className="absolute inset-0 bg-white z-10 p-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-brand-800">Edit Submission</h3>
              <button
                onClick={() => setEditingSubmission(null)}
                className="text-brand-400 hover:text-brand-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-4">
              <label className="text-xs text-brand-400 block mb-1">Count</label>
              <input
                type="number"
                value={formCount}
                onChange={(e) => setFormCount(e.target.value)}
                min="1"
                className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl"
              />
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
              <p className="text-xs text-amber-700">
                <strong>Note:</strong> Editing count will recalculate points for this submission.
                Date and time cannot be changed - delete and re-add instead.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setEditingSubmission(null)}
                className="flex-1 py-3 bg-brand-100 text-brand-600 font-bold rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdate}
                className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl"
              >
                Save Changes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HabitSubmissionLogModal;
