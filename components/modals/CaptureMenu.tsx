import React, { useRef } from 'react';
import { Camera, Type } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import toast from 'react-hot-toast';

interface CaptureMenuProps {
  onSelectImage: (file: File) => void;
  onManual: () => void;
}

// The two highest-frequency ways a household logs an expense: type one in, or
// hand over a photo (the browser's native file picker offers "Take Photo" or
// "Choose from Library" on mobile, so one entry covers both a fresh snap and
// an existing screenshot/statement). Full-width, rich rows (colored icon tile
// + bold label + badge) carry the visual weight as the primary methods.
const PRIMARY_BUTTON_CLASSES = "w-full flex items-center gap-4 p-4 surface-section hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard) active:scale-[0.98] group focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40";

export const CaptureMenu: React.FC<CaptureMenuProps> = ({
  onSelectImage,
  onManual,
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

    onSelectImage(file);

    // Reset input
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-(--duration-base)">
      {/* Each card gets an explicit punctuated aria-label — the computed name
          from the visual content is an unpunctuated run-on ("Manual EntryType
          in an expenseINSTANT…"), which is a wall of words in a screen
          reader. The label overrides the content for the accessible name. */}
      <button
        type="button"
        onClick={onManual}
        className={PRIMARY_BUTTON_CLASSES}
        aria-label="Manual entry: type in an expense. Instant, updates your budget immediately."
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
        </Badge>
      </button>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className={PRIMARY_BUTTON_CLASSES}
        aria-label="Add from image: snap a photo or choose from your library. Review, shows in the Action Queue before affecting your budget."
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent-50 dark:bg-accent-800/40 text-accent-600 dark:text-accent-300">
          <Camera size={24} />
        </div>
        <div className="text-left flex-1">
          <span className="font-bold text-brand-900 dark:text-brand-100 block">Add from Image</span>
          <span className="text-xs text-brand-500 dark:text-brand-400">Snap a photo or choose from your library</span>
        </div>
        <Badge variant="warning" size="sm">
          REVIEW
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
