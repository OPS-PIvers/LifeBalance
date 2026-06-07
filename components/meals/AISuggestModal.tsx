import React from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { useMediaQuery } from '@/hooks/useMediaQuery';

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
  const isMobile = useMediaQuery('(max-width: 639px)');

  const content = (
    <div className="p-6">
        <h3 id="ai-modal-title" className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-900 dark:text-slate-100 tracking-tight">
            <Sparkles className="text-violet-600 dark:text-violet-400 w-6 h-6" /> Chef AI
        </h3>

        <div className="space-y-3 mb-8">
            <label className="flex items-center gap-3 p-3 border border-slate-200/60 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-700/50 transition-colors">
                <input
                    type="checkbox"
                    checked={aiOptions.cheap}
                    onChange={e => setAiOptions({...aiOptions, cheap: e.target.checked})}
                    className="w-5 h-5 rounded text-violet-600 focus:ring-violet-500"
                />
                <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200">Budget Friendly</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Low cost ingredients</div>
                </div>
            </label>

            <label className="flex items-center gap-3 p-4 border border-slate-200/60 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-violet-50/30 hover:border-violet-200/50 dark:hover:bg-violet-500/15 dark:hover:border-violet-500/30 transition-all">
                <input
                    type="checkbox"
                    checked={aiOptions.quick}
                    onChange={e => setAiOptions({...aiOptions, quick: e.target.checked})}
                    className="w-5 h-5 rounded text-violet-600 focus:ring-violet-500"
                />
                <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200">Quick & Easy</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Under 30 minutes</div>
                </div>
            </label>

            <label className="flex items-center gap-3 p-4 border border-slate-200/60 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-violet-50/30 hover:border-violet-200/50 dark:hover:bg-violet-500/15 dark:hover:border-violet-500/30 transition-all">
                <input
                    type="checkbox"
                    checked={aiOptions.new}
                    onChange={e => setAiOptions({...aiOptions, new: e.target.checked})}
                    className="w-5 h-5 rounded text-violet-600 focus:ring-violet-500"
                />
                <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200">Try Something New</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Avoid recent meals</div>
                </div>
            </label>
        </div>

        <button
            onClick={onSuggest}
            disabled={isGeneratingAI}
            className="w-full py-3.5 bg-violet-600 text-white font-bold rounded-xl hover:bg-violet-700 disabled:opacity-50 flex justify-center items-center gap-2 shadow-lg shadow-violet-200 transition-all active:scale-95"
        >
            {isGeneratingAI ? <Loader2 className="animate-spin w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            {isGeneratingAI ? 'Consulting Chef...' : 'Suggest Meal'}
        </button>

        <button
            onClick={onClose}
            disabled={isGeneratingAI}
            className="mt-3 w-full py-3 text-slate-500 hover:bg-slate-50 hover:text-slate-700 font-bold rounded-xl transition-colors dark:text-slate-400 dark:hover:bg-slate-700/50 dark:hover:text-slate-200"
        >
            Cancel
        </button>
    </div>
  );

  if (isMobile) {
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
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-sm"
      className="p-0"
      ariaLabelledBy="ai-modal-title"
    >
      {content}
    </Modal>
  );
};
