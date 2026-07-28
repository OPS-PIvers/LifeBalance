import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import Textarea from '@/components/ui/Textarea';
import { cn } from '@/utils/cn';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { HabitMood } from '@/types/schema';

const MOOD_OPTIONS: { value: HabitMood; emoji: string; label: string }[] = [
  { value: 'great', emoji: '😄', label: 'Great' },
  { value: 'good', emoji: '🙂', label: 'Good' },
  { value: 'meh', emoji: '😐', label: 'Meh' },
  { value: 'rough', emoji: '😣', label: 'Rough' },
];

const NOTE_MAX_LENGTH = 280;

interface ReflectionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  habitId: string;
  habitTitle: string;
}

/**
 * F-HABITS-06 owner note (2): a one-tap "add a note/mood" affordance
 * reachable straight from a habit card after completing it. Persists via
 * `addHabitSubmission` with `count: 0` — a note-only entry that never touches
 * points/streaks (see the useHabitActions comment on the 0-count branch) but
 * reuses the same submission storage the Log/Stats/Calendar tabs already read.
 */
const ReflectionDrawer: React.FC<ReflectionDrawerProps> = ({ isOpen, onClose, habitId, habitTitle }) => {
  const { addHabitSubmission } = useGamification();
  const [mood, setMood] = useState<HabitMood | undefined>(undefined);
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleClose = () => {
    setMood(undefined);
    setNote('');
    onClose();
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await addHabitSubmission(habitId, 0, undefined, note.trim() || undefined, mood);
      handleClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      title={`Reflect on "${habitTitle}"`}
      footer={
        <div className="flex gap-2 border-t border-brand-200 dark:border-brand-700 p-4">
          <Button variant="secondary" className="flex-1" onClick={handleClose} disabled={isSaving}>
            Skip
          </Button>
          <Button variant="primary" className="flex-1" onClick={handleSave} isLoading={isSaving}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-2">
            How did it go?
          </p>
          <div className="grid grid-cols-4 gap-2">
            {MOOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMood(mood === option.value ? undefined : option.value)}
                className={cn(
                  'flex flex-col items-center gap-1 py-3 rounded-btn border transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                  mood === option.value
                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-500/15 dark:border-accent-400'
                    : 'border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 hover:bg-brand-50 dark:hover:bg-brand-700/50'
                )}
                aria-pressed={mood === option.value}
                aria-label={option.label}
              >
                <span className="text-2xl" aria-hidden="true">{option.emoji}</span>
                <span className="text-xxs font-semibold text-brand-600 dark:text-brand-300">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <Textarea
          label="Note (optional)"
          placeholder="Anything worth remembering?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={NOTE_MAX_LENGTH}
          showCount
          rows={3}
        />
      </div>
    </Drawer>
  );
};

export default ReflectionDrawer;
