
import React, { useState, useMemo } from 'react';
import { useFinance, useTodos } from '@/contexts/FirebaseHouseholdContext';
import { format, isSameMonth, isSameDay, isToday, addMonths, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, CheckCircle2, Circle, Trash2, Edit2, X, Copy, CheckSquare, Download, MoreVertical, Repeat, CalendarPlus } from 'lucide-react';
import { CalendarItem } from '@/types/schema';
import { useCalendarGrid } from '@/hooks/useCalendarGrid';
import { expandCalendarItems, parseRecurringId, isRecurringId } from '@/utils/calendarRecurrence';
import { generateCsvExport } from '@/utils/exportUtils';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import toast from 'react-hot-toast';
import RecurringBillsModal from './RecurringBillsModal';

const BudgetCalendar: React.FC = () => {
  const { calendarItems, addCalendarItem, updateCalendarItem, deleteCalendarItem, accounts } = useFinance();
  const { todos, completeToDo } = useTodos();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CalendarItem | null>(null);
  const [activeActionItem, setActiveActionItem] = useState<CalendarItem | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [date, setDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<'monthly' | 'bi-weekly' | 'weekly'>('monthly');

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

  // Expand recurring calendar items for the visible date range
  const expandedCalendarItems = useMemo(
    () => expandCalendarItems(calendarItems, startDate, endDate),
    [calendarItems, startDate, endDate]
  );

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

  const openAddModal = () => {
    setTitle('');
    setAmount('');
    setType('expense');
    setDate(format(selectedDate, 'yyyy-MM-dd'));
    setAccountId('');
    setIsRecurring(false);
    setFrequency('monthly');
    setEditingItem(null);
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
      setEditingItem(originalItem);
    } else {
      setTitle(item.title);
      setAmount(item.amount.toString());
      setType(item.type);
      setDate(item.date);
      setAccountId(item.accountId || '');
      setIsRecurring(!!item.isRecurring);
      setFrequency(item.frequency || 'monthly');
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

  const handleDuplicate = () => {
    if (!title || !amount || !date) return;

    const newItem: CalendarItem = {
      id: crypto.randomUUID(),
      title: `${title} (Copy)`,
      amount: parseFloat(amount),
      date: date,
      type,
      isPaid: false, // Reset status for duplicate
      isRecurring,
      frequency: isRecurring ? frequency : undefined,
      accountId: accountId || undefined
    };

    addCalendarItem(newItem);
    toast.success('Event duplicated');
    setIsAddModalOpen(false);
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

  return (
    <div className="space-y-6">
      {/* Calendar Card */}
      <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl rounded-3xl shadow-glass ring-1 ring-black/5 p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-bold text-xl text-slate-900 dark:text-slate-100 tracking-tight">
            {format(currentDate, 'MMMM yyyy')}
          </h2>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsRecurringModalOpen(true)}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 rounded-xl"
              title="Manage Recurring Bills"
              aria-label="Manage Recurring Bills"
            >
              <Repeat size={20} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleExport}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 mr-2 rounded-xl"
              title="Export this month to CSV"
              aria-label="Export this month to CSV"
            >
              <Download size={20} />
            </Button>
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 my-auto mx-1" />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCurrentDate(subMonths(currentDate, 1))}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 rounded-xl"
              aria-label="Previous month"
            >
              <ChevronLeft size={20} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCurrentDate(addMonths(currentDate, 1))}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 rounded-xl"
              aria-label="Next month"
            >
              <ChevronRight size={20} />
            </Button>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 mb-4">
          {weekDays.map((d, i) => (
            <div key={`${d.full}-${i}`} className="text-center text-xs font-bold text-slate-400 dark:text-slate-500 py-2">
              <abbr title={d.full} className="no-underline">{d.abbr}</abbr>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-3">
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
                onClick={() => setSelectedDate(day)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedDate(day);
                  }
                }}
                className={`
                  relative flex flex-col items-center justify-center h-10 w-10 mx-auto rounded-2xl text-sm font-medium cursor-pointer transition-all duration-200
                  ${!isSameMonth(day, monthStart) ? 'text-slate-300 dark:text-slate-600' : 'text-slate-600 dark:text-slate-300'}
                  ${isSelected ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-lg scale-110 ring-2 ring-slate-900 dark:ring-slate-100 ring-offset-2 ring-offset-white dark:ring-offset-slate-800' : 'hover:bg-white dark:hover:bg-slate-700/50 hover:shadow-sm'}
                  ${isToday(day) && !isSelected ? 'text-slate-900 dark:text-slate-100 font-bold bg-white dark:bg-slate-700/50 shadow-sm' : ''}
                `}
              >
                {format(day, 'd')}

                {/* Dots */}
                <div className="absolute bottom-1.5 flex gap-0.5">
                  {hasIncome && <div className="w-1 h-1 rounded-full bg-emerald-400"></div>}
                  {hasExpense && <div className="w-1 h-1 rounded-full bg-rose-400"></div>}
                  {hasTodo && <div className="w-1 h-1 rounded-full bg-blue-400"></div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail List */}
      <div>
        <div className="flex items-center justify-between mb-4 px-2">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-lg tracking-tight">
            {format(selectedDate, 'MMMM d')}
          </h3>
          <Button
            variant="subtle"
            size="sm"
            onClick={openAddModal}
            className="text-xs py-1.5 rounded-xl bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
          >
            Add Event <Plus size={14} />
          </Button>
        </div>

        {selectedItems.length === 0 && selectedTodos.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-12 px-6 bg-slate-50/50 dark:bg-slate-800/60 rounded-3xl">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center mb-4">
              <CalendarPlus size={28} className="text-slate-400 dark:text-slate-500" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Nothing scheduled</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
              No events or tasks on this day. Add a bill, income, or one-time expense.
            </p>
            <Button
              variant="primary"
              onClick={openAddModal}
              className="mt-5"
              leftIcon={<Plus size={18} />}
            >
              Create Event
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* ToDos Section */}
            {selectedTodos.map(todo => (
              <div key={todo.id} className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-md p-5 rounded-xl ring-1 ring-black/5 shadow-sm flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-lg bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300">
                    <CheckSquare size={20} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-slate-100 text-sm">{todo.text}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Task
                    </p>
                  </div>
                </div>

                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await completeToDo(todo.id);
                        toast.success('Task completed!');
                      } catch (error) {
                        console.error('Failed to complete task:', error);
                        toast.error('Failed to complete task');
                      }
                    }}
                    className="bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/25 text-xs py-1.5 rounded-lg"
                  >
                    Complete
                  </Button>
                </div>
              </div>
            ))}

            {/* Financial Items Section */}
            {selectedItems.map(item => (
              <div key={item.id} className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-md p-5 rounded-xl ring-1 ring-black/5 shadow-sm flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-lg ${
                    item.type === 'income' ? 'bg-money-bgPos dark:bg-emerald-500/15 text-money-pos' : 'bg-money-bgNeg dark:bg-rose-500/15 text-money-neg'
                  }`}>
                    {item.type === 'income' ? '+' : '-'}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-slate-100 text-sm">{item.title}</p>
                    <p className={`text-xs ${item.isPaid ? 'text-money-pos' : 'text-slate-500 dark:text-slate-400'}`}>
                      {item.isPaid ? 'Paid' : 'Unpaid'} {item.isRecurring && '• Recurring'}
                    </p>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-1">
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                    ${item.amount.toLocaleString()}
                  </span>
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    {/* Status Indicator (non-interactive - use Dashboard queue to approve) */}
                    <div>
                      {item.isPaid ? (
                        <CheckCircle2 size={18} className="text-money-pos" />
                      ) : (
                        <Circle size={18} className="text-slate-300 dark:text-slate-600" />
                      )}
                    </div>

                    {/* Edit/Delete (Desktop) */}
                    <div className="hidden md:flex items-center gap-1">
                      {!item.isPaid && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEditModal(item)}
                          className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                          aria-label={`Edit ${item.title}`}
                        >
                          <Edit2 size={14} />
                        </Button>
                      )}
                      <Button
                        variant="ghost-destructive"
                        size="icon-sm"
                        onClick={() => deleteCalendarItem(item.id)}
                        className="text-slate-400 dark:text-slate-500 hover:text-money-neg"
                        aria-label={`Delete ${item.title}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>

                    {/* Mobile Actions */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="md:hidden text-slate-400 dark:text-slate-500"
                      onClick={() => setActiveActionItem(item)}
                      aria-label={`More actions for ${item.title}`}
                    >
                      <MoreVertical size={16} />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
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
            className="w-full h-14 justify-start px-4 text-base bg-rose-50 dark:bg-rose-500/15"
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

      {/* Add/Edit Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        maxWidth="max-w-sm"
      >
        <div className="p-6 scroll-contain-y max-h-[calc(100vh-10rem)] sm:max-h-[80vh]">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100">
              {editingItem ? 'Edit Event' : 'Add Calendar Item'}
            </h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsAddModalOpen(false)}
              aria-label="Close modal"
              className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <X size={20} />
            </Button>
          </div>

          <div className="space-y-4">
             {/* Type Toggle */}
             <SegmentedControl
               value={type}
               onChange={(val) => setType(val as 'income' | 'expense')}
               name="Transaction Type"
               options={[
                 { value: 'expense', label: 'Expense', activeClassName: 'text-money-neg' },
                 { value: 'income', label: 'Income', activeClassName: 'text-money-pos' },
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
               <label id="recurring-label" className="text-sm font-bold text-slate-700 dark:text-slate-200">Recurring?</label>
               <button
                role="switch"
                aria-checked={isRecurring}
                aria-labelledby="recurring-label"
                onClick={() => setIsRecurring(!isRecurring)}
                className={`w-11 h-6 rounded-full relative transition-colors ${isRecurring ? 'bg-slate-900 dark:bg-slate-100' : 'bg-slate-200 dark:bg-slate-700'}`}
               >
                 <span className={`absolute top-1 left-1 w-4 h-4 bg-white dark:bg-slate-900 rounded-full transition-transform ${isRecurring ? 'translate-x-5' : ''}`} />
               </button>
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

             <div className="flex gap-2 mt-2">
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
                 className="flex-1 py-3 h-auto shadow-lg"
               >
                 {editingItem ? 'Save Changes' : 'Add Event'}
               </Button>
             </div>
          </div>
        </div>
      </Modal>

      <RecurringBillsModal
        isOpen={isRecurringModalOpen}
        onClose={() => setIsRecurringModalOpen(false)}
      />
    </div>
  );
};

export default BudgetCalendar;
