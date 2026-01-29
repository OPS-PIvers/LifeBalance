import React, { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';

export interface AIOptions {
  cheap: boolean;
  quick: boolean;
  new: boolean;
}

interface AIMealModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuggest: (options: AIOptions) => void;
  isGenerating: boolean;
}

export const AIMealModal: React.FC<AIMealModalProps> = ({
  isOpen,
  onClose,
  onSuggest,
  isGenerating,
}) => {
  const [options, setOptions] = useState<AIOptions>({
    cheap: false,
    quick: false,
    new: false,
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-modal flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-modal-title"
    >
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl animate-in zoom-in-95 duration-200">
        <h3
          id="ai-modal-title"
          className="text-xl font-bold mb-6 flex items-center gap-2 text-gray-900"
        >
          <Sparkles className="text-purple-600 w-6 h-6" /> Chef AI
        </h3>

        <div className="space-y-3 mb-8">
          <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox"
              checked={options.cheap}
              onChange={(e) => setOptions({ ...options, cheap: e.target.checked })}
              className="w-5 h-5 rounded text-purple-600 focus:ring-purple-500"
            />
            <div>
              <div className="font-bold text-gray-800">Budget Friendly</div>
              <div className="text-xs text-gray-500 mt-0.5">Low cost ingredients</div>
            </div>
          </label>

          <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl cursor-pointer hover:bg-purple-50 hover:border-purple-200 transition-all">
            <input
              type="checkbox"
              checked={options.quick}
              onChange={(e) => setOptions({ ...options, quick: e.target.checked })}
              className="w-5 h-5 rounded text-purple-600 focus:ring-purple-500"
            />
            <div>
              <div className="font-bold text-gray-800">Quick & Easy</div>
              <div className="text-xs text-gray-500 mt-0.5">Under 30 minutes</div>
            </div>
          </label>

          <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl cursor-pointer hover:bg-purple-50 hover:border-purple-200 transition-all">
            <input
              type="checkbox"
              checked={options.new}
              onChange={(e) => setOptions({ ...options, new: e.target.checked })}
              className="w-5 h-5 rounded text-purple-600 focus:ring-purple-500"
            />
            <div>
              <div className="font-bold text-gray-800">Try Something New</div>
              <div className="text-xs text-gray-500 mt-0.5">Avoid recent meals</div>
            </div>
          </label>
        </div>

        <button
          onClick={() => onSuggest(options)}
          disabled={isGenerating}
          className="w-full py-3.5 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 disabled:opacity-50 flex justify-center items-center gap-2 shadow-lg shadow-purple-200 transition-all active:scale-95"
        >
          {isGenerating ? (
            <Loader2 className="animate-spin w-5 h-5" />
          ) : (
            <Sparkles className="w-5 h-5" />
          )}
          {isGenerating ? 'Consulting Chef...' : 'Suggest Meal'}
        </button>

        <button
          onClick={onClose}
          disabled={isGenerating}
          className="mt-3 w-full py-3 text-gray-500 hover:bg-gray-50 hover:text-gray-700 font-bold rounded-xl transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
