import React from 'react';
import { Edit2, Trash2, Settings } from 'lucide-react';
import { Habit } from '@/types/schema';
import { EFFORT_COLORS, EFFORT_LABELS } from '@/data/presetHabits';

interface CustomHabitListProps {
  habits: Habit[];
  onEdit: (habit: Habit) => void;
  onDelete: (habit: Habit) => void;
}

const CustomHabitList: React.FC<CustomHabitListProps> = ({
  habits,
  onEdit,
  onDelete,
}) => {
  if (habits.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Settings size={14} className="text-brand-400" />
        <h3 className="text-xs font-bold text-brand-400 uppercase tracking-wider">
          Your Custom Habits
        </h3>
      </div>
      <div className="space-y-2">
        {habits.map(habit => (
          <div
            key={habit.id}
            className="flex items-center justify-between p-3 bg-white border border-brand-100 rounded-xl"
          >
            <div className="flex items-center gap-3">
              <div className={`w-2 h-8 rounded-full ${habit.type === 'positive' ? 'bg-money-pos' : 'bg-money-neg'}`} />
              <div>
                <p className="font-semibold text-brand-800 text-sm">{habit.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-brand-400">{habit.category}</span>
                  {habit.effortLevel && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${EFFORT_COLORS[habit.effortLevel].bg} ${EFFORT_COLORS[habit.effortLevel].text}`}>
                      {EFFORT_LABELS[habit.effortLevel]}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onEdit(habit)}
                className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"
                aria-label={`Edit habit: ${habit.title}`}
              >
                <Edit2 size={16} />
              </button>
              <button
                onClick={() => onDelete(habit)}
                className="p-2 text-brand-400 hover:text-money-neg hover:bg-rose-50 rounded-lg"
                aria-label={`Delete habit: ${habit.title}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CustomHabitList;
