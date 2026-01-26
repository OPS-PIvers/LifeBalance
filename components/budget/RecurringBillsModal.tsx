import React, { useState, useMemo } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { CalendarItem } from '../../types/schema';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Trash2, Edit2, X, Check, Repeat, TrendingUp, TrendingDown } from 'lucide-react';
import toast from 'react-hot-toast';
import Input from '../ui/Input';
import Select from '../ui/Select';

interface RecurringBillsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const RecurringBillsModal: React.FC<RecurringBillsModalProps> = ({ isOpen, onClose }) => {
  const { calendarItems, updateCalendarItem, deleteCalendarItem } = useHousehold();
  const [editingId, setEditingId] = useState<string | null>(null);

  // Edit Form State
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editFrequency, setEditFrequency] = useState<'weekly' | 'bi-weekly' | 'monthly'>('monthly');

  // Filter for Recurring Templates (exclude instances)
  const recurringItems = useMemo(() => {
    return calendarItems.filter(item =>
      item.isRecurring &&
      !item.parentRecurringId &&
      !item.isDeleted
    );
  }, [calendarItems]);

  // Calculate Monthly Totals
  const { totalIncome, totalExpenses } = useMemo(() => {
    let income = 0;
    let expenses = 0;

    recurringItems.forEach(item => {
      let monthlyAmount = item.amount;

      if (item.frequency === 'weekly') {
        monthlyAmount = item.amount * 4.33; // Average weeks per month
      } else if (item.frequency === 'bi-weekly') {
        monthlyAmount = item.amount * 2.16; // Average bi-weeks per month
      }

      if (item.type === 'income') {
        income += monthlyAmount;
      } else {
        expenses += monthlyAmount;
      }
    });

    return { totalIncome: income, totalExpenses: expenses };
  }, [recurringItems]);

  const startEditing = (item: CalendarItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditAmount(item.amount.toString());
    setEditFrequency(item.frequency || 'monthly');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle('');
    setEditAmount('');
    setEditFrequency('monthly');
  };

  const saveEditing = async (originalItem: CalendarItem) => {
    if (!editTitle || !editAmount) return;

    try {
      await updateCalendarItem({
        ...originalItem,
        title: editTitle,
        amount: parseFloat(editAmount),
        frequency: editFrequency
      });
      toast.success('Updated recurring item');
      cancelEditing();
    } catch (_error) {
      toast.error('Failed to update');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this recurring item? Future instances will stop appearing.')) {
      try {
        await deleteCalendarItem(id);
        toast.success('Deleted recurring item');
      } catch (_error) {
        toast.error('Failed to delete');
      }
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex flex-col h-full max-h-[80vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-brand-100 text-brand-600 rounded-lg">
              <Repeat size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Recurring Manager</h3>
              <p className="text-xs text-gray-500">Manage your subscriptions and bills</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full">
            <X size={20} />
          </button>
        </div>

        {/* Summary Cards */}
        <div className="p-6 grid grid-cols-2 gap-4 shrink-0 bg-gray-50/50">
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-2 mb-1 text-money-neg font-bold text-xs uppercase tracking-wider">
              <TrendingDown size={14} /> Monthly Expenses
            </div>
            <div className="text-2xl font-bold text-gray-900">
              ${totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-gray-400 mt-1">Estimated fixed costs</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-2 mb-1 text-money-pos font-bold text-xs uppercase tracking-wider">
              <TrendingUp size={14} /> Monthly Income
            </div>
            <div className="text-2xl font-bold text-gray-900">
              ${totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-gray-400 mt-1">Estimated recurring income</div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {recurringItems.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
              <p className="text-gray-400">No recurring items found.</p>
              <p className="text-xs text-gray-400 mt-1">Add them from the main calendar view.</p>
            </div>
          ) : (
            recurringItems.map(item => (
              <div key={item.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 group hover:border-brand-200 transition-colors">
                {editingId === item.id ? (
                  // Edit Mode
                  <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <div className="sm:col-span-4">
                      <Input
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        placeholder="Title"
                        className="h-10 text-sm"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Input
                        type="number"
                        value={editAmount}
                        onChange={e => setEditAmount(e.target.value)}
                        placeholder="Amount"
                        className="h-10 text-sm"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Select
                        value={editFrequency}
                        onChange={e => setEditFrequency(e.target.value as 'weekly' | 'bi-weekly' | 'monthly')}
                        className="h-10 text-sm"
                      >
                         <option value="weekly">Weekly</option>
                         <option value="bi-weekly">Bi-Weekly</option>
                         <option value="monthly">Monthly</option>
                      </Select>
                    </div>
                    <div className="sm:col-span-2 flex justify-end gap-1">
                      <Button size="icon-sm" variant="success" onClick={() => saveEditing(item)}>
                        <Check size={16} />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={cancelEditing}>
                        <X size={16} />
                      </Button>
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <>
                    <div className="flex items-center gap-3">
                       <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-lg shrink-0 ${
                          item.type === 'income' ? 'bg-money-bgPos text-money-pos' : 'bg-money-bgNeg text-money-neg'
                        }`}>
                          {item.type === 'income' ? '+' : '-'}
                        </div>
                        <div>
                          <div className="font-bold text-gray-900">{item.title}</div>
                          <div className="text-xs text-gray-500 capitalize flex items-center gap-1">
                            <Repeat size={10} /> {item.frequency}
                          </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                        <div className="text-right">
                          <div className="font-mono font-bold text-gray-900">${item.amount.toLocaleString()}</div>
                          <div className="text-xxs text-gray-400">per instance</div>
                        </div>

                        <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                           <Button variant="ghost" size="icon-sm" onClick={() => startEditing(item)}>
                             <Edit2 size={14} className="text-gray-400 hover:text-brand-600" />
                           </Button>
                           <Button variant="ghost-destructive" size="icon-sm" onClick={() => handleDelete(item.id)}>
                             <Trash2 size={14} />
                           </Button>
                        </div>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 text-center text-xs text-gray-400">
           Changes made here affect all future generated events.
        </div>
      </div>
    </Modal>
  );
};

export default RecurringBillsModal;
