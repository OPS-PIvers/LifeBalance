import React, { useState } from 'react';
import { ToDo, HouseholdMember } from '@/types/schema';
import { SurfaceList } from '@/components/ui/Section';
import { ShowMoreRow } from '@/components/ui/ShowMoreRow';
import { type SectionColor, sectionDotColors } from './todoDisplay';
import { TodoRow } from './TodoRow';

// Moved verbatim from pages/ToDosPage.tsx (Plan 27) — used by both the list
// arrangement (still in ToDosPage) and the Eisenhower matrix view
// (components/todos/EisenhowerMatrixView.tsx).

export interface SectionProps {
  title: string;
  subtitle: string;
  /**
   * Render the subtitle for screen readers only. The Eisenhower quadrant
   * sections use this: their verb titles ("Do First") already encode the
   * urgent/important axis, so a visible caps subtitle would double-encode it —
   * the axis still reaches assistive tech through the sr-only text.
   */
  subtitleSrOnly?: boolean;
  items: ToDo[];
  color: SectionColor;
  onComplete: (id: string) => void;
  onUncomplete: (id: string) => void;
  onEdit: (todo: ToDo) => void;
  onDelete: (id: string) => void;
  onDuplicate: (todo: ToDo) => void;
  onMoveToTomorrow: (todo: ToDo) => void;
  onToggleImportant: (todo: ToDo) => void;
  onMore: (todo: ToDo) => void;
  /** F-TODO-08: toggle a subtask's done state from a row's expanded checklist. */
  onToggleSubtask: (todo: ToDo, subtaskId: string) => void;
  /** Pre-built member lookup map from page level — avoids rebuilding per-section. */
  memberMap: ReadonlyMap<string, HouseholdMember>;
  isSelectionMode: boolean;
  /** Full selection set — Section only re-renders when its own items' membership changes. */
  selectedIds: ReadonlySet<string>;
  onToggleSelection: (id: string) => void;
  /**
   * Optional cap on the rows rendered at once; when exceeded, a ShowMoreRow
   * expands the rest in place. Ignored while selection mode is active so
   * select-all/batch actions always operate on the full visible list.
   */
  maxVisible?: number;
}

// Sub-component for sections.
// Uses a custom memo comparator: when `selectedIds` changes, re-render is skipped unless
// at least one of this section's own items changed its selected/deselected state.
// This prevents toggling an item in one section from re-rendering the other two sections.
export const Section = React.memo(function Section({ title, subtitle, subtitleSrOnly, items, color, onComplete, onUncomplete, onEdit, onDelete, onDuplicate, onMoveToTomorrow, onToggleImportant, onMore, onToggleSubtask, memberMap, isSelectionMode, selectedIds, onToggleSelection, maxVisible }: SectionProps) {
  // Show-more state for capped lists (hooks must run before the empty early-return).
  const [expanded, setExpanded] = useState(false);

  // An empty section renders nothing. (The quick-add bar is no longer a section
  // row — it lives in a sticky card at the top of the page, so an empty
  // Immediate section can now collapse away entirely.)
  if (items.length === 0) return null;

  // In selection mode the full list always renders so select-all / batch
  // actions operate on everything the user expects — the cap is purely a
  // browsing affordance. Items are already priority-sorted by due date, so
  // slicing keeps the soonest-due tasks visible.
  const isCapped =
    maxVisible !== undefined && items.length > maxVisible && !expanded && !isSelectionMode;
  const visibleItems = isCapped ? items.slice(0, maxVisible) : items;

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-(--duration-slow)">
      <div className="flex items-baseline justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${sectionDotColors[color]}`}></div>
          <h2 className="font-display text-base font-semibold text-brand-900 dark:text-brand-50 tracking-tight">{title}</h2>
        </div>
        {subtitleSrOnly ? (
          <span className="sr-only">{subtitle}</span>
        ) : (
          <span className="text-xs font-semibold text-brand-400 dark:text-brand-450 uppercase tracking-wider">{subtitle}</span>
        )}
      </div>

      <SurfaceList className="[&>*:first-child]:border-t-0 [&>*:first-child_.hairline-divider]:border-t-0">
        {visibleItems.map(item => (
          <TodoRow
            key={item.id}
            item={item}
            color={color}
            assignee={memberMap.get(item.assignedTo)}
            isSelected={selectedIds.has(item.id)}
            isSelectionMode={isSelectionMode}
            onComplete={onComplete}
            onUncomplete={onUncomplete}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onMoveToTomorrow={onMoveToTomorrow}
            onToggleImportant={onToggleImportant}
            onMore={onMore}
            onToggleSelection={onToggleSelection}
            onToggleSubtask={onToggleSubtask}
          />
        ))}
        {maxVisible !== undefined && !isSelectionMode && items.length > maxVisible && (
          <ShowMoreRow
            hiddenCount={items.length - maxVisible}
            expanded={expanded}
            onToggle={() => setExpanded(v => !v)}
            noun="task"
          />
        )}
      </SurfaceList>
    </div>
  );
}, (prev: SectionProps, next: SectionProps) => {
  // Fast-path: if the section's items array reference changed, always re-render.
  if (prev.items !== next.items) return false;
  // Check non-set props with reference equality (callbacks are stable via useCallback).
  const sameOtherProps =
    prev.isSelectionMode === next.isSelectionMode &&
    prev.memberMap === next.memberMap &&
    prev.color === next.color &&
    prev.title === next.title &&
    prev.subtitle === next.subtitle &&
    prev.subtitleSrOnly === next.subtitleSrOnly &&
    prev.maxVisible === next.maxVisible &&
    prev.onComplete === next.onComplete &&
    prev.onUncomplete === next.onUncomplete &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete &&
    prev.onDuplicate === next.onDuplicate &&
    prev.onMoveToTomorrow === next.onMoveToTomorrow &&
    prev.onToggleImportant === next.onToggleImportant &&
    prev.onMore === next.onMore &&
    prev.onToggleSubtask === next.onToggleSubtask &&
    prev.onToggleSelection === next.onToggleSelection;
  if (!sameOtherProps) return false;
  // selectedIds reference changed — only re-render if at least one item in THIS
  // section switched its selected/deselected state.
  if (prev.selectedIds === next.selectedIds) return true;
  return !prev.items.some(
    item => prev.selectedIds.has(item.id) !== next.selectedIds.has(item.id)
  );
});
