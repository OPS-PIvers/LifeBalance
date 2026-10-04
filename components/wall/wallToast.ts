import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The wall's one toast slot (plan §3: "Undo for every write: a dark toast at
 * bottom center for 10 s. A newer toast replaces the older one").
 */
export interface WallToastState {
  id: number;
  text: string;
  undo?: () => Promise<void>;
}

export interface WallToaster {
  /** Shows `text` (replacing any toast), with Undo when `undo` is given. */
  show: (text: string, undo?: () => Promise<void>) => void;
  /**
   * Runs a write and shows its toast right away: a queued offline write
   * resolves only when it reaches the server, which can be much later.
   * A failed write replaces the toast with an error.
   */
  run: (write: Promise<unknown>, text: string, undo?: () => Promise<void>) => void;
}

export const WallToastContext = createContext<WallToaster>({ show: () => undefined, run: () => undefined });

export function useWallToaster(): WallToaster {
  return useContext(WallToastContext);
}

export const WALL_TOAST_MS = 10_000;

/** Owns the toast slot; WallApp provides `toaster` and renders `toast`. */
export function useWallToastController(): { toast: WallToastState | null; dismiss: () => void; toaster: WallToaster } {
  const [toast, setToast] = useState<WallToastState | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(() => setToast(current => (current?.id === toast.id ? null : current)), WALL_TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  const toaster = useMemo<WallToaster>(() => {
    const show = (text: string, undo?: () => Promise<void>) => {
      seq.current += 1;
      setToast({ id: seq.current, text, ...(undo ? { undo } : {}) });
    };
    return {
      show,
      run: (write, text, undo) => {
        show(text, undo);
        const id = seq.current;
        write.catch(error => {
          console.error('[wall] write failed:', error);
          setToast(current => (current?.id === id ? { id, text: "Couldn't save that. Try again." } : current));
        });
      },
    };
  }, []);

  const dismiss = useCallback(() => setToast(null), []);
  return { toast, dismiss, toaster };
}
