import React, { useState, useId } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FileText, Loader2, X, Sparkles } from 'lucide-react';
import type { Meal } from '@/types/schema';
import toast from 'react-hot-toast';

interface RecipeImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  householdId: string;
  onConfirm: (meal: Partial<Meal>) => void;
}

export const RecipeImportModal: React.FC<RecipeImportModalProps> = ({
  isOpen,
  onClose,
  householdId,
  onConfirm
}) => {
  const [text, setText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const titleId = useId();

  const handleParse = async () => {
    if (!text.trim()) {
      toast.error('Please paste a recipe first');
      return;
    }

    setIsParsing(true);
    try {
      const { parseRecipe } = await import('@/services/geminiService');
      const result = await parseRecipe(householdId, text);
      onConfirm(result);
      onClose();
      setText(''); // Reset
      toast.success('Recipe parsed successfully!');
    } catch (error) {
      console.error('Recipe parsing failed:', error);
      toast.error('Failed to parse recipe. Please try again.');
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-lg" ariaLabelledBy={titleId}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-brand-200 dark:border-brand-700 flex justify-between items-center bg-white dark:bg-brand-800 z-10 shrink-0">
          <div className="flex items-center gap-2">
            <div className="bg-brand-50 p-2 rounded-xl text-brand-600 dark:bg-brand-700/40 dark:text-brand-300">
                <FileText size={20} />
            </div>
            <div>
                <h3 id={titleId} className="text-lg font-bold text-brand-900 dark:text-brand-100 tracking-tight">Import Recipe</h3>
                <p className="text-xs text-brand-500 dark:text-brand-400 font-medium">Paste text from any website</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-100 rounded-full transition-colors dark:text-brand-500 dark:hover:text-brand-300 dark:hover:bg-brand-700/50"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
             <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 dark:bg-brand-700/40 dark:border-brand-700">
                 <div className="flex gap-3">
                     <div className="bg-white p-2 rounded-lg h-fit dark:bg-brand-800">
                         <Sparkles className="w-5 h-5 text-warm-500 dark:text-warm-300" />
                     </div>
                     <div>
                         <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">AI Recipe Parser</p>
                         <p className="text-xs text-brand-500 dark:text-brand-400 leading-relaxed mt-1">
                             Paste the full text of a recipe (title, ingredients, instructions) below.
                             Our AI will extract the structured data for you.
                         </p>
                     </div>
                 </div>
             </div>

             <div>
                 <textarea
                     value={text}
                     onChange={(e) => setText(e.target.value)}
                     placeholder="Paste recipe here...&#10;&#10;Example:&#10;Spaghetti Carbonara&#10;Ingredients:&#10;- 400g spaghetti&#10;- 150g pancetta&#10;..."
                     className="w-full h-64 p-4 bg-white border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-hidden text-sm font-mono text-brand-700 resize-none leading-relaxed dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:placeholder:text-brand-500"
                 />
             </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800/40 shrink-0">
            <div className="flex gap-3">
                <Button variant="ghost" className="flex-1" onClick={onClose} disabled={isParsing}>
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    className="flex-1"
                    onClick={handleParse}
                    disabled={!text.trim() || isParsing}
                    leftIcon={isParsing ? <Loader2 className="animate-spin" /> : <Sparkles size={18} />}
                >
                    {isParsing ? 'Parsing...' : 'Parse Recipe'}
                </Button>
            </div>
        </div>
      </div>
    </Modal>
  );
};
