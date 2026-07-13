import React from 'react';
import { Calendar, AlertCircle } from 'lucide-react';
import { HouseholdMember } from '@/types/schema';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';

interface CaptureTodoTabProps {
  text: string;
  setText: (value: string) => void;
  date: string;
  setDate: (value: string) => void;
  assignee: string;
  setAssignee: (value: string) => void;
  members: HouseholdMember[];
  onSubmit: () => void;
}

export const CaptureTodoTab: React.FC<CaptureTodoTabProps> = ({
  text,
  setText,
  date,
  setDate,
  assignee,
  setAssignee,
  members,
  onSubmit,
}) => {
  const taskInputRef = useAutoFocus<HTMLInputElement>();
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-(--duration-base)">
      <Input
        ref={taskInputRef}
        label="Task"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter task description"
      />

      <Input
        label="Due Date"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        icon={<Calendar size={18} />}
      />

      <fieldset>
        <legend className="block text-xs font-bold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-1">
          Assign To
        </legend>
        {members.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-brand-400 dark:text-brand-400 py-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>No household members available.</span>
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Assign task to member">
            {members.map(member => (
              <button
                key={member.uid}
                type="button"
                onClick={() => setAssignee(member.uid)}
                aria-pressed={assignee === member.uid}
                className={`flex items-center gap-2 px-3 py-2 rounded-btn border transition-colors duration-(--duration-fast) ease-(--ease-standard) whitespace-nowrap ${
                  assignee === member.uid
                    ? 'bg-accent-600 text-white border-accent-600 dark:bg-accent-500 dark:border-accent-500'
                    : 'bg-white dark:bg-brand-800 text-brand-600 dark:text-brand-300 border-brand-200 dark:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-700/50'
                }`}
              >
                {member.photoURL ? (
                  <img src={member.photoURL} alt={member.displayName ?? 'Member'} className="w-5 h-5 rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-brand-200 dark:bg-brand-700 flex items-center justify-center text-xxs font-bold text-brand-600 dark:text-brand-300">
                    {member.displayName?.charAt(0) ?? 'U'}
                  </div>
                )}
                <span className="text-sm font-medium">{member.displayName?.split(' ')[0] ?? 'User'}</span>
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <Button
        onClick={onSubmit}
        disabled={members.length === 0 || !text.trim()}
        size="lg"
        className="w-full mt-4"
      >
        Create Task
      </Button>
    </div>
  );
};
