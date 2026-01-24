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
    const updates = items.map((h, index) => ({
      id: h.id,
      order: index,
      // We don't change category here, just order within category
    }));
    reorderHabits(updates).catch(console.error);
  };

  return (
    <Reorder.Group axis="y" values={items} onReorder={handleReorder} className="space-y-3">
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
      className="touch-none" // Prevents scrolling while dragging? No, usually handled by dragListener
    >
      <HabitCard
        habit={habit}
        dragHandle={
          <div
            onPointerDown={(e) => controls.start(e)}
            className="cursor-grab active:cursor-grabbing touch-none p-1"
            title="Drag to reorder"
          >
            <GripVertical size={16} />
          </div>
        }
      />
    </Reorder.Item>
  );
};

export default HabitCategoryList;
