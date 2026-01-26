import React, { useState } from 'react';
import { Wand2, Loader2, ArrowRight, X, Check, ShoppingCart, ListTodo, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { parseNaturalLanguageCommand, NaturalLanguageResult } from '../../services/geminiService';
import Input from '../ui/Input';
import { Button } from '../ui/Button';
import toast from 'react-hot-toast';

export const HorizonCommandBar: React.FC = () => {
  const {
    householdId,
    currentUser,
    buckets,
    groceryCategories,
    addTransaction,
    addShoppingItems,
    addToDo
  } = useHousehold();

  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<NaturalLanguageResult | null>(null);

  const handleParse = async () => {
    if (!input.trim() || !householdId) return;

    setIsProcessing(true);
    setResult(null);

    try {
      const expenseCategories = buckets.map(b => b.name);

      const parsed = await parseNaturalLanguageCommand(
        householdId,
        input,
        'unknown',
        {
          shopping: groceryCategories,
          expense: expenseCategories
        }
      );

      if (parsed.detectedType === 'unclear' || parsed.detectedType === 'unknown') {
        toast.error('Sorry, I couldn\'t understand that command.');
      } else {
        setResult(parsed);
      }
    } catch (error) {
      console.error('Command parsing failed:', error);
      toast.error('Failed to process command.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isProcessing) {
      if (result) {
        handleConfirm();
      } else {
        handleParse();
      }
    }
  };

  const handleConfirm = async () => {
    if (!result || !householdId) return;

    try {
      if (result.detectedType === 'shopping') {
        await addShoppingItems(result.items.map(i => ({
          name: i.item,
          quantity: String(i.quantity),
          category: i.category,
          isPurchased: false
        })));
        toast.success(`Added ${result.items.length} items to shopping list`);
      } else if (result.detectedType === 'todo') {
        for (const task of result.tasks) {
          await addToDo({
            text: task.task,
            isCompleted: false,
            priority: task.priority || 'medium',
            completeByDate: format(new Date(), 'yyyy-MM-dd'),
            assignedTo: currentUser?.uid || ''
          });
        }
        toast.success(`Added ${result.tasks.length} task(s)`);
      } else if (result.detectedType === 'expense') {
        if (result.error) {
           toast.error(result.error);
           return;
        }
        if (result.amount === undefined || result.amount === null) {
           toast.error('Could not determine amount.');
           return;
        }
        await addTransaction({
          id: '', // Placeholder, ignored by addDoc
          amount: result.amount,
          merchant: result.merchant || 'Unknown',
          category: result.category || 'Uncategorized',
          date: format(new Date(), 'yyyy-MM-dd'),
          status: 'verified',
          isRecurring: false,
          source: 'manual',
          autoCategorized: false
        });
        toast.success(`Added expense: $${result.amount} at ${result.merchant}`);
      }

      // Reset
      setInput('');
      setResult(null);
    } catch (error) {
      console.error('Failed to execute command:', error);
      toast.error('Failed to execute action.');
    }
  };

  const handleCancel = () => {
    setResult(null);
    setInput('');
  };

  // Render Preview
  const renderPreview = () => {
    if (!result) return null;

    if (result.detectedType === 'shopping') {
      return (
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 mb-3 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 mb-2 text-emerald-700 font-bold text-sm">
            <ShoppingCart size={14} />
            <span>Add to Shopping List</span>
          </div>
          <ul className="space-y-1">
            {result.items.map((item, i) => (
              <li key={i} className="text-sm text-emerald-900 flex justify-between">
                <span>{item.item}</span>
                <span className="text-emerald-600/70 text-xs">{item.quantity} • {item.category}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    if (result.detectedType === 'todo') {
      return (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-3 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 mb-2 text-blue-700 font-bold text-sm">
            <ListTodo size={14} />
            <span>Add Task</span>
          </div>
          <ul className="space-y-1">
            {result.tasks.map((task, i) => (
              <li key={i} className="text-sm text-blue-900 flex justify-between">
                <span>{task.task}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  task.priority === 'high' ? 'bg-red-100 text-red-700' :
                  task.priority === 'medium' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {task.priority}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    if (result.detectedType === 'expense') {
      return (
        <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 mb-3 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 mb-2 text-rose-700 font-bold text-sm">
            <DollarSign size={14} />
            <span>Log Expense</span>
          </div>
          <div className="flex justify-between items-end">
            <div>
              <p className="text-lg font-bold text-rose-900">{result.merchant}</p>
              <p className="text-xs text-rose-600">{result.category}</p>
            </div>
            <p className="text-xl font-mono font-bold text-rose-900">${result.amount?.toFixed(2)}</p>
          </div>
          {result.notes && <p className="text-xs text-rose-500 mt-2 italic">&quot;{result.notes}&quot;</p>}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-indigo-500/10 backdrop-blur-xl border border-white/20 shadow-glass ring-1 ring-black/5 rounded-3xl p-1 overflow-hidden">
      <div className="bg-white/60 backdrop-blur-md rounded-[1.25rem] p-4 transition-all">

        {/* Header/Label */}
        {!result && (
          <div className="flex items-center gap-2 mb-3 px-1">
            <Wand2 size={16} className="text-indigo-500" />
            <span className="text-xs font-bold text-indigo-500 uppercase tracking-wider">Magic Command</span>
          </div>
        )}

        {/* Result Preview Area */}
        {renderPreview()}

        {/* Input Area */}
        <div className="relative flex gap-2">
           {!result ? (
             <>
                <div className="relative flex-1">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a command... (e.g. 'Lunch $15')"
                    className="border-indigo-100 focus:border-indigo-300 focus:ring-indigo-500/10 pr-10"
                    disabled={isProcessing}
                  />
                  {isProcessing && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    </div>
                  )}
                </div>
                <Button
                  onClick={handleParse}
                  disabled={!input.trim() || isProcessing}
                  variant="primary"
                  className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/20"
                >
                  <ArrowRight size={18} />
                </Button>
             </>
           ) : (
             <div className="flex gap-2 w-full">
               <Button
                 onClick={handleCancel}
                 variant="ghost"
                 className="flex-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
               >
                 <X size={16} /> Cancel
               </Button>
               <Button
                 onClick={handleConfirm}
                 variant="primary"
                 className="flex-[2] bg-indigo-600 hover:bg-indigo-700"
               >
                 <Check size={16} /> Confirm
               </Button>
             </div>
           )}
        </div>

      </div>
    </div>
  );
};
