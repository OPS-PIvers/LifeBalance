import React, { useState, useMemo, useEffect } from 'react';
import { useHousehold } from '../contexts/FirebaseHouseholdContext';
import { Plus, Calendar, Check, Trash2, Edit2, AlertCircle, X, Clock, User, Download } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO, isBefore, addDays, startOfToday, endOfWeek } from 'date-fns';
import { ToDo, HouseholdMember } from '../types/schema';
import toast from 'react-hot-toast';
import { showDeleteConfirmation } from '../utils/toastHelpers';
import { generateCsvExport } from '../utils/exportUtils';
import { Modal } from '../components/ui/Modal';

const ToDosPage: React.FC = () => {
  const { todos, addToDo, updateToDo, deleteToDo, completeToDo, members, currentUser } = useHousehold();

  // Track current date to trigger re-categorization at midnight
  const [currentDate, setCurrentDate] = useState(() => startOfToday());

  // Modal and form state - declared before useEffect that references them
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Update date at midnight using recursive setTimeout pattern
  // Note: This pattern is preferred over setInterval because:
  // 1. We need to trigger exactly at midnight (00:00:00), not at regular intervals
  // 2. Each timeout reschedules itself to the next midnight after firing
  // 3. The cleanup function properly clears the timeout on unmount/dependency change
  // 4. No accumulation of callbacks occurs because the recursive call only happens
  //    inside the timeout callback itself, and cleanup clears the active timeout
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    
    const scheduleNextMidnight = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const msUntilMidnight = tomorrow.getTime() - now.getTime();
      
      timeoutId = setTimeout(() => {
        setCurrentDate(startOfToday());
        // Schedule the next midnight check
        scheduleNextMidnight();
      }, msUntilMidnight);
    };

    scheduleNextMidnight();
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, []); // Run once on mount to initiate recurring midnight checks

  // Form State
  const [text, setText] = useState('');
  const [completeByDate, setCompleteByDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [assignedTo, setAssignedTo] = useState('');

  // Categorize To-Dos
  const { immediate, upcoming, radar } = useMemo(() => {
    const active = todos.filter(t => !t.isCompleted);
    const today = currentDate;
    const endOfCurrentWeek = endOfWeek(today, { weekStartsOn: 1 }); // Monday start

    const immediate: ToDo[] = [];
    const upcoming: ToDo[] = [];
    const radar: ToDo[] = [];

    // Create a map of parsed dates for efficient sorting
    const dateMap = new Map<string, number>();

    active.forEach(todo => {
      const date = parseISO(todo.completeByDate);
      dateMap.set(todo.id, date.getTime());

      // Overdue items: strictly before the start of today
      if (isBefore(date, today)) {
        immediate.push(todo);
      // Immediate items: due today or tomorrow
      } else if (isToday(date) || isTomorrow(date)) {
        immediate.push(todo);
      } else if (isBefore(date, addDays(endOfCurrentWeek, 1))) { // Within this week
        upcoming.push(todo);
      } else {
        radar.push(todo);
      }
    });

    // Sort by date using pre-parsed timestamps
    const sortByCompleteByDate = (a: ToDo, b: ToDo) =>
      (dateMap.get(a.id) || 0) - (dateMap.get(b.id) || 0);

    return {
      immediate: immediate.sort(sortByCompleteByDate),
      upcoming: upcoming.sort(sortByCompleteByDate),
      radar: radar.sort(sortByCompleteByDate)
    };
  }, [todos, currentDate]);

  // Ensure user is authenticated (should be guaranteed by ProtectedRoute, but defensive check)
  if (!currentUser) {
    return (
      <div className="pb-24 pt-6 px-4 max-w-2xl mx-auto">
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-rose-700">
          <p className="font-semibold">Authentication Required</p>
          <p className="text-sm">Please log in to manage your to-do list.</p>
        </div>
      </div>
    );
  }

  // Open modal for adding
  const openAddModal = () => {
    setText('');
    setCompleteByDate(format(new Date(), 'yyyy-MM-dd'));
    // Default to current user, or first member if available
    const defaultAssignee = currentUser?.uid ?? (members.length > 0 ? members[0].uid : '');
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

  const handleExport = () => {
    try {
      // Filter for active (not completed) tasks
      const activeTodos = todos.filter(t => !t.isCompleted);

      if (activeTodos.length === 0) {
        toast.error('No active tasks to export');
        return;
      }

      const today = startOfToday();

      // Map to CSV friendly format
      const exportData = activeTodos.map(todo => {
        const assignee = members.find(m => m.uid === todo.assignedTo);
        const dueDate = parseISO(todo.completeByDate);

        // Calculate status text
        let status = 'Future';
        if (isBefore(dueDate, today)) {
          status = 'Overdue';
        } else if (isToday(dueDate)) {
          status = 'Today';
        } else if (isTomorrow(dueDate)) {
          status = 'Tomorrow';
        } else if (isBefore(dueDate, addDays(endOfWeek(today, { weekStartsOn: 1 }), 1))) {
          status = 'This Week';
        }

        return {
          'Task': todo.text,
          'Due Date': todo.completeByDate,
          'Assigned To': assignee?.displayName || 'Unassigned',
          'Status': status,
          'Created At': todo.createdAt ? format(parseISO(todo.createdAt), 'yyyy-MM-dd') : ''
        };
      });

      // Sort by Due Date
      exportData.sort((a, b) => {
        if (a['Due Date'] !== b['Due Date']) {
          return a['Due Date'].localeCompare(b['Due Date']);
        }
        return 0;
      });

      generateCsvExport(exportData, 'todo-list');
      toast.success('Export started');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export tasks');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate in order: members exist, required fields filled, valid assignee
    if (members.length === 0) {
      toast.error('No household members available. Please add members first.');
      return;
    }

    if (!text.trim() || !completeByDate) {
      toast.error('Please fill in all required fields');
      return;
    }

    // Validate assignee is in members list (also covers unselected assignee case)
    const isValidAssignee = members.some(member => member.uid === assignedTo);
    if (!isValidAssignee) {
      if (assignedTo) {
        // The previously selected member may have been removed or is no longer available
        toast.error('The selected household member is no longer available. Please choose another member.');
      } else {
        toast.error('Please select a valid household member to assign this task to');
      }
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
        toast.success('Task added');
      }
      setIsAddModalOpen(false);
    } catch (error) {
      console.error('Error saving to-do:', error);
      toast.error('Failed to save to-do. Please try again.');
    }
  };

  // Action Implementation
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
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={todos.filter(t => !t.isCompleted).length === 0}
            className="bg-white text-brand-600 border border-brand-200 px-3 py-2 rounded-xl text-sm font-bold shadow-sm active:scale-95 transition-transform flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Export active tasks to CSV"
            title="Export active tasks to CSV"
          >
            <Download size={16} />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            onClick={openAddModal}
            className="bg-brand-800 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm active:scale-95 transition-transform flex items-center gap-2"
            aria-label="Add new task"
          >
            <Plus size={16} /> New Task
          </button>
        </div>
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
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        className="p-6"
      >
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
            <div className="relative w-full">
              <input
                id="due-date-input"
                type="date"
                value={completeByDate}
                onChange={(e) => setCompleteByDate(e.target.value)}
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
                <span>No household members available to assign this task.</span>
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Assign task to member">
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
              </div>
            )}
          </fieldset>

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
      </Modal>

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

  // Create member lookup Map for O(1) access instead of O(n) for each item
  const memberMap = useMemo(() => {
    const map = new Map<string, HouseholdMember>();
    members.forEach(member => map.set(member.uid, member));
    return map;
  }, [members]);

  if (items.length === 0) return null;

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
                   onClick={async () => {
                     try {
                       await onComplete(item.id);
                       toast.success('To-Do completed! 🎉');
                     } catch (error) {
                       console.error('Failed to complete task:', error);
                       toast.error('Failed to complete to-do');
                     }
                   }}
                   className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                     color === 'rose' ? 'border-rose-200 hover:bg-rose-50 active:bg-rose-100' :
                     color === 'amber' ? 'border-amber-200 hover:bg-amber-50 active:bg-amber-100' :
                     'border-blue-200 hover:bg-blue-50 active:bg-blue-100'
                   }`}
                   aria-label="Complete task"
                 >
                   <Check size={14} className="text-transparent hover:text-current active:text-current focus:text-current transition-colors" />
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
                           <img
                             src={assignee.photoURL}
                             className="w-3 h-3 rounded-full"
                             alt={assignee.displayName ?? 'Task assignee'}
                           />
                         ) : (
                           <User size={10} />
                         )}
                         <span>{assignee.displayName?.split(' ')[0] ?? 'User'}</span>
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
