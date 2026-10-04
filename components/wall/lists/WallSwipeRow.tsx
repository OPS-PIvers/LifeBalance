import React, { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

interface WallSwipeRowProps {
  label: string;
  done: boolean;
  onToggle: () => void;
  onDelete: () => void;
  /** Muted text after the label (quantity, person, day). */
  meta?: React.ReactNode;
}

const SWIPE_PX = 30;

/**
 * A checkable list row that swipes left to reveal Delete (plan §3 "Delete:
 * swipe left, then Undo"). Pointer events with `touch-action: pan-y`, so a
 * vertical drag still scrolls the list. Tapping anywhere else closes it.
 */
const WallSwipeRow: React.FC<WallSwipeRowProps> = ({ label, done, onToggle, onDelete, meta }) => {
  const [swiped, setSwiped] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!swiped) return undefined;
    const close = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setSwiped(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [swiped]);

  return (
    <div
      ref={rowRef}
      className={['row', done ? 'done' : '', swiped ? 'swiped' : ''].filter(Boolean).join(' ')}
      onPointerDown={e => {
        start.current = { x: e.clientX, y: e.clientY };
        moved.current = false;
      }}
      onPointerMove={e => {
        if (!start.current || moved.current) return;
        const dx = e.clientX - start.current.x;
        if (Math.abs(e.clientY - start.current.y) > Math.abs(dx)) return;
        if (dx < -SWIPE_PX) {
          moved.current = true;
          setSwiped(true);
        } else if (dx > SWIPE_PX) {
          moved.current = true;
          setSwiped(false);
        }
      }}
      onPointerUp={() => {
        start.current = null;
      }}
    >
      <button type="button" className="del" tabIndex={swiped ? 0 : -1} onClick={onDelete}>
        Delete
      </button>
      <button
        type="button"
        className="in"
        aria-pressed={done}
        onClick={() => {
          // A swipe ends in a click; it only opened or closed the row.
          if (moved.current) {
            moved.current = false;
            return;
          }
          if (swiped) setSwiped(false);
          else onToggle();
        }}
      >
        <span className="bx">{done && <Check className="wi" size="1em" aria-hidden="true" />}</span>
        <span className="tx">{label}</span>
        {meta}
      </button>
    </div>
  );
};

export default WallSwipeRow;
