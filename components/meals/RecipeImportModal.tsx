import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Loader2, Sparkles } from 'lucide-react';
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
    <Drawer isOpen={isOpen} onClose={onClose} title="Import Recipe">
      {/* Single scroll container is the Drawer body — no nested scrollers. */}
      <div className="space-y-4">
        <div className="bg-brand-50 border border-brand-200 rounded-card p-4 dark:bg-brand-700/40 dark:border-brand-700">
            <div className="flex gap-3">
                <div className="bg-white p-2 rounded-btn h-fit dark:bg-brand-800">
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

        <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste recipe here...&#10;&#10;Example:&#10;Spaghetti Carbonara&#10;Ingredients:&#10;- 400g spaghetti&#10;- 150g pancetta&#10;..."
            className="w-full h-64 p-4 bg-white border border-brand-200 rounded-btn focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-hidden text-sm font-mono text-brand-700 resize-none leading-relaxed dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:placeholder:text-brand-450"
        />

        <div className="flex gap-3 pt-1">
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
    </Drawer>
  );
};
