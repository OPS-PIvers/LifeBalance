import React, { useRef } from 'react';
import { Camera, Upload, Type, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { CaptureMagicAction } from './CaptureMagicAction';
import type { MagicActionResponse } from '@/services/geminiService.types';
import toast from 'react-hot-toast';

interface CaptureMenuProps {
  onScan: () => void;
  onFileSelect: (file: File) => void;
  onManual: () => void;
  householdId: string;
  dynamicCategories: string[];
  onMagicSuccess: (result: MagicActionResponse) => void;
}

const BUTTON_CLASSES = "w-full flex items-center gap-4 p-4 bg-white/80 dark:bg-slate-800/60 backdrop-blur-xs border-transparent ring-1 ring-black/5 rounded-2xl shadow-glass hover:ring-black/10 hover:shadow-lg transition-all active:scale-[0.98] group";

export const CaptureMenu: React.FC<CaptureMenuProps> = ({
  onScan,
  onFileSelect,
  onManual,
  householdId,
  dynamicCategories,
  onMagicSuccess
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Basic validation here
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      toast.error('Image too large (max 10MB)');
      return;
    }

    onFileSelect(file);

    // Reset input
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">

      <div className="bg-blue-50 dark:bg-blue-500/15 p-3 rounded-xl border border-blue-100 dark:border-blue-500/30 flex items-start gap-3">
        <Shield size={16} className="text-blue-600 dark:text-blue-300 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700 dark:text-blue-300">
          <strong>AI Processing:</strong> Avoid capturing PII like full names or card numbers.
        </p>
      </div>

      <CaptureMagicAction
        householdId={householdId}
        dynamicCategories={dynamicCategories}
        onSuccess={onMagicSuccess}
      />

      <button
        onClick={onScan}
        className={BUTTON_CLASSES}
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
          <Camera size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-slate-900 dark:text-slate-100 block">Scan Receipt</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">Take a photo of your receipt</span>
        </div>
        <Badge variant="warning" size="sm">
          REVIEW
        </Badge>
      </button>

      <button
        onClick={() => fileInputRef.current?.click()}
        className={BUTTON_CLASSES}
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300">
          <Upload size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-slate-900 dark:text-slate-100 block">Upload Image</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">Bank statement or receipt screenshot</span>
        </div>
        <Badge variant="warning" size="sm">
          REVIEW
        </Badge>
      </button>

      <button
        onClick={onManual}
        className={BUTTON_CLASSES}
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
          <Type size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-slate-900 dark:text-slate-100 block">Manual Entry</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">Enter transaction details directly</span>
        </div>
        <Badge variant="success" size="sm">
          INSTANT
        </Badge>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="text-center pt-2">
        <p className="text-xs text-brand-400 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            Review = shows in Action Queue
          </span>
          <span className="mx-2">•</span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-400"></span>
            Instant = updates budget immediately
          </span>
        </p>
      </div>
    </div>
  );
};
