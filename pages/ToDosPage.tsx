import React, { useState, useMemo, useEffect } from 'react';
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import { useHousehold } from '../contexts/FirebaseHouseholdContext';
import { Plus, Calendar, Check, Trash2, Edit2, AlertCircle, X, Clock, User, Download, Layers, CheckSquare, Loader2, RotateCcw, Copy, History, MoreVertical, ClipboardList } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO, isBefore, addDays, startOfToday, endOfWeek, isSameDay, subDays, isSameWeek } from 'date-fns';
import { ToDo, HouseholdMember } from '../types/schema';
import toast from 'react-hot-toast';
import { haptic } from '@/utils/haptics';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { showDeleteConfirmation } from '../utils/toastHelpers';
import { generateCsvExport } from '../utils/exportUtils';
import { Modal } from '../components/ui/Modal';
import { Drawer } from '../components/ui/Drawer';
import { Button } from '../components/ui/Button';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import Input from '../components/ui/Input';
import BatchRescheduleModal from '../components/modals/BatchRescheduleModal';

const ToDosPage: React.FC = () => {
  const { todos, addToDo, updateToDo, deleteToDo, completeToDo, members, currentUser } = useHousehold();

  // View Mode State
  const [viewMode, setViewMode] = useState<'active' | 'completed'>('active');

  // Track current date to trigger re-categorization at midnight
  const [currentDate, setCurrentDate] = useState(() => startOfToday());

  // Modal and form state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Mobile Action Drawer State
  const [actionTodo, setActionTodo] = useState<ToDo | null>(null);

  // Batch Mode State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [isBatchRescheduleOpen, setIsBatchRescheduleOpen] = useState(false);

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

  // Categorize To-Dos (Active)
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

  // Categorize To-Dos (Completed)
  const { completedToday, completedYesterday, completedWeek, completedOlder } = useMemo(() => {
    const completed = todos.filter(t => t.isCompleted);

    const completedToday: ToDo[] = [];
    const completedYesterday: ToDo[] = [];
    const completedWeek: ToDo[] = [];
    const completedOlder: ToDo[] = [];

    completed.forEach(todo => {
        // Fallback to createdAt or 'now' if completedAt is missing (shouldn't happen for new completions)
        const dateStr = todo.completedAt || todo.createdAt || new Date().toISOString();
        const date = parseISO(dateStr);

        if (isSameDay(date, currentDate)) {
            completedToday.push(todo);
        } else if (isSameDay(date, subDays(currentDate, 1))) {
            completedYesterday.push(todo);
        } else if (isSameWeek(date, currentDate, { weekStartsOn: 1 })) {
            completedWeek.push(todo);
        } else {
            completedOlder.push(todo);
        }
    });

    const sortByCompletedAtDesc = (a: ToDo, b: ToDo) => {
        const dateA = a.completedAt || a.createdAt || '';
        const dateB = b.completedAt || b.createdAt || '';
        return dateB.localeCompare(dateA);
    };

    return {
        completedToday: completedToday.sort(sortByCompletedAtDesc),
        completedYesterday: completedYesterday.sort(sortByCompletedAtDesc),
        completedWeek: completedWeek.sort(sortByCompletedAtDesc),
        completedOlder: completedOlder.sort(sortByCompletedAtDesc)
    };
  }, [todos, currentDate]);

  const viewModeOptions = useMemo(() => [
    { value: 'active', label: 'Active' },
    {
        value: 'completed',
        label: (
            <span className="flex items-center gap-1.5">
                Completed
                <span className="bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded text-xs font-normal">
                    {todos.filter(t => t.isCompleted).length}
                </span>
            </span>
        )
    }
  ], [todos]);

  // Ensure user is authenticated (should be guaranteed by ProtectedRoute, but defensive check)
  if (!currentUser) {
    return (
      <div className="pb-24 pt-6 px-4 max-w-2xl mx-auto">
        <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl rounded-2xl p-6 shadow-sm ring-1 ring-black/5 dark:ring-white/5 text-rose-700 dark:text-rose-300">
          <p className="font-semibold tracking-tight text-lg">Authentication Required</p>
          <p className="text-sm opacity-90 mt-1">Please log in to manage your to-do list.</p>
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

  const handleDuplicate = async (todo: ToDo) => {
      try {
          await addToDo({
              text: todo.text,
              completeByDate: format(new Date(), 'yyyy-MM-dd'), // Default to today for the copy
              assignedTo: todo.assignedTo,
              isCompleted: false,
          });
          haptic('success');
          toast.success('Task duplicated');
      } catch (error) {
          console.error('Failed to duplicate task:', error);
          toast.error('Failed to duplicate task');
      }
  };

  const handleUncomplete = async (id: string) => {
      try {
          await updateToDo(id, {
              isCompleted: false,
              completedAt: undefined // Clear completion timestamp
          });
          toast.success('Task restored to active');
      } catch (error) {
          console.error('Failed to restore task:', error);
          toast.error('Failed to restore task');
      }
  };

  const handleMoveToTomorrow = async (todo: ToDo) => {
      try {
          const tomorrow = addDays(startOfToday(), 1);
          await updateToDo(todo.id, {
              completeByDate: format(tomorrow, 'yyyy-MM-dd')
          });
          toast.success('Task moved to tomorrow');
      } catch (error) {
          console.error('Failed to move task:', error);
          toast.error('Failed to move task');
      }
  };

  const handleExport = () => {
    try {
      // Export current view logic
      const dataToExport = viewMode === 'active'
        ? todos.filter(t => !t.isCompleted)
        : todos.filter(t => t.isCompleted);

      if (dataToExport.length === 0) {
        toast.error(`No ${viewMode} tasks to export`);
        return;
      }
      const today = startOfToday();
      const exportData = dataToExport.map(todo => {
        const assignee = members.find(m => m.uid === todo.assignedTo);
        const dueDate = parseISO(todo.completeByDate);
        let status = 'Future';

        if (todo.isCompleted) {
             status = 'Completed';
        } else if (isBefore(dueDate, today)) {
          status = 'Overdue';
        } else if (isToday(dueDate)) {
          status = 'Today';
        } else if (isTomorrow(dueDate)) {
          status = 'Tomorrow';
        } else if (isBefore(dueDate, addDays(endOfWeek(today, { weekStartsOn: 1 }), 1))) {
          status = 'This Week';
        }

        const record: Record<string, string> = {
          'Task': todo.text,
          'Due Date': todo.completeByDate,
          'Assigned To': assignee?.displayName || 'Unassigned',
          'Status': status,
          'Created At': todo.createdAt ? format(parseISO(todo.createdAt), 'yyyy-MM-dd') : ''
        };

        if (todo.isCompleted && todo.completedAt) {
            record['Completed At'] = format(parseISO(todo.completedAt), 'yyyy-MM-dd HH:mm');
        }

        return record;
      });

      exportData.sort((a, b) => {
        if (a['Due Date'] !== b['Due Date']) {
          return a['Due Date'].localeCompare(b['Due Date']);
        }
        return 0;
      });

      generateCsvExport(exportData, `todo-list-${viewMode}`);
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
        haptic('success');
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

  const handleBatchReschedule = async (date: string) => {
    if (selectedIds.size === 0) return;
    setIsBatchProcessing(true);
    try {
      const promises = Array.from(selectedIds).map(id =>
        updateToDo(id, { completeByDate: date })
      );
      const results = await Promise.allSettled(promises);
      const failed = results.filter(r => r.status === 'rejected');

      if (failed.length > 0) {
        toast.error(`Rescheduled ${selectedIds.size - failed.length}, failed ${failed.length}`);
      } else {
        toast.success(`Rescheduled ${selectedIds.size} tasks`);
      }

      setSelectedIds(new Set());
      setIsSelectionMode(false);
    } catch (error) {
      console.error('Batch reschedule failed:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  return (
    <div className="pb-32 pt-8 px-4 max-w-2xl mx-auto space-y-8 min-h-screen">

      <div className="flex flex-col gap-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            {isSelectionMode ? (
              <div className="flex flex-col">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Select Tasks</h1>
                <button
                    onClick={handleSelectAll}
                    className="text-sm text-brand-600 dark:text-brand-400 font-medium flex items-center gap-1 mt-1 hover:text-brand-800 dark:hover:text-brand-200"
                >
                  <CheckSquare size={14} className={selectedIds.size === allActiveCount && allActiveCount > 0 ? 'text-brand-600' : 'text-brand-300'} />
                  {selectedIds.size === allActiveCount && allActiveCount > 0 ? 'Deselect All' : 'Select All'}
                </button>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">To-Do List</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">Stay on top of your tasks</p>
              </>
            )}
          </div>

          <div className="flex gap-2">
            {!isSelectionMode && (
                <>
                  <Button
                    variant="secondary"
                    onClick={handleExport}
                    disabled={viewMode === 'active' ? allActiveCount === 0 : (completedToday.length + completedYesterday.length + completedWeek.length + completedOlder.length) === 0}
                    aria-label={`Export ${viewMode} tasks to CSV`}
                    title={`Export ${viewMode} tasks to CSV`}
                    leftIcon={<Download size={16} />}
                  >
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                  <Button
                    variant="primary"
                    onClick={openAddModal}
                    aria-label="Add new task"
                    leftIcon={<Plus size={16} />}
                  >
                     <span className="hidden sm:inline">New Task</span>
                  </Button>
                </>
              )}

              <Button
                variant="secondary"
                size="icon"
                onClick={() => setIsSelectionMode(!isSelectionMode)}
                disabled={viewMode === 'completed'} // Disable batch mode in completed view for now
                className={`${isSelectionMode ? 'bg-slate-100 border-slate-200 dark:bg-slate-700 dark:border-slate-600' : ''}`}
                title={isSelectionMode ? "Cancel Selection" : "Select Multiple"}
                aria-label={isSelectionMode ? "Cancel Selection" : "Select Multiple"}
              >
                {isSelectionMode ? <X size={20} /> : <Layers size={20} />}
              </Button>
          </div>
        </div>

        {/* View Toggle */}
        <div className="self-start">
             <SegmentedControl
                value={viewMode}
                onChange={(val) => setViewMode(val as 'active' | 'completed')}
                options={viewModeOptions}
             />
        </div>
      </div>

      {viewMode === 'active' ? (
          <>
            {/* Immediate Section */}
            <Section
                title="Immediate"
                subtitle="Overdue, Today & Tomorrow"
                items={immediate}
                color="rose"
                onComplete={completeToDo}
                onEdit={openEditModal}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                onMoveToTomorrow={handleMoveToTomorrow}
                onMore={setActionTodo}
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
                onDuplicate={handleDuplicate}
                onMoveToTomorrow={handleMoveToTomorrow}
                onMore={setActionTodo}
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
                onDuplicate={handleDuplicate}
                onMoveToTomorrow={handleMoveToTomorrow}
                onMore={setActionTodo}
                members={members}
                isSelectionMode={isSelectionMode}
                selectedIds={selectedIds}
                onToggleSelection={toggleSelection}
            />

            {immediate.length === 0 && upcoming.length === 0 && radar.length === 0 && (
                 <div className="text-center py-20 px-6 bg-white/50 dark:bg-slate-800/40 rounded-3xl border border-dashed border-slate-200 dark:border-slate-700">
                     <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700/50 rounded-full flex items-center justify-center mx-auto mb-4 text-brand-400 dark:text-brand-300">
                         <ClipboardList size={28} />
                     </div>
                     <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">All caught up!</h3>
                     <p className="text-slate-500 dark:text-slate-400 mt-1 mb-6">No active tasks. Add one to get started.</p>
                     <Button variant="primary" onClick={openAddModal} leftIcon={<Plus size={16} />}>
                         New Task
                     </Button>
                 </div>
            )}
          </>
      ) : (
          /* Completed View */
          <>
            <CompletedSection
                title="Completed Today"
                items={completedToday}
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                onMore={setActionTodo}
                members={members}
            />
            <CompletedSection
                title="Completed Yesterday"
                items={completedYesterday}
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                onMore={setActionTodo}
                members={members}
            />
            <CompletedSection
                title="This Week"
                items={completedWeek}
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                onMore={setActionTodo}
                members={members}
            />
            <CompletedSection
                title="Older History"
                items={completedOlder}
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                onMore={setActionTodo}
                members={members}
            />

            {completedToday.length === 0 && completedYesterday.length === 0 && completedWeek.length === 0 && completedOlder.length === 0 && (
                 <div className="text-center py-20 px-6 bg-white/50 dark:bg-slate-800/40 rounded-3xl border border-dashed border-slate-200 dark:border-slate-700">
                     <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700/50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400 dark:text-slate-500">
                         <History size={28} />
                     </div>
                     <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">No history yet</h3>
                     <p className="text-slate-500 dark:text-slate-400 mt-1">Completed tasks will appear here.</p>
                 </div>
            )}
          </>
      )}

      {/* Floating Action Bar (FAB) for Batch Actions */}
      {isSelectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-24 left-0 right-0 px-4 md:px-0 flex justify-center z-50 pointer-events-none">
          <div className="bg-slate-900/90 backdrop-blur-xl text-white p-2 rounded-2xl shadow-glass ring-1 ring-white/10 flex items-center gap-2 pointer-events-auto animate-in slide-in-from-bottom-4">
            <div className="px-3 font-bold text-sm border-r border-white/10">
              {selectedIds.size} selected
            </div>

            <Button
              variant="ghost-inverted"
              layout="vertical"
              onClick={handleBatchComplete}
              disabled={isBatchProcessing}
              className="h-auto py-1 px-3 font-normal"
              aria-label="Mark selected as completed"
            >
              <Check size={18} />
              <span className="text-xxs font-medium">Complete</span>
            </Button>

            <Button
              variant="ghost-inverted"
              layout="vertical"
              onClick={() => setIsBatchRescheduleOpen(true)}
              disabled={isBatchProcessing}
              className="h-auto py-1 px-3 font-normal"
              aria-label="Reschedule selected items"
            >
              <Calendar size={18} />
              <span className="text-xxs font-medium">Reschedule</span>
            </Button>

            <Button
              variant="ghost-inverted"
              layout="vertical"
              onClick={() => setShowBatchDeleteConfirm(true)}
              disabled={isBatchProcessing}
              className="h-auto py-1 px-3 font-normal text-rose-300 hover:text-rose-200 hover:bg-rose-500/20"
              aria-label="Delete selected items"
            >
              <Trash2 size={18} />
              <span className="text-xxs font-medium">Delete</span>
            </Button>
          </div>
        </div>
      )}

      {/* Batch Reschedule Modal */}
      <BatchRescheduleModal
        isOpen={isBatchRescheduleOpen}
        onClose={() => setIsBatchRescheduleOpen(false)}
        onConfirm={handleBatchReschedule}
        count={selectedIds.size}
      />

      {/* Add/Edit Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        className="p-6"
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-brand-800 dark:text-slate-100">
            {editingId ? 'Edit Task' : 'New Task'}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsAddModalOpen(false)}
            className="rounded-full hover:bg-brand-50 dark:hover:bg-slate-700/50"
            aria-label="Close dialog"
          >
            <X size={20} className="text-brand-400 dark:text-slate-500" />
          </Button>
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
            <legend className="block text-xs font-bold text-brand-400 dark:text-slate-500 uppercase tracking-wider mb-1">
              Assign To
            </legend>
            {members.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-brand-400 dark:text-slate-500 py-2">
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
                        ? 'bg-brand-800 text-white border-brand-800 shadow-md dark:bg-brand-600 dark:border-brand-600'
                        : 'bg-white text-brand-600 border-brand-200 hover:bg-brand-50 dark:bg-slate-700/50 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700'
                    }`}
                  >
                    {member.photoURL ? (
                      <img src={member.photoURL} alt="" className="w-5 h-5 rounded-full" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-brand-200 dark:bg-slate-600 flex items-center justify-center text-xxs font-bold text-brand-600 dark:text-slate-200">
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
            type="submit"
            variant="primary"
            disabled={members.length === 0}
            className="w-full mt-4 py-3.5 shadow-lg"
          >
            {editingId ? 'Save Changes' : 'Create Task'}
          </Button>
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
            <h3 className="text-lg font-bold text-brand-800 dark:text-slate-100">Batch Delete</h3>
            <p className="text-brand-600 dark:text-slate-300">
              Are you sure you want to delete <strong>{selectedIds.size}</strong> tasks?
            </p>
            <p className="text-sm text-money-neg dark:text-rose-400 font-bold">
              This action cannot be undone.
            </p>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowBatchDeleteConfirm(false)}
                disabled={isBatchProcessing}
                className="flex-1 py-3 bg-brand-100 text-brand-600 font-bold rounded-xl hover:bg-brand-200 transition-colors disabled:opacity-50 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
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

      {/* Mobile Actions Drawer */}
      <Drawer
        isOpen={!!actionTodo}
        onClose={() => setActionTodo(null)}
        title="Task Options"
      >
        <div className="space-y-2">
          {actionTodo && (
            <>
              {/* Primary Action (Edit or Uncomplete) */}
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={actionTodo.isCompleted ? <RotateCcw className="text-brand-500" /> : <Edit2 className="text-brand-500" />}
                onClick={() => {
                  if (actionTodo.isCompleted) {
                    handleUncomplete(actionTodo.id);
                  } else {
                    openEditModal(actionTodo);
                  }
                  setActionTodo(null);
                }}
              >
                {actionTodo.isCompleted ? 'Mark as Active' : 'Edit Task'}
              </Button>

              {/* Common Actions */}
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Copy className="text-brand-500" />}
                onClick={() => {
                  handleDuplicate(actionTodo);
                  setActionTodo(null);
                }}
              >
                Duplicate
              </Button>

              <div className="h-px bg-gray-100 dark:bg-slate-700 my-2" />

              <Button
                variant="ghost-destructive"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Trash2 />}
                onClick={() => {
                   // Close drawer immediately before confirmation to prevent visual clutter
                   // and potential interaction issues with the toast/modal overlay
                   setActionTodo(null);
                   showDeleteConfirmation(async () => {
                     haptic('medium');
                     await deleteToDo(actionTodo.id);
                     toast.success('Task deleted');
                   });
                }}
              >
                {actionTodo.isCompleted ? 'Delete Forever' : 'Delete'}
              </Button>
            </>
          )}
        </div>
      </Drawer>

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
  onDuplicate: (todo: ToDo) => void;
  onMoveToTomorrow: (todo: ToDo) => void;
  onMore: (todo: ToDo) => void;
  members: HouseholdMember[];
  isSelectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
}> = ({ title, subtitle, items, color, onComplete, onEdit, onDelete, onDuplicate, onMoveToTomorrow, onMore, members, isSelectionMode, selectedIds, onToggleSelection }) => {

  // Create member lookup Map for O(1) access instead of O(n) for each item
  const memberMap = useMemo(() => {
    const map = new Map<string, HouseholdMember>();
    members.forEach(member => map.set(member.uid, member));
    return map;
  }, [members]);

  if (items.length === 0) return null;

  const sectionDotColors = {
    rose: 'bg-rose-500',
    amber: 'bg-amber-500',
    blue: 'bg-blue-500',
  };

  const badgeStyles = {
    rose: 'bg-rose-50/50 text-rose-600 border border-rose-100/50 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/20',
    amber: 'bg-amber-50/50 text-amber-600 border border-amber-100/50 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/20',
    blue: 'bg-blue-50/50 text-blue-600 border border-blue-100/50 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/20',
  };

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-baseline justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${sectionDotColors[color]} shadow-sm`}></div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">{title}</h2>
        </div>
        <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{subtitle}</span>
      </div>

      <div className="space-y-3">
        {items.map(item => {
           const assignee = memberMap.get(item.assignedTo);
           const isSelected = selectedIds.has(item.id);

           const cardInner = (
             <div
                onClick={() => isSelectionMode && onToggleSelection(item.id)}
                className={`rounded-2xl p-4 shadow-glass ring-1 ring-black/5 dark:ring-white/5 transition-all active:scale-[0.99] ${
                  isSelectionMode
                    ? `cursor-pointer ${isSelected ? 'bg-brand-50/50 ring-brand-200 dark:bg-brand-700/30 dark:ring-brand-500/40' : 'bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl'}`
                    : 'bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl'
                }`}
             >
               <div className="flex items-start gap-3">
                 {/* Complete Checkbox or Selection Box */}
                 {isSelectionMode ? (
                   <div className={`mt-0.5 w-6 h-6 flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'text-brand-600 dark:text-brand-400' : 'text-brand-200 dark:text-slate-600'}`}>
                      {isSelected ? <CheckSquare size={24} /> : <div className="w-5 h-5 border-2 border-current rounded" />}
                   </div>
                 ) : (
                   <button
                     onClick={async (e) => {
                       e.stopPropagation();
                       try {
                         haptic('light');
                         await onComplete(item.id);
                         toast.success('To-Do completed! 🎉');
                       } catch (error) {
                         console.error('Failed to complete task:', error);
                         toast.error('Failed to complete to-do');
                       }
                     }}
                     className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                       color === 'rose' ? 'border-rose-200 hover:bg-rose-50 active:bg-rose-100 dark:border-rose-500/40 dark:hover:bg-rose-500/15' :
                       color === 'amber' ? 'border-amber-200 hover:bg-amber-50 active:bg-amber-100 dark:border-amber-500/40 dark:hover:bg-amber-500/15' :
                       'border-blue-200 hover:bg-blue-50 active:bg-blue-100 dark:border-blue-500/40 dark:hover:bg-blue-500/15'
                     }`}
                     aria-label="Complete task"
                   >
                     <Check size={14} className="text-transparent hover:text-current active:text-current focus:text-current transition-colors" />
                   </button>
                 )}

                 <div className="flex-1 min-w-0">
                   <p className={`font-medium leading-snug ${isSelected ? 'text-brand-800 dark:text-brand-200' : 'text-slate-900 dark:text-slate-100'}`}>{item.text}</p>

                   <div className="flex flex-wrap items-center gap-2 mt-2">
                     {isBefore(parseISO(item.completeByDate), startOfToday()) ? (
                       <div className="flex items-center gap-1 text-xs px-2 py-1 rounded-md font-bold bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
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
                       <div className="flex items-center gap-1 text-xs text-brand-400 bg-brand-50 px-2 py-1 rounded-md dark:text-slate-400 dark:bg-slate-700/50">
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

                 {/* Actions */}
                 {!isSelectionMode && (
                   <>
                     {/* Desktop Actions */}
                     <div className="hidden sm:flex items-center gap-1 pl-2">
                        <Button
                          variant="ghost-brand"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); onMoveToTomorrow(item); }}
                          aria-label="Move to Tomorrow"
                          title="Move to Tomorrow"
                        >
                          <Calendar size={16} />
                        </Button>
                        <Button
                          variant="ghost-brand"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); onDuplicate(item); }}
                          aria-label="Duplicate task"
                          title="Duplicate"
                        >
                          <Copy size={16} />
                        </Button>
                        <Button
                          variant="ghost-brand"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); onEdit(item); }}
                          aria-label="Edit task"
                        >
                          <Edit2 size={16} />
                        </Button>
                        <Button
                          variant="ghost-brand"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            showDeleteConfirmation(async () => {
                              haptic('medium');
                              await onDelete(item.id);
                              toast.success('Task deleted');
                            });
                          }}
                          className="hover:text-rose-600 active:text-rose-700 active:bg-rose-50 dark:hover:text-rose-300 dark:active:bg-rose-500/15"
                          aria-label="Delete task"
                        >
                          <Trash2 size={16} />
                        </Button>
                     </div>
                     {/* Mobile Actions */}
                     <div className="flex sm:hidden pl-2">
                       <Button
                         variant="ghost-brand"
                         size="icon"
                         onClick={(e) => { e.stopPropagation(); onMore(item); }}
                         aria-label="More options"
                       >
                         <MoreVertical size={20} />
                       </Button>
                     </div>
                   </>
                 )}
               </div>
             </div>
           );

           // In selection mode we keep tap-to-select intact and skip the swipe gesture.
           if (isSelectionMode) {
             return <React.Fragment key={item.id}>{cardInner}</React.Fragment>;
           }

           return (
             <SwipeableTodoRow
               key={item.id}
               onDelete={() => {
                 showDeleteConfirmation(async () => {
                   haptic('medium');
                   await onDelete(item.id);
                   toast.success('Task deleted');
                 });
               }}
             >
               {cardInner}
             </SwipeableTodoRow>
           );
        })}
      </div>
    </div>
  );
};

// Swipe-left-to-delete wrapper for to-do rows. Falls back to a plain container
// (relying on the row's existing delete buttons) when the user prefers reduced motion.
const SWIPE_THRESHOLD = 80;

const SwipeableTodoRow: React.FC<{ onDelete: () => void; children: React.ReactNode }> = ({ onDelete, children }) => {
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const deleteOpacity = useTransform(x, [-SWIPE_THRESHOLD, -20, 0], [1, 0.4, 0]);

  if (reduceMotion) {
    // No drag animation; the row still exposes accessible delete buttons.
    return <>{children}</>;
  }

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_THRESHOLD) {
      onDelete();
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <motion.div
        className="absolute inset-0 flex items-center justify-end pr-6 rounded-2xl bg-rose-500 text-white z-0"
        style={{ opacity: deleteOpacity }}
        aria-hidden="true"
      >
        <span className="flex items-center gap-2 font-bold text-sm">
          <Trash2 size={18} /> Delete
        </span>
      </motion.div>
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.6, right: 0 }}
        onDragEnd={handleDragEnd}
        style={{ x, touchAction: 'pan-y' }}
        className="relative z-10"
      >
        {children}
      </motion.div>
    </div>
  );
};

// Sub-component for completed items
const CompletedSection: React.FC<{
  title: string;
  items: ToDo[];
  onUncomplete: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (todo: ToDo) => void;
  onMore: (todo: ToDo) => void;
  members: HouseholdMember[];
}> = ({ title, items, onUncomplete, onDelete, onDuplicate, onMore, members }) => {
    const memberMap = useMemo(() => {
        const map = new Map<string, HouseholdMember>();
        members.forEach(member => map.set(member.uid, member));
        return map;
      }, [members]);

    if (items.length === 0) return null;

    return (
        <div className="animate-in slide-in-from-bottom-4 duration-500 opacity-80">
            <div className="flex items-center gap-2 mb-3 px-1">
                <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{title}</h2>
                <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1"></div>
            </div>

            <div className="space-y-2">
                {items.map(item => {
                    const assignee = memberMap.get(item.assignedTo);
                    const completedDate = item.completedAt ? parseISO(item.completedAt) : null;

                    return (
                        <div
                            key={item.id}
                            className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex items-start gap-3 hover:bg-white hover:shadow-sm transition-all group dark:bg-slate-800/50 dark:border-slate-700 dark:hover:bg-slate-800"
                        >
                            <button
                                onClick={() => { haptic('light'); onUncomplete(item.id); }}
                                className="mt-0.5 w-6 h-6 rounded-full border-2 border-brand-200 bg-brand-50 text-brand-400 flex items-center justify-center hover:bg-brand-100 hover:text-brand-600 transition-colors flex-shrink-0 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                                title="Mark as incomplete"
                            >
                                <RotateCcw size={14} />
                            </button>

                            <div className="flex-1 min-w-0">
                                <p className="text-slate-500 dark:text-slate-400 line-through decoration-slate-300 dark:decoration-slate-600">{item.text}</p>
                                <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 dark:text-slate-500">
                                    {completedDate && (
                                        <span className="flex items-center gap-1">
                                            <Check size={10} />
                                            {format(completedDate, 'MMM d, h:mm a')}
                                        </span>
                                    )}
                                    {assignee && (
                                         <span className="flex items-center gap-1">
                                            <User size={10} />
                                            {assignee.displayName?.split(' ')[0]}
                                         </span>
                                    )}
                                </div>
                            </div>

                            {/* Desktop Actions */}
                            <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => onDuplicate(item)}
                                    className="text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:text-slate-500 dark:hover:text-brand-300 dark:hover:bg-slate-700/50"
                                    title="Duplicate task"
                                >
                                    <Copy size={14} />
                                </Button>
                                <Button
                                    variant="ghost-destructive"
                                    size="icon-sm"
                                    onClick={() => showDeleteConfirmation(async () => {
                                        haptic('medium');
                                        await onDelete(item.id);
                                        toast.success('Task deleted');
                                    })}
                                    title="Delete forever"
                                >
                                    <Trash2 size={14} />
                                </Button>
                            </div>
                            {/* Mobile Actions */}
                            <div className="flex sm:hidden">
                               <Button
                                 variant="ghost"
                                 size="icon"
                                 onClick={(e) => { e.stopPropagation(); onMore(item); }}
                                 className="text-brand-300 hover:text-brand-600 active:text-brand-800 active:bg-brand-50 dark:text-slate-500 dark:hover:text-slate-300 dark:active:bg-slate-700/50"
                                 aria-label="More options"
                               >
                                 <MoreVertical size={20} />
                               </Button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ToDosPage;
