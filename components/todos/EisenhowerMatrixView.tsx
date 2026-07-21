import React from 'react';
import { QUADRANT_ORDER, type Quadrant } from '@/utils/eisenhower';
import { ToDo, HouseholdMember } from '@/types/schema';
import { Section } from './Section';
import { QUADRANT_SECTIONS } from './todoDisplay';

// Extracted from pages/ToDosPage.tsx (Plan 27) — the
// `effectiveArrangement === 'matrix'` render branch, moved verbatim. Same
// tasks as the list arrangement, partitioned by urgency (derived from due
// date, same window as Immediate) × importance (the star). Stacked sections
// in actionability order; the quick-add bar lives in a sticky card above the
// sections (page level), shared with the list arrangement.

export interface EisenhowerMatrixViewProps {
  quadrants: Record<Quadrant, ToDo[]>;
  memberMap: ReadonlyMap<string, HouseholdMember>;
  isSelectionMode: boolean;
  selectedIds: ReadonlySet<string>;
  onComplete: (id: string) => void;
  onUncomplete: (id: string) => void;
  onEdit: (todo: ToDo) => void;
  onDelete: (id: string) => void;
  /** Opens the Task-options drawer (long-press / context-menu on a row). */
  onMore: (todo: ToDo) => void;
  onToggleSelection: (id: string) => void;
}

export const EisenhowerMatrixView: React.FC<EisenhowerMatrixViewProps> = ({
  quadrants,
  memberMap,
  isSelectionMode,
  selectedIds,
  onComplete,
  onUncomplete,
  onEdit,
  onDelete,
  onMore,
  onToggleSelection,
}) => (
  <>
    {QUADRANT_ORDER.map((q) => (
      <Section
        key={q}
        title={QUADRANT_SECTIONS[q].title}
        // The verb title already encodes the axis — the visible caps subtitle
        // double-encoded it, so it's sr-only here (matches the 2×2 grid view,
        // which carries the axis in each cell's aria-label/tooltip only).
        subtitle={QUADRANT_SECTIONS[q].subtitle}
        subtitleSrOnly
        items={quadrants[q]}
        color={QUADRANT_SECTIONS[q].color}
        maxVisible={q === 'later' ? 5 : undefined}
        onComplete={onComplete}
        onUncomplete={onUncomplete}
        onEdit={onEdit}
        onDelete={onDelete}
        onMore={onMore}
        memberMap={memberMap}
        isSelectionMode={isSelectionMode}
        selectedIds={selectedIds}
        onToggleSelection={onToggleSelection}
      />
    ))}
  </>
);
