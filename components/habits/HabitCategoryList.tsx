import React, { useState, useEffect } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical } from 'lucide-react';
import { Habit } from '../../types/schema';
import HabitCard from './HabitCard';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';

interface HabitCategoryListProps {
  category: string;
  habits: Habit[];
}

const HabitCategoryList: React.FC<HabitCategoryListProps> = ({ category, habits }) => {
  // Local state for immediate reorder feedback
  const [items, setItems] = useState(habits);
  const { reorderHabits } = useHousehold();

  // Sync with props when not dragging (simple approach: sync when props change)
  useEffect(() => {
    setItems(habits);
  }, [habits]);

  const handleReorder = (newOrder: Habit[]) => {
    setItems(newOrder);
  };

  const handleSave = () => {
    // Calculate new orders and save
    // We use the current 'items' state

    // To preserve global ordering structure:
    // 1. Get the list of 'order' values currently assigned to these habits (sorted)
    // 2. Assign these values to the new habit arrangement in sequence
    // This effectively swaps the habits into the existing 'slots' for this category

    const existingOrders = items
      .map(h => h.order ?? 999)
      .sort((a, b) => a - b);

    const updates = items.map((h, index) => ({
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
      className="space-y-3"
      aria-label={`Habit list for ${category}`}
    >
      {items.map((habit) => (
        <ReorderableHabitItem
          key={habit.id}
          habit={habit}
          onSave={handleSave}
        />
      ))}
    </Reorder.Group>
  );
};

interface ReorderableItemProps {
  habit: Habit;
  onSave: () => void;
}

const ReorderableHabitItem: React.FC<ReorderableItemProps> = ({ habit, onSave }) => {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={habit}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onSave}
      style={{ position: 'relative' }} // ensure z-index works
      // Removed touch-none to allow vertical scrolling on the card itself.
      // Dragging is handled via the grip handle which has touch-none.
    >
      <HabitCard
        habit={habit}
        dragHandle={
          <div
            onPointerDown={(e) => controls.start(e)}
            className="cursor-grab active:cursor-grabbing touch-none p-1 focus:outline-none focus:ring-2 focus:ring-brand-400 rounded"
            title="Drag to reorder"
            tabIndex={0}
            role="button"
            aria-label="Drag handle"
          >
            <GripVertical size={16} />
          </div>
        }
      />
    </Reorder.Item>
  );
};

export default HabitCategoryList;
