import React, { useRef, useState } from 'react';
import { Camera, Upload, Type, Shield, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { CaptureMagicAction } from './CaptureMagicAction';
import type { MagicActionResponse } from '@/services/geminiService.types';
import toast from 'react-hot-toast';

// One-time-per-session PII disclaimer: shown until the user explicitly
// dismisses it, then suppressed for the rest of the browser session. Never
// auto-set on mere render — only the explicit dismiss writes the key.
const PII_NOTICE_KEY = 'lifebalance_pii_notice_seen';

/** Lazily read sessionStorage, guarding against jsdom/private-mode throws. */
const readPiiNoticeSeen = (): boolean => {
  try {
    return sessionStorage.getItem(PII_NOTICE_KEY) !== null;
  } catch {
    return false;
  }
};

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
  const [piiNoticeSeen, setPiiNoticeSeen] = useState(readPiiNoticeSeen);

  const dismissPiiNotice = () => {
    try {
      sessionStorage.setItem(PII_NOTICE_KEY, '1');
    } catch {
      // Ignore — worst case the notice reappears next render, which is safe.
    }
    setPiiNoticeSeen(true);
  };

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

      {!piiNoticeSeen && (
        <div className="bg-brand-50 dark:bg-brand-700/40 p-3 rounded-xl border border-brand-200 dark:border-brand-700 flex items-start gap-3">
          <Shield size={16} className="text-brand-500 dark:text-brand-400 mt-0.5 shrink-0" />
          <p className="text-xs text-brand-600 dark:text-brand-300 flex-1">
            <strong>AI Processing:</strong> Avoid capturing PII like full names or card numbers.
          </p>
          <button
            type="button"
            onClick={dismissPiiNotice}
            aria-label="Dismiss PII notice"
            className="shrink-0 min-w-11 min-h-11 flex items-center justify-center text-brand-400 dark:text-brand-500 hover:text-brand-600 dark:hover:text-brand-300 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-full"
          >
            <X size={14} />
          </button>
        </div>
      )}

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
        </div>
        <Badge variant="warning" size="sm">
          REVIEW
          <span className="sr-only">: shows in Action Queue before affecting your budget</span>
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
          <span className="sr-only">: shows in Action Queue before affecting your budget</span>
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
        </div>
        <Badge variant="success" size="sm">
          INSTANT
          <span className="sr-only">: updates budget immediately</span>
        </Badge>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
};
