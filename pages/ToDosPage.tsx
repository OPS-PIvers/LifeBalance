import React, { useState, useMemo, useEffect, useCallback, useRef, useId } from 'react';
import { useTodos, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Calendar, Check, Trash2, Edit2, AlertCircle, X, User, Download, Layers, CheckSquare, Loader2, RotateCcw, Copy, History, MoreVertical, MoreHorizontal, ClipboardList, SlidersHorizontal, ChevronDown, Star, Rows3, Grid2x2, List } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO, isBefore, addDays, startOfToday, endOfWeek, isSameDay, subDays, isSameWeek } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';
import { quadrantForTodo, QUADRANT_ORDER, type Quadrant } from '@/utils/eisenhower';
import { ToDo, HouseholdMember } from '@/types/schema';
import toast from 'react-hot-toast';
import { haptic } from '@/utils/haptics';
import { HapticCheck } from '@/components/ui/HapticCheck';
import { useIsLandscape } from '@/hooks/useOrientation';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import { generateCsvExport } from '@/utils/exportUtils';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { QuickAddBar } from '@/components/ui/QuickAddBar';
import EmptyState from '@/components/ui/EmptyState';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { SurfaceList, Row } from '@/components/ui/Section';
import { cn } from '@/utils/cn';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import BatchRescheduleModal from '@/components/modals/BatchRescheduleModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Section } from '@/components/todos/Section';
import { EisenhowerMatrixView } from '@/components/todos/EisenhowerMatrixView';
import { EisenhowerGridView } from '@/components/todos/EisenhowerGridView';
import { TaskTemplateDrawer } from '@/components/todos/TaskTemplateDrawer';

// localStorage key for the per-device arrangement choice.
const ARRANGEMENT_KEY = 'lifebalance:todos-view';

// Active-view arrangements: chronological list, stacked Eisenhower sections
// ("prioritized list"), or the true 2×2 Eisenhower grid (landscape-only).
type Arrangement = 'list' | 'matrix' | 'grid';

const isArrangement = (value: string | null): value is Arrangement =>
  value === 'list' || value === 'matrix' || value === 'grid';

// The single toggle button cycles list → matrix → grid → list. The icon always
// previews the NEXT view (what tapping will switch to), not the current one.
const ARRANGEMENT_CYCLE: Record<Arrangement, Arrangement> = {
  list: 'matrix',
  matrix: 'grid',
  grid: 'list',
};

const ARRANGEMENT_TOGGLE: Record<Arrangement, { icon: React.ReactNode; label: string; title: string }> = {
  list: { icon: <Rows3 size={18} />, label: 'Switch to prioritized list', title: 'Prioritized list (Eisenhower)' },
  matrix: { icon: <Grid2x2 size={18} />, label: 'Switch to matrix grid', title: 'Matrix grid (2×2, landscape)' },
  grid: { icon: <List size={18} />, label: 'Switch to standard list', title: 'Standard list' },
};

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

  // Assignee filter chips — session-only, transient (not persisted). `null`
  // means "All". Filters every visible section/quadrant to one member's tasks.
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);

  // Active-view arrangement: chronological list, Eisenhower sections, or 2×2 grid.
  // Persisted per-device — this is a personal lens on shared data.
  const [arrangement, setArrangement] = useState<Arrangement>(() => {
    try {
      const stored = localStorage.getItem(ARRANGEMENT_KEY);
      return isArrangement(stored) ? stored : 'list';
    } catch {
      return 'list'; // storage unavailable (private browsing) — default lens
    }
  });
  const setArrangementPersisted = useCallback((next: Arrangement) => {
    setArrangement(next);
    try {
      localStorage.setItem(ARRANGEMENT_KEY, next);
    } catch {
      // non-fatal: the toggle still works for this session
    }
  }, []);

  // The 2×2 grid needs landscape; hook-driven so rotating re-renders instantly.
  const isLandscape = useIsLandscape();

  // Track current date to trigger re-categorization at midnight
  const [currentDate, setCurrentDate] = useState(() => startOfToday());

  // Modal and form state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Top-right overflow ("…") menu of secondary actions (Export, Select multiple)
  // — mirrors the Shopping list header so the two pages share one structure.
  const [menuOpen, setMenuOpen] = useState(false);

  // Mobile Action Drawer State
  const [actionTodo, setActionTodo] = useState<ToDo | null>(null);

  // F-TODO-03 — Task templates ("Quick Task Lists") drawer.
  const [isTemplateDrawerOpen, setIsTemplateDrawerOpen] = useState(false);

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

  // Form State (full add/edit drawer)
  const [text, setText] = useState('');
  const [completeByDate, setCompleteByDate] = useState(getLocalDateString());
  const [assignedTo, setAssignedTo] = useState('');
  const [isImportant, setIsImportant] = useState(false);
  // Shared notes surfaced in the editor drawer — visible to all household members
  // (to-dos are already shared). Capped to match the firestore.rules validator.
  const [notes, setNotes] = useState('');

  // Sticky quick-add bar state — mirrors the shopping list's inline add. The
  // input is desktop-only autofocused (useAutoFocus skips touch so it doesn't
  // pop the iOS keyboard on mount; this page is also embedded in /lists).
  const [quickText, setQuickText] = useState('');
  const quickAddRef = useAutoFocus<HTMLInputElement>();
  // Synchronous in-flight guard: blocks a same-tick double submit (key-repeat /
  // double-click both read the stale quickText closure before the clear
  // re-renders, which would create duplicate tasks). A ref (not state) so the
  // input stays enabled — the whole point of a quick-add bar is rapid-fire
  // entry, so we deliberately do NOT disable the field between adds.
  const submittingQuickAddRef = useRef(false);

  // Categorize To-Dos (Active)
  const { immediate, upcoming, radar, allActiveCount, allActiveIds } = useMemo(() => {
    const active = todos.filter(t => !t.isCompleted && (assigneeFilter === null || t.assignedTo === assigneeFilter));
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
  }, [todos, currentDate, assigneeFilter]);

  // Eisenhower buckets — computed unconditionally (hooks rule) but only
  // rendered in the matrix arrangement. Urgency uses the same midnight-
  // refreshed currentDate as the list sections, so the views always agree.
  const quadrants = useMemo(() => {
    const buckets: Record<Quadrant, ToDo[]> = { do: [], schedule: [], delegate: [], later: [] };
    todos.forEach(todo => {
      if (todo.isCompleted) return;
      if (assigneeFilter !== null && todo.assignedTo !== assigneeFilter) return;
      buckets[quadrantForTodo(todo, currentDate)].push(todo);
    });
    const byDueDate = (a: ToDo, b: ToDo) => a.completeByDate.localeCompare(b.completeByDate);
    QUADRANT_ORDER.forEach(q => buckets[q].sort(byDueDate));
    return buckets;
  }, [todos, currentDate, assigneeFilter]);

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

  // Open the full add form (date + assignee). Carries over whatever is already
  // typed in the sticky quick-add field so switching to "details" never loses it.
  const openAddModal = useCallback(() => {
    setText(quickText.trim());
    setCompleteByDate(getLocalDateString());
    const defaultAssignee = currentUser?.uid ?? (members.length > 0 ? members[0]!.uid : ''); // members[0] is defined: guarded by members.length > 0
    setAssignedTo(defaultAssignee);
    setIsImportant(false);
    setNotes('');
    setEditingId(null);
    setIsAddModalOpen(true);
  }, [quickText, currentUser, members]);

  // Quick-add (sticky bar): create a task with sensible defaults — due today,
  // assigned to the current user (falling back to the first member). For a
  // different date/assignee, the adjacent "details" button opens the full form.
  const handleQuickAdd = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = quickText.trim();
    if (!trimmed || submittingQuickAddRef.current) return;
    if (members.length === 0) {
      toast.error('No household members available. Please add members first.');
      return;
    }
    const assignee = currentUser?.uid ?? members[0]!.uid; // members[0] is defined: guarded by members.length === 0 above
    submittingQuickAddRef.current = true;
    setQuickText('');
    // Haptic at gesture time: after the await, transient user activation has
    // expired and the iOS transport silently no-ops (see utils/haptics.ts).
    haptic('success');
    try {
      await addToDo({
        text: trimmed,
        completeByDate: getLocalDateString(),
        assignedTo: assignee,
        isCompleted: false,
      });
      toast.success('Task added');
    } catch (error) {
      console.error('Error adding to-do:', error);
      toast.error('Failed to add task. Please try again.');
      setQuickText(trimmed); // restore so the user doesn't lose their input
    } finally {
      submittingQuickAddRef.current = false;
    }
  }, [quickText, members, currentUser, addToDo]);

  // Open modal for editing
  const openEditModal = useCallback((todo: ToDo) => {
    setText(todo.text);
    setCompleteByDate(todo.completeByDate);
    setAssignedTo(todo.assignedTo);
    setIsImportant(todo.isImportant === true);
    setNotes(todo.notes ?? '');
    setEditingId(todo.id);
    setIsAddModalOpen(true);
  }, []);

  const handleDuplicate = useCallback(async (todo: ToDo) => {
      haptic('success'); // at gesture time — dead after the await on iOS
      try {
          await addToDo({
              text: todo.text,
              completeByDate: getLocalDateString(), // Default to today for the copy
              assignedTo: todo.assignedTo,
              isCompleted: false,
          });
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

  // One-tap importance triage from any row (both arrangements) — the fast way
  // to walk the list with a partner without opening the edit drawer per task.
  const handleToggleImportant = useCallback(async (todo: ToDo) => {
      const next = todo.isImportant !== true;
      haptic('light'); // at gesture time — dead after the await on iOS
      try {
          await updateToDo(todo.id, { isImportant: next });
      } catch (error) {
          console.error('Failed to update importance:', error);
          toast.error('Failed to update importance');
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

  // The 2×2 grid's compact chips have no selection affordance, so batch
  // selection falls back to the stacked quadrant sections — same buckets,
  // selectable rows. The stored preference is untouched.
  const effectiveArrangement: Arrangement =
    isSelectionMode && arrangement === 'grid' ? 'matrix' : arrangement;

  const gridOverlayVisible =
    viewMode === 'active' && effectiveArrangement === 'grid' && isLandscape;
  const drawerOpen = isAddModalOpen || !!actionTodo;

  // Body-scroll lock for the immersive grid overlay, held at PAGE level as a
  // latch rather than inside GridOverlay. Why: if the user rotates to portrait
  // WHILE the edit/action drawer is open, the overlay unmounts but the drawer
  // still needs the lock — an overlay-local cleanup would restore body scroll
  // behind the open drawer (and the Drawer, having captured 'hidden' as its
  // "original" when it opened over the locked overlay, would then re-pin
  // 'hidden' forever on close). The latch engages when the overlay appears and
  // releases only when BOTH the overlay and any drawer above it are closed.
  // It deliberately never engages from a plain drawer open (Drawer owns its
  // own lock). On release we CLEAR the inline override rather than restoring a
  // captured value: the latch can engage while a Drawer already holds the lock
  // (drawer opened in portrait, then rotated to landscape), so any value
  // captured at engage time may be the drawer's 'hidden' — restoring it would
  // pin the page unscrollable. Clearing falls back to the stylesheet default,
  // and on release Drawer's cleanup (child effect, destroyed first) runs
  // before this one, so the clear is the final, correct write.
  // Latch state uses the render-phase-setState edge pattern (see
  // wasSelectionMode above) instead of an effect cascade.
  const [scrollLockHeld, setScrollLockHeld] = useState(false);
  if (gridOverlayVisible && !scrollLockHeld) {
    setScrollLockHeld(true);
  } else if (scrollLockHeld && !gridOverlayVisible && !drawerOpen) {
    setScrollLockHeld(false);
  }
  useEffect(() => {
    if (!scrollLockHeld) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [scrollLockHeld]);

  // Ensure user is authenticated (should be guaranteed by ProtectedRoute, but defensive check)
  if (!currentUser) {
    return (
      <div className="pb-nav-safe pt-6 px-4 max-w-2xl mx-auto">
        <EmptyState
          icon={<AlertCircle size={28} />}
          title="Authentication required"
          description="Please log in to manage your to-do list."
          tone="danger"
        />
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
    if (isSaving) return;
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

    setIsSaving(true);
    try {
      const trimmedText = text.trim();
      const trimmedNotes = notes.trim();
      if (editingId) {
        await updateToDo(editingId, {
          text: trimmedText,
          completeByDate,
          assignedTo,
          isImportant,
          notes: trimmedNotes
        });
        toast.success('Task updated');
      } else {
        haptic('success'); // at gesture time — dead after the await on iOS
        await addToDo({
          text: trimmedText,
          completeByDate,
          assignedTo,
          isCompleted: false,
          isImportant,
          notes: trimmedNotes
        });
        toast.success('Task added');
        setQuickText(''); // the detailed form consumed the carried-over text
      }
      setIsAddModalOpen(false);
    } catch (error) {
      console.error('Error saving to-do:', error);
      toast.error('Failed to save to-do. Please try again.');
    } finally {
      setIsSaving(false);
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
        toast.success(`Completed ${successful} tasks!`);
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

  // Secondary header actions, collapsed into the top-right "…" overflow menu
  // (same pattern as the Shopping list). Export targets the current view;
  // Select-multiple (batch mode) is disabled in the Completed view, matching
  // the previous behaviour.
  const menuItems: MenuItem[] = [
    {
      key: 'export',
      label: 'Export CSV',
      icon: <Download size={16} />,
      onSelect: handleExport,
      disabled: viewMode === 'active' ? allActiveCount === 0 : completedCount === 0,
    },
    {
      key: 'select',
      label: 'Select multiple',
      icon: <Layers size={16} />,
      onSelect: () => setIsSelectionMode(true),
      disabled: viewMode === 'completed',
    },
  ];

  // Sticky quick-add card — reuses the shopping list's pattern: the add bar is
  // its own top card that stays pinned while a long list scrolls beneath it, so
  // adding a task is always one tap away. `position: sticky` dies inside an
  // `overflow-hidden` ancestor, so the bar lives in a plain sticky wrapper
  // (page-colored background masks rows scrolling past the card's rounded
  // corners) with the `SurfaceList` card nested inside — never in a section's
  // clipped surface. The sticky offset tucks it under ListsPage's sticky tab
  // strip via --lists-sticky-top (0px fallback when the strip is hidden).
  // Shared by the list and matrix arrangements; hidden in selection mode (adding
  // has no context there) and in the grid arrangement (landscape-immersive).
  // Assignee filter chips — 'All' plus one avatar-chip per member, using the
  // same visual pattern as the assign-to fieldset in the add/edit drawer.
  // Skipped entirely for single-member households where filtering is moot.
  const assigneeFilterChips = !isSelectionMode && members.length > 1 ? (
    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by assignee">
      <button
        type="button"
        onClick={() => setAssigneeFilter(null)}
        aria-pressed={assigneeFilter === null}
        className={cn(
          'flex items-center px-3 py-1.5 rounded-btn border text-sm font-medium whitespace-nowrap transition-colors duration-(--duration-fast) ease-(--ease-standard)',
          assigneeFilter === null
            ? 'bg-accent-600 text-white border-accent-600 dark:bg-accent-600 dark:border-accent-600'
            : 'bg-white text-brand-600 border-brand-200 hover:bg-brand-50 dark:bg-brand-700/50 dark:text-brand-200 dark:border-brand-600 dark:hover:bg-brand-700'
        )}
      >
        All
      </button>
      {members.map(member => (
        <button
          key={member.uid}
          type="button"
          onClick={() => setAssigneeFilter(prev => (prev === member.uid ? null : member.uid))}
          aria-label={`Filter to ${member.displayName || 'User'}`}
          aria-pressed={assigneeFilter === member.uid}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-btn border transition-colors duration-(--duration-fast) ease-(--ease-standard) whitespace-nowrap',
            assigneeFilter === member.uid
              ? 'bg-accent-600 text-white border-accent-600 dark:bg-accent-600 dark:border-accent-600'
              : 'bg-white text-brand-600 border-brand-200 hover:bg-brand-50 dark:bg-brand-700/50 dark:text-brand-200 dark:border-brand-600 dark:hover:bg-brand-700'
          )}
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
  ) : null;

  const stickyQuickAdd = !isSelectionMode && effectiveArrangement !== 'grid' ? (
    <div className="sticky top-[var(--lists-sticky-top,0px)] z-20 bg-brand-50 dark:bg-brand-900">
      <SurfaceList>
        <div className="flex items-center gap-2">
          <QuickAddBar
            attached
            onSubmit={handleQuickAdd}
            inputRef={quickAddRef}
            value={quickText}
            onChange={setQuickText}
            placeholder="Add a task..."
            aria-label="Quick add task"
            disabled={!quickText.trim()}
            submitLabel="Add task"
          />

          {/* Task templates — one-tap creation of a bundle of recurring tasks
              from a saved template (F-TODO-03, "Quick Task Lists"). */}
          <button
            type="button"
            onClick={() => setIsTemplateDrawerOpen(true)}
            aria-label="Task templates"
            title="Add tasks from a template"
            className="flex-none flex items-center justify-center p-3 rounded-btn text-brand-600 hover:text-brand-900 hover:bg-brand-100 dark:text-brand-300 dark:hover:text-brand-50 dark:hover:bg-brand-700/50 transition-colors duration-(--duration-fast) ease-(--ease-standard)"
          >
            <ClipboardList className="w-5 h-5" />
          </button>

          {/* Details — opens the full form to set a custom due date / assignee /
              importance. Retains aria-label "Add new task" so it is the page's
              full-add entry point. */}
          <button
            type="button"
            onClick={openAddModal}
            aria-label="Add new task"
            title="Add with date & assignee"
            className="flex-none flex items-center justify-center p-3 mr-2 rounded-btn text-brand-600 hover:text-brand-900 hover:bg-brand-100 dark:text-brand-300 dark:hover:text-brand-50 dark:hover:bg-brand-700/50 transition-colors duration-(--duration-fast) ease-(--ease-standard)"
          >
            <SlidersHorizontal className="w-5 h-5" />
          </button>
        </div>
      </SurfaceList>
    </div>
  ) : null;

  return (
    <div className={cn("px-4 max-w-2xl mx-auto space-y-4 min-h-screen", isSelectionMode ? "pb-40" : "pb-nav-safe")}>

      {/* Compact header unit: title + toggle/select-all row read as one block
          (tight gap, no PageHeader padding tax) since the Plan tab-strip
          already labels this page "To-Dos". */}
      <div className="pt-4 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <h1 className="font-display text-xl font-semibold tracking-tight text-brand-900 dark:text-brand-50 whitespace-nowrap shrink-0">
            {isSelectionMode ? 'Select tasks' : 'To-dos'}
          </h1>
          {!isSelectionMode && (
            <>
              <Tabs value={viewMode} onValueChange={(val) => setViewMode(val as 'active' | 'completed')}>
                <TabsList size="sm" className="w-auto inline-flex">
                  <TabsTrigger value="active">Active</TabsTrigger>
                  <TabsTrigger value="completed">{completedBadge}</TabsTrigger>
                </TabsList>
              </Tabs>
              {/* Arrangement toggle for the Active view — cycles list →
                  prioritized (matrix) → 2×2 grid → list; the icon previews the
                  NEXT view. Stays visible on the Completed tab (it flips what
                  Active will show on return) — simpler than hiding it. */}
              <Button
                variant="ghost-brand"
                size="icon"
                onClick={() => setArrangementPersisted(ARRANGEMENT_CYCLE[arrangement])}
                aria-label={ARRANGEMENT_TOGGLE[arrangement].label}
                title={ARRANGEMENT_TOGGLE[arrangement].title}
                className="shrink-0"
              >
                {ARRANGEMENT_TOGGLE[arrangement].icon}
              </Button>
            </>
          )}
        </div>
        {isSelectionMode ? (
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleSelectAll}
              className="text-sm text-accent-600 dark:text-accent-300 font-medium flex items-center gap-1 hover:text-accent-700 dark:hover:text-accent-200"
            >
              <CheckSquare size={14} aria-hidden="true" className={selectedIds.size === allActiveCount && allActiveCount > 0 ? 'text-accent-600 dark:text-accent-300' : 'text-brand-300 dark:text-brand-450'} />
              {selectedIds.size === allActiveCount && allActiveCount > 0 ? 'Deselect all' : 'Select all'}
            </button>
            {/* While selecting, a visible Cancel (X) stays in the header so the
               way out is always one tap away — the overflow menu is hidden. */}
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setIsSelectionMode(false)}
              className="bg-brand-100 border-brand-200 dark:bg-brand-700 dark:border-brand-600"
              title="Cancel Selection"
              aria-label="Cancel Selection"
            >
              <X size={20} />
            </Button>
          </div>
        ) : (
          /* Secondary actions (Export, Select multiple) collapse into one
             top-right "…" overflow menu, matching the Shopping list header.
             The primary add now lives in the sticky quick-add bar below. */
          <div className="relative shrink-0">
            <Button
              variant="ghost-brand"
              size="icon"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="To-do list actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="rounded-full min-w-11 min-h-11"
            >
              <MoreHorizontal className="w-5 h-5" />
            </Button>
            {menuOpen && (
              <Menu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                ariaLabel="To-do list actions"
                position="top-full right-0 mt-2"
                className="min-w-[208px]"
                items={menuItems}
              />
            )}
          </div>
        )}
      </div>

      {viewMode === 'active' ? (
          <>
            {/* Sticky quick-add card — pinned at the top of the active view so
                the add bar stays visible while a long list scrolls beneath it
                (reused from the Shopping list). Precedes the sections in both
                the list and matrix arrangements. */}
            {assigneeFilterChips}
            {stickyQuickAdd}
            {effectiveArrangement === 'list' ? (
            <>
            {/* Immediate Section — Overdue, Today & Tomorrow. Quick-add now lives
                in the sticky card above (not row one of this section), so an
                empty Immediate section collapses away entirely. */}
            <Section
                title="Immediate"
                subtitle="Overdue, Today & Tomorrow"
                items={immediate}
                color="rose"
                onComplete={completeToDo}
                onUncomplete={handleUncomplete}
                onEdit={openEditModal}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                onMoveToTomorrow={handleMoveToTomorrow}
                onToggleImportant={handleToggleImportant}
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
                maxVisible={5}
                onComplete={completeToDo}
                onUncomplete={handleUncomplete}
                onEdit={openEditModal}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                onMoveToTomorrow={handleMoveToTomorrow}
                onToggleImportant={handleToggleImportant}
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
                maxVisible={5}
                onComplete={completeToDo}
                onUncomplete={handleUncomplete}
                onEdit={openEditModal}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                onMoveToTomorrow={handleMoveToTomorrow}
                onToggleImportant={handleToggleImportant}
                onMore={setActionTodo}
                memberMap={memberMap}
                isSelectionMode={isSelectionMode}
                selectedIds={selectedIds}
                onToggleSelection={toggleSelection}
            />
            </>
            ) : effectiveArrangement === 'matrix' ? (
            /* Eisenhower matrix arrangement — same tasks, partitioned by
               urgency (derived from due date, same window as Immediate) ×
               importance (the star). Stacked sections in actionability order;
               the quick-add bar sits in the sticky card above. */
            <EisenhowerMatrixView
              quadrants={quadrants}
              memberMap={memberMap}
              isSelectionMode={isSelectionMode}
              selectedIds={selectedIds}
              onComplete={completeToDo}
              onUncomplete={handleUncomplete}
              onEdit={openEditModal}
              onDelete={deleteToDo}
              onDuplicate={handleDuplicate}
              onMoveToTomorrow={handleMoveToTomorrow}
              onToggleImportant={handleToggleImportant}
              onMore={setActionTodo}
              onToggleSelection={toggleSelection}
            />
            ) : (
            /* True 2×2 Eisenhower grid — auto-immersive full-screen overlay in
               landscape; a friendly rotate prompt in portrait. */
            <EisenhowerGridView
              quadrants={quadrants}
              isLandscape={isLandscape}
              onComplete={completeToDo}
              onEdit={openEditModal}
              onToggleImportant={handleToggleImportant}
              onExit={() => setArrangementPersisted('list')}
              escapeDisabled={isAddModalOpen || !!actionTodo}
            />
            )}

            {/* The sticky quick-add card is always visible in the list/matrix
                arrangements, so "add a task above" points straight at it. Shown
                only when every section is empty; the grid arrangement has no
                quick-add card, so the note would mislead there. */}
            {effectiveArrangement !== 'grid' && immediate.length === 0 && upcoming.length === 0 && radar.length === 0 && (
                 <p className="px-1 text-sm text-brand-400 dark:text-brand-450 flex items-center gap-1.5">
                     <ClipboardList size={14} aria-hidden="true" />
                     All caught up — add a task above to get started.
                 </p>
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
                defaultCollapsed
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                onMore={setActionTodo}
                memberMap={memberMap}
            />
            <CompletedSection
                title="Older History"
                items={completedOlder}
                defaultCollapsed
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
                 <EmptyState
                     variant="surface"
                     icon={<History size={28} />}
                     title="No history yet"
                     description="Completed tasks will appear here."
                 />
            )}
          </>
      )}

      {/* Floating Action Bar (FAB) for Batch Actions */}
      {isSelectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-24 left-0 right-0 px-4 md:px-0 flex justify-center z-50 pointer-events-none">
          <div className="bg-brand-900 dark:bg-brand-800 text-white p-2 rounded-card shadow-raised border border-brand-700 flex items-center gap-2 pointer-events-auto animate-in slide-in-from-bottom-4">
            <div className="px-3 font-semibold text-sm border-r border-white/10">
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
              className="h-auto py-1 px-3 font-normal text-money-negDark hover:text-money-negDark hover:bg-money-neg/20"
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

      {/* Add/Edit Task Drawer */}
      <Drawer
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        disableClose={isSaving}
        title={editingId ? 'Edit task' : 'New task'}
      >
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

          <Textarea
            id="task-notes"
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add details, links, or context (optional)"
            maxLength={1000}
            showCount
            rows={3}
          />

          {/* Eisenhower importance — a household judgment call, deliberately a
              yes/no (not low/med/high) to match the matrix's two-state axis. */}
          <button
            type="button"
            onClick={() => setIsImportant(v => !v)}
            aria-pressed={isImportant}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-3 rounded-btn border text-left transition-colors duration-(--duration-fast) ease-(--ease-standard)',
              isImportant
                ? 'bg-warm-100 border-warm-500/40 dark:bg-warm-500/15 dark:border-warm-500/40'
                : 'bg-white border-brand-200 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:hover:bg-brand-700'
            )}
          >
            <Star
              size={20}
              aria-hidden="true"
              className={isImportant ? 'text-warm-500 fill-warm-500' : 'text-brand-300 dark:text-brand-500'}
            />
            <span className="flex-1 min-w-0">
              <span className={cn('block text-sm font-medium', isImportant ? 'text-warm-700 dark:text-warm-300' : 'text-brand-900 dark:text-brand-50')}>
                Important
              </span>
              <span className="block text-xs text-brand-400 dark:text-brand-450">
                Matters to the family — big consequences if skipped
              </span>
            </span>
          </button>

          <fieldset>
            <legend className="block text-xs font-bold text-brand-400 dark:text-brand-450 uppercase tracking-wider mb-1">
              Assign to
            </legend>
            {members.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-brand-400 dark:text-brand-450 py-2">
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
            isLoading={isSaving}
            disabled={members.length === 0}
            className="w-full mt-4 py-3.5"
          >
            {editingId ? 'Save changes' : 'Create task'}
          </Button>
        </form>
      </Drawer>

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

      <TaskTemplateDrawer
        isOpen={isTemplateDrawerOpen}
        onClose={() => setIsTemplateDrawerOpen(false)}
      />

    </div>
  );
};

// Sub-component for completed items
const CompletedSection = React.memo(function CompletedSection({ title, items, onUncomplete, onDelete, onDuplicate, onMore, memberMap, defaultCollapsed = false }: {
  title: string;
  items: ToDo[];
  onUncomplete: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (todo: ToDo) => void;
  onMore: (todo: ToDo) => void;
  /** Pre-built member lookup map from page level — avoids rebuilding per-section. */
  memberMap: ReadonlyMap<string, HouseholdMember>;
  /**
   * Start collapsed behind a header toggle (used for the older buckets so
   * recent completions stay in view). Omit/false = always-expanded header.
   */
  defaultCollapsed?: boolean;
}) {
    // Toggle state for collapsible buckets (hooks must run before the empty early-return).
    const [expanded, setExpanded] = useState(!defaultCollapsed);
    const contentId = useId();

    if (items.length === 0) return null;

    // The prop is constant per call site, so it safely decides whether the
    // header renders as a toggle button or the plain always-expanded title.
    const collapsible = defaultCollapsed;

    return (
        <div className="animate-in slide-in-from-bottom-4 duration-(--duration-slow)">
            <div className="flex items-center gap-2 mb-2 px-1">
                {collapsible ? (
                    <h2 className="min-w-0">
                        <button
                            type="button"
                            onClick={() => setExpanded(v => !v)}
                            aria-expanded={expanded}
                            aria-controls={contentId}
                            className="flex min-h-11 items-center gap-1.5 text-xs font-semibold text-brand-400 dark:text-brand-450 uppercase tracking-wider hover:text-brand-600 dark:hover:text-brand-300 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-sm"
                        >
                            {title}
                            <span className="tabular-nums">({items.length})</span>
                            <ChevronDown
                                size={14}
                                aria-hidden="true"
                                className={cn(
                                    'shrink-0 transition-transform duration-(--duration-base) ease-(--ease-standard)',
                                    expanded && 'rotate-180'
                                )}
                            />
                        </button>
                    </h2>
                ) : (
                    <h2 className="text-xs font-semibold text-brand-400 dark:text-brand-450 uppercase tracking-wider">{title}</h2>
                )}
                <div className="h-px bg-brand-200 dark:bg-brand-700 flex-1"></div>
            </div>

            {(!collapsible || expanded) && (
            <SurfaceList
                id={contentId}
                className={collapsible ? 'animate-in fade-in slide-in-from-top-2 duration-(--duration-base)' : undefined}
            >
                {items.map(item => {
                    const assignee = memberMap.get(item.assignedTo);
                    const completedDate = item.completedAt ? parseISO(item.completedAt) : null;

                    return (
                        <Row
                            key={item.id}
                            className="group items-start"
                        >
                            <HapticCheck
                                checked={true}
                                onCheckedChange={() => onUncomplete(item.id)}
                                className="mt-0.5 shrink-0"
                                aria-label={`Mark as incomplete: ${item.text}`}
                            >
                                <span
                                    title="Mark as incomplete"
                                    className="w-6 h-6 rounded-full border-2 border-brand-300 bg-brand-50 text-brand-400 flex items-center justify-center hover:bg-brand-100 hover:text-accent-600 transition-colors dark:border-brand-600 dark:bg-brand-700/50 dark:text-brand-400 dark:hover:bg-brand-700 dark:hover:text-accent-300"
                                >
                                    <RotateCcw size={14} />
                                </span>
                            </HapticCheck>

                            <div className="flex-1 min-w-0">
                                <p className="text-brand-500 dark:text-brand-400 line-through decoration-brand-300 dark:decoration-brand-600">{item.text}</p>
                                <div className="flex items-center gap-3 mt-1 text-xs text-brand-400 dark:text-brand-450">
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
                                    className="text-brand-400 hover:text-accent-600 hover:bg-accent-50 dark:text-brand-450 dark:hover:text-accent-300 dark:hover:bg-brand-700/50"
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
                                 className="text-brand-300 hover:text-accent-600 active:text-accent-800 active:bg-accent-50 dark:text-brand-450 dark:hover:text-brand-300 dark:active:bg-brand-700/50"
                                 aria-label={`More options for: ${item.text}`}
                               >
                                 <MoreVertical size={20} />
                               </Button>
                            </div>
                        </Row>
                    );
                })}
            </SurfaceList>
            )}
        </div>
    );
});

export default ToDosPage;
