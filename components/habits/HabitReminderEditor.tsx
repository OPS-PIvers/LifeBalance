import React from 'react';
import { Bell } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import type { Habit, HabitReminderConfig } from '@/types/schema';
import {
  ALL_DAYS,
  DAY_LABELS_INITIAL,
  DAY_LABELS_SHORT,
  defaultHabitReminder,
  formatReminderSummary,
  WEEKDAYS,
} from '@/utils/habitReminders';

interface HabitReminderEditorProps {
  /** Current config, or null when this habit has no reminder. */
  value: HabitReminderConfig | null;
  /** Emits the next config, or null when the reminder is switched off. */
  onChange: (next: HabitReminderConfig | null) => void;
  /** Drives the seeded default: weekly habits start on one day, not seven. */
  period: Habit['period'];
  disabled?: boolean;
}

/**
 * F-HABITS-03 — the per-habit reminder control in the habit form.
 *
 * Controlled: the parent owns the config and persists it to the MEMBER doc on
 * save (reminders are per-member, so they can't ride along on the habit write).
 * Switching off emits null rather than `enabled: false` — an off reminder keeps
 * no schedule worth remembering, and a null clears the map entry outright.
 */
const HabitReminderEditor: React.FC<HabitReminderEditorProps> = ({
  value,
  onChange,
  period,
  disabled = false,
}) => {
  const enabled = value?.enabled === true;

  const toggleDay = (day: number) => {
    if (!value) return;
    const days = value.days.includes(day)
      ? value.days.filter(d => d !== day)
      : [...value.days, day].sort((a, b) => a - b);
    onChange({ ...value, days });
  };

  const setPreset = (days: readonly number[]) => {
    if (!value) return;
    onChange({ ...value, days: [...days] });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span
            className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase"
            id="habit-reminder-label"
          >
            Remind me
          </span>
          <p className="text-xxs text-brand-400 dark:text-brand-400 mt-0.5">
            A push at your chosen time, only if the habit isn&rsquo;t done yet.
          </p>
        </div>
        <Switch
          tone="warm"
          checked={enabled}
          disabled={disabled}
          aria-labelledby="habit-reminder-label"
          onCheckedChange={next => onChange(next ? defaultHabitReminder(period) : null)}
        />
      </div>

      {enabled && value && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2">
            <label
              htmlFor="habit-reminder-time"
              className="text-xxs font-bold text-brand-400 dark:text-brand-400 uppercase"
            >
              Time
            </label>
            <input
              id="habit-reminder-time"
              type="time"
              value={value.time}
              onChange={e => onChange({ ...value, time: e.target.value })}
              disabled={disabled}
              className="p-2 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-lg font-mono text-sm disabled:opacity-50"
            />
          </div>

          <div>
            <span
              className="text-xxs font-bold text-brand-400 dark:text-brand-400 uppercase"
              id="habit-reminder-days-label"
            >
              Days
            </span>
            <div
              className="flex flex-wrap gap-1.5 mt-1.5"
              role="group"
              aria-labelledby="habit-reminder-days-label"
            >
              {ALL_DAYS.map(day => {
                const selected = value.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    disabled={disabled}
                    aria-pressed={selected}
                    // The visible label is a single ambiguous letter (two T's,
                    // two S's), so the accessible name carries the full day.
                    aria-label={DAY_LABELS_SHORT[day]}
                    className={`w-9 h-9 rounded-btn border text-xs font-bold transition-colors duration-(--duration-fast) ease-(--ease-standard) disabled:opacity-50 ${
                      selected
                        ? 'bg-warm-500 border-warm-500 text-white'
                        : 'bg-white dark:bg-brand-800 border-warm-200 dark:border-warm-800/60 text-warm-700 dark:text-warm-300 hover:bg-warm-100 dark:hover:bg-warm-900/30'
                    }`}
                  >
                    {DAY_LABELS_INITIAL[day]}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3 mt-2">
              <button
                type="button"
                onClick={() => setPreset(ALL_DAYS)}
                disabled={disabled}
                className="text-xxs font-bold text-warm-700 dark:text-warm-300 underline underline-offset-2 disabled:opacity-50"
              >
                Every day
              </button>
              <button
                type="button"
                onClick={() => setPreset(WEEKDAYS)}
                disabled={disabled}
                className="text-xxs font-bold text-warm-700 dark:text-warm-300 underline underline-offset-2 disabled:opacity-50"
              >
                Weekdays
              </button>
            </div>
          </div>

          <p className="flex items-center gap-1.5 text-xxs text-brand-500 dark:text-brand-300">
            <Bell size={12} aria-hidden="true" className="shrink-0" />
            {value.days.length === 0
              ? 'Pick at least one day, or this reminder never fires.'
              : formatReminderSummary(value)}
          </p>
        </div>
      )}
    </div>
  );
};

export default HabitReminderEditor;
