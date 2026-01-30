import React, { useState, useMemo, useEffect } from 'react';
import { useHousehold } from '../contexts/FirebaseHouseholdContext';
import { Plus, Calendar, Check, Trash2, Edit2, AlertCircle, X, Clock, User, Download, Layers, CheckSquare, Loader2 } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO, isBefore, addDays, startOfToday, endOfWeek } from 'date-fns';
import { ToDo, HouseholdMember } from '../types/schema';
import toast from 'react-hot-toast';
import { showDeleteConfirmation } from '../utils/toastHelpers';
import { generateCsvExport } from '../utils/exportUtils';
import { Modal } from '../components/ui/Modal';
import Input from '../components/ui/Input';

const ToDosPage: React.FC = () => {
  const { todos, addToDo, updateToDo, deleteToDo, completeToDo, members, currentUser } = useHousehold();

  // Track current date to trigger re-categorization at midnight
  const [currentDate, setCurrentDate] = useState(() => startOfToday());

  // Modal and form state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Batch Mode State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  // Clear selection when mode is toggled off
  useEffect(() => {
    if (!isSelectionMode) {
      setSelectedIds(new Set());
    }
  }, [isSelectionMode]);

  // Update date at midnight
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
        scheduleNextMidnight();
      }, msUntilMidnight);
    };

    scheduleNextMidnight();
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  // Form State
  const [text, setText] = useState('');
  const [completeByDate, setCompleteByDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [assignedTo, setAssignedTo] = useState('');

  // Categorize To-Dos
  const { immediate, upcoming, radar, allActiveCount, allActiveIds } = useMemo(() => {
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
      radar: radar.sort(sortByCompleteByDate),
      allActiveCount: active.length,
      allActiveIds: active.map(t => t.id)
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
      const activeTodos = todos.filter(t => !t.isCompleted);
      if (activeTodos.length === 0) {
        toast.error('No active tasks to export');
        return;
      }
      const today = startOfToday();
      const exportData = activeTodos.map(todo => {
        const assignee = members.find(m => m.uid === todo.assignedTo);
        const dueDate = parseISO(todo.completeByDate);
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
    if (members.length === 0) {
      toast.error('No household members available. Please add members first.');
      return;
    }
    if (!text.trim() || !completeByDate) {
      toast.error('Please fill in all required fields');
      return;
    }
    const isValidAssignee = members.some(member => member.uid === assignedTo);
    if (!isValidAssignee) {
      if (assignedTo) {
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

  // --- Batch Mode Handlers ---

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === allActiveCount && allActiveCount > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allActiveIds));
    }
  };

  const handleBatchComplete = async () => {
    if (selectedIds.size === 0) return;
    setIsBatchProcessing(true);
    try {
      const promises = Array.from(selectedIds).map(id => completeToDo(id));
      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (successful > 0) {
        toast.success(`Completed ${successful} tasks! 🎉`);
      }
      if (failed > 0) {
        toast.error(`Failed to complete ${failed} tasks`);
      }

      setSelectedIds(new Set());
      setIsSelectionMode(false);
    } catch (error) {
      console.error('Batch complete failed:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsBatchProcessing(true);
    try {
      const promises = Array.from(selectedIds).map(id => deleteToDo(id));
      const results = await Promise.allSettled(promises);
      const failed = results.filter(r => r.status === 'rejected');

      if (failed.length > 0) {
        toast.error(`Deleted ${selectedIds.size - failed.length}, failed ${failed.length}`);
      } else {
        toast.success(`Deleted ${selectedIds.size} tasks`);
      }

      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setShowBatchDeleteConfirm(false);
    } catch (error) {
      console.error('Batch delete failed:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  return (
    <div className="pb-32 pt-8 px-4 max-w-2xl mx-auto space-y-8 min-h-screen">

      <div className="flex items-center justify-between mb-6">
        <div>
          {isSelectionMode ? (
             <div className="flex flex-col">
               <h1 className="text-2xl font-bold tracking-tight text-slate-900">Select Tasks</h1>
               <button
                  onClick={handleSelectAll}
                  className="text-sm text-brand-600 font-medium flex items-center gap-1 mt-1 hover:text-brand-800"
               >
                 <CheckSquare size={14} className={selectedIds.size === allActiveCount && allActiveCount > 0 ? 'text-brand-600' : 'text-brand-300'} />
                 {selectedIds.size === allActiveCount && allActiveCount > 0 ? 'Deselect All' : 'Select All'}
               </button>
             </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">To-Do List</h1>
              <p className="text-sm text-slate-500 leading-relaxed">Stay on top of your tasks</p>
            </>
          )}
        </div>

        <div className="flex gap-2">
           {!isSelectionMode && (
              <>
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
                  <Plus size={16} /> <span className="hidden xs:inline">New Task</span>
                </button>
              </>
            )}

            <button
              onClick={() => setIsSelectionMode(!isSelectionMode)}
              className={`p-2 rounded-xl transition-colors border ${isSelectionMode ? 'bg-brand-100 text-brand-800 border-brand-200' : 'bg-white text-brand-600 border-brand-200 hover:bg-brand-50'}`}
              title={isSelectionMode ? "Cancel Selection" : "Select Multiple"}
              aria-label={isSelectionMode ? "Cancel Selection" : "Select Multiple"}
            >
              {isSelectionMode ? <X size={20} /> : <Layers size={20} />}
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
        isSelectionMode={isSelectionMode}
        selectedIds={selectedIds}
        onToggleSelection={toggleSelection}
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
        isSelectionMode={isSelectionMode}
        selectedIds={selectedIds}
        onToggleSelection={toggleSelection}
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
        isSelectionMode={isSelectionMode}
        selectedIds={selectedIds}
        onToggleSelection={toggleSelection}
      />

      {/* Floating Action Bar (FAB) for Batch Actions */}
      {isSelectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-24 left-0 right-0 px-4 md:px-0 flex justify-center z-50 pointer-events-none">
          <div className="bg-brand-900 text-white p-2 rounded-2xl shadow-xl flex items-center gap-2 pointer-events-auto animate-in slide-in-from-bottom-4">
            <div className="px-3 font-bold text-sm border-r border-brand-700">
              {selectedIds.size} selected
            </div>

            <button
              onClick={handleBatchComplete}
              disabled={isBatchProcessing}
              className="flex flex-col items-center gap-0.5 px-3 py-1 hover:bg-brand-800 rounded-lg transition-colors disabled:opacity-50"
              aria-label="Mark selected as completed"
            >
              <Check size={18} />
              <span className="text-xxs font-medium">Complete</span>
            </button>

            <button
              onClick={() => setShowBatchDeleteConfirm(true)}
              disabled={isBatchProcessing}
              className="flex flex-col items-center gap-0.5 px-3 py-1 hover:bg-red-900 text-red-300 hover:text-red-200 rounded-lg transition-colors disabled:opacity-50"
              aria-label="Delete selected items"
            >
              <Trash2 size={18} />
              <span className="text-xxs font-medium">Delete</span>
            </button>
          </div>
        </div>
      )}

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
          <Input
            id="task-input"
            label="Task"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter task description"
            autoFocus
          />

          <Input
            id="due-date-input"
            label="Due Date"
            type="date"
            value={completeByDate}
            onChange={(e) => setCompleteByDate(e.target.value)}
            icon={<Calendar size={18} />}
            style={{ WebkitAppearance: 'none' }}
          />

          <fieldset>
            <legend className="block text-xs font-bold text-brand-400 uppercase tracking-wider mb-1">
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

      {/* Batch Delete Confirmation Modal */}
      {showBatchDeleteConfirm && (
        <Modal
          isOpen={true}
          onClose={() => !isBatchProcessing && setShowBatchDeleteConfirm(false)}
          disableBackdropClose={isBatchProcessing}
        >
          <div className="p-4 space-y-4">
            <h3 className="text-lg font-bold text-brand-800">Batch Delete</h3>
            <p className="text-brand-600">
              Are you sure you want to delete <strong>{selectedIds.size}</strong> tasks?
            </p>
            <p className="text-sm text-money-neg font-bold">
              This action cannot be undone.
            </p>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowBatchDeleteConfirm(false)}
                disabled={isBatchProcessing}
                className="flex-1 py-3 bg-brand-100 text-brand-600 font-bold rounded-xl hover:bg-brand-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={isBatchProcessing}
                className="flex-1 py-3 bg-money-neg text-white font-bold rounded-xl hover:bg-red-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isBatchProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 size={18} />}
                <span>Delete All</span>
              </button>
            </div>
          </div>
        </Modal>
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
  isSelectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
}> = ({ title, subtitle, items, color, onComplete, onEdit, onDelete, members, isSelectionMode, selectedIds, onToggleSelection }) => {

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
           const isSelected = selectedIds.has(item.id);

           return (
             <div
                key={item.id}
                onClick={() => isSelectionMode && onToggleSelection(item.id)}
                className={`rounded-2xl p-4 shadow-glass ring-1 ring-black/5 transition-all active:scale-[0.99] ${
                  isSelectionMode
                    ? `cursor-pointer ${isSelected ? 'bg-brand-50/50 ring-brand-200' : 'bg-white/80 backdrop-blur-xl'}`
                    : 'bg-white/80 backdrop-blur-xl'
                }`}
             >
               <div className="flex items-start gap-3">
                 {/* Complete Checkbox or Selection Box */}
                 {isSelectionMode ? (
                   <div className={`mt-0.5 w-6 h-6 flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'text-brand-600' : 'text-brand-200'}`}>
                      {isSelected ? <CheckSquare size={24} /> : <div className="w-5 h-5 border-2 border-current rounded" />}
                   </div>
                 ) : (
                   <button
                     onClick={async (e) => {
                       e.stopPropagation();
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
                 )}

                 <div className="flex-1 min-w-0">
                   <p className={`font-medium leading-snug ${isSelected ? 'text-brand-800' : 'text-slate-900'}`}>{item.text}</p>

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

                 {/* Edit/Delete Actions (Only visible when NOT in selection mode) */}
                 {!isSelectionMode && (
                   <div className="flex items-center gap-1 pl-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); onEdit(item); }}
                        className="p-2 text-brand-300 hover:text-brand-600 active:text-brand-800 active:bg-brand-50 rounded-lg transition-colors"
                        aria-label="Edit task"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
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
                 )}
               </div>
             </div>
           );
        })}
      </div>
    </div>
  );
};

export default ToDosPage;
