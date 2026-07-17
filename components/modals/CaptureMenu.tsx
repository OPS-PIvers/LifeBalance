import React, { useRef, useState } from 'react';
import { Camera, Upload, Type, Shield, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { CaptureMagicAction } from './CaptureMagicAction';
import type { MagicActionResponse } from '@/services/geminiService.types';
import toast from 'react-hot-toast';

// One-time-per-device PII disclaimer: shown until the user explicitly
// dismisses it, then suppressed on this device (localStorage — it was
// per-session, which re-injected compliance anxiety into the app's
// highest-frequency flow every browser session; round-3 critique). Never
// auto-set on mere render — only the explicit dismiss writes the key.
const PII_NOTICE_KEY = 'lifebalance_pii_notice_seen';

/** Lazily read localStorage, guarding against jsdom/private-mode throws. */
const readPiiNoticeSeen = (): boolean => {
  try {
    return localStorage.getItem(PII_NOTICE_KEY) !== null;
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

// Primary capture methods: full-width, rich rows (colored icon tile + bold
// label + badge). These are the two highest-frequency ways a household logs an
// expense — snap a receipt, or type one in — so they carry the visual weight.
const PRIMARY_BUTTON_CLASSES = "w-full flex items-center gap-4 p-4 surface-section hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard) active:scale-[0.98] group focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40";

// Secondary method: a quieter, compact row (small neutral icon, no filled tile)
// so the less-frequent bank-statement/screenshot upload recedes below the two
// primary actions instead of competing as a third equal-weight card.
const SECONDARY_BUTTON_CLASSES = "w-full flex items-center gap-3 p-3 rounded-btn border border-brand-200 dark:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-700/30 transition-colors duration-(--duration-fast) ease-(--ease-standard) active:scale-[0.98] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40";

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
      localStorage.setItem(PII_NOTICE_KEY, '1');
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
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-(--duration-base)">

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
            className="shrink-0 min-w-11 min-h-11 flex items-center justify-center text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-full"
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

      {/* Primary methods — the two highest-frequency ways to add an expense. */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={onManual}
          className={PRIMARY_BUTTON_CLASSES}
        >
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-money-bgPos dark:bg-money-pos/15 text-money-pos dark:text-money-posDark">
            <Type size={24} />
          </div>
          <div className="text-left flex-1">
            <span className="font-bold text-brand-900 dark:text-brand-100 block">Manual Entry</span>
            <span className="text-xs text-brand-500 dark:text-brand-400">Type in an expense</span>
          </div>
          <Badge variant="success" size="sm">
            INSTANT
            <span className="sr-only">. Updates your budget immediately.</span>
          </Badge>
        </button>

        <button
          type="button"
          onClick={onScan}
          className={PRIMARY_BUTTON_CLASSES}
        >
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent-50 dark:bg-accent-800/40 text-accent-600 dark:text-accent-300">
            <Camera size={24} />
          </div>
          <div className="text-left flex-1">
            <span className="font-bold text-brand-900 dark:text-brand-100 block">Scan Receipt</span>
            <span className="text-xs text-brand-500 dark:text-brand-400">Snap a photo, we read the total</span>
          </div>
          <Badge variant="warning" size="sm">
            REVIEW
            <span className="sr-only">. Shows in the Action Queue before affecting your budget.</span>
          </Badge>
        </button>
      </div>

      {/* Secondary — quieter, less-frequent method under a soft label. Plain
          normal-case label (not an uppercase tracked eyebrow) keeps it calm. */}
      <div className="space-y-2 pt-1">
        <p className="px-1 text-xs font-medium text-brand-500 dark:text-brand-400">More ways to add</p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={SECONDARY_BUTTON_CLASSES}
        >
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-brand-100 dark:bg-brand-700/50 text-brand-500 dark:text-brand-400 shrink-0">
            <Upload size={18} />
          </div>
          <div className="text-left flex-1 min-w-0">
            <span className="font-semibold text-sm text-brand-700 dark:text-brand-200 block">Upload image</span>
            <span className="text-xs text-brand-500 dark:text-brand-400">Bank statement or receipt screenshot</span>
          </div>
          <Badge variant="warning" size="sm">
            REVIEW
            <span className="sr-only">. Shows in the Action Queue before affecting your budget.</span>
          </Badge>
        </button>
      </div>

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
