/* eslint-disable */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHousehold } from '../contexts/FirebaseHouseholdContext';
import HabitCard from '../components/habits/HabitCard';
import { Habit } from '../types/schema';
import { Settings, Database, ArrowRight, Download } from 'lucide-react';
import HabitCreatorWizard from '../components/modals/HabitCreatorWizard';
import { generateCsvExport } from '../utils/exportUtils';
import toast from 'react-hot-toast';

const Habits: React.FC = () => {
  const navigate = useNavigate();
  const { habits } = useHousehold();
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  // Check if there are habits that need migration
  const habitsNeedingMigration = habits.filter(
    h => !h.hasSubmissionTracking && h.completedDates && h.completedDates.length > 0
  );

  // Group Habits by Category
  const categories: string[] = Array.from(new Set(habits.map(h => h.category)));
  const groupedHabits: Record<string, Habit[]> = categories.reduce((acc, category) => {
    acc[category] = habits.filter(h => h.category === category);
    return acc;
  }, {} as Record<string, Habit[]>);

  const handleExport = () => {
    try {
      if (habits.length === 0) {
        toast.error('No habits to export');
        return;
      }

      const exportData = habits.map(habit => ({
        'Title': habit.title,
        'Category': habit.category,
        'Type': habit.type === 'positive' ? 'Positive' : 'Negative',
        'Current Count': habit.count,
        'Target Count': habit.targetCount,
        'Streak Days': habit.streakDays,
        'Lifetime Count': habit.totalCount,
        'Total Completions (Days)': habit.completedDates.length,
        'Last Updated': habit.lastUpdated ? new Date(habit.lastUpdated).toLocaleDateString() : 'N/A',
        'Scoring Type': habit.scoringType,
        'Base Points': habit.basePoints
      }));

      // Sort by Category then Title
      exportData.sort((a, b) => {
        if (a.Category !== b.Category) return a.Category.localeCompare(b.Category);
        return a.Title.localeCompare(b.Title);
      });

      generateCsvExport(exportData, 'habits-export');
      toast.success('Export started');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export habits');
    }
  };

  return (
    <div className="min-h-screen bg-brand-50 pb-28 pt-6">

      {/* Page Title & Action */}
      <div className="px-4 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-800">Daily Habits</h1>
          <p className="text-sm text-brand-400">Build your streak, earn rewards.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={habits.length === 0}
            className="bg-white text-brand-600 border border-brand-200 px-3 py-2 rounded-xl text-sm font-bold shadow-sm active:scale-95 transition-transform flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Export habits to CSV"
          >
            <Download size={16} />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            onClick={() => setIsWizardOpen(true)}
            className="bg-brand-800 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm active:scale-95 transition-transform flex items-center gap-2"
          >
            <Settings size={16} /> Manage
          </button>
        </div>
      </div>

      {/* Migration Banner */}
      {habitsNeedingMigration.length > 0 && (
        <div className="px-4 mb-6">
          <button
            onClick={() => navigate('/migrate-submissions')}
            className="w-full bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-2xl p-4 shadow-lg hover:shadow-xl transition-all active:scale-98"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 p-2 rounded-xl">
                  <Database size={24} />
                </div>
                <div className="text-left">
                  <h3 className="font-bold text-base">Backfill Historical Data</h3>
                  <p className="text-xs text-white/90 mt-0.5">
                    {habitsNeedingMigration.length} habit{habitsNeedingMigration.length !== 1 ? 's' : ''} ready to migrate
                  </p>
                </div>
              </div>
              <ArrowRight size={20} />
            </div>
          </button>
        </div>
      )}

      {/* Habits List */}
      <div className="px-4 space-y-6">
        {categories.length === 0 && (
          <div className="text-center py-12 border-2 border-dashed border-brand-200 rounded-2xl text-brand-400">
            <p>No habits yet.</p>
            <p className="text-xs mt-1">Tap "New" to start tracking.</p>
          </div>
        )}

        {categories.map(category => (
          <div key={category}>
            <h2 className="text-xs font-bold text-brand-400 uppercase tracking-wider mb-3 ml-2">
              {category}
            </h2>
            <div className="space-y-3">
              {groupedHabits[category].map(habit => (
                <HabitCard key={habit.id} habit={habit} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <HabitCreatorWizard isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />
    </div>
  );
};

export default Habits;
