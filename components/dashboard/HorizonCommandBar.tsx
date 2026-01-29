import React, { useState, useRef } from 'react';
import { Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { useContextualPrompts } from '../../hooks/useContextualPrompts';
import CaptureModal, { ModalTab, ModalView, ManualInitialData } from '../modals/CaptureModal';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import toast from 'react-hot-toast';

export const HorizonCommandBar: React.FC = () => {
  const { householdId, buckets } = useHousehold();
  const { prompts } = useContextualPrompts();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<ModalTab>('transaction');
  const [initialView, setInitialView] = useState<ModalView>('menu');
  const [initialTransactionData, setInitialTransactionData] = useState<ManualInitialData | undefined>(undefined);
  const [initialTodoData, setInitialTodoData] = useState<{ text: string; date: string; assignee?: string } | undefined>(undefined);
  const [initialShoppingData, setInitialShoppingData] = useState<{ name: string; quantity: string; category: string; store: string } | undefined>(undefined);

  const getLocalDateString = (): string => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handlePromptClick = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;

    setIsLoading(true);
    try {
      if (!householdId) throw new Error("Household ID not found");

      const dynamicCategories = [...buckets.map(b => b.name), 'Budgeted in Calendar'];
      const context = {
        categories: dynamicCategories,
        groceryCategories: GROCERY_CATEGORIES,
        todayDate: getLocalDateString()
      };

      const { parseMagicAction } = await import('../../services/geminiService');
      const result = await parseMagicAction(householdId, input, context);

      // Reset modal state
      setInitialTransactionData(undefined);
      setInitialTodoData(undefined);
      setInitialShoppingData(undefined);

      if (result.type === 'transaction') {
        setInitialTab('transaction');
        setInitialView('manual');
        setInitialTransactionData({
          amount: result.data.amount?.toString(),
          merchant: result.data.merchant,
          category: result.data.category, // CaptureModal will fuzzy match this
          date: result.data.date
        });
        toast.success("Transaction details found!");
      } else if (result.type === 'todo') {
        setInitialTab('todo');
        setInitialView('menu');
        setInitialTodoData({
            text: result.data.text || '',
            date: result.data.completeByDate || getLocalDateString()
        });
        toast.success("Task details found!");
      } else if (result.type === 'shopping') {
        setInitialTab('shopping');
        setInitialView('menu');
        setInitialShoppingData({
            name: result.data.item || '',
            quantity: result.data.quantity || '',
            category: result.data.category || 'Uncategorized',
            store: result.data.store || ''
        });
        toast.success("Item details found!");
      } else {
        toast.error("Couldn't understand that. Opening manual entry.");
        setInitialTab('transaction');
        setInitialView('manual');
      }

      setModalOpen(true);
      setInput('');
    } catch (err) {
      console.error(err);
      toast.error("Magic action failed.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="w-full max-w-2xl mx-auto mb-6 px-4">
        {/* Input Bar */}
        <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-violet-600 to-indigo-600 rounded-2xl opacity-20 group-hover:opacity-40 transition duration-500 blur"></div>
            <div className="relative bg-white rounded-xl shadow-lg flex items-center p-2 ring-1 ring-black/5">
                <div className="p-2 text-violet-600">
                    <Sparkles size={20} className={isLoading ? "animate-pulse" : ""} />
                </div>
                <form onSubmit={handleSubmit} className="flex-1 flex items-center">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="What's on your mind? (e.g. 'Coffee $5', 'Buy Milk')"
                        className="w-full bg-transparent border-none outline-none text-slate-800 placeholder:text-slate-400 font-medium px-2"
                        disabled={isLoading}
                        autoComplete="off"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || isLoading}
                        className="p-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:hover:bg-violet-600 transition-colors"
                    >
                        {isLoading ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                    </button>
                </form>
            </div>
        </div>

        {/* Chips */}
        <div className="flex flex-wrap gap-2 mt-3 px-1 justify-center sm:justify-start">
            {prompts.map(prompt => (
                <button
                    key={prompt.id}
                    onClick={() => handlePromptClick(prompt.magicText)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/60 hover:bg-white text-slate-600 hover:text-violet-700 border border-slate-200 hover:border-violet-200 rounded-full text-xs font-semibold shadow-sm transition-all active:scale-95"
                >
                    {prompt.icon}
                    <span>{prompt.label}</span>
                </button>
            ))}
        </div>
      </div>

      <CaptureModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        initialTab={initialTab}
        initialView={initialView}
        initialTransactionData={initialTransactionData}
        initialTodoData={initialTodoData}
        initialShoppingData={initialShoppingData}
      />
    </>
  );
};
