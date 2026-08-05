import React, { useEffect, useRef } from 'react';
import { Check, Plus, Star, X } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO, isBefore, startOfToday } from 'date-fns';
import { QUADRANT_ORDER, type Quadrant } from '@/utils/eisenhower';
import { ToDo } from '@/types/schema';
import toast from 'react-hot-toast';
import { HapticCheck } from '@/components/ui/HapticCheck';
import { Button } from '@/components/ui/Button';
import Eyebrow from '@/components/ui/Eyebrow';
import { cn } from '@/utils/cn';
import { getTodoCategoryColor } from '@/utils/todoCategoryColor';
import { type SectionColor, dateColorMap, sectionDotColors, QUADRANT_SECTIONS } from './todoDisplay';

// Extracted from pages/ToDosPage.tsx (Plan 27) — the grid/landscape render
// branch (the `effectiveArrangement === 'grid'` case), plus its own
// GridOverlay/GridCell/GridChip subcomponents which are used only here.
// Landscape-only overlay: in portrait the page renders a flat list — there is
// no stacked "matrix" arrangement to fall back to. Both the old portrait
// matrix view and the `effectiveArrangement` switch that chose between it and
// this grid were deleted in #1061 ("portrait = flat list, landscape
// auto-shows the immersive overlay"). Portrait users see parked to-dos via
// the page's own "Saved for later" list section instead of this component.

// Stable empty-array reference for quadrants that never carry parked items
// (only `later` does), so GridCell's memo comparator doesn't see a new `[]`
// identity every render.
const EMPTY_PARKED: readonly ToDo[] = [];

export interface EisenhowerGridViewProps {
  quadrants: Record<Quadrant, ToDo[]>;
  /**
   * "Saved for later" to-dos, already filtered to match `quadrants`' own
   * assignee/category filters (see ToDosPage's `parkedRows`). Rendered ONLY
   * inside the `later` cell, grouped behind a subheader beneath the real
   * `later` tasks — quadrant assignment for a parked item is unconditional,
   * never derived from `quadrantForTodo`/its inert placeholder date.
   */
  parkedTodos: ToDo[];
  onComplete: (id: string) => void;
  onEdit: (todo: ToDo) => void;
  onToggleImportant: (todo: ToDo) => void;
  /** Opens the promote (triage) sheet for a parked chip's `+` control. */
  onPromote: (todo: ToDo) => void;
  /** Exit the immersive grid: persists arrangement back to 'list'. */
  onExit: () => void;
  /**
   * Suppress the Escape shortcut while a layer is open ABOVE the grid (edit
   * drawer / task-options drawer). Those layers own Escape — without this
   * gate one keypress would close the drawer AND exit the grid.
   */
  escapeDisabled: boolean;
}

export const EisenhowerGridView: React.FC<EisenhowerGridViewProps> = ({ quadrants, parkedTodos, onComplete, onEdit, onToggleImportant, onPromote, onExit, escapeDisabled }) => (
  /* True 2×2 Eisenhower grid — auto-immersive full-screen overlay.
     In landscape (~375px tall) the toolbar + tabs + bottom nav left
     the in-page grid an unusable sliver, so the grid takes the whole
     viewport instead; ✕ (or Escape / rotating away) leaves it. */
  <GridOverlay
    quadrants={quadrants}
    parkedTodos={parkedTodos}
    onComplete={onComplete}
    onEdit={onEdit}
    onToggleImportant={onToggleImportant}
    onPromote={onPromote}
    onExit={onExit}
    escapeDisabled={escapeDisabled}
  />
);

interface GridOverlayProps {
  quadrants: Record<Quadrant, ToDo[]>;
  parkedTodos: ToDo[];
  onComplete: (id: string) => void;
  onEdit: (todo: ToDo) => void;
  onToggleImportant: (todo: ToDo) => void;
  onPromote: (todo: ToDo) => void;
  /** Exit the immersive grid: persists arrangement back to 'list'. */
  onExit: () => void;
  /**
   * Suppress the Escape shortcut while a layer is open ABOVE the grid (edit
   * drawer / task-options drawer). Those layers own Escape — without this
   * gate one keypress would close the drawer AND exit the grid.
   */
  escapeDisabled: boolean;
}

// Immersive full-screen 2×2 Eisenhower grid. Fixed overlay at z-banner (55):
// above the BottomNav wrapper (z-sticky, 40) and TopToolbar (z-dropdown, 50),
// below the Drawer/modal layer (z-modal, 60) so the edit drawer still opens on
// top. Deliberately NON-modal (role="region", no aria-modal, no focus trap):
// the edit drawer portals to document.body — outside this container — with its
// own document-level focus trap, and a second competing trap here would fight
// it for focus. The close button gets initial focus and Escape exits instead.
const GridOverlay: React.FC<GridOverlayProps> = ({ quadrants, parkedTodos, onComplete, onEdit, onToggleImportant, onPromote, onExit, escapeDisabled }) => {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus the exit control on mount so keyboard users land inside the overlay.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // NOTE: the body-scroll lock for this overlay lives in ToDosPage (page-level
  // latch), NOT here — an overlay-local lock would unlock body scroll behind a
  // still-open drawer when rotating to portrait unmounts this component. See
  // the scrollLockHeld comment in ToDosPage.

  // Escape exits (same as ✕) unless a drawer above the grid owns the key.
  useEffect(() => {
    if (escapeDisabled) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [escapeDisabled, onExit]);

  return (
    <div
      role="region"
      aria-label="Eisenhower matrix"
      data-testid="grid-overlay"
      className="fixed inset-0 z-banner bg-brand-50 dark:bg-brand-900 p-screen-safe"
    >
      {/* Inner flex column: slim header, axis labels, then the grid taking
          every remaining pixel (flex-1 min-h-0; cells scroll internally —
          the matrix itself never scrolls as a unit). */}
      <div className="flex flex-col h-full px-3 pt-1.5 pb-2 gap-1">
        <div className="flex items-center justify-between gap-2 shrink-0">
          {/* size="xxs": the landscape overlay is height-starved (~375px), so
              the eyebrow drops one size step via its sanctioned size prop. */}
          <Eyebrow as="h2" size="xxs">
            Eisenhower matrix
          </Eyebrow>
          <Button
            ref={closeRef}
            variant="ghost-brand"
            size="icon"
            onClick={onExit}
            aria-label="Exit matrix view"
            title="Exit matrix view"
            className="shrink-0"
          >
            <X size={18} />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 px-1 shrink-0" aria-hidden="true">
          <Eyebrow size="xxs" className="text-center">Urgent</Eyebrow>
          <Eyebrow size="xxs" className="text-center">Not urgent</Eyebrow>
        </div>
        <div className="grid grid-cols-2 grid-rows-2 gap-2 flex-1 min-h-0">
          {QUADRANT_ORDER.map(q => (
            <GridCell
              key={q}
              quadrant={q}
              items={quadrants[q]}
              // Parked to-dos are unconditionally `later` — they ride along
              // only on this one cell, never derived per-quadrant.
              parkedItems={q === 'later' ? parkedTodos : EMPTY_PARKED}
              onComplete={onComplete}
              onEdit={onEdit}
              onToggleImportant={onToggleImportant}
              onPromote={onPromote}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

interface GridCellProps {
  quadrant: Quadrant;
  items: ToDo[];
  parkedItems: readonly ToDo[];
  onComplete: (id: string) => void;
  onEdit: (todo: ToDo) => void;
  onToggleImportant: (todo: ToDo) => void;
  onPromote: (todo: ToDo) => void;
}

// One quadrant cell of the landscape 2×2 Eisenhower grid: a fixed header
// (dot + title + count) above an independently scrolling list of compact
// chips. Empty cells still render so the 2×2 shape stays stable.
//
// The `later` cell additionally carries any parked ("saved for later")
// to-dos, grouped BELOW the real `later` items behind a compact subheader —
// the landscape overlay is height-starved (~375px), so this is a single
// small text row rather than a full section header like the list view's.
// The header count SPLITS ("4 + 2") the moment parked items are present, so
// they never inflate the committed-work count the number otherwise reads as.
const GridCell = React.memo(function GridCell({ quadrant, items, parkedItems, onComplete, onEdit, onToggleImportant, onPromote }: GridCellProps) {
  const meta = QUADRANT_SECTIONS[quadrant];
  const hasParked = parkedItems.length > 0;
  const countLabel = hasParked ? `${items.length} + ${parkedItems.length}` : `${items.length}`;
  const countAriaLabel = hasParked
    ? `${items.length} active, ${parkedItems.length} saved for later`
    : `${items.length}`;
  return (
    <section
      aria-label={`${meta.title} — ${meta.subtitle}`}
      data-testid={`grid-cell-${quadrant}`}
      className="flex flex-col min-h-0 overflow-hidden rounded-card border border-brand-200 bg-white dark:border-brand-700 dark:bg-brand-800"
    >
      <header className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-brand-100 dark:border-brand-700 shrink-0" title={meta.subtitle}>
        <span className={cn('w-2 h-2 rounded-full shrink-0', sectionDotColors[meta.color])} aria-hidden="true" />
        <h3 className="font-display text-sm font-semibold tracking-tight text-brand-900 dark:text-brand-50 truncate">{meta.title}</h3>
        <span
          className="ml-auto text-xs tabular-nums text-brand-400 dark:text-brand-450"
          aria-label={countAriaLabel}
        >
          {countLabel}
        </span>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {items.length === 0 && parkedItems.length === 0 ? (
          <p className="px-2.5 py-3 text-xs text-brand-400 dark:text-brand-450">Nothing here</p>
        ) : (
          <>
            {items.map(item => (
              <GridChip
                key={item.id}
                item={item}
                color={meta.color}
                onComplete={onComplete}
                onEdit={onEdit}
                onToggleImportant={onToggleImportant}
              />
            ))}
            {hasParked && (
              <>
                <div className="px-2.5 pt-1.5 pb-0.5 mt-0.5 border-t border-brand-100 dark:border-brand-700">
                  <span className="text-xxs font-semibold uppercase tracking-wide text-brand-400 dark:text-brand-450">
                    Saved for later
                  </span>
                </div>
                {parkedItems.map(item => (
                  <GridChip
                    key={item.id}
                    item={item}
                    color={meta.color}
                    variant="parked"
                    onPromote={onPromote}
                    onEdit={onEdit}
                    onToggleImportant={onToggleImportant}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
});

// Compact task chip inside a grid cell: complete-toggle, truncated title with
// due date (same color logic as list rows), star toggle. Tapping the body
// opens the existing edit drawer — no drag-and-drop between quadrants.
//
// `variant="parked"` mirrors TodoRow's own parked variant (never a fork):
// the leading complete-checkbox becomes a circular outline `+` that opens the
// promote sheet, and the due-date cluster is dropped entirely — a parked
// to-do's `completeByDate` is an inert placeholder (see the schema field
// comment), so rendering it would ship a fabricated date and, once the
// stamp-day passes, a fabricated red "Overdue" label.
const GridChip = React.memo(function GridChip({ item, color, variant = 'active', onComplete, onPromote, onEdit, onToggleImportant }: {
  item: ToDo;
  color: SectionColor;
  variant?: 'active' | 'parked';
  /** Required in practice for `variant="active"`. */
  onComplete?: (id: string) => void;
  /** Required in practice for `variant="parked"`. */
  onPromote?: (todo: ToDo) => void;
  onEdit: (todo: ToDo) => void;
  onToggleImportant: (todo: ToDo) => void;
}) {
  const isParked = variant === 'parked';
  const dueDate = isParked ? null : parseISO(item.completeByDate);
  const isOverdue = dueDate !== null && isBefore(dueDate, startOfToday());

  // F-TODO-16: the same category chip the list rows show, at chip-in-a-chip
  // scale. Read-only here — the grid overlay has no filter control to toggle,
  // and the landscape cells are too dense for another tap target. Absent /
  // blank category renders nothing, exactly as in the list. Still shown on a
  // parked chip — refining a parked idea's category is fine while parked.
  const categoryLabel = item.category?.trim() ?? '';
  const categoryColor = categoryLabel ? getTodoCategoryColor(categoryLabel) : null;

  return (
    // min-h-11 (44px) row + generous complete-toggle hit area: the immersive
    // overlay gives the chips room to meet touch-target size without a redesign.
    <div className="flex items-center gap-1.5 px-2 py-1.5 min-h-11 hairline-divider first:border-t-0">
      {isParked ? (
        /* "Saved for later": a circular outline PLUS in place of the complete
           checkbox — same geometry as the active checkbox below so the two
           states line up, accent-toned rather than neutral because promoting
           is a parked chip's primary (and only constructive) action. */
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPromote?.(item);
          }}
          aria-label={`Add to your list: ${item.text}`}
          className="group p-2.5 -m-1.5 shrink-0 rounded-full focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
        >
          <span className="w-4.5 h-4.5 rounded-full border-2 border-accent-500/60 text-accent-600 flex items-center justify-center transition-colors group-hover:border-accent-500 group-hover:bg-accent-50 group-active:bg-accent-100 dark:border-accent-400/60 dark:text-accent-300 dark:group-hover:border-accent-400 dark:group-hover:bg-accent-900/30">
            <Plus size={10} aria-hidden="true" />
          </span>
        </button>
      ) : (
        <HapticCheck
          checked={false}
          onCheckedChange={async () => {
            try {
              await onComplete?.(item.id);
              toast.success('To-Do completed!');
            } catch (error) {
              console.error('Failed to complete task:', error);
              toast.error('Failed to complete to-do');
            }
          }}
          className="p-2.5 -m-1.5 shrink-0"
          aria-label={`Complete task: ${item.text}`}
        >
          <span className="w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center transition-colors border-brand-300 group-hover:border-accent-500 group-hover:bg-accent-50 dark:border-brand-600 dark:group-hover:border-accent-400 dark:group-hover:bg-accent-900/30">
            <Check size={10} className="text-transparent group-hover:text-current group-active:text-current transition-colors" />
          </span>
        </HapticCheck>
      )}

      <button
        type="button"
        onClick={() => onEdit(item)}
        className="flex-1 min-w-0 text-left"
        aria-label={`Edit task: ${item.text}`}
      >
        <span className="block text-sm font-medium leading-snug text-brand-900 dark:text-brand-50 truncate">{item.text}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          {dueDate !== null && (
            isOverdue ? (
              <span className="block text-xxs font-semibold text-money-neg dark:text-money-negDark">
                Overdue ({format(dueDate, 'MMM d')})
              </span>
            ) : (
              <span className={cn('block text-xxs font-semibold', dateColorMap[color])}>
                {isToday(dueDate) ? 'Today' : isTomorrow(dueDate) ? 'Tomorrow' : format(dueDate, 'MMM d')}
              </span>
            )
          )}
          {categoryLabel && categoryColor && (
            <span
              data-testid="grid-chip-category"
              className={cn(
                'min-w-0 truncate rounded-full border px-1.5 text-xxs font-semibold',
                categoryColor.bg,
                categoryColor.text,
                categoryColor.border
              )}
            >
              {categoryLabel}
            </span>
          )}
        </span>
      </button>

      <Button
        variant="ghost-brand"
        size="icon-sm"
        onClick={(e) => { e.stopPropagation(); onToggleImportant(item); }}
        aria-label={item.isImportant ? `Unmark important: ${item.text}` : `Mark important: ${item.text}`}
        aria-pressed={item.isImportant === true}
        title={item.isImportant ? 'Unmark important' : 'Mark important'}
        className="shrink-0"
      >
        <Star
          size={14}
          className={item.isImportant ? 'text-warm-500 fill-warm-500' : 'text-brand-300 dark:text-brand-500'}
        />
      </Button>
    </div>
  );
});
