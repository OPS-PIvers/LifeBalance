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

const BUTTON_CLASSES = "w-full flex items-center gap-4 p-4 surface-section hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard) active:scale-[0.98] group focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40";

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

      <div className="bg-brand-50 dark:bg-brand-700/40 p-3 rounded-xl border border-brand-200 dark:border-brand-700 flex items-start gap-3">
        <Shield size={16} className="text-brand-500 dark:text-brand-400 mt-0.5 shrink-0" />
        <p className="text-xs text-brand-600 dark:text-brand-300">
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
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent-50 dark:bg-accent-800/40 text-accent-600 dark:text-accent-300">
          <Camera size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-brand-900 dark:text-brand-100 block">Scan Receipt</span>
          <span className="text-xs text-brand-500 dark:text-brand-400">Take a photo of your receipt</span>
        </div>
        <Badge variant="warning" size="sm">
          REVIEW
        </Badge>
      </button>

      <button
        onClick={() => fileInputRef.current?.click()}
        className={BUTTON_CLASSES}
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-warm-50 dark:bg-warm-900/30 text-warm-600 dark:text-warm-300">
          <Upload size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-brand-900 dark:text-brand-100 block">Upload Image</span>
          <span className="text-xs text-brand-500 dark:text-brand-400">Bank statement or receipt screenshot</span>
        </div>
        <Badge variant="warning" size="sm">
          REVIEW
        </Badge>
      </button>

      <button
        onClick={onManual}
        className={BUTTON_CLASSES}
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-money-bgPos dark:bg-money-pos/15 text-money-pos">
          <Type size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-brand-900 dark:text-brand-100 block">Manual Entry</span>
          <span className="text-xs text-brand-500 dark:text-brand-400">Enter transaction details directly</span>
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
        <p className="text-xs text-brand-400 dark:text-brand-500">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-warm-500"></span>
            Review = shows in Action Queue
          </span>
          <span className="mx-2">•</span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-money-pos"></span>
            Instant = updates budget immediately
          </span>
        </p>
      </div>
    </div>
  );
};
