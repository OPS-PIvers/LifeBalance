import React, { useState, useMemo, useEffect } from 'react';
import { useHousehold } from '../contexts/FirebaseHouseholdContext';
import { Plus, Calendar, Check, Trash2, Edit2, AlertCircle, X, Clock, User } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO, isBefore, addDays, startOfToday, endOfWeek } from 'date-fns';
import { ToDo, HouseholdMember } from '../types/schema';
import toast from 'react-hot-toast';
import { showDeleteConfirmation } from '../utils/toastHelpers';

const ToDosPage: React.FC = () => {
  const { todos, addToDo, updateToDo, deleteToDo, completeToDo, members, currentUser } = useHousehold();

  // Track current date to trigger re-categorization at midnight
  const [currentDate, setCurrentDate] = useState(() => startOfToday());

  // Update date at midnight
  useEffect(() => {
    const scheduleNextMidnight = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const msUntilMidnight = tomorrow.getTime() - now.getTime();
      
      return setTimeout(() => {
        setCurrentDate(startOfToday());
        // Schedule the next midnight check
        scheduleNextMidnight();
      }, msUntilMidnight);
    };

    const timeoutId = scheduleNextMidnight();
    return () => clearTimeout(timeoutId);
  }, [currentDate]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isAddModalOpen) {
        setIsAddModalOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isAddModalOpen]);

  // Create a safe user object to avoid undefined access
  const safeUser = currentUser || { uid: '', displayName: 'User', photoURL: null };

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [text, setText] = useState('');
  const [completeByDate, setCompleteByDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [assignedTo, setAssignedTo] = useState('');

  // Open modal for adding
  const openAddModal = () => {
    setText('');
    setCompleteByDate(format(new Date(), 'yyyy-MM-dd'));
    // If current user has no UID (safeUser fallback), try first member or empty
    const defaultAssignee = safeUser.uid || (members.length > 0 ? members[0].uid : '');
    setAssignedTo(defaultAssignee);
    setEditingId(null);
    setIsAddModalOpen(true);
  };

  // Open modal for editing
  const openEditModal = (todo: ToDo) => {
    setText(todo.text);
    setCompleteByDate(todo.completeByDate);
    setAssignedTo(todo.assignedTo);
    setEditingId(todo.id);
    setIsAddModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate assignee against members list
    const isValidAssignee = members.some(member => member.uid === assignedTo);

    // First, ensure all required fields are filled
    if (!text.trim() || !completeByDate || !assignedTo) {
      toast.error('Please fill in all required fields');
      return;
    }

    // Then, ensure the selected assignee is a valid household member
    if (!isValidAssignee) {
      toast.error('Please select a valid household member to assign this task to');
      return;
    }

    try {
      const trimmedText = text.trim();
      if (editingId) {
        await updateToDo(editingId, {
          text: trimmedText,
          completeByDate,
          assignedTo
        });
        toast.success('Task updated');
      } else {
        await addToDo({
          text: trimmedText,
          completeByDate,
          assignedTo,
          isCompleted: false
        });
      }
      setIsAddModalOpen(false);
    } catch (error) {
      console.error('Error saving to-do:', error);
      toast.error('Failed to save to-do. Please try again.');
    }
  };

  // Categorize To-Dos
  const { immediate, upcoming, radar } = useMemo(() => {
    const active = todos.filter(t => !t.isCompleted);
    const today = currentDate;
    const endOfCurrentWeek = endOfWeek(today, { weekStartsOn: 1 }); // Monday start

    const immediate: ToDo[] = [];
    const upcoming: ToDo[] = [];
    const radar: ToDo[] = [];

    active.forEach(todo => {
      const date = parseISO(todo.completeByDate);

      if (isBefore(date, today) || isToday(date) || isTomorrow(date)) {
        immediate.push(todo);
      } else if (isBefore(date, addDays(endOfCurrentWeek, 1))) { // Within this week
        upcoming.push(todo);
      } else {
        radar.push(todo);
      }
    });

    // Sort by date
    const sortByCompleteByDate = (a: ToDo, b: ToDo) =>
      new Date(a.completeByDate).getTime() - new Date(b.completeByDate).getTime();

    return {
      immediate: immediate.sort(sortByCompleteByDate),
      upcoming: upcoming.sort(sortByCompleteByDate),
      radar: radar.sort(sortByCompleteByDate)
    };
  }, [todos, currentDate]);

  // Swipe Action Implementation
  // Swiping is not implemented in this MVP web/PWA version to avoid adding external
  // dependencies or complex touch handling logic. Instead, equivalent actions are
  // exposed via clearly labeled, mobile-friendly buttons.
  // TODO: If a swipe interaction library is added in the future, replace button-based
  // actions with real swipe gestures where appropriate.

  return (
    <div className="pb-24 pt-6 px-4 max-w-2xl mx-auto space-y-8 min-h-screen">

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-800">To-Do List</h1>
          <p className="text-sm text-brand-500">Stay on top of your tasks</p>
        </div>
        <button
          onClick={openAddModal}
          className="p-3 bg-brand-800 text-white rounded-full shadow-lg hover:bg-brand-700 active:scale-95 transition-all"
          aria-label="Add new task"
        >
          <Plus size={24} />
        </button>
      </div>

      {/* Immediate Section */}
      <Section
        title="Immediate"
        subtitle="Overdue, Today & Tomorrow"
        items={immediate}
        color="rose"
        onComplete={completeToDo}
        onEdit={openEditModal}
        onDelete={deleteToDo}
        members={members}
      />

      {/* Upcoming Section */}
      <Section
        title="Upcoming"
        subtitle="This Week"
        items={upcoming}
        color="amber"
        onComplete={completeToDo}
        onEdit={openEditModal}
        onDelete={deleteToDo}
        members={members}
      />

      {/* On The Radar Section */}
      <Section
        title="On the Radar"
        subtitle="Future"
        items={radar}
        color="blue"
        onComplete={completeToDo}
        onEdit={openEditModal}
        onDelete={deleteToDo}
        members={members}
      />

      {/* Add/Edit Modal */}
      {isAddModalOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in"
          onClick={(e) => {
            // Close modal when clicking backdrop
            if (e.target === e.currentTarget) {
              setIsAddModalOpen(false);
            }
          }}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl scale-100 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-brand-800">
                {editingId ? 'Edit Task' : 'New Task'}
              </h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-2 hover:bg-brand-50 rounded-full transition-colors"
                aria-label="Close dialog"
              >
                <X size={20} className="text-brand-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
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
                <div className="relative">
                  <input
                    id="due-date-input"
                    type="date"
                    value={completeByDate}
                    onChange={(e) => setCompleteByDate(e.target.value)}
                    className="w-full p-3 pl-10 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                  />
                  <Calendar size={18} className="absolute left-3 top-3.5 text-brand-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-brand-500 uppercase tracking-wider mb-1">
                  Assign To
                </label>
                {members.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-brand-400 py-2">
                    <AlertCircle size={16} className="flex-shrink-0" />
                    <span>No household members available to assign this task.</span>
                  </div>
                ) : (
                  <fieldset className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Assign task to member">
                    {members.map(member => (
                      <button
                        key={member.uid}
                        type="button"
                        onClick={() => setAssignedTo(member.uid)}
                        aria-label={`Assign to ${member.displayName || 'User'}`}
                        aria-pressed={assignedTo === member.uid}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all whitespace-nowrap ${
                          assignedTo === member.uid
                            ? 'bg-brand-800 text-white border-brand-800 shadow-md'
                            : 'bg-white text-brand-600 border-brand-200 hover:bg-brand-50'
                        }`}
                      >
                        {member.photoURL ? (
                          <img src={member.photoURL} alt="" className="w-5 h-5 rounded-full" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-brand-200 flex items-center justify-center text-[10px] font-bold text-brand-600">
                            {member.displayName?.charAt(0) ?? 'U'}
                          </div>
                        )}
                        <span className="text-sm font-medium">{member.displayName?.split(' ')[0] ?? 'User'}</span>
                      </button>
                    ))}
                  </fieldset>
                )}
              </div>

              <button
                type="submit"
                disabled={members.length === 0}
                className={`w-full py-3.5 bg-brand-800 text-white font-bold rounded-xl shadow-lg transition-all mt-4 ${
                  members.length === 0
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-brand-900 active:scale-[0.98]'
                }`}
              >
                {editingId ? 'Save Changes' : 'Create Task'}
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

// Sub-component for sections
const Section: React.FC<{
  title: string;
  subtitle: string;
  items: ToDo[];
  color: 'rose' | 'amber' | 'blue';
  onComplete: (id: string) => void;
  onEdit: (todo: ToDo) => void;
  onDelete: (id: string) => void;
  members: HouseholdMember[];
}> = ({ title, subtitle, items, color, onComplete, onEdit, onDelete, members }) => {

  if (items.length === 0) return null;

  // Create member lookup Map for O(1) access instead of O(n) for each item
  const memberMap = useMemo(() => {
    const map = new Map<string, HouseholdMember>();
    members.forEach(member => map.set(member.uid, member));
    return map;
  }, [members]);

  const colorStyles = {
    rose: 'text-rose-600 bg-rose-50 border-rose-100',
    amber: 'text-amber-600 bg-amber-50 border-amber-100',
    blue: 'text-blue-600 bg-blue-50 border-blue-100',
  };

  const badgeStyles = {
    rose: 'bg-rose-100 text-rose-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
  };

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-baseline justify-between mb-3 px-1">
        <h2 className={`text-lg font-bold ${colorStyles[color].split(' ')[0]}`}>{title}</h2>
        <span className="text-xs font-medium text-brand-400 uppercase tracking-wider">{subtitle}</span>
      </div>

      <div className="space-y-3">
        {items.map(item => {
           const assignee = memberMap.get(item.assignedTo);

           return (
             <div
                key={item.id}
                className="bg-white rounded-2xl p-4 shadow-sm border border-brand-100 transition-all active:scale-[0.99]"
             >
               <div className="flex items-start gap-3">
                 {/* Complete Checkbox */}
                 <button
                   onClick={() => onComplete(item.id)}
                   className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                     color === 'rose' ? 'border-rose-200 hover:bg-rose-50 active:bg-rose-100' :
                     color === 'amber' ? 'border-amber-200 hover:bg-amber-50 active:bg-amber-100' :
                     'border-blue-200 hover:bg-blue-50 active:bg-blue-100'
                   }`}
                   aria-label="Complete task"
                 >
                   <Check size={14} className="text-transparent hover:text-current active:text-current transition-colors" />
                 </button>

                 <div className="flex-1 min-w-0">
                   <p className="font-medium text-brand-800 leading-snug">{item.text}</p>

                   <div className="flex flex-wrap items-center gap-2 mt-2">
                     {isBefore(parseISO(item.completeByDate), startOfToday()) ? (
                       <div className="flex items-center gap-1 text-xs px-2 py-1 rounded-md font-bold bg-red-100 text-red-700">
                          <AlertCircle size={10} />
                          Overdue ({format(parseISO(item.completeByDate), 'MMM d')})
                       </div>
                     ) : (
                       <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md font-medium ${badgeStyles[color]}`}>
                          <Clock size={10} />
                          {isToday(parseISO(item.completeByDate)) ? 'Today' :
                           isTomorrow(parseISO(item.completeByDate)) ? 'Tomorrow' :
                           format(parseISO(item.completeByDate), 'MMM d')}
                       </div>
                     )}

                     {assignee && (
                       <div className="flex items-center gap-1 text-xs text-brand-400 bg-brand-50 px-2 py-1 rounded-md">
                         {assignee.photoURL ? (
                           <img src={assignee.photoURL} className="w-3 h-3 rounded-full" alt="" />
                         ) : (
                           <User size={10} />
                         )}
                         <span>{assignee.displayName?.split(' ')[0] ?? 'Member'}</span>
                       </div>
                     )}
                   </div>
                 </div>

                 {/* Edit/Delete Actions (Always Visible) */}
                 <div className="flex items-center gap-1 pl-2">
                    <button
                      onClick={() => onEdit(item)}
                      className="p-2 text-brand-300 hover:text-brand-600 active:text-brand-800 active:bg-brand-50 rounded-lg transition-colors"
                      aria-label="Edit task"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => {
                        showDeleteConfirmation(async () => {
                          await onDelete(item.id);
                          toast.success('Task deleted');
                        });
                      }}
                      className="p-2 text-brand-300 hover:text-rose-600 active:text-rose-700 active:bg-rose-50 rounded-lg transition-colors"
                      aria-label="Delete task"
                    >
                      <Trash2 size={16} />
                    </button>
                 </div>
               </div>
             </div>
           );
        })}
      </div>
    </div>
  );
};

export default ToDosPage;
