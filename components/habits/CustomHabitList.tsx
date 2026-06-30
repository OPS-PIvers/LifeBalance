import React from 'react';
import { Edit2, Trash2, Settings } from 'lucide-react';
import { Habit } from '@/types/schema';
import { EFFORT_LABELS } from '@/data/presetHabits';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SurfaceList, Row } from '@/components/ui/Section';

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
        <Settings size={14} className="text-brand-400 dark:text-brand-500" />
        <h3 className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase tracking-wider">
          Your Custom Habits
        </h3>
      </div>
      <SurfaceList>
        {habits.map(habit => (
          <Row key={habit.id}>
            <div className={`w-2 h-8 rounded-full shrink-0 ${habit.type === 'positive' ? 'bg-money-pos' : 'bg-money-neg'}`} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-brand-800 dark:text-brand-100 text-sm">{habit.title}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xxs text-brand-400 dark:text-brand-400">{habit.category}</span>
                {habit.effortLevel && (
                  <Badge size="sm" variant="warning">{EFFORT_LABELS[habit.effortLevel]}</Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon-sm" onClick={() => onEdit(habit)} aria-label={`Edit habit: ${habit.title}`}>
                <Edit2 size={16} />
              </Button>
              <Button variant="ghost-destructive" size="icon-sm" onClick={() => onDelete(habit)} aria-label={`Delete habit: ${habit.title}`}>
                <Trash2 size={16} />
              </Button>
            </div>
          </Row>
        ))}
      </SurfaceList>
    </div>
  );
};

export default CustomHabitList;
