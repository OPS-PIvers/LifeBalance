import React, { useState, useMemo } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { CalendarItem } from '../../types/schema';
import { Button } from '../ui/Button';
import { Trash2, Edit2, Check, Repeat, TrendingUp, TrendingDown, MoreVertical, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Drawer } from '../ui/Drawer';
import Input from '../ui/Input';
import Select from '../ui/Select';

interface RecurringBillsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const RecurringBillsModal: React.FC<RecurringBillsModalProps> = ({ isOpen, onClose }) => {
  const { calendarItems, updateCalendarItem, deleteCalendarItem } = useHousehold();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionItem, setActionItem] = useState<CalendarItem | null>(null);

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

    const parsedAmount = parseFloat(editAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      await updateCalendarItem({
        ...originalItem,
        title: editTitle,
        amount: parsedAmount,
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
    <Drawer isOpen={isOpen} onClose={onClose} noPadding={true}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-slate-100 text-slate-600 rounded-2xl">
            <Repeat size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Recurring Manager</h3>
            <p className="text-xs text-slate-500">Manage your subscriptions and bills</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
          aria-label="Close drawer"
        >
          <X size={20} />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="p-6 grid grid-cols-2 gap-4 shrink-0 bg-slate-50/50">
          <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-soft">
            <div className="flex items-center gap-2 mb-1 text-money-neg font-bold text-xs uppercase tracking-wider">
              <TrendingDown size={14} /> Monthly Expenses
            </div>
            <div className="text-2xl font-bold text-slate-900">
              ${totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-slate-400 mt-1">Estimated fixed costs</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-soft">
            <div className="flex items-center gap-2 mb-1 text-money-pos font-bold text-xs uppercase tracking-wider">
              <TrendingUp size={14} /> Monthly Income
            </div>
            <div className="text-2xl font-bold text-slate-900">
              ${totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-slate-400 mt-1">Estimated recurring income</div>
          </div>
      </div>

      {/* List */}
      <div className="p-4 sm:p-6 space-y-3">
          {recurringItems.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
              <p className="text-slate-400">No recurring items found.</p>
              <p className="text-xs text-slate-400 mt-1">Add them from the main calendar view.</p>
            </div>
          ) : (
            recurringItems.map(item => (
              <div key={item.id} className="bg-white p-4 rounded-xl border border-slate-100 shadow-soft flex flex-col sm:flex-row sm:items-center justify-between gap-4 group hover:border-slate-300 transition-colors">
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
                       <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-lg shrink-0 ${
                          item.type === 'income' ? 'bg-money-bgPos text-money-pos' : 'bg-money-bgNeg text-money-neg'
                        }`}>
                          {item.type === 'income' ? '+' : '-'}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900">{item.title}</div>
                          <div className="text-xs text-slate-500 capitalize flex items-center gap-1">
                            <Repeat size={10} /> {item.frequency}
                          </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                        <div className="text-right">
                          <div className="font-mono font-bold text-slate-900">${item.amount.toLocaleString()}</div>
                          <div className="text-xxs text-slate-400">per instance</div>
                        </div>

                        <div className="hidden sm:flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                           <Button variant="ghost" size="icon-sm" onClick={() => startEditing(item)}>
                             <Edit2 size={14} className="text-slate-400 hover:text-slate-600" />
                           </Button>
                           <Button variant="ghost-destructive" size="icon-sm" onClick={() => handleDelete(item.id)}>
                             <Trash2 size={14} />
                           </Button>
                        </div>

                        {/* Mobile Action */}
                        <div className="sm:hidden">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setActionItem(item)}
                            className="text-slate-400 active:bg-slate-100"
                            aria-label={`Manage ${item.title}`}
                          >
                            <MoreVertical size={20} />
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
      <div className="sticky bottom-0 p-4 bg-slate-50 border-t border-slate-100 text-center text-xs text-slate-400">
         Changes made here affect all future generated events.
      </div>

      {/* Mobile Action Drawer */}
      <Drawer
        isOpen={!!actionItem}
        onClose={() => setActionItem(null)}
        title={actionItem ? `Manage ${actionItem.title}` : 'Manage Item'}
      >
        <div className="space-y-2">
          {actionItem && (
            <>
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Edit2 className="text-slate-500" />}
                onClick={() => {
                  startEditing(actionItem);
                  setActionItem(null);
                }}
              >
                Edit Item
              </Button>
              <div className="h-px bg-slate-100 my-2" />
              <Button
                variant="ghost-destructive"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Trash2 />}
                onClick={() => {
                  handleDelete(actionItem.id);
                  setActionItem(null);
                }}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </Drawer>
    </Drawer>
  );
};

export default RecurringBillsModal;
