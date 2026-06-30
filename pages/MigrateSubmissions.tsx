import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PlayCircle, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import {
  doc,
  setDoc,
  updateDoc
} from 'firebase/firestore';
import { db } from '@/firebase.config';
import { streakEndingOnForHabit, getMultiplier } from '@/utils/habitLogic';
import { HabitSubmission } from '@/types/schema';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';

interface MigrationStats {
  habitsProcessed: number;
  submissionsCreated: number;
  habitsSkipped: number;
}

function sanitizeValue(value: unknown, habitTitle: string): unknown {
  // Remove undefined values at any level
  if (value === undefined) {
    return undefined;
  }
  // Convert NaN numbers to 0 at any level
  if (typeof value === 'number' && isNaN(value)) {
    console.warn(
      `[Migration] Found NaN value in submission for "${habitTitle}", defaulting to 0`
    );
    return 0;
  }
  // Recursively sanitize arrays (Firestore arrays can't contain undefined, convert to null)
  if (Array.isArray(value)) {
    return value.map((item) => {
      const sanitizedItem = sanitizeValue(item, habitTitle);
      return sanitizedItem === undefined ? null : sanitizedItem;
    });
  }
  // Recursively sanitize plain objects
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, prop]) => {
      const sanitizedProp = sanitizeValue(prop, habitTitle);
      // Match original behavior: delete properties that are undefined
      if (sanitizedProp !== undefined) {
        result[key] = sanitizedProp;
      }
    });
    return result;
  }
  // Primitive non-number or already clean number
  return value;
}

function sanitizeSubmission(sub: Omit<HabitSubmission, 'id'>): Record<string, unknown> {
  const habitTitle = sub.habitTitle || 'unknown habit';
  return sanitizeValue(sub, habitTitle) as Record<string, unknown>;
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
      <div className="min-h-screen bg-brand-50 dark:bg-brand-900 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-accent-600 dark:text-accent-300 animate-spin mx-auto mb-4" />
          <p className="text-brand-500 dark:text-brand-400">Loading household data...</p>
        </div>
      </div>
    );
  }

  const runMigration = async () => {
    setIsRunning(true);
    setError(null);
    setIsComplete(false);

    const householdId = householdSettings.id;
    // Local mutable stats for calculation, state updated periodically
    const newStats: MigrationStats = {
      habitsProcessed: 0,
      submissionsCreated: 0,
      habitsSkipped: 0,
    };

    try {
      for (const habit of habits) {
        setCurrentHabit(habit.title || 'Untitled Habit');

        // Skip if already has submission tracking or no completed dates
        const habitTitle = habit.title || 'Untitled Habit';
        if (habit.hasSubmissionTracking) {
          console.log(`Skipping "${habitTitle}" - already has submission tracking`);
          newStats.habitsSkipped++;
          setStats({ ...newStats });
          continue;
        }

        if (!habit.completedDates || habit.completedDates.length === 0) {
          console.log(`Skipping "${habitTitle}" - no completed dates`);
          newStats.habitsSkipped++;
          setStats({ ...newStats });
          continue;
        }

        console.log(`Migrating "${habitTitle}" (${habit.completedDates.length} dates)`);
        newStats.habitsProcessed++;

        // Sort dates chronologically (oldest first)
        const sortedDates = [...habit.completedDates].sort((a, b) =>
          new Date(a).getTime() - new Date(b).getTime()
        );

        // Process each date and create submission
        for (let i = 0; i < sortedDates.length; i++) {
          const date = sortedDates[i];
          if (date === undefined) continue; // noUncheckedIndexedAccess: i is always in-bounds here, but narrow for TS

          // Reconstruct the streak that ended ON this historical date (period-aware:
          // days for daily habits, ISO weeks for weekly). `streakEndingOnForHabit`
          // walks backward from `date`, so passing the full `sortedDates` is correct —
          // completions after `date` are ignored. The previous `calculateStreak` returned
          // the streak ending today/yesterday, so it was 0 for every past date.
          const streakAtTime = streakEndingOnForHabit(
            { period: habit.period, completedDates: sortedDates },
            date
          );

          // Calculate multiplier (period-aware: weekly habits use week thresholds)
          const multiplier = getMultiplier(streakAtTime, habit.type === 'positive', habit.period);

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

          const submissionRaw: Omit<HabitSubmission, 'id'> = {
            habitId: habit.id,
            habitTitle,
            timestamp,
            date,
            count: 1, // Assume 1 completion
            pointsEarned,
            streakDaysAtTime: streakAtTime,
            multiplierApplied: multiplier,
            createdBy: currentUser.uid,
            createdAt: new Date().toISOString(),
          };

          const submission = sanitizeSubmission(submissionRaw);

          // Write submission document
          const subRef = doc(db, `households/${householdId}/habits/${habit.id}/submissions`, submissionId);
          console.log(`Writing submission to: households/${householdId}/habits/${habit.id}/submissions/${submissionId}`);
          await setDoc(subRef, submission);

          newStats.submissionsCreated++;
          setStats({ ...newStats });
        }

        // Mark habit as having submission tracking
        const habitRef = doc(db, `households/${householdId}/habits`, habit.id);
        console.log(`Updating habit: households/${householdId}/habits/${habit.id}`);
        await updateDoc(habitRef, { hasSubmissionTracking: true });

        console.log(`Created ${sortedDates.length} submission(s) for "${habitTitle}"`);
      }

      setIsComplete(true);
      setCurrentHabit('');
      toast.success('Migration completed successfully!');

    } catch (err) {
      console.error('Migration error:', err);
      const errorMessage = String(err);

      // Provide helpful error messages
      if (errorMessage.includes('permission-denied')) {
        setError('Permission denied. Please ensure you are logged in and try refreshing the page. If the problem persists, try logging out and back in.');
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
    <div className="min-h-screen bg-brand-50 dark:bg-brand-900 p-4 pb-24">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <ArrowLeft size={24} className="text-brand-600 dark:text-brand-300" />
          </Button>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-brand-900 dark:text-brand-50">Migrate Habit Submissions</h1>
            <p className="text-sm text-brand-500 dark:text-brand-400">Backfill historical data for submission logs</p>
          </div>
        </div>

        {/* Info Card */}
        <div className="bg-accent-50 dark:bg-accent-900/30 border border-accent-200 dark:border-accent-700 rounded-card p-4 mb-6">
          <div className="flex gap-3">
            <AlertCircle className="text-accent-600 dark:text-accent-300 shrink-0" size={20} />
            <div className="text-sm text-brand-700 dark:text-brand-200">
              <p className="font-bold mb-2">What this does:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Creates detailed submission records from your existing habit completion dates</li>
                <li>Each date gets a submission timestamped at noon</li>
                <li>Points are calculated retroactively based on historical streaks</li>
                <li>Count is set to 1 per date (we don&apos;t have exact historical counts)</li>
                <li>Habits already migrated will be skipped</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Stats Card */}
        <div className="surface-section p-6 mb-6">
          <h2 className="font-display text-lg font-semibold text-brand-900 dark:text-brand-50 mb-4">Migration Summary</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-brand-50 dark:bg-brand-700/40 rounded-card">
              <div className="stat-num text-2xl font-bold text-brand-900 dark:text-brand-50">{habitsToMigrate.length}</div>
              <div className="text-xs text-brand-500 dark:text-brand-400">Habits to migrate</div>
            </div>
            <div className="text-center p-4 bg-money-bgPos dark:bg-money-pos/15 rounded-card">
              <div className="stat-num text-2xl font-bold text-money-pos dark:text-money-posDark">{stats.habitsProcessed}</div>
              <div className="text-xs text-money-pos dark:text-money-posDark">Processed</div>
            </div>
            <div className="text-center p-4 bg-accent-50 dark:bg-accent-900/30 rounded-card">
              <div className="stat-num text-2xl font-bold text-accent-700 dark:text-accent-300">{stats.submissionsCreated}</div>
              <div className="text-xs text-accent-700 dark:text-accent-300">Submissions created</div>
            </div>
          </div>
        </div>

        {/* Current Progress */}
        {isRunning && currentHabit && (
          <div className="surface-section p-6 mb-6">
            <div className="flex items-center gap-3">
              <Loader2 className="w-6 h-6 text-accent-600 dark:text-accent-300 animate-spin shrink-0" />
              <div>
                <p className="text-sm font-bold text-brand-900 dark:text-brand-50">Processing...</p>
                <p className="text-xs text-brand-500 dark:text-brand-400">{currentHabit}</p>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-money-bgNeg dark:bg-money-neg/15 border border-money-neg/20 dark:border-money-neg/30 rounded-card p-4 mb-6">
            <div className="flex gap-3">
              <AlertCircle className="text-money-neg dark:text-money-negDark shrink-0" size={20} />
              <div className="text-sm text-money-neg dark:text-money-negDark">
                <p className="font-bold mb-1">Migration Error</p>
                <p>{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Success */}
        {isComplete && (
          <div className="bg-money-bgPos dark:bg-money-pos/15 border border-money-pos/20 dark:border-money-pos/30 rounded-card p-4 mb-6">
            <div className="flex gap-3">
              <CheckCircle className="text-money-pos dark:text-money-posDark shrink-0" size={20} />
              <div className="text-sm text-money-pos dark:text-money-posDark">
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
            <Button
              size="lg"
              onClick={runMigration}
              isLoading={isRunning}
              disabled={habitsToMigrate.length === 0}
              className="flex-1 py-4"
              leftIcon={<PlayCircle size={20} />}
            >
              {isRunning ? 'Running Migration...' : 'Run Migration'}
            </Button>
          )}
          {isComplete && (
            <Button
              size="lg"
              onClick={() => navigate(-1)}
              className="flex-1 py-4"
            >
              Done
            </Button>
          )}
        </div>

        {habitsToMigrate.length === 0 && !isRunning && (
          <p className="text-center text-brand-500 dark:text-brand-400 text-sm mt-4">
            No habits to migrate. All habits either have submission tracking enabled or have no completed dates.
          </p>
        )}
      </div>
    </div>
  );
};

export default MigrateSubmissions;
