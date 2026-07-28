import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Link2, Loader2, Sparkles } from 'lucide-react';
import type { Meal } from '@/types/schema';
import { getFunctionsInstance } from '@/firebase.config';
import toast from 'react-hot-toast';

interface RecipeImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  householdId: string;
  onConfirm: (meal: Partial<Meal>) => void;
}

/** Response shape of the `fetchrecipepage` callable (functions/src/fetchRecipePage.ts). */
interface FetchRecipePageResult {
  text: string;
  usedJsonLd: boolean;
}

export const RecipeImportModal: React.FC<RecipeImportModalProps> = ({
  isOpen,
  onClose,
  householdId,
  onConfirm
}) => {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  // The URL a successful server-side fetch came from. Recipe URLs are set in
  // CODE, never trusted from the model — after a parse that originated from a
  // URL fetch, this overwrites `result.recipeUrl`.
  const [fetchedUrl, setFetchedUrl] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [isParsing, setIsParsing] = useState(false);

  const handleFetch = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      toast.error('Please enter a recipe link first');
      return;
    }

    setIsFetching(true);
    try {
      // Lazy `firebase/functions` import + getFunctionsInstance keeps the
      // functions SDK off the boot path (same pattern as NotificationSettings).
      const [{ httpsCallable }, functions] = await Promise.all([
        import('firebase/functions'),
        getFunctionsInstance(),
      ]);
      const fetchPage = httpsCallable<{ url: string }, FetchRecipePageResult>(
        functions,
        'fetchrecipepage'
      );
      const { data } = await fetchPage({ url: trimmedUrl });
      setText(data.text);
      setFetchedUrl(trimmedUrl);
      toast.success('Recipe page loaded — review the text, then parse.');
    } catch (error) {
      console.error('Recipe page fetch failed:', error);
      toast.error('Could not fetch that link. Paste the recipe text instead.');
    } finally {
      setIsFetching(false);
    }
  };

  const handleParse = async () => {
    if (!text.trim()) {
      toast.error('Please paste a recipe first');
      return;
    }

    setIsParsing(true);
    try {
      const { parseRecipe } = await import('@/services/geminiService');
      const parsed = await parseRecipe(householdId, text);
      // Code-owned URL (repo convention): the actual fetched link wins over
      // whatever the model put in recipeUrl.
      const result = fetchedUrl ? { ...parsed, recipeUrl: fetchedUrl } : parsed;
      onConfirm(result);
      onClose();
      setText(''); // Reset
      setUrl('');
      setFetchedUrl('');
      toast.success('Recipe parsed successfully!');
    } catch (error) {
      console.error('Recipe parsing failed:', error);
      toast.error('Failed to parse recipe. Please try again.');
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Import Recipe"
      footer={
        <div className="flex gap-3 border-t border-brand-200 dark:border-brand-700 p-4">
            <Button variant="ghost" className="flex-1" onClick={onClose} disabled={isParsing}>
                Cancel
            </Button>
            <Button
                variant="primary"
                className="flex-1"
                onClick={handleParse}
                disabled={!text.trim() || isParsing || isFetching}
                leftIcon={isParsing ? <Loader2 className="animate-spin" /> : <Sparkles size={18} />}
            >
                {isParsing ? 'Parsing...' : 'Parse Recipe'}
            </Button>
        </div>
      }
    >
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
                        Fetch a recipe from a link, or paste the full text of a recipe
                        (title, ingredients, instructions) below. Our AI will extract
                        the structured data for you.
                    </p>
                </div>
            </div>
        </div>

        <div className="flex gap-2 items-start">
            <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.allrecipes.com/recipe/..."
                aria-label="Recipe link"
                disabled={isFetching || isParsing}
            />
            <Button
                variant="secondary"
                className="shrink-0"
                onClick={handleFetch}
                disabled={!url.trim() || isFetching || isParsing}
                leftIcon={isFetching ? <Loader2 className="animate-spin" size={18} /> : <Link2 size={18} />}
            >
                {isFetching ? 'Fetching...' : 'Fetch from link'}
            </Button>
        </div>

        <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste recipe here...&#10;&#10;Example:&#10;Spaghetti Carbonara&#10;Ingredients:&#10;- 400g spaghetti&#10;- 150g pancetta&#10;..."
            className="w-full h-64 p-4 bg-white border border-brand-200 rounded-btn focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-hidden text-sm font-mono text-brand-700 resize-none leading-relaxed dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:placeholder:text-brand-450"
        />
      </div>
    </Drawer>
  );
};
