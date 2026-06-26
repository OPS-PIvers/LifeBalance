import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import { useTodos, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Plus, Calendar, Check, Trash2, Edit2, AlertCircle, X, Clock, User, Download, Layers, CheckSquare, Loader2, RotateCcw, Copy, History, MoreVertical, ClipboardList } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO, isBefore, addDays, startOfToday, endOfWeek, isSameDay, subDays, isSameWeek } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';
import { ToDo, HouseholdMember } from '@/types/schema';
import { DEFAULT_TODO_POINTS } from '@/utils/todoPoints';
import toast from 'react-hot-toast';
import { haptic } from '@/utils/haptics';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import { generateCsvExport } from '@/utils/exportUtils';
import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { SurfaceList, Row } from '@/components/ui/Section';
import { cn } from '@/utils/cn';
import Input from '@/components/ui/Input';
import BatchRescheduleModal from '@/components/modals/BatchRescheduleModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const ToDosPage: React.FC = () => {
  const {
    todos,
    addToDo,
    updateToDo,
    deleteToDo,
    completeToDo,
    hasMoreCompletedTodos,
    isLoadingOlderTodos,
    loadOlderCompletedTodos,
  } = useTodos();
  const { members, currentUser } = useHouseholdCore();

  // Page-level member lookup map — computed once here, passed to Section/CompletedSection
  // so the O(n) map build does not repeat per-section (previously built 3× in render).
  const memberMap = useMemo(() => {
    const map = new Map<string, HouseholdMember>();
    members.forEach(member => map.set(member.uid, member));
    return map;
  }, [members]);

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

  // Clear selection when selection mode is toggled off. Done during render on
  // the on→off edge rather than in an effect so it doesn't trigger a cascading
  // render. Mirrors the previous effect keyed on `[isSelectionMode]`.
  const [wasSelectionMode, setWasSelectionMode] = useState(isSelectionMode);
  if (wasSelectionMode !== isSelectionMode) {
    setWasSelectionMode(isSelectionMode);
    if (!isSelectionMode) {
      setSelectedIds(new Set());
    }
  }

  // Update date at midnight so todo categorization (immediate/upcoming/radar) stays accurate.
  // NOTE: useMidnightScheduler (hooks/useMidnightScheduler.ts) is not used here because its
  // contract also fires the callback immediately on mount and on a 5-min periodic interval,
  // which differs from this page's intent of only updating at midnight. Replacing it would
  // require passing `enabled` + a Promise-returning wrapper and accepting the extra immediate
  // call — a behaviour change that is out of scope for this task.
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
  const [completeByDate, setCompleteByDate] = useState(getLocalDateString());
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

    // Pre-parse completion timestamps into a Map (mirrors the active-todos dateMap pattern)
    // so parseISO is called once per todo rather than per-todo in the loop below.
    const completedDateMap = new Map<string, Date>();
    completed.forEach(todo => {
        const dateStr = todo.completedAt || todo.createdAt || new Date().toISOString();
        completedDateMap.set(todo.id, parseISO(dateStr));
    });

    completed.forEach(todo => {
        const date = completedDateMap.get(todo.id)!; // always set in the loop above

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

  // Derive completed count from already-computed buckets to avoid a fourth pass over todos.
  const completedCount = completedToday.length + completedYesterday.length + completedWeek.length + completedOlder.length;

  const completedBadge = (
    <span className="flex items-center gap-1.5">
        Completed
        <span className="bg-brand-200 text-brand-700 dark:bg-brand-700 dark:text-brand-200 px-1.5 py-0.5 rounded-sm text-xs font-normal tabular-nums">
            {completedCount}
        </span>
    </span>
  );

  // Open modal for adding
  const openAddModal = useCallback(() => {
    setText('');
    setCompleteByDate(getLocalDateString());
    const defaultAssignee = currentUser?.uid ?? (members.length > 0 ? members[0]!.uid : ''); // members[0] is defined: guarded by members.length > 0
    setAssignedTo(defaultAssignee);
    setEditingId(null);
    setIsAddModalOpen(true);
  }, [currentUser, members]);

  // Open modal for editing
  const openEditModal = useCallback((todo: ToDo) => {
    setText(todo.text);
    setCompleteByDate(todo.completeByDate);
    setAssignedTo(todo.assignedTo);
    setEditingId(todo.id);
    setIsAddModalOpen(true);
  }, []);

  const handleDuplicate = useCallback(async (todo: ToDo) => {
      try {
          await addToDo({
              text: todo.text,
              completeByDate: getLocalDateString(), // Default to today for the copy
              assignedTo: todo.assignedTo,
              isCompleted: false,
          });
          haptic('success');
          toast.success('Task duplicated');
      } catch (error) {
          console.error('Failed to duplicate task:', error);
          toast.error('Failed to duplicate task');
      }
  }, [addToDo]);

  const handleUncomplete = useCallback(async (id: string) => {
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
  }, [updateToDo]);

  const handleMoveToTomorrow = useCallback(async (todo: ToDo) => {
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
  }, [updateToDo]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  // Ensure user is authenticated (should be guaranteed by ProtectedRoute, but defensive check)
  if (!currentUser) {
    return (
      <div className="pb-24 pt-6 px-4 max-w-2xl mx-auto">
        <div className="surface-section p-6 text-money-neg">
          <p className="font-display font-semibold tracking-tight text-lg">Authentication required</p>
          <p className="text-sm opacity-90 mt-1">Please log in to manage your to-do list.</p>
        </div>
      </div>
    );
  }

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
        const aDate = a['Due Date'] ?? '';
        const bDate = b['Due Date'] ?? '';
        if (aDate !== bDate) {
          return aDate.localeCompare(bDate);
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
                <h1 className="font-display text-2xl font-semibold tracking-tight text-brand-900 dark:text-brand-50">Select tasks</h1>
                <button
                    onClick={handleSelectAll}
                    className="text-sm text-accent-600 dark:text-accent-300 font-medium flex items-center gap-1 mt-1 hover:text-accent-700 dark:hover:text-accent-200"
                >
                  <CheckSquare size={14} aria-hidden="true" className={selectedIds.size === allActiveCount && allActiveCount > 0 ? 'text-accent-600 dark:text-accent-300' : 'text-brand-300 dark:text-brand-500'} />
                  {selectedIds.size === allActiveCount && allActiveCount > 0 ? 'Deselect all' : 'Select all'}
                </button>
              </div>
            ) : (
              <>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-brand-900 dark:text-brand-50">To-do list</h1>
                <p className="text-sm text-brand-500 dark:text-brand-400 leading-relaxed">Stay on top of your tasks</p>
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
                className={`${isSelectionMode ? 'bg-brand-100 border-brand-200 dark:bg-brand-700 dark:border-brand-600' : ''}`}
                title={isSelectionMode ? "Cancel Selection" : "Select Multiple"}
                aria-label={isSelectionMode ? "Cancel Selection" : "Select Multiple"}
              >
                {isSelectionMode ? <X size={20} /> : <Layers size={20} />}
              </Button>
          </div>
        </div>

        {/* View Toggle */}
        <Tabs value={viewMode} onValueChange={(val) => setViewMode(val as 'active' | 'completed')}>
          <TabsList className="self-start w-auto inline-flex">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="completed">{completedBadge}</TabsTrigger>
          </TabsList>
        </Tabs>
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
                memberMap={memberMap}
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
                memberMap={memberMap}
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
                memberMap={memberMap}
                isSelectionMode={isSelectionMode}
                selectedIds={selectedIds}
                onToggleSelection={toggleSelection}
            />

            {immediate.length === 0 && upcoming.length === 0 && radar.length === 0 && (
                 <div className="text-center py-20 px-6 surface-section">
                     <div className="w-16 h-16 bg-brand-100 dark:bg-brand-700 rounded-full flex items-center justify-center mx-auto mb-4 text-accent-600 dark:text-accent-300">
                         <ClipboardList size={28} />
                     </div>
                     <h3 className="font-display text-lg font-semibold text-brand-900 dark:text-brand-50">All caught up</h3>
                     <p className="text-brand-500 dark:text-brand-400 mt-1 mb-6">No active tasks. Add one to get started.</p>
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
                memberMap={memberMap}
            />
            <CompletedSection
                title="Completed Yesterday"
                items={completedYesterday}
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                onMore={setActionTodo}
                memberMap={memberMap}
            />
            <CompletedSection
                title="This Week"
                items={completedWeek}
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                onMore={setActionTodo}
                memberMap={memberMap}
            />
            <CompletedSection
                title="Older History"
                items={completedOlder}
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                onMore={setActionTodo}
                memberMap={memberMap}
            />

            {/* Completed to-dos are windowed to the last 30 days; load older on demand. */}
            {hasMoreCompletedTodos && (
                <div className="flex justify-center pt-2">
                    <Button
                        variant="secondary"
                        onClick={loadOlderCompletedTodos}
                        disabled={isLoadingOlderTodos}
                        leftIcon={isLoadingOlderTodos ? <Loader2 size={16} className="animate-spin" /> : <History size={16} />}
                    >
                        {isLoadingOlderTodos ? 'Loading…' : 'Load older completed tasks'}
                    </Button>
                </div>
            )}

            {completedToday.length === 0 && completedYesterday.length === 0 && completedWeek.length === 0 && completedOlder.length === 0 && !hasMoreCompletedTodos && (
                 <div className="text-center py-20 px-6 surface-section">
                     <div className="w-16 h-16 bg-brand-100 dark:bg-brand-700 rounded-full flex items-center justify-center mx-auto mb-4 text-brand-400 dark:text-brand-300">
                         <History size={28} />
                     </div>
                     <h3 className="font-display text-lg font-semibold text-brand-900 dark:text-brand-50">No history yet</h3>
                     <p className="text-brand-500 dark:text-brand-400 mt-1">Completed tasks will appear here.</p>
                 </div>
            )}
          </>
      )}

      {/* Floating Action Bar (FAB) for Batch Actions */}
      {isSelectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-24 left-0 right-0 px-4 md:px-0 flex justify-center z-50 pointer-events-none">
          <div className="bg-brand-900 dark:bg-brand-800 text-white p-2 rounded-2xl shadow-raised border border-brand-700 flex items-center gap-2 pointer-events-auto animate-in slide-in-from-bottom-4">
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
        ariaLabelledBy="todo-modal-title"
      >
        <div className="flex justify-between items-center mb-6">
          <h2 id="todo-modal-title" className="font-display text-xl font-semibold text-brand-900 dark:text-brand-50">
            {editingId ? 'Edit task' : 'New task'}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsAddModalOpen(false)}
            className="rounded-full hover:bg-brand-50 dark:hover:bg-brand-700/50"
            aria-label="Close dialog"
          >
            <X size={20} className="text-brand-400 dark:text-brand-500" />
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
            className="appearance-none"
          />

          <fieldset>
            <legend className="block text-xs font-bold text-brand-400 dark:text-brand-500 uppercase tracking-wider mb-1">
              Assign to
            </legend>
            {members.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-brand-400 dark:text-brand-500 py-2">
                <AlertCircle size={16} className="shrink-0" />
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
                    className={`flex items-center gap-2 px-3 py-2 rounded-btn border transition-colors duration-(--duration-fast) ease-(--ease-standard) whitespace-nowrap ${
                      assignedTo === member.uid
                        ? 'bg-accent-600 text-white border-accent-600 dark:bg-accent-600 dark:border-accent-600'
                        : 'bg-white text-brand-600 border-brand-200 hover:bg-brand-50 dark:bg-brand-700/50 dark:text-brand-200 dark:border-brand-600 dark:hover:bg-brand-700'
                    }`}
                  >
                    {member.photoURL ? (
                      <img src={member.photoURL} alt={member.displayName ?? 'User'} className="w-5 h-5 rounded-full" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-brand-200 dark:bg-brand-600 flex items-center justify-center text-xxs font-bold text-brand-600 dark:text-brand-200">
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
            className="w-full mt-4 py-3.5"
          >
            {editingId ? 'Save changes' : 'Create task'}
          </Button>
        </form>
      </Modal>

      {/* Batch Delete Confirmation */}
      <ConfirmDialog
        isOpen={showBatchDeleteConfirm}
        onClose={() => !isBatchProcessing && setShowBatchDeleteConfirm(false)}
        onConfirm={handleBatchDelete}
        title="Batch Delete"
        message={`Are you sure you want to delete ${selectedIds.size} task${selectedIds.size !== 1 ? 's' : ''}? This action cannot be undone.`}
        confirmLabel={isBatchProcessing ? 'Deleting…' : 'Delete All'}
        confirmVariant="destructive"
        isConfirming={isBatchProcessing}
      />

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

              <div className="h-px bg-brand-200 dark:bg-brand-700 my-2" />

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

interface TodoRowProps {
  item: ToDo;
  color: 'rose' | 'amber' | 'blue';
  assignee: HouseholdMember | undefined;
  isSelected: boolean;
  isSelectionMode: boolean;
  onComplete: (id: string) => void;
  onEdit: (todo: ToDo) => void;
  onDelete: (id: string) => void;
  onDuplicate: (todo: ToDo) => void;
  onMoveToTomorrow: (todo: ToDo) => void;
  onMore: (todo: ToDo) => void;
  onToggleSelection: (id: string) => void;
}

const badgeStyleMap = {
  rose: 'bg-money-bgNeg text-money-neg border border-money-neg/20 dark:bg-money-neg/15 dark:text-money-neg dark:border-money-neg/25',
  amber: 'bg-warm-50 text-warm-700 border border-warm-200 dark:bg-warm-500/15 dark:text-warm-300 dark:border-warm-500/25',
  blue: 'bg-habit-blue/10 text-habit-blue border border-habit-blue/20 dark:bg-habit-blue/15 dark:text-habit-blue dark:border-habit-blue/25',
} as const;

// Memoized row for a single active to-do.
// Uses a field-by-field comparator so toggling selection in one row does not
// re-render sibling rows that haven't changed their selected state.
const TodoRow = React.memo(function TodoRow({
  item,
  color,
  assignee,
  isSelected,
  isSelectionMode,
  onComplete,
  onEdit,
  onDelete,
  onDuplicate,
  onMoveToTomorrow,
  onMore,
  onToggleSelection,
}: TodoRowProps) {
  // Parse the due date once per row render to avoid repeated parseISO calls
  const dueDate = parseISO(item.completeByDate);
  const isOverdue = isBefore(dueDate, startOfToday());

  const cardInner = (
    <div
      onClick={() => isSelectionMode && onToggleSelection(item.id)}
      {...(isSelectionMode ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-pressed': isSelected,
        'aria-label': `${isSelected ? 'Deselect' : 'Select'} task: ${item.text}`,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleSelection(item.id);
          }
        }
      } : {})}
      className={cn(
        'hairline-divider p-4 transition-colors duration-(--duration-fast) ease-(--ease-standard)',
        isSelectionMode
          ? isSelected
            ? 'cursor-pointer bg-accent-50 dark:bg-accent-900/30'
            : 'cursor-pointer bg-white dark:bg-brand-800 hover:bg-brand-50 dark:hover:bg-brand-700/40'
          : 'bg-white dark:bg-brand-800'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Complete Checkbox or Selection Box */}
        {isSelectionMode ? (
          <div className={`mt-0.5 w-6 h-6 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'text-accent-600 dark:text-accent-300' : 'text-brand-300 dark:text-brand-600'}`}>
            {isSelected ? <CheckSquare aria-hidden="true" size={24} /> : <div className="w-5 h-5 border-2 border-current rounded-sm" />}
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
            className="mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors shrink-0 border-brand-300 hover:border-accent-500 hover:bg-accent-50 active:bg-accent-100 dark:border-brand-600 dark:hover:border-accent-400 dark:hover:bg-accent-900/30"
            aria-label={`Complete task: ${item.text}`}
          >
            <Check size={14} className="text-transparent hover:text-current active:text-current focus:text-current transition-colors" />
          </button>
        )}

        <div className="flex-1 min-w-0">
          <p className={`font-medium leading-snug ${isSelected ? 'text-accent-800 dark:text-accent-200' : 'text-brand-900 dark:text-brand-50'}`}>{item.text}</p>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            {isOverdue ? (
              <div className="flex items-center gap-1 text-xs px-2 py-1 rounded-sm font-bold bg-money-bgNeg text-money-neg dark:bg-money-neg/15 dark:text-money-neg">
                <AlertCircle size={10} />
                Overdue ({format(dueDate, 'MMM d')})
              </div>
            ) : (
              <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-sm font-medium ${badgeStyleMap[color]}`}>
                <Clock size={10} />
                {isToday(dueDate) ? 'Today' :
                 isTomorrow(dueDate) ? 'Tomorrow' :
                 format(dueDate, 'MMM d')}
              </div>
            )}

            {assignee && (
              <div className="flex items-center gap-1 text-xs text-brand-500 bg-brand-100 px-2 py-1 rounded-sm dark:text-brand-300 dark:bg-brand-700/60">
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

            {/* Plan 080c-5: points-on-completion badge — kid chores only. Dormant for
                normal households: only shown when the assignee is a managed kid. */}
            {assignee?.isManaged === true && (
              <span className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-sm bg-warm-100 text-warm-700 dark:bg-warm-500/15 dark:text-warm-300">
                +{item.points ?? DEFAULT_TODO_POINTS} pts
              </span>
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
                className="hover:text-money-neg active:text-money-neg active:bg-money-bgNeg dark:hover:text-money-neg dark:active:bg-money-neg/15"
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
                aria-label={`More options for: ${item.text}`}
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
    return <>{cardInner}</>;
  }

  return (
    <SwipeableTodoRow
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
});

interface SectionProps {
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
  /** Pre-built member lookup map from page level — avoids rebuilding per-section. */
  memberMap: ReadonlyMap<string, HouseholdMember>;
  isSelectionMode: boolean;
  /** Full selection set — Section only re-renders when its own items' membership changes. */
  selectedIds: ReadonlySet<string>;
  onToggleSelection: (id: string) => void;
}

// Sub-component for sections.
// Uses a custom memo comparator: when `selectedIds` changes, re-render is skipped unless
// at least one of this section's own items changed its selected/deselected state.
// This prevents toggling an item in one section from re-rendering the other two sections.
const Section = React.memo(function Section({ title, subtitle, items, color, onComplete, onEdit, onDelete, onDuplicate, onMoveToTomorrow, onMore, memberMap, isSelectionMode, selectedIds, onToggleSelection }: SectionProps) {

  if (items.length === 0) return null;

  const sectionDotColors = {
    rose: 'bg-money-neg',
    amber: 'bg-warm-500',
    blue: 'bg-habit-blue',
  };

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-(--duration-slow)">
      <div className="flex items-baseline justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${sectionDotColors[color]}`}></div>
          <h2 className="font-display text-base font-semibold text-brand-900 dark:text-brand-50 tracking-tight">{title}</h2>
        </div>
        <span className="text-xs font-semibold text-brand-400 dark:text-brand-500 uppercase tracking-wider">{subtitle}</span>
      </div>

      <SurfaceList className="[&>*:first-child_.hairline-divider]:border-t-0">
        {items.map(item => (
          <TodoRow
            key={item.id}
            item={item}
            color={color}
            assignee={memberMap.get(item.assignedTo)}
            isSelected={selectedIds.has(item.id)}
            isSelectionMode={isSelectionMode}
            onComplete={onComplete}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onMoveToTomorrow={onMoveToTomorrow}
            onMore={onMore}
            onToggleSelection={onToggleSelection}
          />
        ))}
      </SurfaceList>
    </div>
  );
}, (prev: SectionProps, next: SectionProps) => {
  // Fast-path: if the section's items array reference changed, always re-render.
  if (prev.items !== next.items) return false;
  // Check non-set props with reference equality (callbacks are stable via useCallback).
  const sameOtherProps =
    prev.isSelectionMode === next.isSelectionMode &&
    prev.memberMap === next.memberMap &&
    prev.color === next.color &&
    prev.title === next.title &&
    prev.subtitle === next.subtitle &&
    prev.onComplete === next.onComplete &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete &&
    prev.onDuplicate === next.onDuplicate &&
    prev.onMoveToTomorrow === next.onMoveToTomorrow &&
    prev.onMore === next.onMore &&
    prev.onToggleSelection === next.onToggleSelection;
  if (!sameOtherProps) return false;
  // selectedIds reference changed — only re-render if at least one item in THIS
  // section switched its selected/deselected state.
  if (prev.selectedIds === next.selectedIds) return true;
  return !prev.items.some(
    item => prev.selectedIds.has(item.id) !== next.selectedIds.has(item.id)
  );
});

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
    <div className="relative overflow-hidden">
      <motion.div
        className="absolute inset-0 flex items-center justify-end pr-6 bg-money-neg text-white z-0"
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
const CompletedSection = React.memo(function CompletedSection({ title, items, onUncomplete, onDelete, onDuplicate, onMore, memberMap }: {
  title: string;
  items: ToDo[];
  onUncomplete: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (todo: ToDo) => void;
  onMore: (todo: ToDo) => void;
  /** Pre-built member lookup map from page level — avoids rebuilding per-section. */
  memberMap: ReadonlyMap<string, HouseholdMember>;
}) {

    if (items.length === 0) return null;

    return (
        <div className="animate-in slide-in-from-bottom-4 duration-(--duration-slow)">
            <div className="flex items-center gap-2 mb-2 px-1">
                <h2 className="text-xs font-semibold text-brand-400 dark:text-brand-500 uppercase tracking-wider">{title}</h2>
                <div className="h-px bg-brand-200 dark:bg-brand-700 flex-1"></div>
            </div>

            <SurfaceList>
                {items.map(item => {
                    const assignee = memberMap.get(item.assignedTo);
                    const completedDate = item.completedAt ? parseISO(item.completedAt) : null;

                    return (
                        <Row
                            key={item.id}
                            className="group items-start"
                        >
                            <button
                                onClick={() => { haptic('light'); onUncomplete(item.id); }}
                                className="mt-0.5 w-6 h-6 rounded-full border-2 border-brand-300 bg-brand-50 text-brand-400 flex items-center justify-center hover:bg-brand-100 hover:text-accent-600 transition-colors shrink-0 dark:border-brand-600 dark:bg-brand-700/50 dark:text-brand-400 dark:hover:bg-brand-700 dark:hover:text-accent-300"
                                title="Mark as incomplete"
                                aria-label={`Mark as incomplete: ${item.text}`}
                            >
                                <RotateCcw size={14} />
                            </button>

                            <div className="flex-1 min-w-0">
                                <p className="text-brand-500 dark:text-brand-400 line-through decoration-brand-300 dark:decoration-brand-600">{item.text}</p>
                                <div className="flex items-center gap-3 mt-1 text-xs text-brand-400 dark:text-brand-500">
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
                                    className="text-brand-400 hover:text-accent-600 hover:bg-accent-50 dark:text-brand-500 dark:hover:text-accent-300 dark:hover:bg-brand-700/50"
                                    title="Duplicate task"
                                    aria-label={`Duplicate task: ${item.text}`}
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
                                    aria-label={`Delete forever: ${item.text}`}
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
                                 className="text-brand-300 hover:text-accent-600 active:text-accent-800 active:bg-accent-50 dark:text-brand-500 dark:hover:text-brand-300 dark:active:bg-brand-700/50"
                                 aria-label={`More options for: ${item.text}`}
                               >
                                 <MoreVertical size={20} />
                               </Button>
                            </div>
                        </Row>
                    );
                })}
            </SurfaceList>
        </div>
    );
});

export default ToDosPage;
