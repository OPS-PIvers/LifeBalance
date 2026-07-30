import React, { useCallback, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { Habit } from '@/types/schema';
import HabitCard from './HabitCard';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import type { HabitRowMemberContext } from '@/utils/habitRowAttribution';

interface HabitCategoryListProps {
  category: string;
  habits: Habit[];
  /**
   * Per-member attribution context, built ONCE on the Habits page and threaded
   * down by identity — a card subscribing to the core slice itself would
   * re-render every row on any household change.
   */
  attribution?: HabitRowMemberContext;
}

const HabitCategoryList: React.FC<HabitCategoryListProps> = ({ category, habits, attribution }) => {
  // Local state for immediate reorder feedback during drag only.
  // While the user is dragging we show `dragItems`; once the drag ends we
  // persist to Firestore and immediately go back to reading from props (the
  // Firestore snapshot). This removes the need for a synchronising useEffect
  // and avoids the cascading-render anti-pattern.
  const [dragItems, setDragItems] = useState<Habit[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const { reorderHabits } = useGamification();

  // Use the optimistic local order while dragging; fall back to the
  // Firestore-synced props otherwise.
  const items = isDragging ? dragItems : habits;

  const handleReorder = (newOrder: Habit[]) => {
    setIsDragging(true);
    setDragItems(newOrder);
  };

  const handleSave = () => {
    // `isDragging` is the load-bearing guard, and it has to be: a press on the
    // grip that never actually moved anything fires no `onReorder`, only
    // `onDragEnd`. Without this, that tap ran the whole save path — on the
    // first press with an empty `dragItems` (an empty batch, but still a
    // "Habits reordered" toast for a gesture that reordered nothing), and from
    // the second press onward with the PREVIOUS drag's `dragItems`, which is
    // deliberately never cleared. That stale array is the dangerous case: if a
    // habit has since been deleted elsewhere, the batch updates a missing doc
    // and the whole commit fails. So don't collapse this into a
    // `dragItems.length` check — that only catches the very first press.
    if (!isDragging) return;
    setIsDragging(false);
    if (dragItems.length === 0) return;

    // Calculate new orders and save.
    // To preserve global ordering structure:
    // 1. Get the list of 'order' values currently assigned to these habits (sorted).
    // 2. Assign these values to the new habit arrangement in sequence.
    // This effectively swaps the habits into the existing 'slots' for this category.

    const existingOrders = dragItems.map(h => h.order ?? 999).sort((a, b) => a - b);

    const updates = dragItems.map((h, index) => ({
      id: h.id,
      order: existingOrders[index] ?? index, // Fallback to index if orders ran out (unlikely)
      // We don't change category here, just order within category
    }));
    reorderHabits(updates).catch(console.error);
  };

  return (
    <Reorder.Group
      axis="y"
      values={items}
      onReorder={handleReorder}
      // Hand-rolled SurfaceList (this is a Reorder.Group, not a <div>), with one
      // deliberate difference: NO `overflow-hidden`. HabitCard's desktop kebab
      // dropdown is anchored inside its own row and is much taller than it, so
      // the usual grouped-surface clip sliced it off — on the last row of a
      // category almost the whole menu disappeared.
      //
      // Dropping the clip alone is NOT enough here. Unlike BudgetAccounts' rows
      // (which paint no background and so can just use
      // `<SurfaceList className="overflow-visible">`), habit rows paint their
      // own surface — white/brand-800, or a money-bg tint while active — so
      // without the clip their SQUARE corners poke past this container's
      // rounded-card border. The edge rows therefore round their own background
      // instead: `>*:first-child` inside each Reorder.Item is HabitCard's
      // ListRow, the element that actually paints the row.
      className="surface-section overflow-visible [&>*:first-child]:border-t-0 [&>*:first-child>*:first-child]:rounded-t-card [&>*:last-child>*:first-child]:rounded-b-card"
      aria-label={`Habit list for ${category}`}
    >
      {items.map(habit => (
        <ReorderableHabitItem
          key={habit.id}
          habit={habit}
          onSave={handleSave}
          attribution={attribution}
        />
      ))}
    </Reorder.Group>
  );
};

interface ReorderableItemProps {
  habit: Habit;
  onSave: () => void;
  attribution?: HabitRowMemberContext;
}

const ReorderableHabitItem: React.FC<ReorderableItemProps> = ({ habit, onSave, attribution }) => {
  const controls = useDragControls();

  // Stable identity so HabitCard's memo comparator holds across re-renders
  // (the old inline dragHandle JSX broke the memo on every parent render).
  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => controls.start(e),
    [controls]
  );

  return (
    <Reorder.Item
      value={habit}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onSave}
      style={{ position: 'relative' }} // ensure z-index works
      // hairline-divider draws the 1px separator between rows; the parent
      // SurfaceList suppresses it on the first row.
      className="hairline-divider"
      // Search deep-link target (see useScrollToHighlight) — applied
      // imperatively via DOM classList, so it doesn't need a prop threaded
      // through HabitCard's memo comparator.
      data-highlight-target={habit.id}
      // Removed touch-none to allow vertical scrolling on the card itself.
      // Dragging is handled via the grip handle which has touch-none.
    >
      <HabitCard habit={habit} onGripPointerDown={startDrag} attribution={attribution} />
    </Reorder.Item>
  );
};

export default HabitCategoryList;
