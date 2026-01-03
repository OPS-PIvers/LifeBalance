import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PlayCircle, CheckCircle, AlertCircle } from 'lucide-react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  getFirestore,
} from 'firebase/firestore';
import { db } from '@/firebase.config';
import { calculateStreak, getMultiplier } from '@/utils/habitLogic';
import { Habit, HabitSubmission } from '@/types/schema';
import toast from 'react-hot-toast';

interface MigrationStats {
  habitsProcessed: number;
  submissionsCreated: number;
  habitsSkipped: number;
}

const MigrateSubmissions: React.FC = () => {
  const navigate = useNavigate();
  const { habits, householdSettings, currentUser } = useHousehold();
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [stats, setStats] = useState<MigrationStats>({
    habitsProcessed: 0,
    submissionsCreated: 0,
    habitsSkipped: 0,
  });
  const [currentHabit, setCurrentHabit] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Show loading state while household data is loading
  if (!householdSettings || !currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-brand-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto mb-4" />
          <p className="text-brand-400">Loading household data...</p>
        </div>
      </div>
    );
  }

  const runMigration = async () => {
    setIsRunning(true);
    setError(null);
    setIsComplete(false);

    const householdId = householdSettings.id;
    const newStats: MigrationStats = {
      habitsProcessed: 0,
      submissionsCreated: 0,
      habitsSkipped: 0,
    };

    try {
      for (const habit of habits) {
        setCurrentHabit(habit.title);

        // Skip if already has submission tracking or no completed dates
        if (habit.hasSubmissionTracking) {
          console.log(`Skipping "${habit.title}" - already has submission tracking`);
          newStats.habitsSkipped++;
          setStats({ ...newStats });
          continue;
        }

        if (!habit.completedDates || habit.completedDates.length === 0) {
          console.log(`Skipping "${habit.title}" - no completed dates`);
          newStats.habitsSkipped++;
          setStats({ ...newStats });
          continue;
        }

        console.log(`Migrating "${habit.title}" (${habit.completedDates.length} dates)`);
        newStats.habitsProcessed++;

        // Sort dates chronologically (oldest first)
        const sortedDates = [...habit.completedDates].sort((a, b) =>
          new Date(a).getTime() - new Date(b).getTime()
        );

        // Process each date and create submission
        for (let i = 0; i < sortedDates.length; i++) {
          const date = sortedDates[i];

          // Calculate streak as of this date
          const datesUpToNow = sortedDates.slice(0, i + 1);
          const streakAtTime = calculateStreak(datesUpToNow);

          // Calculate multiplier
          const multiplier = getMultiplier(streakAtTime, habit.type === 'positive');

          // Calculate points for this submission
          let pointsEarned = 0;
          if (habit.scoringType === 'incremental') {
            pointsEarned = Math.floor(habit.basePoints * multiplier);
          } else {
            // Threshold: assume target reached for backfilled data
            pointsEarned = Math.floor(habit.basePoints * multiplier);
          }

          // Create submission document
          const submissionId = `backfill_${date}`;
          const timestamp = `${date}T12:00:00.000Z`; // Noon UTC

          const submission: Omit<HabitSubmission, 'id'> = {
            habitId: habit.id,
            habitTitle: habit.title,
            timestamp,
            date,
            count: 1, // Assume 1 completion
            pointsEarned,
            streakDaysAtTime: streakAtTime,
            multiplierApplied: multiplier,
            createdBy: currentUser.uid,
            createdAt: new Date().toISOString(),
          };

          // Write to Firestore
          await setDoc(
            doc(db, `households/${householdId}/habits/${habit.id}/submissions`, submissionId),
            submission
          );

          newStats.submissionsCreated++;
          setStats({ ...newStats });
        }

        // Mark habit as having submission tracking
        await updateDoc(
          doc(db, `households/${householdId}/habits`, habit.id),
          { hasSubmissionTracking: true }
        );

        console.log(`Created ${sortedDates.length} submission(s) for "${habit.title}"`);
      }

      setIsComplete(true);
      setCurrentHabit('');
      toast.success('Migration completed successfully!');

    } catch (err) {
      console.error('Migration error:', err);
      const errorMessage = String(err);

      // Provide helpful error messages
      if (errorMessage.includes('permission-denied')) {
        setError('Permission denied. Try logging out and back in to refresh your authentication, then try again.');
        toast.error('Permission error - try logging out and back in');
      } else {
        setError(errorMessage);
        toast.error('Migration failed. Check console for details.');
      }
    } finally {
      setIsRunning(false);
    }
  };

  const habitsToMigrate = habits.filter(
    h => !h.hasSubmissionTracking && h.completedDates && h.completedDates.length > 0
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-brand-50 p-4 pb-24">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl hover:bg-brand-100 transition-colors"
          >
            <ArrowLeft size={24} className="text-brand-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-brand-800">Migrate Habit Submissions</h1>
            <p className="text-sm text-brand-400">Backfill historical data for submission logs</p>
          </div>
        </div>

        {/* Info Card */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6">
          <div className="flex gap-3">
            <AlertCircle className="text-blue-600 flex-shrink-0" size={20} />
            <div className="text-sm text-blue-800">
              <p className="font-bold mb-2">What this does:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Creates detailed submission records from your existing habit completion dates</li>
                <li>Each date gets a submission timestamped at noon</li>
                <li>Points are calculated retroactively based on historical streaks</li>
                <li>Count is set to 1 per date (we don't have exact historical counts)</li>
                <li>Habits already migrated will be skipped</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Stats Card */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <h2 className="text-lg font-bold text-brand-800 mb-4">Migration Summary</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-brand-50 rounded-xl">
              <div className="text-2xl font-bold text-brand-800">{habitsToMigrate.length}</div>
              <div className="text-xs text-brand-400">Habits to migrate</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-xl">
              <div className="text-2xl font-bold text-green-600">{stats.habitsProcessed}</div>
              <div className="text-xs text-green-600">Processed</div>
            </div>
            <div className="text-center p-4 bg-purple-50 rounded-xl">
              <div className="text-2xl font-bold text-purple-600">{stats.submissionsCreated}</div>
              <div className="text-xs text-purple-600">Submissions created</div>
            </div>
          </div>
        </div>

        {/* Current Progress */}
        {isRunning && currentHabit && (
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
              <div>
                <p className="text-sm font-bold text-brand-800">Processing...</p>
                <p className="text-xs text-brand-400">{currentHabit}</p>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6">
            <div className="flex gap-3">
              <AlertCircle className="text-red-600 flex-shrink-0" size={20} />
              <div className="text-sm text-red-800">
                <p className="font-bold mb-1">Migration Error</p>
                <p>{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Success */}
        {isComplete && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-6">
            <div className="flex gap-3">
              <CheckCircle className="text-green-600 flex-shrink-0" size={20} />
              <div className="text-sm text-green-800">
                <p className="font-bold mb-1">Migration Complete!</p>
                <p>
                  Successfully migrated {stats.habitsProcessed} habit(s) with {stats.submissionsCreated} total
                  submission(s).
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          {!isComplete && (
            <button
              onClick={runMigration}
              disabled={isRunning || habitsToMigrate.length === 0}
              className={`flex-1 py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors ${
                isRunning || habitsToMigrate.length === 0
                  ? 'bg-brand-100 text-brand-400 cursor-not-allowed'
                  : 'bg-brand-800 text-white hover:bg-brand-900'
              }`}
            >
              <PlayCircle size={20} />
              {isRunning ? 'Running Migration...' : 'Run Migration'}
            </button>
          )}
          {isComplete && (
            <button
              onClick={() => navigate(-1)}
              className="flex-1 py-4 bg-brand-800 text-white rounded-xl font-bold hover:bg-brand-900"
            >
              Done
            </button>
          )}
        </div>

        {habitsToMigrate.length === 0 && !isRunning && (
          <p className="text-center text-brand-400 text-sm mt-4">
            No habits to migrate. All habits either have submission tracking enabled or have no completed dates.
          </p>
        )}
      </div>
    </div>
  );
};

export default MigrateSubmissions;
