
import React, { useState } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, CheckCircle2, Circle, Trash2, Edit2, X } from 'lucide-react';
import { CalendarItem } from '../../types/schema';

const BudgetCalendar: React.FC = () => {
  const { calendarItems, addCalendarItem, updateCalendarItem, deleteCalendarItem } = useHousehold();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CalendarItem | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<'monthly' | 'bi-weekly' | 'weekly'>('monthly');

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // Filter items for the selected date
  const selectedItems = calendarItems.filter(item => 
    isSameDay(parseISO(item.date), selectedDate)
  );

  const openAddModal = () => {
    setTitle('');
    setAmount('');
    setType('expense');
    setIsRecurring(false);
    setFrequency('monthly');
    setEditingItem(null);
    setIsAddModalOpen(true);
  };

  const openEditModal = (item: CalendarItem) => {
    setTitle(item.title);
    setAmount(item.amount.toString());
    setType(item.type);
    setIsRecurring(!!item.isRecurring);
    setFrequency(item.frequency || 'monthly');
    setEditingItem(item);
    setIsAddModalOpen(true);
  };

  const handleSave = () => {
    if (!title || !amount) return;

    const newItem: CalendarItem = {
      id: editingItem ? editingItem.id : crypto.randomUUID(),
      title,
      amount: parseFloat(amount),
      date: format(selectedDate, 'yyyy-MM-dd'),
      type,
      isPaid: editingItem ? editingItem.isPaid : false,
      isRecurring,
      frequency: isRecurring ? frequency : undefined
    };

    if (editingItem) {
      updateCalendarItem(newItem);
    } else {
      addCalendarItem(newItem);
    }
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
          {weekDays.map(d => (
            <div key={d} className="text-center text-xs font-bold text-brand-300 py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-2">
          {days.map(day => {
            const dateItems = calendarItems.filter(i => isSameDay(parseISO(i.date), day));
            const hasIncome = dateItems.some(i => i.type === 'income');
            const hasExpense = dateItems.some(i => i.type === 'expense');
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

        {selectedItems.length === 0 ? (
          <div className="text-center py-8 bg-white border border-dashed border-brand-200 rounded-2xl text-brand-400 text-sm">
            No events scheduled.
          </div>
        ) : (
          <div className="space-y-3">
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
                    <button onClick={() => deleteCalendarItem(item.id)} className="p-1 text-brand-300 hover:text-money-neg">
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
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-in zoom-in-95">
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
                   onChange={(e: any) => setFrequency(e.target.value)}
                   className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl"
                 >
                   <option value="monthly">Monthly</option>
                   <option value="bi-weekly">Bi-Weekly</option>
                   <option value="weekly">Weekly</option>
                 </select>
               )}

               <button 
                 onClick={handleSave}
                 className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl mt-2"
               >
                 Save Event
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetCalendar;
