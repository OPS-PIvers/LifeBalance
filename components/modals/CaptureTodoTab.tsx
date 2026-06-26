import React, { useId } from 'react';
import { Calendar, AlertCircle } from 'lucide-react';
import { HouseholdMember } from '@/types/schema';
import { useAutoFocus } from '@/hooks/useAutoFocus';

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
  const taskInputId = useId();
  const dueDateInputId = useId();
  const taskInputRef = useAutoFocus<HTMLInputElement>();
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <label htmlFor={taskInputId} className="block text-xs font-bold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-1">
          Task
        </label>
        <input
          ref={taskInputRef}
          id={taskInputId}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter task description"
          className="w-full p-3 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-xl focus:ring-2 focus:ring-accent-500/30 focus:outline-hidden"
        />
      </div>

      <div>
        <label htmlFor={dueDateInputId} className="block text-xs font-bold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-1">
          Due Date
        </label>
        <div className="relative w-full">
          <input
            id={dueDateInputId}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="block w-full min-w-0 p-3 pl-10 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-xl focus:ring-2 focus:ring-accent-500/30 focus:outline-hidden appearance-none"
            style={{ WebkitAppearance: 'none' }}
          />
          <Calendar size={18} className="absolute left-3 top-3.5 text-brand-400 dark:text-brand-400 pointer-events-none" />
        </div>
      </div>

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

      <button
        onClick={onSubmit}
        disabled={members.length === 0 || !text.trim()}
        className={`w-full py-3.5 bg-accent-600 dark:bg-accent-500 text-white font-semibold rounded-btn shadow-btn-primary transition-all duration-(--duration-fast) ease-(--ease-standard) mt-4 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 ${
          members.length === 0 || !text.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent-700 dark:hover:bg-accent-400 active:scale-[0.98]'
        }`}
      >
        Create Task
      </button>
    </div>
  );
};
