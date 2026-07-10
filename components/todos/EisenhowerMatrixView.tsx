import React from 'react';
import { QUADRANT_ORDER, type Quadrant } from '@/utils/eisenhower';
import { ToDo, HouseholdMember } from '@/types/schema';
import { Section } from './Section';
import { QUADRANT_SECTIONS } from './todoDisplay';

// Extracted from pages/ToDosPage.tsx (Plan 27) — the
// `effectiveArrangement === 'matrix'` render branch, moved verbatim. Same
// tasks as the list arrangement, partitioned by urgency (derived from due
// date, same window as Immediate) × importance (the star). Stacked sections
// in actionability order; quick-add stays row one of the first section.

export interface EisenhowerMatrixViewProps {
  quadrants: Record<Quadrant, ToDo[]>;
  memberMap: ReadonlyMap<string, HouseholdMember>;
  isSelectionMode: boolean;
  selectedIds: ReadonlySet<string>;
  /** Rendered as the first row of the first (Do First) section. */
  quickAddRow: React.ReactNode;
  onComplete: (id: string) => void;
  onEdit: (todo: ToDo) => void;
  onDelete: (id: string) => void;
  onDuplicate: (todo: ToDo) => void;
  onMoveToTomorrow: (todo: ToDo) => void;
  onToggleImportant: (todo: ToDo) => void;
  onMore: (todo: ToDo) => void;
  onToggleSelection: (id: string) => void;
}

export const EisenhowerMatrixView: React.FC<EisenhowerMatrixViewProps> = ({
  quadrants,
  memberMap,
  isSelectionMode,
  selectedIds,
  quickAddRow,
  onComplete,
  onEdit,
  onDelete,
  onDuplicate,
  onMoveToTomorrow,
  onToggleImportant,
  onMore,
  onToggleSelection,
}) => (
  <>
    {QUADRANT_ORDER.map((q, idx) => (
      <Section
        key={q}
        title={QUADRANT_SECTIONS[q].title}
        subtitle={QUADRANT_SECTIONS[q].subtitle}
        items={quadrants[q]}
        color={QUADRANT_SECTIONS[q].color}
        maxVisible={q === 'later' ? 5 : undefined}
        onComplete={onComplete}
        onEdit={onEdit}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onMoveToTomorrow={onMoveToTomorrow}
        onToggleImportant={onToggleImportant}
        onMore={onMore}
        memberMap={memberMap}
        isSelectionMode={isSelectionMode}
        selectedIds={selectedIds}
        onToggleSelection={onToggleSelection}
        addRow={idx === 0 ? quickAddRow : undefined}
      />
    ))}
  </>
);
