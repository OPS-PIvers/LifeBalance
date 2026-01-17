
import React, { useState, useMemo } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, CheckCircle2, Circle, Trash2, Edit2, X, Copy, CheckSquare } from 'lucide-react';
import { CalendarItem } from '../../types/schema';
import { expandCalendarItems } from '../../utils/calendarRecurrence';
import { Modal } from '../ui/Modal';
import toast from 'react-hot-toast';

const BudgetCalendar: React.FC = () => {
  const { calendarItems, addCalendarItem, updateCalendarItem, deleteCalendarItem, todos, completeToDo } = useHousehold();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CalendarItem | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [date, setDate] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<'monthly' | 'bi-weekly' | 'weekly'>('monthly');

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // Expand recurring calendar items for the visible date range
  const expandedCalendarItems = useMemo(
    () => expandCalendarItems(calendarItems, startDate, endDate),
    [calendarItems, startDate, endDate] // eslint-disable-line react-hooks/preserve-manual-memoization
  );

  // Filter items for the selected date
  const selectedItems = expandedCalendarItems.filter(item =>
    isSameDay(parseISO(item.date), selectedDate)
  );

  // Filter todos for the selected date
  const selectedTodos = todos.filter(todo =>
    isSameDay(parseISO(todo.completeByDate), selectedDate) && !todo.isCompleted
  );

  const openAddModal = () => {
    setTitle('');
    setAmount('');
    setType('expense');
    setDate(format(selectedDate, 'yyyy-MM-dd'));
    setIsRecurring(false);
    setFrequency('monthly');
    setEditingItem(null);
    setIsAddModalOpen(true);
  };

  // Helper to check if an item is a generated recurring instance (vs. the original)
  const isRecurringInstance = (item: CalendarItem): boolean => {
    return item.isRecurring === true && item.id.includes('-202'); // Synthetic IDs contain date like "-2024-01-15"
  };

  // Helper to find the original calendar item for a recurring instance
  const findOriginalItem = (instanceId: string): CalendarItem | undefined => {
    // Extract original ID (everything before the date suffix)
    const originalId = instanceId.split('-202')[0]; // Split on "-202" to get base ID
    return calendarItems.find(item => item.id === originalId);
  };

  const openEditModal = (item: CalendarItem) => {
    // If this is a recurring instance, edit the original item instead
    const itemToEdit = isRecurringInstance(item) ? findOriginalItem(item.id) || item : item;

    setTitle(itemToEdit.title);
    setAmount(itemToEdit.amount.toString());
    setType(itemToEdit.type);
    setDate(itemToEdit.date);
    setIsRecurring(!!itemToEdit.isRecurring);
    setFrequency(itemToEdit.frequency || 'monthly');
    setEditingItem(itemToEdit);
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
      frequency: isRecurring ? frequency : undefined
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
      frequency: isRecurring ? frequency : undefined
    };

    addCalendarItem(newItem);
    toast.success('Event duplicated');
    setIsAddModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Calendar Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-brand-100 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg text-brand-800">
            {format(currentDate, 'MMMM yyyy')}
          </h2>
          <div className="flex gap-2">
            <button onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))} className="p-1 hover:bg-brand-50 rounded-lg">
              <ChevronLeft size={20} className="text-brand-400" />
            </button>
            <button onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))} className="p-1 hover:bg-brand-50 rounded-lg">
              <ChevronRight size={20} className="text-brand-400" />
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 mb-2">
          {weekDays.map((d, i) => (
            <div key={`${d}-${i}`} className="text-center text-xs font-bold text-brand-300 py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-2">
          {days.map(day => {
            const dateItems = expandedCalendarItems.filter(i => isSameDay(parseISO(i.date), day));
            const hasIncome = dateItems.some(i => i.type === 'income');
            const hasExpense = dateItems.some(i => i.type === 'expense');
            const hasTodo = todos.some(t => isSameDay(parseISO(t.completeByDate), day) && !t.isCompleted);
            const isSelected = isSameDay(day, selectedDate);

            return (
              <div 
                key={day.toString()} 
                onClick={() => setSelectedDate(day)}
                className={`
                  relative flex flex-col items-center justify-center h-10 w-10 mx-auto rounded-xl text-sm font-medium cursor-pointer transition-all
                  ${!isSameMonth(day, monthStart) ? 'text-brand-200' : 'text-brand-600'}
                  ${isSelected ? 'bg-brand-800 text-white shadow-md scale-105' : 'hover:bg-brand-50'}
                  ${isToday(day) && !isSelected ? 'text-brand-800 font-bold' : ''}
                `}
              >
                {format(day, 'd')}
                
                {/* Dots */}
                <div className="absolute bottom-1 flex gap-0.5">
                  {hasIncome && <div className="w-1 h-1 rounded-full bg-money-pos"></div>}
                  {hasExpense && <div className="w-1 h-1 rounded-full bg-money-neg"></div>}
                  {hasTodo && <div className="w-1 h-1 rounded-full bg-blue-500"></div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail List */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="font-bold text-brand-800 text-sm uppercase tracking-wide">
            Events for {format(selectedDate, 'MMM d')}
          </h3>
          <button 
            onClick={openAddModal}
            className="flex items-center gap-1 text-xs font-bold text-brand-600 bg-brand-100 px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
          >
            Add Event <Plus size={14} />
          </button>
        </div>

        {selectedItems.length === 0 && selectedTodos.length === 0 ? (
          <div className="text-center py-8 bg-white border border-dashed border-brand-200 rounded-2xl text-brand-400 text-sm">
            No events or tasks scheduled.
          </div>
        ) : (
          <div className="space-y-3">
            {/* ToDos Section */}
            {selectedTodos.map(todo => (
              <div key={todo.id} className="bg-white p-3 rounded-xl border border-blue-100 shadow-sm flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-lg bg-blue-50 text-blue-600">
                    <CheckSquare size={20} />
                  </div>
                  <div>
                    <p className="font-bold text-brand-800 text-sm">{todo.text}</p>
                    <p className="text-xs text-brand-400">
                      Task
                    </p>
                  </div>
                </div>

                <div className="flex items-center">
                  <button
                    onClick={async () => {
                      try {
                        await completeToDo(todo.id);
                        toast.success('Task completed!');
                      } catch (error) {
                        console.error('Failed to complete task:', error);
                        toast.error('Failed to complete task');
                      }
                    }}
                    className="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                  >
                    Complete
                  </button>
                </div>
              </div>
            ))}

            {/* Financial Items Section */}
            {selectedItems.map(item => (
              <div key={item.id} className="bg-white p-3 rounded-xl border border-brand-100 shadow-sm flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-lg ${
                    item.type === 'income' ? 'bg-money-bgPos text-money-pos' : 'bg-money-bgNeg text-money-neg'
                  }`}>
                    {item.type === 'income' ? '+' : '-'}
                  </div>
                  <div>
                    <p className="font-bold text-brand-800 text-sm">{item.title}</p>
                    <p className={`text-xs ${item.isPaid ? 'text-money-pos' : 'text-brand-400'}`}>
                      {item.isPaid ? 'Paid' : 'Unpaid'} {item.isRecurring && '• Recurring'}
                    </p>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-1">
                  <span className="font-mono font-bold text-brand-800">
                    ${item.amount.toLocaleString()}
                  </span>
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    {/* Status Indicator (non-interactive - use Dashboard queue to approve) */}
                    <div>
                      {item.isPaid ? (
                        <CheckCircle2 size={18} className="text-money-pos" />
                      ) : (
                        <Circle size={18} className="text-brand-300" />
                      )}
                    </div>

                    {/* Edit/Delete (visible mostly on hover in desktop, but always accessible) */}
                    {!item.isPaid && (
                      <button onClick={() => openEditModal(item)} className="p-1 text-brand-300 hover:text-brand-600">
                        <Edit2 size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => deleteCalendarItem(item.id)}
                      className="p-1 text-brand-300 hover:text-money-neg"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        maxWidth="max-w-sm"
      >
        <div className="p-6 overflow-y-auto max-h-[calc(100vh-10rem)] sm:max-h-[80vh]">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-lg text-brand-800">
              {editingItem ? 'Edit Event' : 'Add Calendar Item'}
            </h3>
            <button onClick={() => setIsAddModalOpen(false)}><X size={20} className="text-brand-400" /></button>
          </div>

          <div className="space-y-4">
             {/* Type Toggle */}
             <div className="flex bg-brand-50 p-1 rounded-xl">
               <button
                 onClick={() => setType('expense')}
                 className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${type === 'expense' ? 'bg-white shadow-sm text-money-neg' : 'text-brand-400'}`}
               >Expense</button>
               <button
                 onClick={() => setType('income')}
                 className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${type === 'income' ? 'bg-white shadow-sm text-money-pos' : 'text-brand-400'}`}
               >Income</button>
             </div>

             <input
               type="text"
               placeholder="Title (e.g. Rent)"
               value={title}
               onChange={e => setTitle(e.target.value)}
               className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl"
             />

             <input
               type="number"
               placeholder="Amount"
               value={amount}
               onChange={e => setAmount(e.target.value)}
               className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl font-mono"
             />

             <div>
               <label className="text-xs font-bold text-brand-400 uppercase ml-1 mb-1 block">Date</label>
               <input
                 type="date"
                 value={date}
                 onChange={e => setDate(e.target.value)}
                 className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl font-medium"
               />
             </div>

             <div className="flex items-center justify-between">
               <label className="text-sm font-bold text-brand-600">Recurring?</label>
               <button
                onClick={() => setIsRecurring(!isRecurring)}
                className={`w-11 h-6 rounded-full relative transition-colors ${isRecurring ? 'bg-brand-800' : 'bg-brand-200'}`}
               >
                 <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${isRecurring ? 'translate-x-5' : ''}`} />
               </button>
             </div>

             {isRecurring && (
               <select
                 value={frequency}
                 onChange={(e) => setFrequency(e.target.value as 'monthly' | 'bi-weekly' | 'weekly')}
                 className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl"
               >
                 <option value="monthly">Monthly</option>
                 <option value="bi-weekly">Bi-Weekly</option>
                 <option value="weekly">Weekly</option>
               </select>
             )}

             <div className="flex gap-2 mt-2">
               {editingItem && (
                 <button
                   onClick={handleDuplicate}
                   className="flex-1 py-3 bg-white border border-brand-200 text-brand-600 font-bold rounded-xl hover:bg-brand-50 transition-colors flex items-center justify-center gap-2"
                 >
                   <Copy size={18} />
                   Duplicate
                 </button>
               )}
               <button
                 onClick={handleSave}
                 className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all"
               >
                 {editingItem ? 'Save Changes' : 'Add Event'}
               </button>
             </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default BudgetCalendar;
