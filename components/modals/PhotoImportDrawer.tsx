import React, { useRef, useState } from 'react';
import { X, Loader2, Camera, ImageUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';

/** A parsed line held for review, wrapped with its transient UI state. */
interface Row<T> {
  id: string;
  selected: boolean;
  data: T;
}

type View = 'menu' | 'processing' | 'review';

interface PhotoImportDrawerProps<T> {
  isOpen: boolean;
  onClose: () => void;
  /** Drawer title (e.g. "Scan a to-do list"). */
  title: string;
  /** Short helper text shown above the capture buttons. */
  hint: string;
  /** ARIA id used to label the drawer; must be unique per instance. */
  titleId: string;
  /**
   * Parse a base64 image into review rows. Already bound to householdId by the
   * caller. Runs off the AI vision path (proxy or direct SDK).
   */
  parse: (base64Image: string) => Promise<T[]>;
  /** Render one editable review row; `patch` merges a partial update into the row. */
  renderRow: (item: T, patch: (updates: Partial<T>) => void) => React.ReactNode;
  /** True when a row is complete enough to commit (e.g. non-empty text). */
  isRowValid: (item: T) => boolean;
  /** Commit the confirmed rows. Should throw on failure so the drawer can recover. */
  onCommit: (items: T[]) => Promise<void>;
  /** Label for the commit button given the number of selected valid rows. */
  commitLabel: (count: number) => string;
  /** Message shown when the parse returns no rows. */
  emptyResult: string;
  /** Optional helper to get a unique label for each item (for accessibility). */
  getItemLabel?: (item: T) => string;
}

/**
 * Shared capture → parse → review shell for the photo-import features
 * (F-TODO-06): snap a handwritten note and turn it into to-dos, or a whiteboard
 * menu into meal-plan entries. One implementation, two thin callers.
 *
 * Capture uses a plain file input (with `capture="environment"` for the camera
 * button) rather than a live MediaStream — no stream lifecycle to leak, and it
 * degrades to a file picker on desktop. The parsed lines are presented for
 * review/edit (per-line checkbox + editable fields) before anything is written,
 * per the roadmap.
 */
export function PhotoImportDrawer<T>({
  isOpen,
  onClose,
  title,
  hint,
  titleId,
  parse,
  renderRow,
  isRowValid,
  onCommit,
  commitLabel,
  emptyResult,
  getItemLabel,
}: PhotoImportDrawerProps<T>): React.ReactElement {
  const [view, setView] = useState<View>('menu');
  const [rows, setRows] = useState<Row<T>[]>([]);
  const [isCommitting, setIsCommitting] = useState(false);

  // Two inputs: one opens the camera on mobile (capture attr), one the gallery.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setView('menu');
    setRows([]);
    setIsCommitting(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setView('processing');
    let base64: string;
    try {
      base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
    } catch {
      toast.error('Failed to read image.');
      setView('menu');
      return;
    }

    try {
      const parsed = await parse(base64);
      if (parsed.length === 0) {
        toast.error(emptyResult);
        setView('menu');
        return;
      }
      setRows(
        parsed.map((data) => ({
          id: typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : Math.random().toString(36).substring(2, 11),
          selected: true,
          data,
        }))
      );
      setView('review');
    } catch (error) {
      // parse() already surfaces a user-facing toast via withErrorHandling.
      console.error('Photo import parse error:', error);
      setView('menu');
    }
  };

  const patchRow = (id: string, updates: Partial<T>) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, data: { ...r.data, ...updates } } : r))
    );
  };

  const toggleRow = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r)));
  };

  const selectedValidRows = rows.filter((r) => r.selected && isRowValid(r.data));

  const handleCommit = async () => {
    if (selectedValidRows.length === 0) {
      toast.error('Select at least one item to add.');
      return;
    }
    setIsCommitting(true);
    try {
      await onCommit(selectedValidRows.map((r) => r.data));
      handleClose();
    } catch (error) {
      console.error('Photo import commit error:', error);
      toast.error('Failed to add items. Please try again.');
      setIsCommitting(false);
    }
  };

  const header = (
    <div className="flex items-center justify-between px-6 py-4 border-b border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800">
      <h2
        id={titleId}
        className="font-display text-xl font-semibold text-brand-800 dark:text-brand-100"
      >
        {title}
      </h2>
      <Button
        variant="subtle"
        size="icon"
        className="rounded-full"
        onClick={handleClose}
        aria-label="Close drawer"
      >
        <X size={20} />
      </Button>
    </div>
  );

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      header={header}
      ariaLabelledBy={titleId}
      noPadding
      height="tall"
      disableClose={view === 'processing' || isCommitting}
      // The commit action only exists in the review step, so the footer bar is
      // conditional the same way — the menu/processing views keep the body's
      // own pb-safe bottom inset.
      footer={
        view === 'review' ? (
          <div className="flex gap-2 border-t border-brand-200 dark:border-brand-700 p-4">
            <Button variant="ghost" onClick={() => setView('menu')} disabled={isCommitting}>
              Retake
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleCommit}
              isLoading={isCommitting}
              disabled={selectedValidRows.length === 0}
            >
              {commitLabel(selectedValidRows.length)}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="p-6">
        {/* Hidden capture inputs shared by both entry buttons. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {view === 'menu' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-(--duration-base)">
            <p className="text-sm text-brand-500 dark:text-brand-400">{hint}</p>
            <div className="grid grid-cols-1 gap-3">
              <Button
                variant="primary"
                leftIcon={<Camera size={18} />}
                onClick={() => cameraInputRef.current?.click()}
              >
                Take a photo
              </Button>
              <Button
                variant="outline"
                leftIcon={<ImageUp size={18} />}
                onClick={() => galleryInputRef.current?.click()}
              >
                Choose an image
              </Button>
            </div>
          </div>
        )}

        {view === 'processing' && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-12 h-12 text-accent-600 dark:text-accent-300 animate-spin" />
            <p className="text-brand-500 dark:text-brand-400 font-medium">Reading the photo…</p>
          </div>
        )}

        {view === 'review' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-(--duration-base)">
            <p className="text-sm text-brand-500 dark:text-brand-400">
              Review and edit before adding. Untick anything you don&apos;t want.
            </p>
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start gap-3 rounded-xl border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 p-3"
                >
                  <input
                    type="checkbox"
                    checked={r.selected}
                    onChange={() => toggleRow(r.id)}
                    aria-label={getItemLabel ? `Include ${getItemLabel(r.data)}` : 'Include this item'}
                    className="mt-2 h-5 w-5 shrink-0 rounded border-brand-300 text-accent-600 focus:ring-accent-500"
                  />
                  <div className="min-w-0 flex-1">
                    {renderRow(r.data, (updates) => patchRow(r.id, updates))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Drawer>
  );
}
