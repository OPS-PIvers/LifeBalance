import React from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';

export type AIOptions = {
  cheap: boolean;
  quick: boolean;
  new: boolean;
};

interface AISuggestModalProps {
  isOpen: boolean;
  onClose: () => void;
  aiOptions: AIOptions;
  setAiOptions: React.Dispatch<React.SetStateAction<AIOptions>>;
  isGeneratingAI: boolean;
  onSuggest: () => void;
}

export const AISuggestModal: React.FC<AISuggestModalProps> = ({
  isOpen,
  onClose,
  aiOptions,
  setAiOptions,
  isGeneratingAI,
  onSuggest
}) => {
  const content = (
    <div className="p-6">
        <h3 id="ai-modal-title" className="text-xl font-bold mb-6 flex items-center gap-2 text-brand-900 dark:text-brand-100 tracking-tight">
            <Sparkles className="text-warm-500 dark:text-warm-300 w-6 h-6" /> Chef AI
        </h3>

        <div className="space-y-3 mb-8">
            <label className="flex items-center gap-3 p-3 border border-brand-200 dark:border-brand-700 rounded-xl cursor-pointer hover:bg-brand-50 dark:hover:bg-brand-700/50 transition-colors duration-(--duration-fast) ease-(--ease-standard)">
                <input
                    type="checkbox"
                    checked={aiOptions.cheap}
                    onChange={e => setAiOptions({...aiOptions, cheap: e.target.checked})}
                    className="w-5 h-5 rounded-sm text-warm-500 focus:ring-warm-500/40"
                />
                <div>
                    <div className="font-bold text-brand-800 dark:text-brand-200">Budget Friendly</div>
                    <div className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">Low cost ingredients</div>
                </div>
            </label>

            <label className="flex items-center gap-3 p-4 border border-brand-200 dark:border-brand-700 rounded-xl cursor-pointer hover:bg-warm-50 hover:border-warm-200 dark:hover:bg-warm-500/15 dark:hover:border-warm-500/30 transition-colors duration-(--duration-fast) ease-(--ease-standard)">
                <input
                    type="checkbox"
                    checked={aiOptions.quick}
                    onChange={e => setAiOptions({...aiOptions, quick: e.target.checked})}
                    className="w-5 h-5 rounded-sm text-warm-500 focus:ring-warm-500/40"
                />
                <div>
                    <div className="font-bold text-brand-800 dark:text-brand-200">Quick & Easy</div>
                    <div className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">Under 30 minutes</div>
                </div>
            </label>

            <label className="flex items-center gap-3 p-4 border border-brand-200 dark:border-brand-700 rounded-xl cursor-pointer hover:bg-warm-50 hover:border-warm-200 dark:hover:bg-warm-500/15 dark:hover:border-warm-500/30 transition-colors duration-(--duration-fast) ease-(--ease-standard)">
                <input
                    type="checkbox"
                    checked={aiOptions.new}
                    onChange={e => setAiOptions({...aiOptions, new: e.target.checked})}
                    className="w-5 h-5 rounded-sm text-warm-500 focus:ring-warm-500/40"
                />
                <div>
                    <div className="font-bold text-brand-800 dark:text-brand-200">Try Something New</div>
                    <div className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">Avoid recent meals</div>
                </div>
            </label>
        </div>

        <button
            onClick={onSuggest}
            disabled={isGeneratingAI}
            className="w-full py-3.5 bg-warm-500 text-white font-bold rounded-btn hover:bg-warm-600 disabled:opacity-50 flex justify-center items-center gap-2 transition-colors duration-(--duration-fast) ease-(--ease-standard) active:scale-95"
        >
            {isGeneratingAI ? <Loader2 className="animate-spin w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            {isGeneratingAI ? 'Consulting Chef...' : 'Suggest Meal'}
        </button>

        <button
            onClick={onClose}
            disabled={isGeneratingAI}
            className="mt-3 w-full py-3 text-brand-500 hover:bg-brand-50 hover:text-brand-700 font-bold rounded-btn transition-colors duration-(--duration-fast) ease-(--ease-standard) dark:text-brand-400 dark:hover:bg-brand-700/50 dark:hover:text-brand-200"
        >
            Cancel
        </button>
    </div>
  );

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      noPadding
      title="Chef AI"
    >
      {content}
    </Drawer>
  );
};
