/**
 * Migration Script: Backfill Habit Submissions
 *
 * This script creates detailed submission records from existing completedDates arrays.
 * Run once to populate historical data for the habit submission log.
 *
 * Usage: npx tsx scripts/migrateHabitSubmissions.ts
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  query,
} from 'firebase/firestore';
import { calculateStreak, getMultiplier } from '../utils/habitLogic';
import { Habit, HabitSubmission } from '../types/schema';

// Firebase config - uses same config as main app
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
  measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

interface MigrationStats {
  householdsProcessed: number;
  habitsProcessed: number;
  submissionsCreated: number;
  habitsSkipped: number;
  errors: string[];
}

async function migrateHabitSubmissions(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    householdsProcessed: 0,
    habitsProcessed: 0,
    submissionsCreated: 0,
    habitsSkipped: 0,
    errors: [],
  };

  try {
    console.log('🔍 Finding households...');
    const householdsSnapshot = await getDocs(collection(db, 'households'));

    console.log(`📊 Found ${householdsSnapshot.size} household(s)\n`);

    for (const householdDoc of householdsSnapshot.docs) {
      const householdId = householdDoc.id;
      console.log(`\n🏠 Processing household: ${householdId}`);
      stats.householdsProcessed++;

      // Get all habits for this household
      const habitsSnapshot = await getDocs(
        query(collection(db, `households/${householdId}/habits`))
      );

      console.log(`  📋 Found ${habitsSnapshot.size} habit(s)`);

      for (const habitDoc of habitsSnapshot.docs) {
        const habit = habitDoc.data() as Habit;
        const habitId = habitDoc.id;

        // Skip if already has submission tracking or no completed dates
        if (habit.hasSubmissionTracking) {
          console.log(`  ⏭️  Skipping "${habit.title}" - already has submission tracking`);
          stats.habitsSkipped++;
          continue;
        }

        if (!habit.completedDates || habit.completedDates.length === 0) {
          console.log(`  ⏭️  Skipping "${habit.title}" - no completed dates`);
          stats.habitsSkipped++;
          continue;
        }

        console.log(`  ✨ Migrating "${habit.title}" (${habit.completedDates.length} dates)`);
        stats.habitsProcessed++;

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
            // Incremental: basePoints * multiplier per completion
            pointsEarned = Math.floor(habit.basePoints * multiplier);
          } else {
            // Threshold: basePoints * multiplier when target hit
            // Assume 1 completion = target reached for backfilled data
            pointsEarned = Math.floor(habit.basePoints * multiplier);
          }

          // Create submission document
          const submissionId = `backfill_${date}`;
          const timestamp = `${date}T12:00:00.000Z`; // Noon UTC

          const submission: Omit<HabitSubmission, 'id'> = {
            habitId,
            habitTitle: habit.title,
            timestamp,
            date,
            count: 1, // Assume 1 completion (we don't have historical count data)
            pointsEarned,
            streakDaysAtTime: streakAtTime,
            multiplierApplied: multiplier,
            createdBy: 'migration_script',
            createdAt: new Date().toISOString(),
          };

          // Write to Firestore
          await setDoc(
            doc(db, `households/${householdId}/habits/${habitId}/submissions`, submissionId),
            submission
          );

          stats.submissionsCreated++;
        }

        // Mark habit as having submission tracking
        await updateDoc(
          doc(db, `households/${householdId}/habits`, habitId),
          { hasSubmissionTracking: true }
        );

        console.log(`  ✅ Created ${sortedDates.length} submission(s) for "${habit.title}"`);
      }
    }

    console.log('\n✅ Migration completed successfully!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    stats.errors.push(String(error));
  }

  return stats;
}

// Run migration
console.log('🚀 Starting Habit Submissions Migration\n');
console.log('This will create detailed submission records from existing completedDates.');
console.log('Submissions will be timestamped at noon on each date.\n');

migrateHabitSubmissions()
  .then((stats) => {
    console.log('📊 Migration Statistics:');
    console.log(`   Households: ${stats.householdsProcessed}`);
    console.log(`   Habits migrated: ${stats.habitsProcessed}`);
    console.log(`   Habits skipped: ${stats.habitsSkipped}`);
    console.log(`   Submissions created: ${stats.submissionsCreated}`);

    if (stats.errors.length > 0) {
      console.log(`\n⚠️  Errors encountered:`);
      stats.errors.forEach((error, i) => {
        console.log(`   ${i + 1}. ${error}`);
      });
      process.exit(1);
    } else {
      console.log('\n🎉 All done! Your habit submission logs are now populated with historical data.');
      process.exit(0);
    }
  })
  .catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
