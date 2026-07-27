import React, { useRef } from 'react';
import { Camera } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';

/** Images larger than this are rejected before any upload/scan is attempted. */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface CaptureImageButtonProps {
  /** Called with a validated image file (type + size already checked). */
  onSelectImage: (file: File) => void;
  className?: string;
}

/**
 * The "hand it a photo instead of typing" affordance for the Capture drawer's
 * Money tab.
 *
 * Owns the hidden `<input type="file" accept="image/*">` plus its image-type
 * and 10MB size validation — extracted from the deleted two-card CaptureMenu
 * so that validation survived the redesign in one place. On mobile the native
 * file picker offers "Take Photo" or "Choose from Library", so this single
 * entry covers both a fresh snap and an existing screenshot/statement.
 *
 * Rendered as a SECONDARY, full-width button above the manual form: typing is
 * now the default path, and this is the alternative. The REVIEW badge is the
 * lighter survivor of the old menu's INSTANT/REVIEW pair — a scanned image
 * lands in the Action Queue for review rather than hitting the budget
 * immediately (the manual form carries its own "saves instantly" note).
 */
export const CaptureImageButton: React.FC<CaptureImageButtonProps> = ({
  onSelectImage,
  className,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('Image too large (max 10MB)');
      return;
    }

    onSelectImage(file);

    // Reset so re-picking the SAME file still fires a change event.
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className={cn('w-full', className)}>
      {/* Explicit aria-label: the computed name from the visual content is an
          unpunctuated run-on ("Scan a receipt or screenshotREVIEW"). */}
      {/* Two deliberate lines (label + hint) rather than a base-size label
          that wraps by accident at 375px — the icon/label/badge row is the
          same shape the previous capture menu used for this entry. */}
      <Button
        type="button"
        variant="secondary"
        size="lg"
        onClick={() => fileInputRef.current?.click()}
        className="w-full justify-start gap-3 px-4 py-3"
        aria-label="Scan a receipt or screenshot. Goes to your Action Queue for review before it affects your budget."
      >
        <Camera size={20} className="shrink-0 text-accent-600 dark:text-accent-300" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-semibold text-brand-800 dark:text-brand-100">
            Scan a receipt or screenshot
          </span>
          <span className="block text-xs font-normal text-brand-500 dark:text-brand-400">
            Camera or photo library
          </span>
        </span>
        <Badge variant="warning" size="sm">
          REVIEW
        </Badge>
      </Button>
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
