import React, { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Reorder, useDragControls } from 'framer-motion';
import { useTodos, useHouseholdCore, useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Calendar, Check, Trash2, Edit2, AlertCircle, X, User, Download, Layers, CheckSquare, Loader2, RotateCcw, Copy, History, MoreHorizontal, ClipboardList, SlidersHorizontal, ChevronDown, Star, Camera, Sparkles, Plus, Repeat, Filter, ArrowUpDown, GripVertical, UserPlus, Tag, Tags, ListChecks } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO, isBefore, addDays, startOfToday, endOfWeek, isSameDay, subDays, isSameWeek } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';
import { quadrantForTodo, QUADRANT_ORDER, type Quadrant } from '@/utils/eisenhower';
import { toggleSubtask, appendSubtask, removeSubtask, subtasksFromTexts, subtaskLinesFromPaste, isPermissionDeniedError, subtaskProgress, MAX_SUBTASKS, updateSubtaskText, setSubtaskAssignee } from '@/utils/subtasks';
import { TODO_FREQUENCIES, TODO_FREQUENCY_LABELS, type TodoFrequency } from '@/utils/todoRecurrence';
import { REMINDER_OFFSET_OPTIONS, compareDueTimes } from '@/utils/todoTime';
import { WHOLE_HOUSEHOLD_ASSIGNEE, resolveAssignedTo } from '@/utils/todoAssignee';
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
import { Popover } from '@/components/ui/Popover';
import { CategoryChipPicker } from '@/components/ui/CategoryChipPicker';
import { SurfaceList, Row } from '@/components/ui/Section';
import SectionHeading from '@/components/ui/SectionHeading';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { cn } from '@/utils/cn';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Eyebrow from '@/components/ui/Eyebrow';
import Textarea from '@/components/ui/Textarea';
import BatchRescheduleModal from '@/components/modals/BatchRescheduleModal';
import { TodoPhotoImportDrawer } from '@/components/modals/TodoPhotoImportDrawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import PageHeader from '@/components/ui/PageHeader';
import { TodoRow } from '@/components/todos/TodoRow';
import MemberAvatar from '@/components/ui/MemberAvatar';
import { buildMemberColorMap, memberColorFor } from '@/utils/memberColors';
import { type SectionColor } from '@/components/todos/todoDisplay';
import { EisenhowerGridView } from '@/components/todos/EisenhowerGridView';
import { TaskTemplateDrawer } from '@/components/todos/TaskTemplateDrawer';
import { TodoCategoryManagerDrawer } from '@/components/todos/TodoCategoryManagerDrawer';
import { TodoTriageDrawer } from '@/components/todos/TodoTriageDrawer';
import { PromoteToDoSheet } from '@/components/todos/PromoteToDoSheet';
import { sortFlatTodos, groupTodosByCategory, TODO_SORT_MODES, TODO_SORT_LABELS, type TodoSortMode } from '@/utils/todoSort';
import { getTodoCategoryColor, UNCATEGORIZED_LABEL } from '@/utils/todoCategoryColor';
import {
  categoryFilterVocabulary,
  describeCategoryFilter,
  isCategoryFilterEntrySelected,
  matchesCategoryFilter,
  parseStoredCategoryFilter,
  pruneCategoryFilter,
  serializeCategoryFilter,
  toggleCategoryFilterEntry,
  type TodoCategoryFilterEntry,
} from '@/utils/todoCategoryFilter';
import { isTodoSubtasksIncompleteError } from '@/utils/todoSubtaskGate';
import { useStackedStickyOffset } from '@/hooks/useStackedStickyOffset';
import { useDeepLinkHighlight, HIGHLIGHT_DURATION_MS } from '@/hooks/useDeepLinkHighlight';
import { useScrollToHighlight } from '@/hooks/useScrollToHighlight';
import type { TodoCompletionOptions } from '@/contexts/household/mutations/todoMutations';

// Persisted like the Shopping list's sort mode — the derived view survives
// a reload but never writes to Firestore.
const TODO_SORT_STORAGE_KEY = 'todos-sort-mode';

// F-TODO-16 — the category filter is PERSISTED (unlike the transient person
// filter): a household that works in categories tends to stay in one, so
// re-picking it after every reload would be busywork. Stored as a JSON array
// where a string is a category name and `null` is the reserved Uncategorized
// bucket, e.g. `["Home",null]` — see utils/todoCategoryFilter.ts.
const TODO_CATEGORY_FILTER_STORAGE_KEY = 'todos-category-filter';

// Last category chosen on ADD (never on edit), pre-selected for the next new
// task. Plain string; absent = no default. Validated against the household's
// current vocabulary on read, so a since-deleted category degrades to "none".
const TODO_LAST_CATEGORY_STORAGE_KEY = 'todos-last-category';

/** Reads the persisted last-used category, resolved (case-insensitively) to the
 *  household's current spelling. Returns undefined when unset/unknown. */
function readLastUsedCategory(categories: readonly string[]): string | undefined {
  try {
    const stored = typeof window !== 'undefined'
      ? window.localStorage.getItem(TODO_LAST_CATEGORY_STORAGE_KEY)
      : null;
    const key = stored?.trim().toLowerCase();
    if (!key) return undefined;
    return categories.find(c => c.trim().toLowerCase() === key);
  } catch (_error) {
    // Ignore localStorage errors (private mode, quota, disabled storage)
    return undefined;
  }
}

/** Remembers (or forgets) the category used on the last ADD. */
function writeLastUsedCategory(category: string | undefined): void {
  try {
    if (typeof window === 'undefined') return;
    if (category) {
      window.localStorage.setItem(TODO_LAST_CATEGORY_STORAGE_KEY, category);
    } else {
      window.localStorage.removeItem(TODO_LAST_CATEGORY_STORAGE_KEY);
    }
  } catch (_error) {
    // Ignore persistence errors
  }
}

/**
 * Collapse key for the "Saved for later" section. It shares `collapsedCategories`
 * — the same session-only Set the category sections use — because the collapse
 * rule is identical: momentary "get this out of my way", deliberately not
 * persisted. Prefixed so it can never collide with a real category's key (which
 * is always `cat:`/`uncat:`).
 */
const SAVED_FOR_LATER_SECTION_KEY = 'section:saved-for-later';

/** Stable section key for a category group (null = the Uncategorized section). */
const categorySectionKey = (category: string | null): string =>
  category === null ? 'uncat:' : `cat:${category.trim().toLowerCase()}`;

/** The section key a to-do's own `category` field belongs to. */
const categorySectionKeyForTodo = (todo: ToDo): string => {
  const trimmed = (todo.category ?? '').trim();
  return categorySectionKey(trimmed === '' ? null : trimmed);
};

// Sentinel for the "Whole household" option in the Assign-to picker — no
// member's uid ever collides with this. Selecting it stores `assignedTo:
// undefined` (unassigned/shared), never a literal member id. Shared with the
// Capture drawer's To-Dos tab, which offers the same choice.

// One subtask row in the drawer editor: tap-to-edit text (wraps instead of
// truncating while read-only), a drag handle for Reorder, and a small
// assignee button opening a member picker. A separate component so each row
// can own its own `useDragControls` (Reorder.Item forbids calling hooks
// inside the parent's .map).
interface SubtaskEditorRowProps {
  sub: Subtask;
  members: HouseholdMember[];
  isEditing: boolean;
  editingText: string;
  onEditingTextChange: (value: string) => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onToggleDone: () => void;
  onRemove: () => void;
  assigneePickerOpen: boolean;
  onOpenAssigneePicker: () => void;
  onCloseAssigneePicker: () => void;
  onPickAssignee: (uid: string | undefined) => void;
}

const SubtaskEditorRow: React.FC<SubtaskEditorRowProps> = ({
  sub, members, isEditing, editingText, onEditingTextChange,
  onStartEdit, onCommitEdit, onCancelEdit, onToggleDone, onRemove,
  assigneePickerOpen, onOpenAssigneePicker, onCloseAssigneePicker, onPickAssignee,
}) => {
  const dragControls = useDragControls();
  const assignee = sub.assigneeId ? members.find(m => m.uid === sub.assigneeId) : undefined;
  // `members` is the full household roster as passed down from ToDosPage
  // (`useHouseholdCore().members`, unsorted) — never a filtered/reordered
  // copy — so this chip's fallback color matches the same member's badge on
  // TodoRow's read-only assignee chip and every other member-badge surface.
  const colors = buildMemberColorMap(members);
  const assigneeMenuItems: MenuItem[] = [
    {
      key: 'unassigned',
      label: 'Unassigned',
      selected: !sub.assigneeId,
      onSelect: () => onPickAssignee(undefined),
    },
    ...members.map(m => ({
      key: m.uid,
      label: m.displayName ?? 'User',
      selected: sub.assigneeId === m.uid,
      onSelect: () => onPickAssignee(m.uid),
    })),
  ];

  return (
    <Reorder.Item
      value={sub}
      dragListener={false}
      dragControls={dragControls}
      as="li"
      className="flex items-center gap-1.5 bg-brand-50 dark:bg-brand-900/40 rounded-btn"
    >
      <button
        type="button"
        onPointerDown={(e) => dragControls.start(e)}
        aria-label={`Reorder step: ${sub.text}`}
        className="shrink-0 p-2 -mr-1 touch-none text-brand-300 hover:text-brand-500 dark:text-brand-500 dark:hover:text-brand-300 cursor-grab active:cursor-grabbing"
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <input
        type="checkbox"
        checked={sub.isDone}
        onChange={onToggleDone}
        aria-label={`Mark "${sub.text}" ${sub.isDone ? 'not done' : 'done'}`}
        className="w-4 h-4 shrink-0 rounded-sm border-brand-300 text-accent-600 focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-brand-600 dark:bg-brand-700"
      />
      {isEditing ? (
        <Input
          autoFocus
          value={editingText}
          onChange={(e) => onEditingTextChange(e.target.value)}
          onBlur={onCommitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommitEdit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancelEdit();
            }
          }}
          maxLength={200}
          aria-label={`Edit step: ${sub.text}`}
          className="flex-1 min-w-0"
        />
      ) : (
        <button
          type="button"
          onClick={onStartEdit}
          className={cn(
            'flex-1 min-w-0 text-left text-sm py-1.5 break-words rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
            sub.isDone ? 'line-through text-brand-400 dark:text-brand-500' : 'text-brand-700 dark:text-brand-200'
          )}
        >
          {sub.text}
        </button>
      )}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={assigneePickerOpen ? onCloseAssigneePicker : onOpenAssigneePicker}
          aria-label={assignee ? `Assigned to ${assignee.displayName ?? 'User'} — change` : 'Assign this step'}
          aria-haspopup="menu"
          aria-expanded={assigneePickerOpen}
          className="flex items-center justify-center w-6 h-6 rounded-full text-brand-400 hover:text-accent-600 dark:text-brand-500 dark:hover:text-accent-300"
        >
          {assignee ? (
            <MemberAvatar
              name={assignee.displayName ?? '?'}
              photoURL={assignee.photoURL}
              color={memberColorFor(colors, assignee.uid)}
              size={20}
            />
          ) : (
            <UserPlus size={16} aria-hidden="true" />
          )}
        </button>
        {assigneePickerOpen && (
          <Menu
            isOpen={assigneePickerOpen}
            onClose={onCloseAssigneePicker}
            ariaLabel="Assign this step"
            position="top-full right-0 mt-1"
            className="min-w-[160px]"
            items={assigneeMenuItems}
          />
        )}
      </div>
      <Button
        type="button"
        variant="ghost-brand"
        size="icon"
        onClick={onRemove}
        aria-label={`Remove subtask: ${sub.text}`}
        className="shrink-0 hover:text-money-neg dark:hover:text-money-negDark"
      >
        <X size={16} />
      </Button>
    </Reorder.Item>
  );
};

const ToDosPage: React.FC = () => {
  const {
    todos,
    // "Saved for later": the parked slice. `todos` already excludes these (and
    // held-for-review captures) at the context, so nothing on this page needs a
    // per-consumer `savedForLater` filter.
    savedForLaterTodos,
    addToDo,
    addSavedForLaterTodo,
    updateToDo,
    deleteToDo,
    completeToDo,
    uncompleteToDo,
    toggleTodoSubtask,
    hasMoreCompletedTodos,
    isLoadingOlderTodos,
    loadOlderCompletedTodos,
    todoCategories,
    updateTodoCategories,
  } = useTodos();
  const { members, currentUser, householdId, isLoading } = useHouseholdCore();
  // Habit Automations (PRD #1065): the "Counts toward habit" picker links a
  // to-do to a habit so completing it fires the habit like one manual tap.
  const { habits } = useGamification();
  // Only active (non-archived) habits are linkable — archived ones are hidden
  // from the Track surface, so offering them here would be confusing.
  const linkableHabits = useMemo(
    () => habits.filter(h => !h.archivedAt).sort((a, b) => a.title.localeCompare(b.title)),
    [habits],
  );

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

  // F-TODO-16 category filter — MULTI-select and PERSISTED (see the storage-key
  // comments above). An empty array is "All"; `null` inside it is the reserved
  // Uncategorized bucket. ANDs with the person filter above.
  const [categoryFilter, setCategoryFilter] = useState<TodoCategoryFilterEntry[]>(() => {
    try {
      return parseStoredCategoryFilter(
        typeof window !== 'undefined'
          ? window.localStorage.getItem(TODO_CATEGORY_FILTER_STORAGE_KEY)
          : null,
      );
    } catch (_error) {
      // Ignore localStorage errors
      return [];
    }
  });
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        TODO_CATEGORY_FILTER_STORAGE_KEY,
        serializeCategoryFilter(categoryFilter),
      );
    } catch (_error) {
      // Ignore persistence errors
    }
  }, [categoryFilter]);

  // The vocabulary the filter menu offers and the prune validates against: the
  // UNION of the household's `todoCategories` and the categories actually
  // present on to-dos. `quickAddTodo` never mints a Shortcut-created category
  // into the household list, so a vocabulary-only menu could neither offer it
  // nor keep it in a saved filter — the prune below would drop it on every
  // reload and the persistence effect would write the emptied filter back,
  // silently resetting the selection to "All". See utils/todoCategoryFilter.ts
  // for the stable ordering / canonical-spelling rules.
  const categoryVocabulary = useMemo(
    () => categoryFilterVocabulary(todoCategories, todos),
    [todoCategories, todos],
  );

  // Drop persisted entries whose category no longer exists ANYWHERE — gone from
  // the vocabulary AND unused by every to-do. The Uncategorized bucket always
  // survives, since it isn't part of the vocabulary. Deliberately NOT done while
  // reading storage: the initial render can happen before `todoCategories` /
  // `todos` have loaded, which would nuke every saved entry on reload. Instead
  // this runs on the vocabulary-changed EDGE during render (the same pattern as
  // `wasSelectionMode` below) — no effect cascade — and `pruneCategoryFilter`
  // returns the same array reference when nothing is dropped, so React bails out
  // of the re-render in the common case.
  const categoryVocabKey = isLoading ? null : `v:${categoryVocabulary.join('\u0000')}`;
  const [lastCategoryVocabKey, setLastCategoryVocabKey] = useState<string | null>(null);
  if (categoryVocabKey !== null && categoryVocabKey !== lastCategoryVocabKey) {
    setLastCategoryVocabKey(categoryVocabKey);
    setCategoryFilter(prev => pruneCategoryFilter(prev, categoryVocabulary));
  }

  // Orientation drives the view (no persisted arrangement anymore): portrait
  // shows the flat list; rotating to landscape auto-shows the immersive 2×2
  // Eisenhower grid. Hook-driven so rotating re-renders instantly.
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

  // Person-filter popover in the title row (mirrors the Shopping list's store
  // filter): quiet funnel icon at rest, accent pill with the member's name +
  // inline clear when active.
  const [filterOpen, setFilterOpen] = useState(false);

  // Sort popover in the title row (mirrors the Shopping list's sort): icon
  // tinted when a non-default mode is active so the derived view is glanceable.
  const [sortOpen, setSortOpen] = useState(false);
  const [sortMode, setSortMode] = useState<TodoSortMode>(() => {
    try {
      const stored = typeof window !== 'undefined'
        ? window.localStorage.getItem(TODO_SORT_STORAGE_KEY)
        : null;
      if (stored && (TODO_SORT_MODES as readonly string[]).includes(stored)) {
        return stored as TodoSortMode;
      }
    } catch (_error) {
      // Ignore localStorage errors
    }
    return 'important';
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(TODO_SORT_STORAGE_KEY, sortMode);
    } catch (_error) {
      // Ignore persistence errors
    }
  }, [sortMode]);

  // "More ways to add" menu next to the quick-add bar — collapses the old pair
  // of unlabeled icon buttons (full form / templates) plus Scan a list into
  // one labeled affordance.

  // Mobile Action Drawer State
  const [actionTodo, setActionTodo] = useState<ToDo | null>(null);

  // F-TODO-03 — Task templates ("Quick Task Lists") drawer.
  const [isTemplateDrawerOpen, setIsTemplateDrawerOpen] = useState(false);

  // F-TODO-16 — manage-categories drawer (add/rename/delete the vocabulary)
  // and the one-at-a-time triage pass over uncategorised tasks.
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  const [isTriageOpen, setIsTriageOpen] = useState(false);
  // Session-only, like the assignee filter and the section collapse state: the
  // nudge is worth re-offering on a fresh visit, and persisting it would need a
  // key that could outlive the backlog it refers to.
  const [triageBannerDismissed, setTriageBannerDismissed] = useState(false);

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
  // "Auto-reschedule": only meaningful for a repeating task — when the due date
  // passes unfinished the chore rolls to its next occurrence (steps reset)
  // instead of going overdue. See utils/todoRecurrence.computeExpiredTodoRoll.
  const [resetWhenExpired, setResetWhenExpired] = useState(false);
  // Shared notes surfaced in the editor drawer — visible to all household members
  // (to-dos are already shared). Capped to match the firestore.rules validator.
  const [notes, setNotes] = useState('');
  // Habit Automations (PRD #1065): the habit this to-do counts toward. '' = not
  // linked. Completing a linked to-do fires the habit like one manual tap.
  const [linkedHabitId, setLinkedHabitId] = useState('');
  // F-TODO-16: the task's category. `undefined` = Uncategorized (the canonical
  // representation — the field is REMOVED, never written as '').
  const [category, setCategory] = useState<string | undefined>(undefined);
  // PRD #1065: when the editing to-do links a habit that has since been ARCHIVED,
  // that habit is filtered out of `linkableHabits`, so the Select would show
  // "None" while the link still exists. Surface it as a disabled "(archived)"
  // option so the UI never contradicts the stored link. null when the current
  // pick is unlinked or still-active.
  const archivedLinkedHabit = useMemo(
    () =>
      linkedHabitId && !linkableHabits.some(h => h.id === linkedHabitId)
        ? habits.find(h => h.id === linkedHabitId && h.archivedAt) ?? null
        : null,
    [linkedHabitId, linkableHabits, habits],
  );
  // F-TODO-08: subtask checklist edited in the drawer as local state, persisted
  // on save via addToDo/updateToDo. `subtaskInput` is the pending new-step text;
  // `aiBreakingDown` guards the "Break down with AI" request.
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [subtaskInput, setSubtaskInput] = useState('');
  const [aiBreakingDown, setAiBreakingDown] = useState(false);
  // Inline tap-to-edit for a subtask's text (paper cut #1) — which step's
  // label is currently swapped for an Input, and its pending edited value.
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskText, setEditingSubtaskText] = useState('');
  // Which subtask's assignee popover is open (paper cut #2). At most one at a
  // time — opening another closes the previous.
  const [assigneePickerSubtaskId, setAssigneePickerSubtaskId] = useState<string | null>(null);
  // "Scan steps": photo → parseTaskList OCR → appended as subtasks. The hidden
  // file input is reset after each run so re-picking the same photo re-fires.
  const [aiScanningSteps, setAiScanningSteps] = useState(false);
  const subtaskImageInputRef = useRef<HTMLInputElement>(null);
  // Progressive disclosure: the drawer shows only the core fields (task, due
  // date, assignee, important) until "More options" is expanded. Editing a task
  // that already has any secondary value auto-expands so nothing is hidden.
  const [moreOpen, setMoreOpen] = useState(false);

  // "Saved for later": the parked section's OWN add bar, so a thought can be
  // parked directly without routing it through the active list first. Separate
  // text state from the main quick-add — the two bars are on screen together and
  // must not share a draft. Same synchronous in-flight ref guard against a
  // same-tick double submit.
  const [parkedQuickText, setParkedQuickText] = useState('');
  const submittingParkedAddRef = useRef(false);
  // The parked to-do currently being triaged in the promote sheet (null = closed).
  const [promotingTodo, setPromotingTodo] = useState<ToDo | null>(null);

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

  // Flat active list (owner-locked spec): ONE list of every active to-do —
  // starred first, then overdue → ascending due date → undated last (see
  // utils/todoSort.ts). The old Immediate/Upcoming/Radar urgency windows
  // survive only as each row's due-date COLOR (rose/amber/blue), computed here
  // once per todo so TodoRow keeps its urgency-tinted meta line.
  const { flatActive, rowColors, allActiveCount, allActiveIds } = useMemo(() => {
    // Person AND category filters compose: a task must pass both to show.
    const active = todos.filter(t =>
      !t.isCompleted &&
      (assigneeFilter === null || t.assignedTo === assigneeFilter) &&
      matchesCategoryFilter(t, categoryFilter));
    const endOfCurrentWeek = addDays(endOfWeek(currentDate, { weekStartsOn: 1 }), 1); // Monday start

    const rowColors = new Map<string, SectionColor>();
    active.forEach(todo => {
      // Legacy/blank due date: explicitly 'blue' (undated ~ far future) rather
      // than relying on every date-fns predicate rejecting an Invalid Date.
      if (!todo.completeByDate) {
        rowColors.set(todo.id, 'blue');
        return;
      }
      const date = parseISO(todo.completeByDate);
      rowColors.set(
        todo.id,
        isBefore(date, currentDate) || isToday(date) || isTomorrow(date)
          ? 'rose' // overdue / today / tomorrow (old "Immediate" window)
          : isBefore(date, endOfCurrentWeek)
            ? 'amber' // this week
            : 'blue' // future
      );
    });

    return {
      flatActive: sortFlatTodos(active, sortMode),
      rowColors,
      allActiveCount: active.length,
      allActiveIds: active.map(t => t.id)
    };
  }, [todos, currentDate, assigneeFilter, categoryFilter, sortMode]);

  // F-TODO-16: in the 'category' sort mode the flat run becomes collapsible
  // sections (uncategorized last — groupTodosByCategory preserves the incoming
  // order inside each group, so rows keep their due-date order). Every other
  // sort mode renders exactly as before.
  const showCategorySections = sortMode === 'category';
  const categorySections = useMemo(
    () => (showCategorySections ? groupTodosByCategory(flatActive) : []),
    [showCategorySections, flatActive],
  );
  // F-TODO-16: how many ACTIVE tasks still have no category — drives the triage
  // banner and the kebab count. Counted off `todos` rather than `flatActive` so
  // an active filter can't make the backlog look smaller than it is.
  const uncategorizedActiveCount = useMemo(
    () => todos.filter(t => !t.isCompleted && !(t.category ?? '').trim()).length,
    [todos],
  );

  // "Saved for later" — the parked section below the active list. It obeys the
  // page's live filters and sort exactly as the active list does, so a filtered
  // view never shows parked items it would have hidden above.
  //
  // Two counts, deliberately: `parkedTotal` is every parked item, `parkedRows`
  // is what survives the filters. Parked items usually carry no assignee and no
  // category, so they filter out easily — the header reads "3 of 12" whenever
  // the two disagree, which is the agreed mitigation for "my parked list looks
  // empty and I don't know why".
  //
  // Ordering follows the page's sort mode. `ToDo` has NO `order` field and none
  // is being added, so there is deliberately no drag-reorder here (unlike the
  // Shopping list, which has one).
  const { parkedRows, parkedTotal } = useMemo(() => {
    const parked = savedForLaterTodos.filter(t => !t.isCompleted);
    const filtered = parked.filter(t =>
      (assigneeFilter === null || t.assignedTo === assigneeFilter) &&
      matchesCategoryFilter(t, categoryFilter));
    return { parkedRows: sortFlatTodos(filtered, sortMode), parkedTotal: parked.length };
  }, [savedForLaterTodos, assigneeFilter, categoryFilter, sortMode]);

  // Batch selection spans BOTH lists — but a parked row is selectable for DELETE
  // ONLY (owner-locked spec). Complete is suppressed because a parked item is
  // not completable at all (`completeToDo` refuses one), and Reschedule because
  // there is no real due date to reschedule: its stored `completeByDate` is an
  // inert placeholder, so "move these to Friday" would silently promote nothing
  // and rewrite a date nobody can see. Promotion is the one-at-a-time triage
  // sheet, deliberately not a batch action.
  const parkedIdSet = useMemo(() => new Set(parkedRows.map(t => t.id)), [parkedRows]);
  const selectableIds = useMemo(
    () => [...allActiveIds, ...parkedRows.map(t => t.id)],
    [allActiveIds, parkedRows],
  );
  const selectionIncludesParked = useMemo(
    () => Array.from(selectedIds).some(id => parkedIdSet.has(id)),
    [selectedIds, parkedIdSet],
  );

  // Session-only (deliberately NOT persisted): collapsing a section is a
  // momentary "get this out of my way", not a saved view.
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const toggleCategorySection = useCallback((key: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // --- Deep-link + highlight (ONE system, v1.2) -----------------------------
  // The canonical transport is router state — `navigate('/lists', { state: {
  // tab: 'todos', highlightId } })`, read by `useDeepLinkHighlight` and painted
  // by `useScrollToHighlight` + `data-highlight-target`, exactly as Money and
  // Habits do. The dashboard Action Queue's older `?todo=<id>` links are
  // TRANSLATED onto that same internal target rather than kept as a second
  // highlight path with its own ref map and its own ring overlay.
  const [searchParams, setSearchParams] = useSearchParams();
  const routerHighlightId = useDeepLinkHighlight();

  // Legacy `?todo=` → the same internal target. Latched on the render the param
  // arrives (a render-phase edge check, not an effect, so there is no cascading
  // render) because ListsPage's own `useDeepLinkTab` replaces the location —
  // dropping the query string with it — during that very render pass.
  const paramTodoId = searchParams.get('todo');
  const [consumedTodoParam, setConsumedTodoParam] = useState<string | null>(null);
  const [paramHighlightId, setParamHighlightId] = useState<string | null>(null);
  if (paramTodoId !== consumedTodoParam) {
    setConsumedTodoParam(paramTodoId);
    // Only ACT on a real incoming id; clearing back to null just re-arms the
    // edge so the same link can fire again later.
    if (paramTodoId) setParamHighlightId(paramTodoId);
  }
  // Consume the param so a refresh / back navigation doesn't re-fire it.
  // Removes only the `todo` key, so any other params (filters, sort) survive.
  useEffect(() => {
    if (!paramTodoId) return;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('todo');
      return next;
    }, { replace: true });
  }, [paramTodoId, setSearchParams]);
  // Self-clearing on the same schedule as `useDeepLinkHighlight`'s own timer,
  // so both sources of a highlight behave identically downstream.
  useEffect(() => {
    if (!paramHighlightId) return;
    const timer = window.setTimeout(() => setParamHighlightId(null), HIGHLIGHT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [paramHighlightId]);

  const highlightId = routerHighlightId ?? paramHighlightId;

  // Eisenhower buckets — computed unconditionally (hooks rule) but only
  // rendered in the matrix arrangement. Urgency uses the same midnight-
  // refreshed currentDate as the list sections, so the views always agree.
  const quadrants = useMemo(() => {
    const buckets: Record<Quadrant, ToDo[]> = { do: [], schedule: [], delegate: [], later: [] };
    todos.forEach(todo => {
      if (todo.isCompleted) return;
      if (assigneeFilter !== null && todo.assignedTo !== assigneeFilter) return;
      // The grid is scoped by the category filter exactly like the list.
      if (!matchesCategoryFilter(todo, categoryFilter)) return;
      buckets[quadrantForTodo(todo, currentDate)].push(todo);
    });
    const byDueDate = (a: ToDo, b: ToDo) =>
      a.completeByDate.localeCompare(b.completeByDate) || compareDueTimes(a, b);
    QUADRANT_ORDER.forEach(q => buckets[q].sort(byDueDate));
    return buckets;
  }, [todos, currentDate, assigneeFilter, categoryFilter]);

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
    setResetWhenExpired(false);
    setNotes('');
    setLinkedHabitId('');
    // Pre-select the category used on the last ADD (never on an edit), so a
    // household working through one bucket doesn't re-pick it every task. A
    // since-deleted category resolves to undefined — no stale default.
    setCategory(readLastUsedCategory(todoCategories));
    setSubtasks([]);
    setSubtaskInput('');
    setEditingSubtaskId(null);
    setAssigneePickerSubtaskId(null);
    setMoreOpen(false);
    setEditingId(null);
    setIsAddModalOpen(true);
  }, [quickText, currentUser, members, todoCategories]);

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

  // "Saved for later" quick-add: parks a thought with NO classification at all —
  // no assignee, no category, no importance, and an inert placeholder due date
  // owned by `addSavedForLaterTodo`. That is the whole point: a parked item is
  // explicitly not committed work, and the promote sheet is where it becomes so.
  const handleParkedQuickAdd = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = parkedQuickText.trim();
    if (!trimmed || submittingParkedAddRef.current) return;
    submittingParkedAddRef.current = true;
    setParkedQuickText('');
    haptic('success'); // at gesture time — dead after the await on iOS
    try {
      await addSavedForLaterTodo(trimmed);
      toast.success('Saved for later');
    } catch (error) {
      console.error('Error saving a to-do for later:', error);
      toast.error('Failed to save that for later. Please try again.');
      setParkedQuickText(trimmed); // restore so the user doesn't lose their input
    } finally {
      submittingParkedAddRef.current = false;
    }
  }, [parkedQuickText, addSavedForLaterTodo]);

  // Open modal for editing
  const openEditModal = useCallback((todo: ToDo) => {
    setText(todo.text);
    setCompleteByDate(todo.completeByDate);
    setAssignedTo(todo.assignedTo ?? WHOLE_HOUSEHOLD_ASSIGNEE);
    setIsImportant(todo.isImportant === true);
    setDueTime(todo.dueTime ?? '');
    setReminderMinutesBefore(todo.reminderMinutesBefore ?? null);
    setRecurrence(todo.recurrence?.frequency ?? 'none');
    setResetWhenExpired(todo.resetWhenExpired === true);
    setNotes(todo.notes ?? '');
    setLinkedHabitId(todo.linkedHabitId ?? '');
    // Editing NEVER inherits the last-used default — the stored value (or the
    // absence of one) is the truth for an existing task. A cleared category is
    // written through the sanitizer as null, so normalize it back to undefined.
    setCategory(todo.category?.trim() || undefined);
    setSubtasks(todo.subtasks ?? []);
    setSubtaskInput('');
    setEditingSubtaskId(null);
    setAssigneePickerSubtaskId(null);
    // Auto-expand when any hidden-by-default field already has a value —
    // editing a task with notes/subtasks/time/repeat/habit-link must never hide them.
    setMoreOpen(
      !!todo.dueTime ||
      todo.reminderMinutesBefore != null ||
      !!todo.recurrence ||
      !!(todo.notes && todo.notes.trim()) ||
      !!todo.linkedHabitId ||
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

  const handleUncomplete = useCallback(async (id: string, options?: TodoCompletionOptions) => {
      try {
          // uncompleteToDo (not a plain updateToDo) so a managed-kid assignee's
          // completion points credit is reversed atomically with the restore.
          // `options.subtaskToggle` (from an inline subtask auto-complete undo)
          // re-unchecks the triggering subtask by id in the same batch.
          await uncompleteToDo(id, options);
          toast.success('Task restored to active');
      } catch (error) {
          console.error('Failed to restore task:', error);
          toast.error('Failed to restore task');
      }
  }, [uncompleteToDo]);

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

  // F-TODO-16: mint a new category from the form's chip picker. Appends to the
  // household vocabulary; CategoryChipPicker selects it on success and owns the
  // duplicate/blank/in-flight guards.
  const handleAddCategory = useCallback(async (name: string) => {
    await updateTodoCategories([...todoCategories, name]);
  }, [todoCategories, updateTodoCategories]);

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

  // --- Inline tap-to-edit subtask text (paper cut #1) ---
  const handleStartEditSubtask = useCallback((sub: Subtask) => {
    setEditingSubtaskId(sub.id);
    setEditingSubtaskText(sub.text);
  }, []);

  const handleCommitEditSubtask = useCallback(() => {
    if (editingSubtaskId) {
      // Blank result keeps the original (updateSubtaskText no-ops on blank).
      setSubtasks(prev => updateSubtaskText(prev, editingSubtaskId, editingSubtaskText));
    }
    setEditingSubtaskId(null);
  }, [editingSubtaskId, editingSubtaskText]);

  const handleCancelEditSubtask = useCallback(() => {
    setEditingSubtaskId(null);
  }, []);

  // --- Per-subtask assignee (paper cut #2) ---
  const handlePickSubtaskAssignee = useCallback((id: string, uid: string | undefined) => {
    setSubtasks(prev => setSubtaskAssignee(prev, id, uid));
    setAssigneePickerSubtaskId(null);
  }, []);

  // Shared append for the multi-line paths (paste, photo scan): clamps to the
  // firestore.rules MAX_SUBTASKS cap and reports how many actually landed.
  const appendSubtaskLines = useCallback((lines: string[]) => {
    const room = Math.max(0, MAX_SUBTASKS - subtasks.length);
    const built = subtasksFromTexts(lines.slice(0, room));
    if (built.length === 0) {
      toast.error(`Subtask limit reached (${MAX_SUBTASKS}).`);
      return;
    }
    setSubtasks(prev => [...prev, ...built]);
    toast.success(
      lines.length > built.length
        ? `Added ${built.length} steps (limit ${MAX_SUBTASKS})`
        : `Added ${built.length} step${built.length === 1 ? '' : 's'}`
    );
  }, [subtasks.length]);

  // Pasting a multi-line list into the "Add a step" input turns each line into
  // its own subtask (bullets/numbering stripped). Single-line pastes keep the
  // default paste-into-the-input behavior.
  const handleSubtaskPaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const lines = subtaskLinesFromPaste(e.clipboardData.getData('text'));
    if (lines.length < 2) return;
    e.preventDefault();
    appendSubtaskLines(lines);
    setSubtaskInput('');
  }, [appendSubtaskLines]);

  // "Scan steps from a photo": OCR the image via the same parseTaskList vision
  // path as the page-level "Scan a list", appending each line as a subtask.
  const handleSubtaskImage = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!householdId) {
      toast.error('Household not ready — try again in a moment');
      return;
    }
    setAiScanningSteps(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const { parseTaskList } = await import('@/services/geminiService');
      const result = await parseTaskList(householdId, base64);
      const lines = subtaskLinesFromPaste(result.tasks.map(t => t.text).join('\n'));
      if (lines.length === 0) {
        toast('No steps found in that photo. Try a clearer shot.', { icon: 'ℹ️' });
        return;
      }
      appendSubtaskLines(lines);
    } catch (error) {
      console.error('Failed to scan steps from photo:', error);
      const message = error instanceof Error && error.message.includes('temporarily disabled')
        ? 'AI features are turned off right now.'
        : error instanceof Error && error.message.toLowerCase().includes('quota')
          ? error.message
          : 'Could not read steps from that photo. Please try again.';
      toast.error(message);
    } finally {
      setAiScanningSteps(false);
      if (subtaskImageInputRef.current) subtaskImageInputRef.current.value = '';
    }
  }, [householdId, appendSubtaskLines]);

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

  const drawerOpen = isAddModalOpen || !!actionTodo;

  // Stacked sticky header (owner decision): tab strip (ListsPage), then the
  // title row, then the quick-add row all pin; list rows scroll beneath the
  // stack. The hook measures the title row and publishes --lists-sticky-top-2
  // (strip + title height) on the page root for the add row's offset.
  const { containerRef: stickyContainerRef, titleRowRef: stickyTitleRowRef } =
    useStackedStickyOffset<HTMLDivElement, HTMLDivElement>();

  // F-TODO-16 — a THIRD sticky tier for the category-section headers, stacked
  // below the quick-add row. useStackedStickyOffset publishes tiers 1–2 (strip,
  // title row); this measures the quick-add row on top of tier 2 and publishes
  // `--todos-sticky-top-3` on the same container, so a header pins flush under
  // the add bar. Node captured via a state-setter ref (not useRef) so the
  // measurement re-runs when the add row mounts/unmounts with selection mode.
  const [quickAddNode, setQuickAddNode] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const container = stickyContainerRef.current;
    if (!container) return;
    const update = () => {
      container.style.setProperty(
        '--todos-sticky-top-3',
        `calc(var(--lists-sticky-top-2, 0px) + ${quickAddNode ? quickAddNode.offsetHeight : 0}px)`
      );
    };
    update();
    if (!quickAddNode || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(quickAddNode);
    return () => observer.disconnect();
  }, [quickAddNode, stickyContainerRef]);

  // Rotation-driven 2×2 Eisenhower grid (owner-locked spec): rotating to
  // landscape auto-shows the immersive grid overlay; rotating back to portrait
  // returns to the flat list. The grid never AUTO-shows over an active layer —
  // selection mode (its chips have no selection affordance) or any open
  // drawer/modal — but once shown it stays put while the edit/options drawer
  // opens ABOVE it (the guard applies at show-time only; when the blocking
  // layer closes while still landscape, the grid then appears).
  //
  // `gridDismissed`: the grid's on-screen ✕ (or Escape) simply hides the grid
  // until the next rotation — the simplest correct exit. It resets whenever
  // the device returns to portrait, so the next rotation to landscape shows
  // the grid again. Both use the render-phase-setState edge pattern (see
  // wasSelectionMode above) instead of an effect cascade.
  const [gridActive, setGridActive] = useState(false);
  const [gridDismissed, setGridDismissed] = useState(false);
  const blockingLayerOpen =
    isSelectionMode || drawerOpen || isPhotoImportOpen || isTemplateDrawerOpen ||
    isBatchRescheduleOpen || showBatchDeleteConfirm ||
    isCategoryManagerOpen || isTriageOpen || promotingTodo !== null;
  if (!isLandscape) {
    if (gridActive) setGridActive(false);
    if (gridDismissed) setGridDismissed(false);
  } else if (viewMode === 'active' && !gridActive && !gridDismissed && !blockingLayerOpen) {
    setGridActive(true);
  }
  const exitGrid = useCallback(() => {
    setGridActive(false);
    setGridDismissed(true);
  }, []);

  const gridOverlayVisible = gridActive && viewMode === 'active';

  // Un-hide the deep-linked row BEFORE `useScrollToHighlight` looks for it in
  // the DOM (it gives this callback one frame). Every branch is conditional on
  // the target actually failing the current view — a deep link must reveal what
  // it points at, but it must not stomp view choices it didn't need to touch.
  const revealHighlightedTodo = useCallback(() => {
    if (!highlightId) return;
    // A deep link / search hit can point at a PARKED to-do too — `todos`
    // excludes those at the context, so both slices have to be consulted or a
    // parked target would fall out here and nothing below would run.
    const activeTarget = todos.find(t => t.id === highlightId);
    const parkedTarget = activeTarget
      ? undefined
      : savedForLaterTodos.find(t => t.id === highlightId);
    const target = activeTarget ?? parkedTarget;
    if (!target) return;

    // 1. The landscape Eisenhower overlay genuinely UNMOUNTS the flat list, so
    //    a scroll target inside it doesn't exist at all while it is up.
    if (gridActive) {
      setGridActive(false);
      setGridDismissed(true);
    }

    // 2. Active vs completed. `searchTodos` returns completed to-dos too, so a
    //    completed hit would otherwise silently fail against the active view.
    setViewMode(target.isCompleted ? 'completed' : 'active');
    if (target.isCompleted) return; // the filters/sections below are active-only

    // 3. Filters — cleared ONLY when this task actually fails them.
    if (assigneeFilter !== null && target.assignedTo !== assigneeFilter) {
      setAssigneeFilter(null);
    }
    if (!matchesCategoryFilter(target, categoryFilter)) {
      setCategoryFilter([]);
    }

    // 4. Sections collapse with `hidden` (display:none) rather than unmounting,
    //    and BOTH `scrollIntoView` and the flash class are silent no-ops on a
    //    display:none subtree — so expanding the target's section is required,
    //    not optional. `useScrollToHighlight` calls this synchronously and then
    //    waits exactly one rAF before querying the DOM, so this has to happen
    //    here (in the reveal callback) and not a frame later.
    //
    //    A parked to-do lives in the "Saved for later" section, never in a
    //    category section — the two are mutually exclusive, so the branch
    //    returns rather than falling through.
    if (parkedTarget) {
      setCollapsedCategories(prev => {
        if (!prev.has(SAVED_FOR_LATER_SECTION_KEY)) return prev;
        const next = new Set(prev);
        next.delete(SAVED_FOR_LATER_SECTION_KEY);
        return next;
      });
      return;
    }
    if (sortMode === 'category') {
      const sectionKey = categorySectionKeyForTodo(target);
      setCollapsedCategories(prev => {
        if (!prev.has(sectionKey)) return prev;
        const next = new Set(prev);
        next.delete(sectionKey);
        return next;
      });
    }
  }, [highlightId, todos, savedForLaterTodos, gridActive, assigneeFilter, categoryFilter, sortMode]);
  useScrollToHighlight(highlightId, revealHighlightedTodo);

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
          // F-TODO-16: an absent category exports as the Uncategorized label so
          // the column is never blank/ambiguous in a spreadsheet.
          'Category': todo.category?.trim() || UNCATEGORIZED_LABEL,
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
    const isValidAssignee =
      assignedTo === WHOLE_HOUSEHOLD_ASSIGNEE || members.some(member => member.uid === assignedTo);
    if (!isValidAssignee) {
      if (assignedTo) {
        toast.error('The selected household member is no longer available. Please choose another member.');
      } else {
        toast.error('Please select a valid household member to assign this task to');
      }
      return;
    }
    // "Whole household" stores an absent assignedTo (unassigned/shared) — the
    // sentinel value never reaches Firestore.
    const assignedToValue = resolveAssignedTo(assignedTo);

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
      // "Auto-reschedule" only exists on a REPEATING task, so turning Repeat off
      // turns it off too. Clearing writes an explicit `false` rather than
      // `undefined` — the sanitizer maps undefined to null, and an honest
      // boolean is what the schema documents.
      const resetWhenExpiredValue = recurrence === 'none' ? false : resetWhenExpired;
      const trimmedNotes = notes.trim();
      // Habit Automations (PRD #1065): '' (no selection) means "not linked".
      const linkedHabitValue = linkedHabitId || undefined;
      // F-TODO-16: blank/cleared means Uncategorized, which is the ABSENCE of
      // the field — never ''.
      const categoryValue = category?.trim() || undefined;
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
          assignedTo: assignedToValue,
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
        // Same "only when it changed" shape, so a plain (never-repeating) edit
        // stays byte-identical to today's write.
        if (resetWhenExpiredValue !== (editingTodo?.resetWhenExpired === true)) {
          updates.resetWhenExpired = resetWhenExpiredValue;
        }
        // Habit Automations (PRD #1065): only touch linkedHabitId when it
        // actually changed, so plain (never-linked) edits stay byte-identical.
        if ((linkedHabitValue ?? null) !== (editingTodo?.linkedHabitId ?? null)) {
          updates.linkedHabitId = linkedHabitValue; // sanitizer writes null → cleared
        }
        // F-TODO-16: same shape as linkedHabitId — only touch the field when it
        // actually changed, so a plain (never-categorized) edit stays
        // byte-identical to today's write, and CLEARING sends undefined (the
        // sanitizer turns it into null, i.e. "no category") rather than ''.
        if ((categoryValue ?? null) !== (editingTodo?.category?.trim() || null)) {
          updates.category = categoryValue;
        }
        await updateToDo(editingId, updates);
        toast.success('Task updated');
      } else {
        haptic('success'); // at gesture time — dead after the await on iOS
        await addToDo({
          text: trimmedText,
          completeByDate,
          assignedTo: assignedToValue,
          isCompleted: false,
          isImportant,
          notes: trimmedNotes,
          ...subtaskField,
          ...(dueTimeValue !== undefined ? { dueTime: dueTimeValue } : {}),
          ...(reminderValue !== undefined ? { reminderMinutesBefore: reminderValue } : {}),
          ...(recurrenceValue ? { recurrence: recurrenceValue } : {}),
          ...(resetWhenExpiredValue ? { resetWhenExpired: true } : {}),
          ...(linkedHabitValue ? { linkedHabitId: linkedHabitValue } : {}),
          ...(categoryValue ? { category: categoryValue } : {})
        });
        // Remember (or forget) the category for the NEXT new task — add only.
        writeLastUsedCategory(categoryValue);
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

  // Covers every row currently on screen — active AND parked — so "Select all"
  // never silently skips rows the user can see and tap.
  const handleSelectAll = () => {
    if (selectedIds.size === selectableIds.length && selectableIds.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  };

  const handleBatchComplete = async () => {
    if (selectedIds.size === 0) return;
    setIsBatchProcessing(true);
    try {
      const promises = Array.from(selectedIds).map(id => completeToDo(id));
      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      // Habit Automations (PRD #1065): a habit-linked to-do with unfinished
      // subtasks is REFUSED by the mutation (not a generic failure) — skip it
      // and report it as "steps left", separate from real errors.
      const gated = rejected.filter(r => isTodoSubtasksIncompleteError(r.reason));
      const failed = rejected.length - gated.length;

      if (successful > 0) {
        toast.success(`Completed ${successful} tasks!`);
      }
      if (gated.length > 0) {
        const firstGate = gated[0]?.reason;
        toast(
          gated.length === 1 && isTodoSubtasksIncompleteError(firstGate)
            ? `${firstGate.stepsLeft} step${firstGate.stepsLeft === 1 ? '' : 's'} left on “${firstGate.title}”`
            : `${gated.length} tasks still have steps left`,
        );
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

  // ONE overflow menu for the whole page, anchored on the quick-add row's
  // kebab (the default view has no separate header row at all — owner call).
  // Groups: "Add" (the extra add methods), "View" (Active/Completed radio —
  // replaced the old segmented toggle), "Filter" (person radio — replaced the
  // old chips row), then the ungrouped actions. Export targets the current
  // view; Select-multiple is disabled in the Completed view, matching the
  // previous behaviour. Filter is skipped for single-member households.
  const menuItems: MenuItem[] = [
    {
      key: 'details',
      label: 'Full details',
      icon: <SlidersHorizontal size={16} />,
      ariaLabel: 'Add new task with full details',
      group: 'Add',
      onSelect: openAddModal,
    },
    {
      key: 'template',
      label: 'From template',
      icon: <ClipboardList size={16} />,
      ariaLabel: 'Add tasks from a template',
      group: 'Add',
      onSelect: () => setIsTemplateDrawerOpen(true),
    },
    {
      key: 'scan',
      label: 'Scan a list',
      icon: <Camera size={16} />,
      group: 'Add',
      onSelect: () => setIsPhotoImportOpen(true),
    },
    {
      key: 'view-active',
      label: 'Active tasks',
      selected: viewMode === 'active',
      group: 'View',
      onSelect: () => setViewMode('active'),
    },
    {
      key: 'view-completed',
      label: `Completed (${completedCount})`,
      selected: viewMode === 'completed',
      group: 'View',
      onSelect: () => setViewMode('completed'),
    },
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
    // F-TODO-16 — always present, so triage stays reachable at zero (and after
    // the banner is dismissed) rather than only when there's a backlog.
    {
      key: 'triage',
      label: uncategorizedActiveCount > 0
        ? `Triage uncategorized (${uncategorizedActiveCount})`
        : 'Triage uncategorized',
      icon: <ListChecks size={16} />,
      ariaLabel: 'Triage uncategorized tasks one at a time',
      group: 'Categories',
      onSelect: () => setIsTriageOpen(true),
      disabled: uncategorizedActiveCount === 0,
    },
    {
      key: 'manage-categories',
      label: 'Manage categories',
      icon: <Tags size={16} />,
      group: 'Categories',
      onSelect: () => setIsCategoryManagerOpen(true),
    },
  ];

  // Add row — row ONE of the list card, matching the Shopping list exactly:
  // `position: sticky` dies inside an `overflow-hidden` ancestor, so the
  // surface is split into a sticky top card (add row, bottom hairline = the
  // divider) and a flush list card below (border-t-0, rounded-t-none) that
  // together read as one rounded section. The sticky offset tucks it under
  // the pinned title row via --lists-sticky-top-2 (strip + title height,
  // published by useStackedStickyOffset; 0px fallback when neither renders);
  // the wrapper's page-colored background masks rows scrolling past the
  // card's rounded top corners. z-20 keeps it under the tab strip's z-30,
  // matching the Shopping list. Hidden in selection mode (adding has no
  // context there).
  //
  // In the 'category' sort mode the list below is a stack of separately
  // rounded section cards rather than one flush run, so the add card keeps its
  // own bottom corners there instead of pretending to be attached.
  const stickyQuickAdd = !isSelectionMode ? (
    <div
      ref={setQuickAddNode}
      className="sticky top-[var(--lists-sticky-top-2,0px)] z-20 bg-brand-50 dark:bg-brand-900"
    >
      <div className={cn('surface-section overflow-hidden', !showCategorySections && 'rounded-b-none')}>
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
        </div>
      </div>
    </div>
  ) : null;

  // Person filter, inline in the title row next to the kebab (mirrors the
  // Shopping list's store filter exactly): a quiet funnel icon at rest, an
  // accent pill with the member's first name + inline clear when active, so
  // the scoped view stays glanceable. Hidden for single-member households
  // (nothing to filter) and in the Completed view (it only scopes active
  // tasks — showing it there would lie).
  const activeFilterMember = assigneeFilter !== null ? memberMap.get(assigneeFilter) : undefined;
  const filterMenuItems: MenuItem[] = [
    {
      key: 'filter-all',
      label: 'Everyone',
      icon: <User size={16} />,
      selected: assigneeFilter === null,
      onSelect: () => setAssigneeFilter(null),
    },
    ...members.map((member) => ({
      key: `filter-${member.uid}`,
      label: member.displayName?.split(' ')[0] ?? 'User',
      ariaLabel: `Filter to ${member.displayName ?? 'User'}`,
      selected: assigneeFilter === member.uid,
      onSelect: () => setAssigneeFilter(member.uid),
    })),
  ];
  const filterControl = members.length > 1 ? (
    <div className="relative flex-none">
      {assigneeFilter !== null ? (
        <div className="flex items-center bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-200 rounded-full">
          <button
            type="button"
            onClick={() => setFilterOpen((o) => !o)}
            aria-label={`Filter by person: ${activeFilterMember?.displayName ?? 'User'}`}
            aria-expanded={filterOpen}
            aria-haspopup="menu"
            className="flex items-center gap-1.5 pl-3 pr-1.5 py-2 text-xs font-medium max-w-[38vw]"
          >
            <Filter className="w-4 h-4 shrink-0" />
            <span className="truncate">{activeFilterMember?.displayName?.split(' ')[0] ?? 'User'}</span>
          </button>
          <button
            type="button"
            onClick={() => setAssigneeFilter(null)}
            aria-label="Clear person filter"
            className="pr-2.5 py-2 hover:text-accent-900 dark:hover:text-accent-50 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setFilterOpen((o) => !o)}
          aria-label="Filter by person"
          aria-expanded={filterOpen}
          aria-haspopup="menu"
          className="relative before:absolute before:-inset-1 before:content-[''] p-2 text-brand-500 hover:text-accent-600 hover:bg-brand-100 rounded-full transition-colors dark:text-brand-400 dark:hover:text-accent-300 dark:hover:bg-brand-700/50"
        >
          <Filter className="w-5 h-5" />
        </button>
      )}
      {filterOpen && (
        <Menu
          isOpen={filterOpen}
          onClose={() => setFilterOpen(false)}
          ariaLabel="Filter by person"
          position="top-full right-0 mt-2"
          className="min-w-[176px]"
          items={filterMenuItems}
        />
      )}
    </div>
  ) : null;

  // F-TODO-16 category filter — same visual grammar as the person filter above
  // (quiet icon at rest; accent pill + inline clear when active), but
  // MULTI-select: the label shows the single category's name, or the count when
  // several are picked. Hidden when the household has no vocabulary AND nothing
  // is selected (a stale filter must always stay clearable).
  //
  // Built on Popover rather than Menu: Menu closes on every activation, which is
  // wrong for a checkbox list you tick several times. Items are
  // `menuitemcheckbox`es that toggle in place; Escape / click-away close.
  const categoryFilterLabel = describeCategoryFilter(categoryFilter, UNCATEGORIZED_LABEL);
  // Entries come from the UNION vocabulary (household list + categories present
  // on tasks), so a Shortcut-created category is reachable here instead of only
  // via a row chip — and the control stays available for it.
  const categoryFilterEntries: TodoCategoryFilterEntry[] = [...categoryVocabulary, null];
  const categoryFilterControl = (categoryVocabulary.length > 0 || categoryFilter.length > 0) ? (
    <div className="relative flex-none">
      {categoryFilterLabel !== null ? (
        <div className="flex items-center bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-200 rounded-full">
          <button
            type="button"
            onClick={() => setCategoryFilterOpen((o) => !o)}
            aria-label={`Filter by category: ${categoryFilter.length === 1 ? categoryFilterLabel : `${categoryFilter.length} selected`}`}
            aria-expanded={categoryFilterOpen}
            aria-haspopup="menu"
            className="flex items-center gap-1.5 pl-3 pr-1.5 py-2 text-xs font-medium max-w-[38vw]"
          >
            <Tag className="w-4 h-4 shrink-0" />
            <span className="truncate">{categoryFilterLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => setCategoryFilter([])}
            aria-label="Clear category filter"
            className="pr-2.5 py-2 hover:text-accent-900 dark:hover:text-accent-50 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCategoryFilterOpen((o) => !o)}
          aria-label="Filter by category"
          aria-expanded={categoryFilterOpen}
          aria-haspopup="menu"
          className="relative before:absolute before:-inset-1 before:content-[''] p-2 text-brand-500 hover:text-accent-600 hover:bg-brand-100 rounded-full transition-colors dark:text-brand-400 dark:hover:text-accent-300 dark:hover:bg-brand-700/50"
        >
          <Tag className="w-5 h-5" />
        </button>
      )}
      {categoryFilterOpen && (
        <Popover
          isOpen
          onClose={() => setCategoryFilterOpen(false)}
          role="menu"
          ariaLabel="Filter by category"
          position="top-full right-0 mt-2"
          className="w-56 overflow-hidden py-1"
        >
          {/* role="none": a scroll container between the `menu` and its
              `menuitemcheckbox`es would otherwise break the required
              menu → menuitem* ownership relation for assistive tech. */}
          <div role="none" className="max-h-72 scroll-contain-y">
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={categoryFilter.length === 0}
              onClick={() => setCategoryFilter([])}
              className={cn(
                'w-full min-h-[44px] px-4 py-2 flex items-center justify-between gap-2 text-left text-sm transition-colors hover:bg-brand-50 dark:hover:bg-brand-600/50 focus:outline-hidden focus:bg-brand-50 dark:focus:bg-brand-600/50',
                categoryFilter.length === 0
                  ? 'text-accent-600 font-medium dark:text-accent-300'
                  : 'text-brand-700 dark:text-brand-300'
              )}
            >
              All categories
              {categoryFilter.length === 0 && <Check size={14} aria-hidden="true" />}
            </button>
            {categoryFilterEntries.map((entry) => {
              const label = entry ?? UNCATEGORIZED_LABEL;
              const selected = isCategoryFilterEntrySelected(categoryFilter, entry);
              const color = getTodoCategoryColor(entry ?? undefined);
              return (
                <button
                  key={entry === null ? 'category-filter-uncategorized' : `category-filter-${entry}`}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={selected}
                  // Deliberately does NOT close: ticking several categories in
                  // one visit is the whole point of a multi-select filter.
                  onClick={() => setCategoryFilter(prev => toggleCategoryFilterEntry(prev, entry))}
                  className={cn(
                    'w-full min-h-[44px] px-4 py-2 flex items-center justify-between gap-2 text-left text-sm transition-colors hover:bg-brand-50 dark:hover:bg-brand-600/50 focus:outline-hidden focus:bg-brand-50 dark:focus:bg-brand-600/50',
                    selected
                      ? 'text-accent-600 font-medium dark:text-accent-300'
                      : 'text-brand-700 dark:text-brand-300'
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn('w-2.5 h-2.5 rounded-full border shrink-0', color.bg, color.border)}
                    />
                    <span className="truncate">{label}</span>
                  </span>
                  {selected && <Check size={14} aria-hidden="true" className="shrink-0" />}
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </div>
  ) : null;

  // Sort, inline in the title row (mirrors the Shopping list's sort icon):
  // tinted when a non-default mode is active so the derived view is glanceable.
  const sortMenuItems: MenuItem[] = TODO_SORT_MODES.map((mode) => ({
    key: `sort-${mode}`,
    label: TODO_SORT_LABELS[mode],
    selected: sortMode === mode,
    onSelect: () => setSortMode(mode),
  }));
  const sortControl = (
    <div className="relative flex-none">
      <button
        type="button"
        onClick={() => setSortOpen((o) => !o)}
        aria-label={`Sort: ${TODO_SORT_LABELS[sortMode]}`}
        aria-expanded={sortOpen}
        aria-haspopup="menu"
        className={cn(
          "relative before:absolute before:-inset-1 before:content-[''] p-2 rounded-full transition-colors hover:bg-brand-100 dark:hover:bg-brand-700/50",
          sortMode !== 'important'
            ? 'text-accent-600 dark:text-accent-300'
            : 'text-brand-500 hover:text-accent-600 dark:text-brand-400 dark:hover:text-accent-300'
        )}
      >
        <ArrowUpDown className="w-5 h-5" />
      </button>
      {sortOpen && (
        <Menu
          isOpen={sortOpen}
          onClose={() => setSortOpen(false)}
          ariaLabel="Sort tasks"
          position="top-full right-0 mt-2"
          className="min-w-[176px]"
          items={sortMenuItems}
        />
      )}
    </div>
  );

  // THE page kebab, in the title row (mirrors the Shopping list header — the
  // two Plan siblings must share one structure): the single menu carrying the
  // add methods, view radio, and list actions.
  const pageKebab = (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="To-do list actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="relative before:absolute before:-inset-1 before:content-[''] p-2 text-brand-500 hover:text-accent-600 hover:bg-brand-100 rounded-full transition-colors dark:text-brand-400 dark:hover:text-accent-300 dark:hover:bg-brand-700/50"
      >
        <MoreHorizontal className="w-5 h-5" />
      </button>
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
  );

  // One active-list row + its deep-link scroll anchor. Extracted so the flat
  // list and the category sections render IDENTICAL rows (a plain function, not
  // a component, so the row's own state isn't remounted).
  const renderTodoRow = (item: ToDo) => (
    <div
      key={item.id}
      // Global search / Action Queue deep-link target — the shared
      // `data-highlight-target` convention (see hooks/useScrollToHighlight),
      // which finds the node and applies `.search-highlight-flash`
      // imperatively, so TodoRow's memo comparator needs no highlight prop.
      data-highlight-target={item.id}
      // scroll-mt clears the stacked sticky header when the row is scrolled
      // into view; `relative` anchors the flash overlay (index.css).
      className="relative scroll-mt-32"
    >
      <TodoRow
        item={item}
        color={rowColors.get(item.id) ?? 'blue'}
        assignee={item.assignedTo ? memberMap.get(item.assignedTo) : undefined}
        isSelected={selectedIds.has(item.id)}
        isSelectionMode={isSelectionMode}
        onComplete={completeToDo}
        onUncomplete={handleUncomplete}
        onEdit={openEditModal}
        onDelete={deleteToDo}
        onMore={setActionTodo}
        onToggleSelection={toggleSelection}
        onToggleSubtask={toggleTodoSubtask}
        memberMap={memberMap}
      />
    </div>
  );

  // "Saved for later" row — the same TodoRow in its parked variant, never a
  // fork. The leading control becomes a circular `+` that opens the promote
  // sheet, right-swipe promotes, left-swipe deletes, and BOTH completion paths
  // (checkbox and swipe) are suppressed inside the component.
  const renderParkedRow = (item: ToDo) => (
    <div
      key={item.id}
      data-highlight-target={item.id}
      className="relative scroll-mt-32"
    >
      <TodoRow
        variant="parked"
        item={item}
        // A parked row renders no due date at all, so the urgency color is
        // inert here — pass the neutral 'blue' rather than deriving one from
        // the placeholder date.
        color="blue"
        assignee={item.assignedTo ? memberMap.get(item.assignedTo) : undefined}
        isSelected={selectedIds.has(item.id)}
        isSelectionMode={isSelectionMode}
        onPromote={setPromotingTodo}
        onComplete={completeToDo}
        onUncomplete={handleUncomplete}
        onEdit={openEditModal}
        onDelete={deleteToDo}
        onMore={setActionTodo}
        onToggleSelection={toggleSelection}
        onToggleSubtask={toggleTodoSubtask}
        memberMap={memberMap}
      />
    </div>
  );

  // The parked section's header count. Plain total when nothing narrows it;
  // "3 of 12" the moment the page's filters do — parked items usually carry no
  // assignee/category, so they filter out easily and a bare "3" would read as
  // "I lost nine things".
  const parkedCollapsed = collapsedCategories.has(SAVED_FOR_LATER_SECTION_KEY);
  const parkedCountLabel =
    parkedRows.length === parkedTotal ? `${parkedTotal}` : `${parkedRows.length} of ${parkedTotal}`;
  const savedForLaterSection = (
    <section aria-label="Saved for later" className="pt-1">
      <h3>
        <button
          type="button"
          onClick={() => toggleCategorySection(SAVED_FOR_LATER_SECTION_KEY)}
          aria-expanded={!parkedCollapsed}
          aria-controls="saved-for-later-content"
          className="w-full min-h-11 flex items-center gap-2 px-1 py-1.5 text-left rounded-card focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
        >
          <span className="font-display text-sm font-semibold tracking-tight text-brand-700 dark:text-brand-200">
            Saved for later
          </span>
          <span className="text-xs tabular-nums text-brand-500 dark:text-brand-400">
            · {parkedCountLabel}
          </span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cn(
              'ml-auto shrink-0 text-brand-400 dark:text-brand-450 transition-transform duration-(--duration-fast) ease-(--ease-standard)',
              parkedCollapsed && '-rotate-90'
            )}
          />
        </button>
      </h3>
      {/* Always mounted (hidden when collapsed) so the header's aria-controls
          never references an absent id — the same discipline as the category
          sections above. */}
      <div id="saved-for-later-content" hidden={parkedCollapsed}>
        {/* Own add bar, so a thought can be parked directly rather than being
            routed through the active list first. Hidden in selection mode,
            matching the main list's add row. */}
        {!isSelectionMode && (
          <div className={cn('surface-section overflow-hidden', parkedRows.length > 0 && 'rounded-b-none')}>
            <QuickAddBar
              attached
              onSubmit={handleParkedQuickAdd}
              value={parkedQuickText}
              onChange={setParkedQuickText}
              placeholder="Save something for later..."
              aria-label="Save a task for later"
              disabled={!parkedQuickText.trim()}
              submitLabel="Save for later"
            />
          </div>
        )}
        {parkedRows.length > 0 ? (
          <SurfaceList
            className={cn(
              '[&>*:first-child_.hairline-divider]:border-t-0',
              !isSelectionMode && 'rounded-t-none border-t-0'
            )}
          >
            {parkedRows.map(renderParkedRow)}
          </SurfaceList>
        ) : (
          <p className="px-1 pt-2 text-sm text-brand-400 dark:text-brand-450">
            {parkedTotal === 0
              ? 'Nothing parked yet — save an idea here and triage it when you are ready.'
              : 'Nothing parked matches the current filters.'}
          </p>
        )}
      </div>
    </section>
  );

  return (
    // NO min-h-screen here: the page renders inside MainLayout's <main>
    // scroller, so a 100vh floor (measured against the WINDOW, not the
    // scrollport) manufactured ~2–300px of phantom scroll range on short
    // lists — flinging every row up beneath the pinned add row and leaving a
    // blank page (the "list content gone" iPhone bug).
    <div ref={stickyContainerRef} className={cn("px-4 max-w-2xl mx-auto space-y-3", isSelectionMode ? "pb-40" : "pb-nav-safe")}>

      {/* Title row — mirrors the Shopping tab's header exactly (serif title +
          inline actions cluster) so the two Plan siblings read as one system.
          STICKY (owner decision): pins flush below the tab strip at
          --lists-sticky-top, with the quick-add row pinned below it in turn;
          the opaque page background masks rows scrolling beneath. All three
          variants (normal / selection / completed) share this one measured
          wrapper so --lists-sticky-top-2 tracks whichever is showing. The
          kebab lives here; selection mode swaps the row for its own
          Select all + Cancel controls. The page-level h1 is ListsPage's
          sr-only "Plan". */}
      <div
        ref={stickyTitleRowRef}
        className="sticky top-[var(--lists-sticky-top,0px)] z-30 bg-brand-50 dark:bg-brand-900"
      >
      {isSelectionMode ? (
        <div className="pt-4 pb-2 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold tracking-tight text-brand-900 dark:text-brand-50 whitespace-nowrap shrink-0">
            Select tasks
          </h2>
          <div className="flex items-center gap-3 shrink-0">
            <Button
              variant="link"
              size="sm"
              onClick={handleSelectAll}
              className="min-h-11 gap-1 px-2 text-accent-600 dark:text-accent-300 hover:text-accent-700 dark:hover:text-accent-200"
              leftIcon={<CheckSquare size={14} aria-hidden="true" className={selectedIds.size === selectableIds.length && selectableIds.length > 0 ? 'text-accent-600 dark:text-accent-300' : 'text-brand-300 dark:text-brand-450'} />}
            >
              {selectedIds.size === selectableIds.length && selectableIds.length > 0 ? 'Deselect all' : 'Select all'}
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
        </div>
      ) : viewMode === 'completed' ? (
        <PageHeader
          as="h2"
          className="px-0 pt-4 pb-2 items-center"
          title={
            <>
              Completed
              <span className="ml-2 font-sans text-sm font-normal text-brand-400 dark:text-brand-450 tabular-nums">
                {completedCount}
              </span>
            </>
          }
          actions={pageKebab}
        />
      ) : (
        <PageHeader
          as="h2"
          className="px-0 pt-4 pb-2 items-center"
          title="To-dos"
          actions={
            <div className="flex items-center gap-1">
              {filterControl}
              {categoryFilterControl}
              {sortControl}
              {pageKebab}
            </div>
          }
        />
      )}
      </div>

      {viewMode === 'active' ? (
          <>
            {/* F-TODO-16 — the triage nudge. Only while there IS a backlog, and
                only in the active view; it disappears on its own as the count
                reaches zero, so it never becomes permanent furniture. The kebab
                keeps triage reachable once this is dismissed. */}
            {uncategorizedActiveCount > 0 && !triageBannerDismissed && !gridOverlayVisible && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-700 dark:bg-brand-800/40">
                <Tag size={16} aria-hidden="true" className="shrink-0 text-brand-400 dark:text-brand-300" />
                <p className="min-w-0 flex-1 text-xs text-brand-600 dark:text-brand-200">
                  {uncategorizedActiveCount === 1
                    ? '1 task needs a category'
                    : `${uncategorizedActiveCount} tasks need a category`}
                </p>
                <button
                  type="button"
                  onClick={() => setIsTriageOpen(true)}
                  // The 51x24 visible pill is well under the 44px floor; the
                  // house extender (Button's `sm` idiom) grows the tap target
                  // vertically only — the banner itself is ~42px tall, so a
                  // full ::before inset would bleed into the sticky header
                  // above / first to-do row below.
                  className="relative shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-accent-700 hover:bg-accent-50 dark:text-accent-300 dark:hover:bg-accent-900/30 before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']"
                >
                  Triage
                </button>
                <button
                  type="button"
                  onClick={() => setTriageBannerDismissed(true)}
                  aria-label="Dismiss the triage reminder"
                  // 22x22 icon button. The extender is DELIBERATELY ASYMMETRIC:
                  // a symmetric one reaching 44px would overhang the 8px `gap-2`
                  // and steal the right edge of the Triage pill next to it
                  // (whose own extender is inset-x-0, so it can't push back).
                  // `ml-1` widens this one gap to 12px and the extender reaches
                  // only 4px left, leaving an 8px dead zone between the two hit
                  // areas; the remaining width is taken to the RIGHT, where the
                  // banner's px-3 padding and the page gutter hold nothing
                  // clickable. Verified with elementFromPoint along the seam.
                  className="relative ml-1 shrink-0 rounded-lg p-1 text-brand-400 hover:bg-brand-100 dark:text-brand-300 dark:hover:bg-brand-700 before:absolute before:-top-3 before:-bottom-3 before:-left-1 before:-right-5 before:content-['']"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            )}
            {/* One flat list card. Its first row is the sticky quick-add bar
                (Shopping's split-card pattern — see stickyQuickAdd above); the
                flush SurfaceList below completes the same rounded section.
                Not rendered while the immersive grid overlay is up — the
                overlay covers the whole viewport, and rendering the same rows
                underneath would double every task's accessible control. */}
            {!gridOverlayVisible && (
            <div>
              {stickyQuickAdd}
              {/* F-TODO-16: the 'category' sort mode swaps the single flush run
                  for one collapsible section per category (uncategorized last).
                  Every other mode renders exactly as before. */}
              {showCategorySections ? (
                <div className="space-y-3">
                  {categorySections.map((section, index) => {
                    const key = categorySectionKey(section.category);
                    const collapsed = collapsedCategories.has(key);
                    const label = section.category ?? UNCATEGORIZED_LABEL;
                    const color = getTodoCategoryColor(section.category ?? undefined);
                    // Positional id, NOT the category name: names are free text
                    // and may contain spaces/quotes, which are illegal in an
                    // HTML id (and would break the aria-controls reference).
                    const contentId = `todo-category-section-${index}`;
                    return (
                      <section key={key} aria-label={label}>
                        {/* Sticky header, pinned below the quick-add row via the
                            third sticky tier (--todos-sticky-top-3, measured
                            above). Page-colored background so rows scroll
                            beneath it, z-10 keeps it under the add row (z-20). */}
                        <div className="sticky top-[var(--todos-sticky-top-3,0px)] z-10 bg-brand-50 dark:bg-brand-900 pt-1">
                          <h3>
                            <button
                              type="button"
                              onClick={() => toggleCategorySection(key)}
                              aria-expanded={!collapsed}
                              aria-controls={contentId}
                              className="w-full min-h-11 flex items-center gap-2 px-1 py-1.5 text-left rounded-card focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
                            >
                              <span className={cn('inline-flex min-w-0 items-center rounded-full border px-2 py-0.5 text-xxs font-semibold', color.bg, color.text, color.border)}>
                                <span className="truncate">{label}</span>
                              </span>
                              <span className="text-xs tabular-nums text-brand-500 dark:text-brand-400">
                                {section.todos.length}
                              </span>
                              <ChevronDown
                                size={16}
                                aria-hidden="true"
                                className={cn(
                                  'ml-auto shrink-0 text-brand-400 dark:text-brand-450 transition-transform duration-(--duration-fast) ease-(--ease-standard)',
                                  collapsed && '-rotate-90'
                                )}
                              />
                            </button>
                          </h3>
                        </div>
                        {/* Always mounted (hidden when collapsed) so the header
                            button's aria-controls never references an absent id
                            — exactly when aria-expanded="false" makes the
                            reference matter most. `hidden` removes the rows from
                            the a11y tree and from tab order, so collapsed
                            content stays genuinely unreachable. Mirrors the
                            "More options" disclosure in the drawer below. */}
                        <SurfaceList
                          id={contentId}
                          hidden={collapsed}
                          className="[&>*:first-child_.hairline-divider]:border-t-0"
                        >
                          {section.todos.map(renderTodoRow)}
                        </SurfaceList>
                      </section>
                    );
                  })}
                </div>
              ) : flatActive.length > 0 && (
                <SurfaceList
                  className={cn(
                    // SwipeActionRow wraps each Row, so the inner hairline of
                    // the first row needs suppressing too (as TodoSection did).
                    '[&>*:first-child_.hairline-divider]:border-t-0',
                    // Flush against the sticky add card — unless selection mode
                    // hid the add row, in which case the list stands alone.
                    !isSelectionMode && 'rounded-t-none border-t-0'
                  )}
                >
                  {flatActive.map(renderTodoRow)}
                </SurfaceList>
              )}
            </div>
            )}

            {/* The add row above is always visible in the flat list, so "add a
                task above" points straight at it (hidden with the list while
                the grid overlay is up). */}
            {!gridOverlayVisible && flatActive.length === 0 && (
                 <p className="px-1 text-sm text-brand-400 dark:text-brand-450 flex items-center gap-1.5">
                     <ClipboardList size={14} aria-hidden="true" />
                     All caught up — add a task above to get started.
                 </p>
            )}

            {/* "Saved for later" — below the active list, in the LIST
                arrangement only. It always renders (header + add bar) even when
                empty, so direct-add is always reachable. Hidden with the list
                while the immersive Eisenhower overlay is up, for the same reason
                the list is: the overlay covers the viewport, and rendering these
                rows underneath would double every parked task's controls. */}
            {!gridOverlayVisible && savedForLaterSection}

            {/* Immersive 2×2 Eisenhower grid — landscape-only overlay, shown
                automatically on rotation (see the gridActive edge logic). */}
            {gridOverlayVisible && (
              <EisenhowerGridView
                quadrants={quadrants}
                onComplete={completeToDo}
                onEdit={openEditModal}
                onToggleImportant={handleToggleImportant}
                onExit={exitGrid}
                escapeDisabled={drawerOpen}
              />
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
            {/* The two collapsed buckets take the deep-link target so a hit
                inside them opens its section instead of quietly finding no row
                to scroll to. */}
            <CompletedSection
                title="This week"
                items={completedWeek}
                defaultCollapsed
                highlightId={highlightId}
                onUncomplete={handleUncomplete}
                onDelete={deleteToDo}
                onDuplicate={handleDuplicate}
                memberMap={memberMap}
            />
            <CompletedSection
                title="Older"
                items={completedOlder}
                defaultCollapsed
                highlightId={highlightId}
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
        <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-0 right-0 px-4 flex justify-center z-dropdown pointer-events-none">
          <div className="bg-brand-900 dark:bg-brand-800 text-white p-2 rounded-card shadow-raised border border-brand-700 flex items-center gap-2 pointer-events-auto animate-in slide-in-from-bottom-4">
            <div className="px-3 font-semibold text-sm border-r border-brand-700 dark:border-brand-600">
              {selectedIds.size} selected
            </div>

            {/* "Saved for later": Complete and Reschedule are REMOVED (not
                merely disabled) the moment the selection includes a parked row —
                a parked item is not completable and has no real due date to
                reschedule, so offering either would be a control that lies. A
                disabled button would still read as "this applies here, just not
                right now". Delete stays, which is the whole permitted set for a
                parked row per the spec. */}
            {!selectionIncludesParked && (
              <>
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
              </>
            )}

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

      {/* "Saved for later": single-item triage. Confirm commits the promotion
          AND the classification as ONE write (promoteTodo); backing out calls
          nothing, leaving the item parked and untouched. */}
      <PromoteToDoSheet
        todo={promotingTodo}
        onClose={() => setPromotingTodo(null)}
      />

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
        /* Paper cut: Save must never be a scroll away. The Drawer's `footer`
           renders a fixed bar below the scrollable body — but OUTSIDE the
           <form>, so the button is associated back to it via form="task-form".
           Mirrors HabitFormModal's footer. */
        footer={
          <div className="bg-white dark:bg-brand-800 border-t border-brand-200 dark:border-brand-700 p-4">
            <Button
              type="submit"
              form="task-form"
              variant="primary"
              isLoading={isSaving}
              disabled={members.length === 0}
              className="w-full py-3.5"
            >
              {editingId ? 'Save changes' : 'Create task'}
            </Button>
          </div>
        }
      >
        <form id="task-form" onSubmit={handleSubmit} className="space-y-4">
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
              {assignedTo !== '' && assignedTo !== WHOLE_HOUSEHOLD_ASSIGNEE && !members.some(m => m.uid === assignedTo) && (
                <option value={assignedTo} disabled>Former member</option>
              )}
              <option value={WHOLE_HOUSEHOLD_ASSIGNEE}>Whole household</option>
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
          <div>
            <div className="flex flex-wrap items-center gap-2">
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

              {/* Auto-reschedule — only meaningful for a repeating task, so it
                  appears alongside Important once a cadence is chosen. Accent
                  (not warm) on-state so it never reads as a second "Important". */}
              {recurrence !== 'none' && (
                <button
                  type="button"
                  onClick={() => setResetWhenExpired(v => !v)}
                  aria-pressed={resetWhenExpired}
                  className={cn(
                    'inline-flex items-center gap-2 min-h-11 px-3 py-2 rounded-btn border text-sm font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                    'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
                    resetWhenExpired
                      ? 'bg-accent-50 border-accent-500/40 text-accent-700 dark:bg-accent-500/15 dark:border-accent-500/40 dark:text-accent-300'
                      : 'bg-white border-brand-200 text-brand-600 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:hover:bg-brand-700'
                  )}
                >
                  <RotateCcw
                    size={18}
                    aria-hidden="true"
                    className={resetWhenExpired ? 'text-accent-600 dark:text-accent-300' : 'text-brand-300 dark:text-brand-500'}
                  />
                  Auto-reschedule
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-brand-400 dark:text-brand-450">
              Matters to the family — big consequences if skipped.
            </p>
            {recurrence !== 'none' && (
              <p className="mt-1 text-xs text-brand-400 dark:text-brand-450">
                Not done by the due date? It moves to the next date instead of going overdue — and the steps reset.
              </p>
            )}
          </div>

          {/* F-TODO-16 — category. A CORE field (not behind "More options"):
              new tasks pre-select the last-used category, and a default the
              user can't see is a default they can't correct. Multi-select chips
              are the wrong control for a pick-one field per DESIGN.md §6, but
              this shared picker is single-select with an inline "+ Add" — the
              same control the capture tab uses, so the vocabulary is minted the
              same way everywhere. `allowClear`: tapping the selected chip
              clears it back to Uncategorized. */}
          <CategoryChipPicker
            label="Category"
            categories={todoCategories}
            value={category}
            onChange={setCategory}
            onAddCategory={handleAddCategory}
            allowClear
            disabled={isSaving}
          />

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
                {resetWhenExpired
                  ? 'A fresh copy is created each time you complete it — and if the due date passes first, this one moves to the next date.'
                  : 'A fresh copy is created each time you complete it. Turn on Auto-reschedule above to also move it forward when the due date passes.'}
              </p>
            )}
          </div>

          {/* Habit Automations (PRD #1065): "Counts toward habit" picker.
              Completing this to-do fires the chosen habit like one manual tap
              (points + streak). A pick-one field is a Select, per DESIGN.md. */}
          {(linkableHabits.length > 0 || archivedLinkedHabit) && (
            <div>
              <Select
                id="linked-habit-select"
                label="Counts toward habit"
                icon={<Sparkles size={18} />}
                value={linkedHabitId}
                onChange={(e) => setLinkedHabitId(e.target.value)}
              >
                <option value="">None</option>
                {linkableHabits.map(h => (
                  <option key={h.id} value={h.id}>{h.title}</option>
                ))}
                {archivedLinkedHabit && (
                  <option value={archivedLinkedHabit.id} disabled>
                    {archivedLinkedHabit.title} (archived)
                  </option>
                )}
              </Select>
              {linkedHabitId && (
                <p className="mt-1.5 text-xs text-brand-400 dark:text-brand-450">
                  Completing this task logs the habit for you.
                  {subtasks.length > 0 && ' Steps below must all be done first.'}
                </p>
              )}
            </div>
          )}

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
              <div className="flex items-center gap-1">
                <input
                  ref={subtaskImageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleSubtaskImage(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="ghost-brand"
                  size="icon"
                  onClick={() => subtaskImageInputRef.current?.click()}
                  isLoading={aiScanningSteps}
                  disabled={aiScanningSteps || aiBreakingDown}
                  aria-label="Scan steps from a photo"
                  title="Scan steps from a photo"
                  className="text-accent-600 dark:text-accent-300"
                >
                  {!aiScanningSteps && <Camera size={15} aria-hidden="true" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost-brand"
                  size="sm"
                  onClick={handleBreakDownWithAI}
                  isLoading={aiBreakingDown}
                  disabled={aiBreakingDown || aiScanningSteps || !text.trim()}
                  className="gap-1.5 text-accent-600 dark:text-accent-300"
                >
                  {!aiBreakingDown && <Sparkles size={15} aria-hidden="true" />}
                  Break down with AI
                </Button>
              </div>
            </div>

            {subtasks.length > 0 && (
              <Reorder.Group
                as="ul"
                axis="y"
                values={subtasks}
                onReorder={setSubtasks}
                className="space-y-1 mb-2"
                aria-label="Subtasks"
              >
                {subtasks.map(sub => (
                  <SubtaskEditorRow
                    key={sub.id}
                    sub={sub}
                    members={members}
                    isEditing={editingSubtaskId === sub.id}
                    editingText={editingSubtaskText}
                    onEditingTextChange={setEditingSubtaskText}
                    onStartEdit={() => handleStartEditSubtask(sub)}
                    onCommitEdit={handleCommitEditSubtask}
                    onCancelEdit={handleCancelEditSubtask}
                    onToggleDone={() => handleToggleSubtaskLocal(sub.id)}
                    onRemove={() => handleRemoveSubtaskLocal(sub.id)}
                    assigneePickerOpen={assigneePickerSubtaskId === sub.id}
                    onOpenAssigneePicker={() => setAssigneePickerSubtaskId(sub.id)}
                    onCloseAssigneePicker={() => setAssigneePickerSubtaskId(null)}
                    onPickAssignee={(uid) => handlePickSubtaskAssignee(sub.id, uid)}
                  />
                ))}
              </Reorder.Group>
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
                onPaste={handleSubtaskPaste}
                placeholder="Add a step — or paste a list"
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
                   }, 'task');
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

      <TodoCategoryManagerDrawer
        isOpen={isCategoryManagerOpen}
        onClose={() => setIsCategoryManagerOpen(false)}
      />

      <TodoTriageDrawer
        isOpen={isTriageOpen}
        onClose={() => setIsTriageOpen(false)}
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
        // Completed rows carry the deep-link target too: `searchTodos` returns
        // completed to-dos, so without this a completed hit would switch the
        // view and then silently fail to find anything to flash.
        <Row data-highlight-target={item.id} className="items-start">
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
                    }, 'task')}
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
const CompletedSection = React.memo(function CompletedSection({ title, items, onUncomplete, onDelete, onDuplicate, memberMap, defaultCollapsed = false, highlightId = null }: {
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
  /**
   * The active deep-link target. A collapsed `CollapsibleSection` does not
   * render its children at all, so a deep link into the "This week" / "Older"
   * buckets has to open this section or there is nothing to scroll to.
   */
  highlightId?: string | null;
}) {
    // Render-phase edge (the page's `wasSelectionMode` pattern): open once, on
    // the render a NEW highlight naming a row in this bucket arrives, then hand
    // control back to the user's own toggles — the section deliberately does not
    // re-collapse when the highlight fades.
    const [isOpen, setIsOpen] = useState(!defaultCollapsed);
    const [consumedHighlightId, setConsumedHighlightId] = useState<string | null>(null);
    if (highlightId !== consumedHighlightId) {
      setConsumedHighlightId(highlightId);
      if (highlightId && !isOpen && items.some(item => item.id === highlightId)) {
        setIsOpen(true);
      }
    }

    if (items.length === 0) return null;

    const rows = (
        <SurfaceList>
            {items.map(item => (
                <CompletedTodoRow
                    key={item.id}
                    item={item}
                    assignee={item.assignedTo ? memberMap.get(item.assignedTo) : undefined}
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
                <CollapsibleSection
                    title={title}
                    summary={items.length}
                    open={isOpen}
                    onOpenChange={setIsOpen}
                >
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
