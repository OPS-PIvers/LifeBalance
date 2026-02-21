import React, { useState } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Sparkles, ArrowRight, Loader2, CreditCard, ListTodo, ShoppingCart } from 'lucide-react';
import toast from 'react-hot-toast';
import type { MagicActionResponse } from '../../services/geminiService';
import { Transaction } from '../../types/schema';

type MagicInputData = Omit<MagicActionResponse['data'], 'amount'> & { amount?: number | string };

const MagicInput: React.FC = () => {
  const {
    householdId,
    buckets,
    groceryCategories,
    addTransaction,
    addToDo,
    addShoppingItem
  } = useHousehold();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [parsedResult, setParsedResult] = useState<MagicActionResponse | null>(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  // Editable fields state
  const [editData, setEditData] = useState<MagicInputData>({});

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !householdId) return;

    setIsLoading(true);
    try {
      // Dynamic import to avoid circular dependencies
      const { parseMagicAction } = await import('../../services/geminiService');

      const categories = buckets.map(b => b.name);
      const todayDate = new Date().toISOString().split('T')[0];

      const result = await parseMagicAction(
        householdId,
        input,
        {
          categories,
          groceryCategories,
          todayDate
        }
      );

      setParsedResult(result);
      setEditData(result.data); // Initialize editable data
      setIsConfirmModalOpen(true);
    } catch (error) {
      console.error('Magic Input Error:', error);
      toast.error('Failed to process command');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!parsedResult) return;

    try {
      switch (parsedResult.type) {
        case 'transaction':
          if (!editData.amount || !editData.merchant || !editData.category) {
            toast.error('Please fill in all required fields');
            return;
          }
          await addTransaction({
            amount: Number(editData.amount) || 0,
            merchant: editData.merchant || '',
            category: editData.category || 'Uncategorized',
            date: editData.date || new Date().toISOString().split('T')[0],
            status: 'verified',
            source: 'manual',
            isRecurring: false,
            autoCategorized: false,
          } as unknown as Transaction);
          toast.success('Transaction added');
          break;

        case 'todo':
          if (!editData.text) {
            toast.error('Task description is required');
            return;
          }
          await addToDo({
            text: editData.text || '',
            completeByDate: editData.completeByDate || new Date().toISOString().split('T')[0],
            isCompleted: false,
            priority: 'medium',
            source: 'voice', // or 'magic'
            assignedTo: '', // Default
          });
          toast.success('Task added');
          break;

        case 'shopping':
          if (!editData.item) {
            toast.error('Item name is required');
            return;
          }
          await addShoppingItem({
            name: editData.item || '',
            quantity: editData.quantity || '1',
            category: editData.category || 'Uncategorized',
            store: editData.store,
            isPurchased: false,
          });
          toast.success('Added to shopping list');
          break;

        default:
          toast.error('Unknown action type');
          return;
      }

      setIsConfirmModalOpen(false);
      setInput('');
      setParsedResult(null);
    } catch (error) {
      console.error('Magic Action Failed:', error);
      toast.error('Failed to execute action');
    }
  };

  const renderModalContent = () => {
    if (!parsedResult) return null;

    const typeLabel = {
      'transaction': 'New Transaction',
      'todo': 'New Task',
      'shopping': 'Add to Shopping List',
      'unknown': 'Unknown Action'
    }[parsedResult.type] || parsedResult.type;

    const typeIcon = {
      'transaction': <CreditCard className="w-5 h-5 text-brand-600" />,
      'todo': <ListTodo className="w-5 h-5 text-blue-600" />,
      'shopping': <ShoppingCart className="w-5 h-5 text-emerald-600" />,
      'unknown': <Sparkles className="w-5 h-5 text-slate-400" />
    }[parsedResult.type];

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          {typeIcon}
          <h3 className="font-bold text-lg text-slate-900">{typeLabel}</h3>
        </div>

        {/* Transaction / Expense Form */}
        {parsedResult.type === 'transaction' && (
          <div className="space-y-3">
             <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Merchant</label>
                <input
                  type="text"
                  value={editData.merchant || ''}
                  onChange={e => setEditData({...editData, merchant: e.target.value})}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
                />
             </div>
             <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editData.amount || ''}
                    onChange={e => setEditData({...editData, amount: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Date</label>
                  <input
                    type="date"
                    value={editData.date || ''}
                    onChange={e => setEditData({...editData, date: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>
             </div>
             <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Category</label>
                <select
                  value={editData.category || ''}
                  onChange={e => setEditData({...editData, category: e.target.value})}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
                >
                  <option value="">Select Category...</option>
                  {buckets.map(b => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
             </div>
          </div>
        )}

        {/* Todo Form */}
        {parsedResult.type === 'todo' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Task</label>
              <input
                type="text"
                value={editData.text || ''}
                onChange={e => setEditData({...editData, text: e.target.value})}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Due Date</label>
              <input
                type="date"
                value={editData.completeByDate || ''}
                onChange={e => setEditData({...editData, completeByDate: e.target.value})}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
          </div>
        )}

        {/* Shopping Form */}
        {parsedResult.type === 'shopping' && (
          <div className="space-y-3">
             <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Item Name</label>
                <input
                  type="text"
                  value={editData.item || ''}
                  onChange={e => setEditData({...editData, item: e.target.value})}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
                />
             </div>
             <div className="grid grid-cols-2 gap-3">
                <div>
                   <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Quantity</label>
                   <input
                      type="text"
                      value={editData.quantity || ''}
                      onChange={e => setEditData({...editData, quantity: e.target.value})}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
                    />
                </div>
                <div>
                   <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Store</label>
                   <input
                      type="text"
                      value={editData.store || ''}
                      onChange={e => setEditData({...editData, store: e.target.value})}
                      placeholder="Optional"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
                    />
                </div>
             </div>
             <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Category</label>
                <select
                  value={editData.category || 'Uncategorized'}
                  onChange={e => setEditData({...editData, category: e.target.value})}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
                >
                  <option value="Uncategorized">Uncategorized</option>
                  {groceryCategories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
             </div>
          </div>
        )}

        {parsedResult.type === 'unknown' && (
          <div className="p-4 bg-slate-50 rounded-xl text-center text-slate-500">
            Could not understand the command. Please try again.
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <Button
            variant="subtle"
            size="lg"
            className="flex-1"
            onClick={() => setIsConfirmModalOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            onClick={handleConfirm}
            disabled={parsedResult.type === 'unknown'}
          >
            Confirm
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      <form onSubmit={handleScan} className="relative group z-10">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          {isLoading ? (
            <Loader2 className="h-5 w-5 text-brand-500 animate-spin" />
          ) : (
            <Sparkles className="h-5 w-5 text-brand-400 group-focus-within:text-brand-600 transition-colors" />
          )}
        </div>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Catalyst... (e.g. 'Spent $20 at Target')"
          className="w-full pl-11 pr-12 py-4 bg-white/90 backdrop-blur-xl border border-white/20 shadow-sm ring-1 ring-black/5 rounded-2xl text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500/50 transition-all"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-brand-800 text-white rounded-xl shadow-lg hover:bg-brand-900 disabled:opacity-50 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none transition-all active:scale-95"
        >
          <ArrowRight size={18} />
        </button>
      </form>

      <Modal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
      >
        {renderModalContent()}
      </Modal>
    </>
  );
};

export default MagicInput;
