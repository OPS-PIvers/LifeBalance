import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useTodos, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Calendar, Check, Trash2, Edit2, AlertCircle, X, User, Download, Layers, CheckSquare, Loader2, RotateCcw, Copy, History, MoreHorizontal, ClipboardList, SlidersHorizontal, ChevronDown, Star, Rows3, Grid2x2, List, Camera, Smartphone, Sparkles, Plus, Repeat } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO, isBefore, addDays, startOfToday, endOfWeek, isSameDay, subDays, isSameWeek } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';
import { quadrantForTodo, QUADRANT_ORDER, type Quadrant } from '@/utils/eisenhower';
import { toggleSubtask, appendSubtask, removeSubtask, subtasksFromTexts, isPermissionDeniedError, subtaskProgress } from '@/utils/subtasks';
import { TODO_FREQUENCIES, TODO_FREQUENCY_LABELS, type TodoFrequency } from '@/utils/todoRecurrence';
import { REMINDER_OFFSET_OPTIONS, compareDueTimes } from '@/utils/todoTime';
import { ToDo, HouseholdMember, Subtask } from '@/types/schema';
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
import SectionHeading from '@/components/ui/SectionHeading';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import CountBadge from '@/components/ui/CountBadge';
import { cn } from '@/utils/cn';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Eyebrow from '@/components/ui/Eyebrow';
import Textarea from '@/components/ui/Textarea';
import BatchRescheduleModal from '@/components/modals/BatchRescheduleModal';
import { TodoPhotoImportDrawer } from '@/components/modals/TodoPhotoImportDrawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TodoSection } from '@/components/todos/TodoSection';
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

// View choices for the overflow menu — labeled radio-style items (the old
// single cycle button previewed the NEXT view's icon, which read as mystery
// meat). Order matches the old cycle: list → prioritized → grid.
const ARRANGEMENT_OPTIONS: Array<{ value: Arrangement; icon: React.ReactNode; label: string }> = [
  { value: 'list', icon: <List size={16} />, label: 'List view' },
  { value: 'matrix', icon: <Rows3 size={16} />, label: 'Prioritized list' },
  { value: 'grid', icon: <Grid2x2 size={16} />, label: '2×2 grid' },
];

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
  const { members, currentUser, householdId } = useHouseholdCore();

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
  // F-TODO-06: photo-to-tasklist import drawer.
  const [isPhotoImportOpen, setIsPhotoImportOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Top-right overflow ("…") menu of secondary actions (Export, Select multiple)
  // — mirrors the Shopping list header so the two pages share one structure.
  const [menuOpen, setMenuOpen] = useState(false);

  // "More ways to add" menu next to the quick-add bar — collapses the old pair
  // of unlabeled icon buttons (full form / templates) plus Scan a list into
  // one labeled affordance.
  const [addMenuOpen, setAddMenuOpen] = useState(false);

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
  // F-TODO-14: optional due time-of-day (HH:mm, '' = none) and reminder lead
  // time in minutes (null = no reminder). The reminder picker is only enabled
  // once a due time is set — a reminder needs a time to anchor to.
  const [dueTime, setDueTime] = useState('');
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState<number | null>(null);
  // F-TODO-01: recurrence cadence for the full add/edit form. 'none' = one-off.
  const [recurrence, setRecurrence] = useState<'none' | TodoFrequency>('none');
  // Shared notes surfaced in the editor drawer — visible to all household members
  // (to-dos are already shared). Capped to match the firestore.rules validator.
  const [notes, setNotes] = useState('');
  // F-TODO-08: subtask checklist edited in the drawer as local state, persisted
  // on save via addToDo/updateToDo. `subtaskInput` is the pending new-step text;
  // `aiBreakingDown` guards the "Break down with AI" request.
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [subtaskInput, setSubtaskInput] = useState('');
  const [aiBreakingDown, setAiBreakingDown] = useState(false);
  // Progressive disclosure: the drawer shows only the core fields (task, due
  // date, assignee, important) until "More options" is expanded. Editing a task
  // that already has any secondary value auto-expands so nothing is hidden.
  const [moreOpen, setMoreOpen] = useState(false);

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

    // Sort by date using pre-parsed timestamps; within the same day, timed
    // to-dos come first ordered by their due time (F-TODO-14).
    const sortByCompleteByDate = (a: ToDo, b: ToDo) =>
      ((dateMap.get(a.id) || 0) - (dateMap.get(b.id) || 0)) || compareDueTimes(a, b);

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
    const byDueDate = (a: ToDo, b: ToDo) =>
      a.completeByDate.localeCompare(b.completeByDate) || compareDueTimes(a, b);
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

  // Inline CountBadge variant (a tab count, not a notification). The badge
  // itself is aria-hidden, so the count also rides along as sr-only text.
  const completedBadge = (
    <span className="flex items-center gap-1.5">
        Completed
        <CountBadge count={completedCount} max={99} variant="inline" />
        <span className="sr-only">{completedCount} completed {completedCount === 1 ? 'task' : 'tasks'}</span>
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
    setDueTime('');
    setReminderMinutesBefore(null);
    setRecurrence('none');
    setNotes('');
    setSubtasks([]);
    setSubtaskInput('');
    setMoreOpen(false);
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
    setDueTime(todo.dueTime ?? '');
    setReminderMinutesBefore(todo.reminderMinutesBefore ?? null);
    setRecurrence(todo.recurrence?.frequency ?? 'none');
    setNotes(todo.notes ?? '');
    setSubtasks(todo.subtasks ?? []);
    setSubtaskInput('');
    // Auto-expand when any hidden-by-default field already has a value —
    // editing a task with notes/subtasks/time/repeat must never hide them.
    setMoreOpen(
      !!todo.dueTime ||
      todo.reminderMinutesBefore != null ||
      !!todo.recurrence ||
      !!(todo.notes && todo.notes.trim()) ||
      (todo.subtasks?.length ?? 0) > 0
    );
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

  // --- Drawer subtask editor handlers (local state; persisted on save) ---
  const handleAddSubtaskInput = useCallback(() => {
    setSubtasks(prev => appendSubtask(prev, subtaskInput));
    setSubtaskInput('');
  }, [subtaskInput]);

  const handleRemoveSubtaskLocal = useCallback((id: string) => {
    setSubtasks(prev => removeSubtask(prev, id));
  }, []);

  const handleToggleSubtaskLocal = useCallback((id: string) => {
    setSubtasks(prev => toggleSubtask(prev, id));
  }, []);

  // "Break down with AI": ask the Gemini proxy to decompose the task into steps,
  // appending any it returns. Fully guarded — a disabled kill-switch, quota cap,
  // or transport error surfaces a toast and leaves the manual editor untouched.
  const handleBreakDownWithAI = useCallback(async () => {
    const taskText = text.trim();
    if (!taskText) {
      toast.error('Add a task description first');
      return;
    }
    if (!householdId) {
      toast.error('Household not ready — try again in a moment');
      return;
    }
    setAiBreakingDown(true);
    try {
      const { suggestSubtasks } = await import('@/services/geminiService');
      const steps = await suggestSubtasks(householdId, taskText, notes.trim() || undefined);
      const built = subtasksFromTexts(steps);
      if (built.length === 0) {
        toast('No steps suggested — this task looks atomic.', { icon: 'ℹ️' });
        return;
      }
      setSubtasks(prev => [...prev, ...built]);
      toast.success(`Added ${built.length} step${built.length === 1 ? '' : 's'}`);
    } catch (error) {
      console.error('Failed to break down task:', error);
      const message = error instanceof Error && error.message.includes('temporarily disabled')
        ? 'AI features are turned off right now.'
        : error instanceof Error && error.message.toLowerCase().includes('quota')
          ? error.message
          : 'Could not break down this task. Please try again.';
      toast.error(message);
    } finally {
      setAiBreakingDown(false);
    }
  }, [text, notes, householdId]);

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

  // The 2×2 grid falls back to the stacked quadrant sections — same buckets,
  // full rows — whenever it can't do its job: in selection mode its compact
  // chips have no selection affordance, and in portrait the four quadrants
  // can't fit side by side (a full-screen "rotate your phone" wall would hide
  // every task in the phone's default orientation). The stored preference is
  // untouched, so rotating to landscape restores the grid.
  const effectiveArrangement: Arrangement =
    arrangement === 'grid' && (isSelectionMode || !isLandscape) ? 'matrix' : arrangement;

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
      const editingTodo = editingId ? todos.find(t => t.id === editingId) : undefined;
      // F-TODO-01: recurrence template. Preserve an existing chain root across
      // edits; a fresh recurring task has no parentRecurringId yet (the first
      // spawn on completion anchors it).
      const recurrenceValue: ToDo['recurrence'] | undefined =
        recurrence === 'none'
          ? undefined
          : { frequency: recurrence, ...(editingTodo?.recurrence?.parentRecurringId
              ? { parentRecurringId: editingTodo.recurrence.parentRecurringId }
              : {}) };
      const trimmedNotes = notes.trim();
      // Only write the `subtasks` field when there's something to persist (or when
      // clearing a task that previously had them). This keeps ordinary edits off
      // the new field until the firestore.rules whitelist ships it — a plain task
      // with no checklist never sends `subtasks`, so its write stays valid today.
      const editingOriginal = editingId ? todos.find(t => t.id === editingId) : undefined;
      const hadSubtasks = (editingOriginal?.subtasks?.length ?? 0) > 0;
      const subtaskField: Partial<ToDo> =
        subtasks.length > 0 || hadSubtasks ? { subtasks } : {};
      // F-TODO-14: a reminder is only meaningful anchored to a due time — if
      // the time was cleared, drop the reminder with it. Like recurrence and
      // subtasks, only touch these fields when set now or previously set, so
      // plain (never-timed) edits stay byte-identical to today's writes.
      const dueTimeValue = dueTime || undefined;
      const reminderValue = dueTimeValue != null ? reminderMinutesBefore ?? undefined : undefined;
      const timeFields: Partial<ToDo> = {};
      if (dueTimeValue !== undefined) {
        timeFields.dueTime = dueTimeValue;
      } else if (editingTodo?.dueTime != null) {
        timeFields.dueTime = undefined; // sanitizer writes null → cleared
      }
      if (reminderValue !== undefined) {
        timeFields.reminderMinutesBefore = reminderValue;
      } else if (editingTodo?.reminderMinutesBefore != null) {
        timeFields.reminderMinutesBefore = undefined;
      }
      if (editingId) {
        // Scheduling fields go into `updates` only when they actually CHANGED:
        // updateToDo re-arms the reminder (reminderSentAt: null) whenever a
        // scheduling key is present, so unconditionally including
        // completeByDate/dueTime would make a pure notes/text edit within the
        // late-catch-up window re-deliver an already-sent reminder push.
        // (Stored values may be null after a clear — normalize for comparison.)
        const updates: Partial<ToDo> = {
          text: trimmedText,
          assignedTo,
          isImportant,
          notes: trimmedNotes,
          ...subtaskField
        };
        if (completeByDate !== editingTodo?.completeByDate) {
          updates.completeByDate = completeByDate;
        }
        if ((dueTimeValue ?? null) !== (editingTodo?.dueTime ?? null) && 'dueTime' in timeFields) {
          updates.dueTime = timeFields.dueTime;
        }
        if (
          (reminderValue ?? null) !== (editingTodo?.reminderMinutesBefore ?? null) &&
          'reminderMinutesBefore' in timeFields
        ) {
          updates.reminderMinutesBefore = timeFields.reminderMinutesBefore;
        }
        // Only touch the recurrence field when it is set now, or when it was
        // previously set and is being turned off — so plain (never-recurring)
        // edits stay byte-identical to today's write.
        if (recurrenceValue) {
          updates.recurrence = recurrenceValue;
        } else if (editingTodo?.recurrence) {
          updates.recurrence = undefined; // sanitizer writes null → inert
        }
        await updateToDo(editingId, updates);
        toast.success('Task updated');
      } else {
        haptic('success'); // at gesture time — dead after the await on iOS
        await addToDo({
          text: trimmedText,
          completeByDate,
          assignedTo,
          isCompleted: false,
          isImportant,
          notes: trimmedNotes,
          ...subtaskField,
          ...(dueTimeValue !== undefined ? { dueTime: dueTimeValue } : {}),
          ...(reminderValue !== undefined ? { reminderMinutesBefore: reminderValue } : {}),
          ...(recurrenceValue ? { recurrence: recurrenceValue } : {})
        });
        toast.success('Task added');
        setQuickText(''); // the detailed form consumed the carried-over text
      }
      setIsAddModalOpen(false);
    } catch (error) {
      console.error('Error saving to-do:', error);
      // A rules rejection on the not-yet-whitelisted `subtasks` field gets a
      // specific message; everything else keeps the generic save error.
      toast.error(
        isPermissionDeniedError(error) && subtasks.length > 0
          ? "Subtasks aren't available yet — the task's other changes weren't saved."
          : 'Failed to save to-do. Please try again.'
      );
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
  // View arrangement lives here as labeled radio items (replacing the old
  // icon-cycling toggle). Choosing one persists per-device; the landscape-only
  // grid behavior (portrait falls back to stacked quadrants) is unchanged.
  const menuItems: MenuItem[] = [
    ...ARRANGEMENT_OPTIONS.map((option) => ({
      key: `view-${option.value}`,
      label: option.label,
      icon: option.icon,
      selected: arrangement === option.value,
      group: 'View',
      onSelect: () => setArrangementPersisted(option.value),
    })),
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
          // The pill renders ~34px tall; the invisible before: extender
          // (Button's established pattern) stretches the hit area past 44px
          // without changing the visual size. Vertical only — adjacent pills
          // in the row would otherwise overlap each other's zones.
          "relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
          'flex items-center px-3 py-1.5 rounded-full border text-sm font-medium whitespace-nowrap transition-colors duration-(--duration-fast) ease-(--ease-standard)',
          'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
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
            "relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
            'flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors duration-(--duration-fast) ease-(--ease-standard) whitespace-nowrap',
            'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
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

  // "More ways to add" menu — Full details keeps the quick-add carry-over
  // behavior (openAddModal seeds the form with whatever is typed in the bar).
  const addMenuItems: MenuItem[] = [
    {
      key: 'details',
      label: 'Full details',
      icon: <SlidersHorizontal size={16} />,
      ariaLabel: 'Add new task with full details',
      onSelect: openAddModal,
    },
    {
      key: 'template',
      label: 'From template',
      icon: <ClipboardList size={16} />,
      ariaLabel: 'Add tasks from a template',
      onSelect: () => setIsTemplateDrawerOpen(true),
    },
    {
      key: 'scan',
      label: 'Scan a list',
      icon: <Camera size={16} />,
      onSelect: () => setIsPhotoImportOpen(true),
    },
  ];

  const stickyQuickAdd = !isSelectionMode && effectiveArrangement !== 'grid' ? (
    <div className="sticky top-[var(--lists-sticky-top,0px)] z-sticky bg-brand-50 dark:bg-brand-900">
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

          {/* One labeled "More" affordance replaces the old pair of unlabeled
              icon buttons — opens Full details / From template / Scan a list. */}
          <div className="relative flex-none mr-2">
            <button
              type="button"
              onClick={() => setAddMenuOpen((o) => !o)}
              aria-label="More ways to add"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              className="min-h-11 flex items-center gap-1 px-3 py-2 rounded-btn text-sm font-medium text-brand-600 hover:text-brand-900 hover:bg-brand-100 dark:text-brand-300 dark:hover:text-brand-50 dark:hover:bg-brand-700/50 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
            >
              More
              <ChevronDown size={16} aria-hidden="true" className={cn('transition-transform duration-(--duration-fast) ease-(--ease-standard)', addMenuOpen && 'rotate-180')} />
            </button>
            {addMenuOpen && (
              <Menu
                isOpen={addMenuOpen}
                onClose={() => setAddMenuOpen(false)}
                ariaLabel="More ways to add"
                position="top-full right-0 mt-2"
                className="min-w-[208px]"
                items={addMenuItems}
              />
            )}
          </div>
        </div>
      </SurfaceList>
    </div>
  ) : null;

  return (
    <div className={cn("px-4 max-w-2xl mx-auto space-y-4 min-h-screen", isSelectionMode ? "pb-40" : "pb-nav-safe")}>

      {/* Compact header unit: title + toggle/select-all row read as one block
          (tight gap, no PageHeader padding tax) since the Plan tab-strip
          already labels this page "To-Dos". An h2, not h1 — the page-level h1
          is ListsPage's "Plan" masthead above the tab strip. */}
      <div className="pt-4 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <h2 className="font-display text-xl font-semibold tracking-tight text-brand-900 dark:text-brand-50 whitespace-nowrap shrink-0">
            {isSelectionMode ? 'Select tasks' : 'To-dos'}
          </h2>
          {!isSelectionMode && (
            <Tabs value={viewMode} onValueChange={(val) => setViewMode(val as 'active' | 'completed')}>
              {/* size="sm" (36px) was the app's only sub-44px touch target; default md keeps min-h-11. */}
              <TabsList className="w-auto inline-flex">
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="completed">{completedBadge}</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
        {isSelectionMode ? (
          <div className="flex items-center gap-3 shrink-0">
            <Button
              variant="link"
              size="sm"
              onClick={handleSelectAll}
              className="min-h-11 gap-1 px-2 text-accent-600 dark:text-accent-300 hover:text-accent-700 dark:hover:text-accent-200"
              leftIcon={<CheckSquare size={14} aria-hidden="true" className={selectedIds.size === allActiveCount && allActiveCount > 0 ? 'text-accent-600 dark:text-accent-300' : 'text-brand-300 dark:text-brand-450'} />}
            >
              {selectedIds.size === allActiveCount && allActiveCount > 0 ? 'Deselect all' : 'Select all'}
            </Button>
            {/* While selecting, a visible Cancel (X) stays in the header so the
               way out is always one tap away — the overflow menu is hidden. */}
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setIsSelectionMode(false)}
              className="bg-brand-100 border-brand-200 dark:bg-brand-700 dark:border-brand-600"
              title="Cancel selection"
              aria-label="Cancel selection"
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
            <TodoSection
                title="Immediate"
                subtitle="Overdue, Today & Tomorrow"
                items={immediate}
                color="rose"
                onComplete={completeToDo}
                onUncomplete={handleUncomplete}
                onEdit={openEditModal}
                onDelete={deleteToDo}
                onMore={setActionTodo}
                memberMap={memberMap}
                isSelectionMode={isSelectionMode}
                selectedIds={selectedIds}
                onToggleSelection={toggleSelection}
            />

            {/* Upcoming Section */}
            <TodoSection
                title="Upcoming"
                subtitle="This Week"
                items={upcoming}
                color="amber"
                maxVisible={5}
                onComplete={completeToDo}
                onUncomplete={handleUncomplete}
                onEdit={openEditModal}
                onDelete={deleteToDo}
                onMore={setActionTodo}
                memberMap={memberMap}
                isSelectionMode={isSelectionMode}
                selectedIds={selectedIds}
                onToggleSelection={toggleSelection}
            />

            {/* On The Radar Section */}
            <TodoSection
                title="On the Radar"
                subtitle="Future"
                items={radar}
                color="blue"
                maxVisible={5}
                onComplete={completeToDo}
                onUncomplete={handleUncomplete}
                onEdit={openEditModal}
                onDelete={deleteToDo}
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
            <>
            {arrangement === 'grid' && !isSelectionMode && (
              /* Portrait fallback from the 2×2 grid: the tasks stay visible;
                 this one-liner explains why the layout differs and how to get
                 the grid back. */
              <p className="px-1 text-xs text-brand-400 dark:text-brand-450 flex items-center gap-1.5">
                <Smartphone size={14} className="rotate-90" aria-hidden="true" />
                Stacked while portrait. Rotate your phone for the 2×2 grid.
              </p>
            )}
            <EisenhowerMatrixView
              quadrants={quadrants}
              memberMap={memberMap}
              isSelectionMode={isSelectionMode}
              selectedIds={selectedIds}
              onComplete={completeToDo}
              onUncomplete={handleUncomplete}
              onEdit={openEditModal}
              onDelete={deleteToDo}
              onMore={setActionTodo}
              onToggleSelection={toggleSelection}
            />
            </>
            ) : (
            /* True 2×2 Eisenhower grid — auto-immersive full-screen overlay.
               Only reachable in landscape (effectiveArrangement falls back to
               'matrix' in portrait). */
            <EisenhowerGridView
              quadrants={quadrants}
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
                title="Completed today"
                items={completedToday}
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                memberMap={memberMap}
            />
            <CompletedSection
                title="Completed yesterday"
                items={completedYesterday}
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                memberMap={memberMap}
            />
            <CompletedSection
                title="This week"
                items={completedWeek}
                defaultCollapsed
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                memberMap={memberMap}
            />
            <CompletedSection
                title="Older"
                items={completedOlder}
                defaultCollapsed
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
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
        /* Offset/z recipe from TransactionMasterList's batch bar (minus its
           md:px-0, dropped here — mobile-only surface): clears the bottom nav
           (+ home-indicator inset) and sits at z-dropdown — above the
           z-sticky nav, below drawers/modals. */
        <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] left-0 right-0 px-4 flex justify-center z-dropdown pointer-events-none">
          <div className="bg-brand-900 dark:bg-brand-800 text-white p-2 rounded-card shadow-raised border border-brand-700 flex items-center gap-2 pointer-events-auto animate-in slide-in-from-bottom-4">
            <div className="px-3 font-semibold text-sm border-r border-brand-700 dark:border-brand-600">
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
            label="Due date"
            type="date"
            value={completeByDate}
            onChange={(e) => setCompleteByDate(e.target.value)}
            icon={<Calendar size={18} />}
            className="appearance-none"
          />

          {members.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-brand-400 dark:text-brand-450 py-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>No household members available to assign this task.</span>
            </div>
          ) : (
            <Select
              id="assignee-select"
              label="Assign to"
              icon={<User size={18} />}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              {/* Keep the rendered value in sync with state: without these
                  sentinels an empty ('' on create) or orphaned (member left)
                  assignedTo would visually snap to the first member while
                  state still held the old value. handleSubmit blocks both
                  cases with a toast — this just makes the field honest. */}
              {assignedTo === '' && (
                <option value="" disabled>Choose a member</option>
              )}
              {assignedTo !== '' && !members.some(m => m.uid === assignedTo) && (
                <option value={assignedTo} disabled>Former member</option>
              )}
              {members.map(member => (
                <option key={member.uid} value={member.uid}>
                  {member.displayName ?? 'User'}
                </option>
              ))}
            </Select>
          )}

          {/* Eisenhower importance — a household judgment call, deliberately a
              yes/no (not low/med/high) to match the matrix's two-state axis.
              Compact star chip: the task-options drawer also toggles this, so
              it no longer needs a full explainer card. */}
          <button
            type="button"
            onClick={() => setIsImportant(v => !v)}
            aria-pressed={isImportant}
            className={cn(
              'inline-flex items-center gap-2 min-h-11 px-3 py-2 rounded-btn border text-sm font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard)',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
              isImportant
                ? 'bg-warm-100 border-warm-500/40 text-warm-700 dark:bg-warm-500/15 dark:border-warm-500/40 dark:text-warm-300'
                : 'bg-white border-brand-200 text-brand-600 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:hover:bg-brand-700'
            )}
          >
            <Star
              size={18}
              aria-hidden="true"
              className={isImportant ? 'text-warm-500 fill-warm-500' : 'text-brand-300 dark:text-brand-500'}
            />
            Important
          </button>
          <p className="mt-1 text-xs text-brand-400 dark:text-brand-450">
            Matters to the family — big consequences if skipped.
          </p>

          {/* Progressive disclosure: secondary fields live behind this expander.
              Opening a task that already uses any of them auto-expands (see
              openEditModal). */}
          <button
            type="button"
            onClick={() => setMoreOpen(v => !v)}
            aria-expanded={moreOpen}
            aria-controls="task-more-options"
            className="w-full min-h-11 flex items-center justify-between px-1 py-2 text-sm font-medium text-brand-600 dark:text-brand-300 hover:text-brand-900 dark:hover:text-brand-100 rounded-btn transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
          >
            <span>More options</span>
            <ChevronDown
              size={18}
              aria-hidden="true"
              className={cn('transition-transform duration-(--duration-fast) ease-(--ease-standard)', moreOpen && 'rotate-180')}
            />
          </button>

          {/* Always mounted (hidden when collapsed) so the expander button's
              aria-controls never references an absent id. */}
          <div id="task-more-options" className="space-y-4" hidden={!moreOpen}>
          {/* F-TODO-14: optional due time + reminder lead time. The reminder
              select is disabled until a time anchors it; clearing the time
              clears the reminder on save (see handleSubmit). */}
          <div className="grid grid-cols-2 gap-3">
            <Input
              id="due-time-input"
              label="Time"
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className="appearance-none"
            />
            <div>
              <Select
                id="reminder-select"
                label="Reminder"
                value={dueTime && reminderMinutesBefore !== null ? String(reminderMinutesBefore) : ''}
                onChange={(e) =>
                  setReminderMinutesBefore(e.target.value === '' ? null : Number(e.target.value))
                }
                disabled={!dueTime}
              >
                <option value="">No reminder</option>
                {REMINDER_OFFSET_OPTIONS.map(opt => (
                  <option key={opt.value} value={String(opt.value)}>{opt.label}</option>
                ))}
              </Select>
              {!dueTime && (
                <p className="mt-1 text-xs text-brand-400 dark:text-brand-450">
                  Set a time to enable reminders.
                </p>
              )}
            </div>
          </div>

          {/* F-TODO-01: recurrence cadence — mirrors CalendarItem's weekly/
              bi-weekly/monthly cadence. 'None' = a one-off task (default). */}
          <div>
            <Select
              id="recurrence-select"
              label="Repeat"
              icon={<Repeat size={18} />}
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as 'none' | TodoFrequency)}
            >
              <option value="none">None</option>
              {TODO_FREQUENCIES.map(option => (
                <option key={option} value={option}>{TODO_FREQUENCY_LABELS[option]}</option>
              ))}
            </Select>
            {recurrence !== 'none' && (
              <p className="mt-1.5 text-xs text-brand-400 dark:text-brand-450">
                A fresh copy is created automatically each time you complete this task.
              </p>
            )}
          </div>

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

          {/* F-TODO-08: subtask checklist editor. Local state — persisted when the
              form saves. "Break down with AI" appends model-suggested steps. */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Eyebrow>
                Subtasks{subtasks.length > 0 ? ` (${subtaskProgress(subtasks).done}/${subtasks.length})` : ''}
              </Eyebrow>
              <Button
                type="button"
                variant="ghost-brand"
                size="sm"
                onClick={handleBreakDownWithAI}
                isLoading={aiBreakingDown}
                disabled={aiBreakingDown || !text.trim()}
                className="gap-1.5 text-accent-600 dark:text-accent-300"
              >
                {!aiBreakingDown && <Sparkles size={15} aria-hidden="true" />}
                Break down with AI
              </Button>
            </div>

            {subtasks.length > 0 && (
              <ul className="space-y-1 mb-2" aria-label="Subtasks">
                {subtasks.map(sub => (
                  <li key={sub.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={sub.isDone}
                      onChange={() => handleToggleSubtaskLocal(sub.id)}
                      aria-label={`Mark "${sub.text}" ${sub.isDone ? 'not done' : 'done'}`}
                      className="w-4 h-4 shrink-0 rounded-sm border-brand-300 text-accent-600 focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-brand-600 dark:bg-brand-700"
                    />
                    <span className={cn(
                      'flex-1 min-w-0 text-sm truncate',
                      sub.isDone ? 'line-through text-brand-400 dark:text-brand-500' : 'text-brand-700 dark:text-brand-200'
                    )}>
                      {sub.text}
                    </span>
                    <Button
                      type="button"
                      variant="ghost-brand"
                      size="icon"
                      onClick={() => handleRemoveSubtaskLocal(sub.id)}
                      aria-label={`Remove subtask: ${sub.text}`}
                      className="shrink-0 hover:text-money-neg dark:hover:text-money-negDark"
                    >
                      <X size={16} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2">
              <Input
                id="subtask-input"
                type="text"
                value={subtaskInput}
                onChange={(e) => setSubtaskInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddSubtaskInput();
                  }
                }}
                placeholder="Add a step"
                maxLength={200}
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={handleAddSubtaskInput}
                disabled={!subtaskInput.trim()}
                aria-label="Add subtask"
              >
                <Plus size={18} />
              </Button>
            </div>
          </div>
          </div>

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
        title="Delete tasks"
        message={`Are you sure you want to delete ${selectedIds.size} task${selectedIds.size !== 1 ? 's' : ''}? This action cannot be undone.`}
        confirmLabel={isBatchProcessing ? 'Deleting…' : 'Delete all'}
        confirmVariant="destructive"
        isConfirming={isBatchProcessing}
      />

      {/* Task-options drawer — the full per-task action set, opened by
          long-press / right-click on a row (all visible per-row action buttons
          were removed in the row-diet redesign). */}
      <Drawer
        isOpen={!!actionTodo}
        onClose={() => setActionTodo(null)}
        title="Task options"
      >
        <div className="space-y-1">
          {actionTodo && (
            <>
              <Button
                variant="ghost"
                className="w-full justify-start"
                leftIcon={<Edit2 size={18} className="text-brand-500" />}
                onClick={() => {
                  openEditModal(actionTodo);
                  setActionTodo(null);
                }}
              >
                Edit
              </Button>

              <Button
                variant="ghost"
                className="w-full justify-start"
                aria-pressed={actionTodo.isImportant === true}
                leftIcon={<Star size={18} className={actionTodo.isImportant ? 'text-warm-500 fill-warm-500' : 'text-brand-500'} />}
                onClick={() => {
                  handleToggleImportant(actionTodo);
                  setActionTodo(null);
                }}
              >
                {actionTodo.isImportant ? 'Unmark important' : 'Mark important'}
              </Button>

              <Button
                variant="ghost"
                className="w-full justify-start"
                leftIcon={<Calendar size={18} className="text-brand-500" />}
                onClick={() => {
                  handleMoveToTomorrow(actionTodo);
                  setActionTodo(null);
                }}
              >
                Move to tomorrow
              </Button>

              <Button
                variant="ghost"
                className="w-full justify-start"
                leftIcon={<Copy size={18} className="text-brand-500" />}
                onClick={() => {
                  handleDuplicate(actionTodo);
                  setActionTodo(null);
                }}
              >
                Duplicate
              </Button>

              <div className="hairline-divider my-2" />

              <Button
                variant="ghost-destructive"
                className="w-full justify-start"
                leftIcon={<Trash2 size={18} />}
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
                Delete
              </Button>
            </>
          )}
        </div>
      </Drawer>

      {/* F-TODO-06: photo-to-tasklist import */}
      <TodoPhotoImportDrawer
        isOpen={isPhotoImportOpen}
        onClose={() => setIsPhotoImportOpen(false)}
      />

      <TaskTemplateDrawer
        isOpen={isTemplateDrawerOpen}
        onClose={() => setIsTemplateDrawerOpen(false)}
      />

    </div>
  );
};

// A single completed to-do row on the shared Row primitive. Completed rows are
// rare and terminal, so their two actions (duplicate, delete forever) stay
// VISIBLE as small icon buttons — no hover-reveal (mobile-only app), no
// gesture layer, no options-drawer indirection. Restore is the leading
// RotateCcw circle, mirroring the active row's complete circle.
const CompletedTodoRow = React.memo(function CompletedTodoRow({ item, assignee, onUncomplete, onDelete, onDuplicate }: {
  item: ToDo;
  assignee: HouseholdMember | undefined;
  onUncomplete: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (todo: ToDo) => void;
}) {
    const completedDate = item.completedAt ? parseISO(item.completedAt) : null;
    return (
        <Row className="items-start">
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

            <div className="flex items-center gap-1 shrink-0">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDuplicate(item)}
                    className="min-w-11 min-h-11 text-brand-400 hover:text-accent-600 hover:bg-accent-50 dark:text-brand-450 dark:hover:text-accent-300 dark:hover:bg-brand-700/50"
                    title="Duplicate task"
                    aria-label={`Duplicate task: ${item.text}`}
                >
                    <Copy size={16} />
                </Button>
                <Button
                    variant="ghost-destructive"
                    size="icon"
                    onClick={() => showDeleteConfirmation(async () => {
                        haptic('medium');
                        await onDelete(item.id);
                        toast.success('Task deleted');
                    })}
                    className="min-w-11 min-h-11"
                    title="Delete forever"
                    aria-label={`Delete forever: ${item.text}`}
                >
                    <Trash2 size={16} />
                </Button>
            </div>
        </Row>
    );
});

// Date-bucketed group of completed to-dos. Recent buckets get the canonical
// SectionHeading voice (serif, sentence case — a content grouping per
// DESIGN.md §3); older buckets reuse the shared CollapsibleSection primitive
// (same heading spec) with the item count as its collapsed summary.
const CompletedSection = React.memo(function CompletedSection({ title, items, onUncomplete, onDelete, onDuplicate, memberMap, defaultCollapsed = false }: {
  title: string;
  items: ToDo[];
  onUncomplete: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (todo: ToDo) => void;
  /** Pre-built member lookup map from page level — avoids rebuilding per-section. */
  memberMap: ReadonlyMap<string, HouseholdMember>;
  /**
   * Start collapsed behind a header toggle (used for the older buckets so
   * recent completions stay in view). Omit/false = always-expanded header.
   */
  defaultCollapsed?: boolean;
}) {
    if (items.length === 0) return null;

    const rows = (
        <SurfaceList>
            {items.map(item => (
                <CompletedTodoRow
                    key={item.id}
                    item={item}
                    assignee={memberMap.get(item.assignedTo)}
                    onUncomplete={onUncomplete}
                    onDelete={onDelete}
                    onDuplicate={onDuplicate}
                />
            ))}
        </SurfaceList>
    );

    return (
        <div className="animate-in slide-in-from-bottom-4 duration-(--duration-slow)">
            {defaultCollapsed ? (
                <CollapsibleSection title={title} summary={items.length}>
                    {rows}
                </CollapsibleSection>
            ) : (
                <>
                    <SectionHeading
                        as="h3"
                        className="px-1 mb-1.5"
                        action={<span className="text-xs tabular-nums text-brand-500 dark:text-brand-400">{items.length}</span>}
                    >
                        {title}
                    </SectionHeading>
                    {rows}
                </>
            )}
        </div>
    );
});

export default ToDosPage;
