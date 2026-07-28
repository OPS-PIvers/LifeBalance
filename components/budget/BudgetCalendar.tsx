
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useFinance, useTodos, useExpandedCalendarItems } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { format, isSameMonth, isSameDay, isToday, addMonths, subMonths, startOfWeek, addDays } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, Trash2, Edit2, Copy, CheckSquare, Download, MoreVertical, MoreHorizontal, Repeat, CalendarPlus, CalendarDays } from 'lucide-react';
import { CalendarItem } from '@/types/schema';
import { useCalendarGrid } from '@/hooks/useCalendarGrid';
import { parseRecurringId, isRecurringId } from '@/utils/calendarRecurrence';
import { generateCsvExport } from '@/utils/exportUtils';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import EmptyState from '@/components/ui/EmptyState';
import { SurfaceList, Row } from '@/components/ui/Section';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { cn } from '@/utils/cn';
import toast from 'react-hot-toast';
import { isTodoSubtasksIncompleteError } from '@/utils/todoSubtaskGate';
import { useSettleBill } from '@/hooks/useSettleBill';
import RecurringBillsModal from './RecurringBillsModal';
import TransactionLinkPicker from './TransactionLinkPicker';
import AccountPicker from './AccountPicker';

/** localStorage key remembering the user's Day/Month view choice (per-device). */
const VIEW_MODE_KEY = 'lifebalance:budgetCalendar:viewMode';
type CalendarViewMode = 'day' | 'month';

// Scrollable day-strip range, in weeks either side of the current week (matches
// the Meals day strip). The strip is one continuous run of days — navigation is
// a free horizontal scroll; these bounds just cap how far it extends.
const STRIP_WEEKS_BACK = 8;
const STRIP_WEEKS_FORWARD = 12;

const BudgetCalendar: React.FC = () => {
  const { calendarItems, addCalendarItem, updateCalendarItem, deleteCalendarItem, accounts } = useFinance();
  const { todos, completeToDo } = useTodos();
  const fmt = useFormatCurrency();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Selecting a day anchors BOTH states: the agenda follows `selectedDate`, and
  // `currentDate` (which month grid is shown) tracks it so switching Day→Month
  // lands on the month you were browsing.
  const handleSelectDate = (day: Date) => {
    setSelectedDate(day);
    setCurrentDate(day);
  };

  // Day/Month view toggle. Defaults to MONTH (the full grid is the landing);
  // the choice is remembered across visits via localStorage.
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => {
    if (typeof window === 'undefined') return 'month';
    return window.localStorage.getItem(VIEW_MODE_KEY) === 'day' ? 'day' : 'month';
  });
  const changeViewMode = (mode: CalendarViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // localStorage unavailable (private browsing) — in-memory state still works
    }
  };

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CalendarItem | null>(null);
  /**
   * The OCCURRENCE the Edit drawer was opened from — carried separately from
   * `editingItem` on purpose.
   *
   * `openEditModal` deliberately swaps a recurring INSTANCE for its TEMPLATE (so
   * an edit changes the series), which discards the occurrence date and leaves
   * `editingItem.id` holding a REAL template doc id. Feeding that id to
   * `settleBillWithTransaction` would take its one-off branch and permanently
   * rewrite the template's amount — changing every future occurrence's budgeted
   * figure, and therefore Safe-to-Spend — while suppressing nothing, so the bill
   * would still show unpaid. This holds the synthetic
   * `templateId_instance_yyyy-MM-dd` id (or a genuine one-off's own id) plus its
   * date; `null` hides the settle affordance entirely.
   */
  const [settleTarget, setSettleTarget] = useState<{ id: string; date: string; title: string } | null>(null);
  const [activeActionItem, setActiveActionItem] = useState<CalendarItem | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Form State
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [date, setDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<'monthly' | 'bi-weekly' | 'weekly'>('monthly');
  const [isSubscription, setIsSubscription] = useState(false);

  // TODO.md 2H(a): "this bill IS that charge", from the calendar side. Closes
  // the Edit drawer once the merge actually commits.
  const {
    begin: beginSettle,
    busy: isSettling,
    needsAccount: settleNeedsAccount,
    confirmAccount: confirmSettleAccount,
    cancel: cancelSettle,
  } = useSettleBill(() => setIsAddModalOpen(false));

  const { monthStart, startDate, endDate, days } = useCalendarGrid(currentDate);

  const weekDays: { abbr: string; full: string }[] = [
    { abbr: 'S', full: 'Sunday' },
    { abbr: 'M', full: 'Monday' },
    { abbr: 'T', full: 'Tuesday' },
    { abbr: 'W', full: 'Wednesday' },
    { abbr: 'T', full: 'Thursday' },
    { abbr: 'F', full: 'Friday' },
    { abbr: 'S', full: 'Saturday' },
  ];

  // Continuous day strip (Day view) — one pre-formatted run of days anchored to
  // the current week. The strip render never calls `format`.
  const stripDays = useMemo(() => {
    const rangeStart = addDays(startOfWeek(new Date()), -7 * STRIP_WEEKS_BACK);
    return Array.from({ length: 7 * (STRIP_WEEKS_BACK + STRIP_WEEKS_FORWARD + 1) }, (_, i) => {
      const day = addDays(rangeStart, i);
      return {
        date: day,
        dateStr: format(day, 'yyyy-MM-dd'),
        dayLetter: format(day, 'EEEEE'),
        dayNumber: format(day, 'd'),
        ariaLabel: format(day, 'EEEE, MMMM d'),
      };
    });
  }, []);

  // Expand recurring items over a range covering BOTH the day strip and the
  // visible month grid, so dots/agenda are populated in either view. The strip
  // bounds are fixed; the grid bounds move with `currentDate` (month nav).
  const { expandStart, expandEnd } = useMemo(() => {
    const stripStart = stripDays[0]?.date ?? startDate;
    const stripEnd = stripDays[stripDays.length - 1]?.date ?? endDate;
    return {
      expandStart: stripStart.getTime() < startDate.getTime() ? stripStart : startDate,
      expandEnd: stripEnd.getTime() > endDate.getTime() ? stripEnd : endDate,
    };
  }, [stripDays, startDate, endDate]);

  // Shared window-keyed expansion memo (keyed on the bounds' timestamps, not
  // Date object identity) — selecting a day recreates `currentDate` and thus
  // fresh Date bounds for the SAME window, which previously re-ran the whole
  // expansion; the shared hook reuses the prior result for identical windows.
  const expandedCalendarItems = useExpandedCalendarItems(expandStart, expandEnd);

  // Pre-group calendar items by date string for O(1) day-cell lookup
  const calendarItemsByDate = useMemo(() => {
    const map = new Map<string, typeof expandedCalendarItems>();
    for (const item of expandedCalendarItems) {
      const key = item.date; // already 'yyyy-MM-dd'
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      list.push(item);
    }
    return map;
  }, [expandedCalendarItems]);

  // Pre-group pending todos by date string for O(1) day-cell lookup
  const pendingTodosByDate = useMemo(() => {
    const map = new Map<string, typeof todos>();
    for (const todo of todos) {
      if (todo.isCompleted) continue;
      const key = todo.completeByDate; // already 'yyyy-MM-dd'
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      list.push(todo);
    }
    return map;
  }, [todos]);

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // Filter items for the selected date (O(1) lookup)
  const selectedDateKey = format(selectedDate, 'yyyy-MM-dd');
  const selectedItems = useMemo(
    () => calendarItemsByDate.get(selectedDateKey) ?? [],
    [calendarItemsByDate, selectedDateKey]
  );

  // Filter todos for the selected date (O(1) lookup)
  const selectedTodos = useMemo(
    () => pendingTodosByDate.get(selectedDateKey) ?? [],
    [pendingTodosByDate, selectedDateKey]
  );

  // --- Day-strip scroll mechanics (mirrors MealPlanTab) ---------------------
  const stripRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);

  const scrollStripTo = useCallback((dateStr: string) => {
    const container = stripRef.current;
    const chip = container?.querySelector<HTMLElement>(`[data-date="${dateStr}"]`);
    if (!container || !chip) return;
    const left = chip.offsetLeft - (container.clientWidth - chip.offsetWidth) / 2;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ left, behavior: didInitialScrollRef.current ? 'smooth' : 'auto' });
    } else {
      // jsdom (tests) has no Element.scrollTo
      container.scrollLeft = left;
    }
    didInitialScrollRef.current = true;
  }, []);

  // Center the selected chip whenever it changes or we (re-)enter Day view.
  useEffect(() => {
    if (viewMode === 'day') scrollStripTo(selectedDateKey);
  }, [viewMode, selectedDateKey, scrollStripTo]);

  // Month label above the strip follows the center of the viewport as the user
  // scrolls. Reads are batched into one rAF per frame.
  const [visibleMonth, setVisibleMonth] = useState(() => format(new Date(), 'MMMM yyyy'));
  const scrollRafRef = useRef(0);
  const handleStripScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const container = stripRef.current;
      if (!container) return;
      const first = container.children[0] as HTMLElement | undefined;
      const second = container.children[1] as HTMLElement | undefined;
      if (!first || !second) return;
      const stride = second.offsetLeft - first.offsetLeft;
      if (stride <= 0) return;
      const rawIdx = Math.round((container.scrollLeft + container.clientWidth / 2 - first.offsetLeft) / stride);
      const day = stripDays[Math.min(stripDays.length - 1, Math.max(0, rawIdx))];
      if (day) setVisibleMonth(format(day.date, 'MMMM yyyy'));
    });
  }, [stripDays]);
  useEffect(() => () => cancelAnimationFrame(scrollRafRef.current), []);

  const handleJumpToToday = useCallback(() => {
    if (selectedDateKey !== todayStr) handleSelectDate(new Date());
    // Re-center explicitly — when today is already selected the centering
    // effect won't re-run because selectedDateKey is unchanged.
    scrollStripTo(todayStr);
  }, [scrollStripTo, selectedDateKey, todayStr]);

  const openAddModal = () => {
    setTitle('');
    setAmount('');
    setType('expense');
    setDate(format(selectedDate, 'yyyy-MM-dd'));
    setAccountId('');
    setIsRecurring(false);
    setFrequency('monthly');
    setIsSubscription(false);
    setEditingItem(null);
    setSettleTarget(null);
    setIsAddModalOpen(true);
  };

  // Helper to check if an item is a generated recurring instance (vs. the original)
  const isInstance = (item: CalendarItem): boolean => {
    return item.isRecurring === true && isRecurringId(item.id);
  };

  // Helper to find the original calendar item for a recurring instance
  const findOriginalItem = (instanceId: string): CalendarItem | undefined => {
    const parsed = parseRecurringId(instanceId);
    if (!parsed) return undefined;
    return calendarItems.find(item => item.id === parsed.templateId);
  };

  const openEditModal = (item: CalendarItem) => {
    // Capture the OCCURRENCE first — BEFORE the template swap below throws it
    // away. Only an UNPAID EXPENSE can be settled, and only when the id we hold
    // is safe to pass to the mutation: a synthetic occurrence id, or a genuine
    // one-off. A recurring TEMPLATE opened directly (real doc id + isRecurring)
    // is deliberately excluded — settling it would rewrite the series' budgeted
    // amount instead of marking one month paid.
    const settleable =
      item.type === 'expense' &&
      !item.isPaid &&
      (isRecurringId(item.id) || !item.isRecurring);
    setSettleTarget(settleable ? { id: item.id, date: item.date, title: item.title } : null);

    // If this is a recurring instance, edit the original item instead
    if (isInstance(item)) {
      const originalItem = findOriginalItem(item.id);
      if (!originalItem) {
        toast.error('Cannot edit this recurring instance. The original template may have been deleted.');
        return;
      }
      setTitle(originalItem.title);
      setAmount(originalItem.amount.toString());
      setType(originalItem.type);
      setDate(originalItem.date);
      setAccountId(originalItem.accountId || '');
      setIsRecurring(!!originalItem.isRecurring);
      setFrequency(originalItem.frequency || 'monthly');
      setIsSubscription(!!originalItem.isSubscription);
      setEditingItem(originalItem);
    } else {
      setTitle(item.title);
      setAmount(item.amount.toString());
      setType(item.type);
      setDate(item.date);
      setAccountId(item.accountId || '');
      setIsRecurring(!!item.isRecurring);
      setFrequency(item.frequency || 'monthly');
      setIsSubscription(!!item.isSubscription);
      setEditingItem(item);
    }
    setIsAddModalOpen(true);
  };

  const handleSave = async () => {
    if (!title || !amount || !date) return;

    const newItem: CalendarItem = {
      id: editingItem ? editingItem.id : crypto.randomUUID(),
      title,
      amount: parseFloat(amount),
      date: date,
      type,
      isPaid: editingItem ? editingItem.isPaid : false,
      isRecurring,
      frequency: isRecurring ? frequency : undefined,
      isSubscription: type === 'expense' && isSubscription ? true : undefined,
      accountId: accountId || undefined
    };

    try {
      if (editingItem) {
        await updateCalendarItem(newItem);
      } else {
        await addCalendarItem(newItem);
      }
      setIsAddModalOpen(false);
    } catch (error) {
      console.error("Failed to save calendar item:", error);
      toast.error("Failed to save event");
    }
  };

  // Duplicate pre-fills the Add form from the currently-edited item — title,
  // amount, type, account — and leaves date/recurrence for the user to review
  // before submitting (F-MONEY-12). It does NOT auto-save: `editingItem` is
  // cleared so pressing "Add Event" creates a new item via the normal
  // `addCalendarItem` path in `handleSave`, rather than a second writeBatch
  // path here. Recurrence is intentionally stripped so a duplicate doesn't
  // silently spin up a second overlapping recurring template.
  const handleDuplicate = () => {
    if (!title || !amount || !date) return;

    setEditingItem(null);
    setIsRecurring(false);
    setFrequency('monthly');
    toast.success('Review the duplicate, then tap Add Event');
  };

  const handleExport = () => {
    try {
      if (expandedCalendarItems.length === 0) {
        toast.error('No events to export for this month');
        return;
      }

      const exportData = expandedCalendarItems.map(item => ({
        Date: item.date,
        Title: item.title,
        Amount: item.amount,
        Type: item.type,
        Status: item.isPaid ? 'Paid' : 'Unpaid',
        Recurring: item.isRecurring ? 'Yes' : 'No',
        Frequency: item.frequency || 'N/A'
      }));

      // Sort by date
      exportData.sort((a, b) => a.Date.localeCompare(b.Date));

      generateCsvExport(exportData, `budget-calendar-${format(currentDate, 'yyyy-MM')}`);
      toast.success('Export started');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export calendar');
    }
  };

  const calendarMenuItems: MenuItem[] = [
    {
      key: 'manage-recurring',
      label: 'Manage recurring bills',
      icon: <Repeat size={16} />,
      onSelect: () => setIsRecurringModalOpen(true),
    },
    {
      key: 'export',
      label: 'Export month to CSV',
      icon: <Download size={16} />,
      onSelect: handleExport,
    },
  ];

  const isMonth = viewMode === 'month';

  return (
    <div className="space-y-4 animate-in fade-in duration-(--duration-base)">
      {/* Calendar surface — leads the page (calendar first, the selected day's
          agenda below), in both Day and Month views. */}
      <div className="surface-section p-4">
        {/* Header: month label (with prev/next arrows in Month view) on the
            left; Today (Day view) + Day/Month toggle + overflow on the right. */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-0.5 min-w-0">
            {isMonth && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCurrentDate(subMonths(currentDate, 1))}
                className="text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 rounded-btn shrink-0"
                aria-label="Previous month"
              >
                <ChevronLeft size={20} />
              </Button>
            )}
            <h2 className="font-display font-semibold text-base text-brand-900 dark:text-brand-100 tracking-tight truncate">
              {isMonth ? format(currentDate, 'MMMM yyyy') : visibleMonth}
            </h2>
            {isMonth && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCurrentDate(addMonths(currentDate, 1))}
                className="text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 rounded-btn shrink-0"
                aria-label="Next month"
              >
                <ChevronRight size={20} />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {!isMonth && selectedDateKey !== todayStr && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleJumpToToday}
                className="text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 rounded-btn"
                aria-label="Jump to today"
                title="Today"
              >
                <CalendarDays size={18} />
              </Button>
            )}
            <SegmentedControl<CalendarViewMode>
              value={viewMode}
              onChange={changeViewMode}
              name="Calendar view"
              size="sm"
              showBorder={false}
              className="w-[136px]"
              options={[
                { value: 'day', label: 'Day' },
                { value: 'month', label: 'Month' },
              ]}
            />
            <div className="relative">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsMenuOpen(v => !v)}
                className="text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 rounded-btn"
                aria-label="More calendar actions"
                aria-haspopup="menu"
                aria-expanded={isMenuOpen}
              >
                <MoreHorizontal size={20} />
              </Button>
              <Menu
                isOpen={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                items={calendarMenuItems}
                ariaLabel="Calendar actions"
                position="top-10 right-0"
                className="min-w-[208px]"
              />
            </div>
          </div>
        </div>

        {isMonth ? (
          <div id="budget-calendar-month-grid">
            {/* Weekday labels */}
            <div className="grid grid-cols-7 mb-3" role="row">
              {weekDays.map((d, i) => (
                <div key={`${d.full}-${i}`} role="columnheader" className="text-center text-xs font-semibold text-brand-400 dark:text-brand-450 py-2">
                  <abbr title={d.full} className="no-underline">{d.abbr}</abbr>
                </div>
              ))}
            </div>
            {/* Full month grid */}
            <div className="grid grid-cols-7 gap-y-2">
              {days.map(day => {
                const dayKey = format(day, 'yyyy-MM-dd');
                const dateItems = calendarItemsByDate.get(dayKey) ?? [];
                const hasIncome = dateItems.some(i => i.type === 'income');
                const hasExpense = dateItems.some(i => i.type === 'expense');
                const hasTodo = (pendingTodosByDate.get(dayKey)?.length ?? 0) > 0;
                const isSelected = isSameDay(day, selectedDate);

                const eventParts: string[] = [];
                if (hasIncome) eventParts.push('income');
                if (hasExpense) eventParts.push('expense');
                if (hasTodo) eventParts.push('tasks');
                const ariaLabel = eventParts.length > 0
                  ? `${format(day, 'MMMM d, yyyy')}, has ${eventParts.join(', ')}`
                  : format(day, 'MMMM d, yyyy');

                return (
                  <div
                    key={day.toString()}
                    role="button"
                    tabIndex={0}
                    aria-label={ariaLabel}
                    aria-pressed={isSelected}
                    onClick={() => handleSelectDate(day)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectDate(day);
                      }
                    }}
                    className={`
                      relative flex flex-col items-center justify-center h-10 w-10 mx-auto rounded-card text-sm font-medium cursor-pointer transition-[background-color,color,transform] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40
                      ${!isSameMonth(day, monthStart) ? 'text-brand-300 dark:text-brand-500' : 'text-brand-600 dark:text-brand-300'}
                      ${isSelected ? 'bg-accent-600 dark:bg-accent-600 text-white scale-105 ring-2 ring-accent-600 ring-offset-2 ring-offset-white dark:ring-offset-brand-800' : 'hover:bg-brand-100 dark:hover:bg-brand-700/50'}
                      ${isToday(day) && !isSelected ? 'text-accent-700 dark:text-accent-300 font-bold bg-brand-100 dark:bg-brand-700/50' : ''}
                    `}
                  >
                    {format(day, 'd')}

                    {/* Dots */}
                    <div className="absolute bottom-1 flex gap-0.5">
                      {hasIncome && <div className="w-1 h-1 rounded-full bg-money-pos"></div>}
                      {hasExpense && <div className="w-1 h-1 rounded-full bg-money-neg"></div>}
                      {hasTodo && <div className="w-1 h-1 rounded-full bg-habit-blue"></div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Day view — one continuous scrollable run of days */
          <div
            ref={stripRef}
            onScroll={handleStripScroll}
            className="relative flex gap-1 overflow-x-auto no-scrollbar snap-x"
          >
            {stripDays.map(day => {
              const { dateStr } = day;
              const dateItems = calendarItemsByDate.get(dateStr) ?? [];
              const hasIncome = dateItems.some(i => i.type === 'income');
              const hasExpense = dateItems.some(i => i.type === 'expense');
              const hasTodo = (pendingTodosByDate.get(dateStr)?.length ?? 0) > 0;
              const isSelected = dateStr === selectedDateKey;
              const isTodayChip = dateStr === todayStr;

              const eventParts: string[] = [];
              if (hasIncome) eventParts.push('income');
              if (hasExpense) eventParts.push('expense');
              if (hasTodo) eventParts.push('tasks');
              const ariaLabel = eventParts.length > 0
                ? `${day.ariaLabel}, has ${eventParts.join(', ')}`
                : day.ariaLabel;

              return (
                <button
                  type="button"
                  key={dateStr}
                  data-date={dateStr}
                  aria-label={ariaLabel}
                  aria-pressed={isSelected}
                  onClick={() => handleSelectDate(day.date)}
                  className={cn(
                    'w-12 shrink-0 snap-center flex flex-col items-center justify-center gap-0.5 rounded-card py-2 text-sm font-medium transition-[background-color,color] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
                    isSelected
                      ? 'bg-accent-600 dark:bg-accent-600 text-white'
                      : 'hover:bg-brand-100 dark:hover:bg-brand-700/50 text-brand-600 dark:text-brand-300',
                    isTodayChip && !isSelected && 'text-accent-700 dark:text-accent-300 font-bold bg-brand-100 dark:bg-brand-700/50'
                  )}
                >
                  <span className="text-xxs uppercase tracking-wide opacity-70">{day.dayLetter}</span>
                  <span>{day.dayNumber}</span>
                  <div className="flex gap-0.5 h-1">
                    {hasIncome && <div className="w-1 h-1 rounded-full bg-money-pos"></div>}
                    {hasExpense && <div className="w-1 h-1 rounded-full bg-money-neg"></div>}
                    {hasTodo && <div className="w-1 h-1 rounded-full bg-habit-blue"></div>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected-day agenda — the day's bills/tasks, below the calendar. */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="font-display font-semibold text-brand-900 dark:text-brand-100 text-lg tracking-tight">
            {format(selectedDate, 'MMMM d')}
          </h3>
          <Button
            variant="primary"
            size="sm"
            onClick={openAddModal}
            leftIcon={<Plus size={16} />}
          >
            Add Event
          </Button>
        </div>

        {selectedItems.length === 0 && selectedTodos.length === 0 ? (
          <EmptyState
            variant="surface"
            size="compact"
            icon={<CalendarPlus size={20} />}
            title="Nothing scheduled"
            description="No events or tasks on this day."
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={openAddModal}
                leftIcon={<Plus size={16} />}
              >
                Create Event
              </Button>
            }
          />
        ) : (
          <SurfaceList>
            {/* ToDos Section */}
            {selectedTodos.map(todo => (
              <Row key={todo.id} className="justify-between group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-card flex items-center justify-center font-bold text-lg bg-habit-blue/15 text-habit-blue shrink-0">
                    <CheckSquare size={20} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm truncate">{todo.text}</p>
                    <p className="text-xs text-brand-500 dark:text-brand-400">
                      Task
                    </p>
                  </div>
                </div>

                <div className="flex items-center shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await completeToDo(todo.id);
                        toast.success('Task completed!');
                      } catch (error) {
                        // A habit-linked to-do with unfinished subtasks is
                        // REFUSED by the mutation (PRD #1065), not a failure —
                        // surface the remaining step count instead.
                        if (isTodoSubtasksIncompleteError(error)) {
                          toast(`${error.stepsLeft} step${error.stepsLeft === 1 ? '' : 's'} left on “${error.title}”`);
                          return;
                        }
                        console.error('Failed to complete task:', error);
                        toast.error('Failed to complete task');
                      }
                    }}
                    className="bg-habit-blue/15 text-habit-blue hover:bg-habit-blue/25 text-xs py-1.5 rounded-btn"
                  >
                    Complete
                  </Button>
                </div>
              </Row>
            ))}

            {/* Financial Items Section */}
            {selectedItems.map(item => (
              <Row key={item.id} className="justify-between group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-card flex items-center justify-center font-bold text-lg shrink-0 ${
                    item.type === 'income' ? 'bg-money-bgPos dark:bg-money-pos/15 text-money-pos dark:text-money-posDark' : 'bg-money-bgNeg dark:bg-money-neg/15 text-money-neg dark:text-money-negDark'
                  }`}>
                    {item.type === 'income' ? '+' : '-'}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm truncate">{item.title}</p>
                    <p className={`text-xs ${item.isPaid ? 'text-money-pos dark:text-money-posDark' : 'text-brand-500 dark:text-brand-400'}`}>
                      {item.isPaid ? 'Paid' : 'Unpaid'} {item.isRecurring && '• Recurring'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="font-mono tabular-nums font-bold text-brand-900 dark:text-brand-100">
                    {fmt(item.amount)}
                  </span>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    {/* Edit/Delete (Desktop) */}
                    <div className="hidden md:flex items-center gap-1">
                      {!item.isPaid && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEditModal(item)}
                          className="text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300"
                          aria-label={`Edit ${item.title}`}
                        >
                          <Edit2 size={14} />
                        </Button>
                      )}
                      <Button
                        variant="ghost-destructive"
                        size="icon-sm"
                        onClick={() => deleteCalendarItem(item.id)}
                        className="text-brand-400 dark:text-brand-450 hover:text-money-neg dark:hover:text-money-negDark"
                        aria-label={`Delete ${item.title}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>

                    {/* Mobile Actions */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="md:hidden text-brand-400 dark:text-brand-450"
                      onClick={() => setActiveActionItem(item)}
                      aria-label={`More actions for ${item.title}`}
                    >
                      <MoreVertical size={16} />
                    </Button>
                  </div>
                </div>
              </Row>
            ))}
          </SurfaceList>
        )}
      </div>

      {/* Mobile Actions Drawer */}
      <Drawer
        isOpen={!!activeActionItem}
        onClose={() => setActiveActionItem(null)}
        title={activeActionItem?.title}
      >
        <div className="space-y-3 pb-6">
          {!activeActionItem?.isPaid && (
            <Button
              variant="secondary"
              className="w-full h-14 justify-start px-4 text-base"
              leftIcon={<Edit2 size={20} />}
              onClick={() => {
                if (activeActionItem) {
                  openEditModal(activeActionItem);
                  setActiveActionItem(null);
                }
              }}
            >
              Edit Event
            </Button>
          )}

          <Button
            variant="ghost-destructive"
            className="w-full h-14 justify-start px-4 text-base bg-money-bgNeg dark:bg-money-neg/15"
            leftIcon={<Trash2 size={20} />}
            onClick={() => {
              if (activeActionItem) {
                deleteCalendarItem(activeActionItem.id);
                setActiveActionItem(null);
              }
            }}
          >
            Delete Event
          </Button>

          <Button
            variant="ghost"
            className="w-full h-14"
            onClick={() => setActiveActionItem(null)}
          >
            Cancel
          </Button>
        </div>
      </Drawer>

      {/* Add/Edit Calendar Item Drawer */}
      <Drawer
        isOpen={isAddModalOpen}
        // `cancelSettle` too: the settle flow's AccountPicker is a SIBLING
        // sheet, so dismissing this drawer while it awaits an account would
        // otherwise leave it floating with nothing behind it. A no-op when
        // nothing is pending.
        onClose={() => { setIsAddModalOpen(false); cancelSettle(); }}
        title={editingItem ? 'Edit Event' : 'Add Calendar Item'}
        footer={
          <div className="flex gap-2 border-t border-brand-200 dark:border-brand-700 p-4">
            {editingItem && (
              <Button
                variant="secondary"
                onClick={handleDuplicate}
                className="flex-1 py-3 h-auto"
              >
                <Copy size={18} />
                Duplicate
              </Button>
            )}
            <Button
              variant="primary"
              onClick={handleSave}
              className="flex-1 py-3 h-auto"
            >
              {editingItem ? 'Save Changes' : 'Add Event'}
            </Button>
          </div>
        }
      >
          <div className="space-y-4">
             {/* Type Toggle */}
             <SegmentedControl
               value={type}
               onChange={(val) => setType(val as 'income' | 'expense')}
               name="Transaction Type"
               options={[
                 { value: 'expense', label: 'Expense', activeClassName: 'text-money-neg dark:text-money-negDark' },
                 { value: 'income', label: 'Income', activeClassName: 'text-money-pos dark:text-money-posDark' },
               ]}
               className="mb-4"
               showBorder={false}
             />

             <Input
               label="Title"
               type="text"
               placeholder="Title (e.g. Rent)"
               value={title}
               onChange={e => setTitle(e.target.value)}
             />

             <Input
               label="Amount"
               type="number"
               placeholder="Amount"
               value={amount}
               onChange={e => setAmount(e.target.value)}
               className="font-mono"
             />

             <Input
               label="Date"
               type="date"
               value={date}
               onChange={e => setDate(e.target.value)}
               className="font-medium"
             />

             <Select
               label="Account (Optional)"
               value={accountId}
               onChange={(e) => setAccountId(e.target.value)}
             >
               <option value="">(None)</option>
               {accounts.map(a => (
                 <option key={a.id} value={a.id}>{a.name}</option>
               ))}
             </Select>

             <div className="flex items-center justify-between">
               <label id="recurring-label" className="text-sm font-semibold text-brand-700 dark:text-brand-200">Recurring?</label>
               <Switch
                 checked={isRecurring}
                 onCheckedChange={setIsRecurring}
                 aria-label="Recurring?"
               />
             </div>

             {isRecurring && (
               <Select
                 label="Frequency"
                 value={frequency}
                 onChange={(e) => setFrequency(e.target.value as 'monthly' | 'bi-weekly' | 'weekly')}
               >
                 <option value="monthly">Monthly</option>
                 <option value="bi-weekly">Bi-Weekly</option>
                 <option value="weekly">Weekly</option>
               </Select>
             )}

             {type === 'expense' && (
               <div className="flex items-center justify-between">
                 <div className="min-w-0 pr-3">
                   <label className="text-sm font-semibold text-brand-700 dark:text-brand-200">Subscription?</label>
                   <p className="text-xs text-brand-450 dark:text-brand-400">
                     Groups this bill under Subscriptions on the Money tab.
                   </p>
                 </div>
                 <Switch
                   checked={isSubscription}
                   onCheckedChange={setIsSubscription}
                   aria-label="Subscription?"
                 />
               </div>
             )}

             {/* TODO.md 2E/2H(a): the bill↔transaction link, from the CALENDAR
                 side. Picking a transaction marks THIS occurrence paid at the
                 charged amount and files that existing row as the payment — no
                 second transaction, and the recurring template's own amount is
                 never touched. `settleTarget` (not `editingItem.id`) carries the
                 occurrence — see its declaration for why that distinction is
                 load-bearing. */}
             {editingItem && settleTarget && type === 'expense' && (
               <div className="pt-3 border-t border-brand-200 dark:border-brand-700">
                 <TransactionLinkPicker
                   anchorDate={settleTarget.date}
                   busy={isSettling}
                   helperText={`Already paid ${settleTarget.title}? Link the charge that paid it instead of recording it twice.`}
                   onSelect={(transactionId) =>
                     beginSettle({ transactionId, calendarItemId: settleTarget.id })
                   }
                 />
               </div>
             )}
          </div>
      </Drawer>

      {/* Settling moves real money out of an account. When the picked
          transaction carries no account tag, confirm which one rather than
          guessing (see useSettleBill). */}
      <AccountPicker
        isOpen={settleNeedsAccount}
        onClose={cancelSettle}
        onSelect={confirmSettleAccount}
        title="Which account paid this?"
        description="Marking this bill paid moves the charge out of an account. Pick the one it came from."
      />

      <RecurringBillsModal
        isOpen={isRecurringModalOpen}
        onClose={() => setIsRecurringModalOpen(false)}
      />
    </div>
  );
};

export default BudgetCalendar;
