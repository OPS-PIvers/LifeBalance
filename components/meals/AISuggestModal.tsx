import React from 'react';
import { Sparkles } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { SurfaceList, Row } from '@/components/ui/Section';

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

        <div className="mb-8">
          <SurfaceList>
            <Row>
                <label htmlFor="ai-cheap" className="flex-1 cursor-pointer">
                    <div className="font-bold text-brand-800 dark:text-brand-200">Budget Friendly</div>
                    <div className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">Low cost ingredients</div>
                </label>
                <Switch
                    id="ai-cheap"
                    checked={aiOptions.cheap}
                    onCheckedChange={checked => setAiOptions({...aiOptions, cheap: checked})}
                    aria-label="Budget Friendly"
                />
            </Row>

            <Row>
                <label htmlFor="ai-quick" className="flex-1 cursor-pointer">
                    <div className="font-bold text-brand-800 dark:text-brand-200">Quick & Easy</div>
                    <div className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">Under 30 minutes</div>
                </label>
                <Switch
                    id="ai-quick"
                    checked={aiOptions.quick}
                    onCheckedChange={checked => setAiOptions({...aiOptions, quick: checked})}
                    aria-label="Quick & Easy"
                />
            </Row>

            <Row>
                <label htmlFor="ai-new" className="flex-1 cursor-pointer">
                    <div className="font-bold text-brand-800 dark:text-brand-200">Try Something New</div>
                    <div className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">Avoid recent meals</div>
                </label>
                <Switch
                    id="ai-new"
                    checked={aiOptions.new}
                    onCheckedChange={checked => setAiOptions({...aiOptions, new: checked})}
                    aria-label="Try Something New"
                />
            </Row>
          </SurfaceList>
        </div>

        <Button
            variant="warning"
            size="lg"
            className="w-full"
            onClick={onSuggest}
            isLoading={isGeneratingAI}
            leftIcon={<Sparkles className="w-5 h-5" />}
        >
            Suggest Meal
        </Button>

        <Button
            variant="ghost"
            size="lg"
            className="mt-3 w-full"
            onClick={onClose}
            disabled={isGeneratingAI}
        >
            Cancel
        </Button>
    </div>
  );

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      disableClose={isGeneratingAI}
      noPadding
      title="Chef AI"
    >
      {content}
    </Drawer>
  );
};
