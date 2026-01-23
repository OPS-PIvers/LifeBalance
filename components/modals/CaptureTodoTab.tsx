import React from 'react';
import { Calendar, AlertCircle } from 'lucide-react';
import { HouseholdMember } from '../../types/schema';

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
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <label htmlFor="task-input" className="block text-xs font-bold text-brand-500 uppercase tracking-wider mb-1">
          Task
        </label>
        <input
          id="task-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter task description"
          className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="due-date-input" className="block text-xs font-bold text-brand-500 uppercase tracking-wider mb-1">
          Due Date
        </label>
        <div className="relative w-full">
          <input
            id="due-date-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="block w-full min-w-0 p-3 pl-10 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none appearance-none"
            style={{ WebkitAppearance: 'none' }}
          />
          <Calendar size={18} className="absolute left-3 top-3.5 text-brand-400 pointer-events-none" />
        </div>
      </div>

      <fieldset>
        <legend className="block text-xs font-bold text-brand-500 uppercase tracking-wider mb-1">
          Assign To
        </legend>
        {members.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-brand-400 py-2">
            <AlertCircle size={16} className="flex-shrink-0" />
            <span>No household members available.</span>
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Assign task to member">
            {members.map(member => (
              <button
                key={member.uid}
                type="button"
                onClick={() => setAssignee(member.uid)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all whitespace-nowrap ${
                  assignee === member.uid
                    ? 'bg-brand-800 text-white border-brand-800 shadow-md'
                    : 'bg-white text-brand-600 border-brand-200 hover:bg-brand-50'
                }`}
              >
                {member.photoURL ? (
                  <img src={member.photoURL} alt="" className="w-5 h-5 rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-brand-200 flex items-center justify-center text-xxs font-bold text-brand-600">
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
        disabled={members.length === 0}
        className={`w-full py-3.5 bg-brand-800 text-white font-bold rounded-xl shadow-lg transition-all mt-4 ${
          members.length === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-brand-900 active:scale-[0.98]'
        }`}
      >
        Create Task
      </button>
    </div>
  );
};
